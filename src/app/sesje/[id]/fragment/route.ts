import { spawn } from "node:child_process";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { AUDIO_CUT_ENABLED } from "@/lib/audio-cut";

/**
 * @module
 * `GET /sesje/[id]/fragment?segment=...&do=...` — wycina fragment nagrania
 * jednego bloku wypowiedzi jako mp3 do pobrania/zacytowania poza serwisem.
 *
 * @remarks Granica zaufania
 * Trasa nie ma odpowiednika `requireManager()` — dowolny klient, także
 * niezalogowany, może ją wywołać wprost. Jedyną barierą dostępu jest RLS na
 * `segment`/`meeting`: zapytania `.select()` w {@link GET} zwrócą `null` dla
 * wiersza, którego wywołujący nie ma prawa czytać, i trasa kończy się 404
 * zanim ffmpeg w ogóle wystartuje. Skuteczność tej bariery zależy więc
 * całkowicie od polityk RLS na tych dwóch tabelach — nie są one zdefiniowane
 * w skryptach SQL tego repo, więc nie da się tego potwierdzić samą lekturą
 * kodu; do zweryfikowania bezpośrednio w Supabase.
 *
 * @remarks Parametry wejściowe
 * - `params.id` (ścieżka) — id sesji (`meeting.id`); służy tylko do
 *   dopasowania przeciw `segment.meeting_id` ({@link GET}), nie trafia
 *   bezpośrednio do żadnego zapytania zapisu ani do polecenia powłoki.
 * - `segment` (query, wymagany) — id wiersza `segment`; wybiera, KTÓRY
 *   wiersz zostanie odczytany, ale sam odczyt i tak przechodzi przez RLS,
 *   więc nie daje dostępu do segmentów spoza uprawnień wywołującego.
 * - `do` (query, wymagany, liczba) — sekunda końca wycinka; jedyny
 *   parametr, który bezpośrednio wpływa na czas trwania procesu ffmpeg
 *   (`duration = min(do - segment.start_time, MAX_FRAGMENT_SECONDS)`).
 *   `Number()` na dowolnym tekście — `NaN` jest odrzucane przez
 *   `Number.isFinite`, ale wartości ujemne lub absurdalnie duże przechodzą
 *   dalej i dopiero tam są przycinane przez `Math.min` oraz test
 *   `duration > 0`.
 *
 * @remarks Algorytm cięcia
 * `ffmpeg -ss <start> -i <url> -t <duration>`, z `-ss` PRZED `-i`: ffmpeg
 * liczy pozycję startu z playlisty HLS i pobiera tylko potrzebne segmenty
 * `.ts`, więc kilkuminutowy wycinek z kilkugodzinnej sesji kosztuje sekundy,
 * nie czas całego nagrania. Wyjście jest strumieniowane do klienta
 * (`ReadableStream` opakowujący `ffmpeg.stdout`) z prostą kontrolą
 * przepływu: gdy `controller.desiredSize` spada do zera, strumień ffmpeg
 * jest wstrzymywany (`pause()`), żeby wolny odbiorca nie zapychał pamięci
 * procesu buforem wyjściowym; `pull()` go wznawia.
 *
 * @remarks STRIDE
 * - **Spoofing**: nie dotyczy — trasa nie identyfikuje wywołującego poza
 *   tym, co niesie sesja Supabase użyta przez RLS.
 * - **Tampering**: `meeting.video_url` przekazywany do ffmpeg pochodzi z
 *   bazy (pisany tylko przez import/admina), nie z żądania — klient nie
 *   kontroluje URL-a przekazywanego do procesu. `spawn()` dostaje argumenty
 *   jako tablicę, bez powłoki, więc klasyczna iniekcja przez `;`/`` w
 *   parametrach query nie ma tu wektora, nawet gdyby `segmentId`/`do`
 *   trafiały do ffmpeg wprost (nie trafiają — tylko wyliczone `start`/
 *   `duration`, oba liczby).
 * - **Repudiation**: brak logu „kto wyciął jaki fragment” — błędy ffmpeg
 *   lecą do `console.error`, ale udane pobrania nie zostawiają śladu poza
 *   ewentualnymi logami serwera HTTP.
 * - **Information disclosure**: nazwa pliku w `Content-Disposition` ujawnia
 *   `full_name` radnego powiązanego z segmentem (patrz
 *   {@link fragmentFilename}) — zamierzone (atrybucja cytatu), ale znaczy,
 *   że nazwa pliku może wynieść personalia poza kontekst, w którym RLS by
 *   je pokazało, jeśli sam plik krąży dalej bez linku źródłowego.
 * - **Denial of service**: jedyna trasa w serwisie uruchamiająca ffmpeg
 *   (koszt CPU/transferu per żądanie) — chroniona limitem 20 żądań/10 min
 *   na IP (`checkRateLimit`, patrz `src/lib/rate-limit.ts`) i twardym
 *   pułapem `MAX_FRAGMENT_SECONDS` (20 min) na długość wycinka,
 *   niezależnie od `do`. Limiter jest per-proces w pamięci — restart
 *   procesu zeruje liczniki, a wdrożenie wieloprocesowe ominęłoby limit per
 *   instancję; obecnie nieistotne (jeden proces `next start`), ale trzeba
 *   pamiętać przy skalowaniu.
 * - **Elevation of privilege**: nie dotyczy — trasa tylko odczytuje i tnie
 *   audio, nic nie zapisuje i nie zmienia uprawnień.
 *
 * @remarks Dostępność
 * Trasa działa tylko tam, gdzie jest zainstalowany `ffmpeg` i gdzie
 * `AUDIO_CUT_ENABLED` (`RADA_AUDIO_CUT` w `.env.local`) jest ustawione —
 * czyli na serwerze domowym (systemd), nie na Vercelu. Bez tej flagi trasa
 * zawsze zwraca 404, więc dla klienta wygląda jak nieistniejąca, a przycisk
 * pobierania po prostu się nie renderuje.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dłuższy wycinek to już nie cytat, tylko kopia sesji. */
const MAX_FRAGMENT_SECONDS = 20 * 60;

/**
 * @param request - żądanie HTTP; czytane pola: `url.searchParams` (`segment`,
 *   `do` — patrz „Parametry wejściowe” w dokumentacji modułu) oraz nagłówki
 *   do identyfikacji klienta na potrzeby rate limitu (`clientIp`).
 * @param params.params - `Promise` z `{ id }`, id sesji ze ścieżki
 *   `/sesje/[id]/fragment` (konwencja Next.js dla dynamic route segments).
 * @returns strumieniowana odpowiedź `audio/mpeg` (200); albo błąd: 404
 *   (trasa wyłączona / sesja lub segment nie znaleziony / brak nagrania),
 *   400 (brakujące parametry / pusty wycinek po przycięciu), 429
 *   (przekroczony rate limit, z nagłówkiem `Retry-After`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!AUDIO_CUT_ENABLED) {
    return new Response("Nie znaleziono", { status: 404 });
  }

  const { id: meetingId } = await params;
  const url = new URL(request.url);
  const segmentId = url.searchParams.get("segment");
  const endParam = Number(url.searchParams.get("do"));

  if (!segmentId || !Number.isFinite(endParam)) {
    return new Response("Brakuje parametrów", { status: 400 });
  }

  // Krojenie kosztuje procesor i transfer, więc jest jedyną trasą w serwisie
  // z własnym limitem — patrz src/lib/rate-limit.ts (licznik żyje w pamięci
  // procesu, co przy tym jednoprocesowym wdrożeniu wystarcza).
  const limit = checkRateLimit(`fragment:${clientIp(request.headers)}`, {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.allowed) {
    return new Response("Za dużo pobrań, spróbuj za chwilę", {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const supabase = await createClient();

  // Z klienta przychodzi tylko id segmentu i koniec bloku — początek, sesja i
  // atrybucja pochodzą z bazy, przez RLS. Kto nie ma prawa czytać sesji, nie
  // wytnie sobie z niej audio.
  const [{ data: segment }, { data: meeting }] = await Promise.all([
    supabase
      .from("segment")
      .select(
        "start_time, meeting_id, councilor:confirmed_councilor_id(full_name)"
      )
      .eq("id", segmentId)
      .maybeSingle(),
    supabase
      .from("meeting")
      .select("date, video_url")
      .eq("id", meetingId)
      .maybeSingle(),
  ]);

  if (!segment || !meeting || segment.meeting_id !== meetingId) {
    return new Response("Nie znaleziono", { status: 404 });
  }
  if (!meeting.video_url) {
    return new Response("Ta sesja nie ma podpiętego nagrania", { status: 404 });
  }

  const start = Number(segment.start_time);
  const duration = Math.min(endParam - start, MAX_FRAGMENT_SECONDS);
  if (!(duration > 0)) {
    return new Response("Pusty fragment", { status: 400 });
  }

  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(start),
      "-i",
      meeting.video_url,
      "-t",
      String(duration),
      "-vn",
      "-acodec",
      "libmp3lame",
      "-b:a",
      "96k",
      "-f",
      "mp3",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  // Szczegóły błędów ffmpeg lecą do logów serwera, nie do przeglądarki.
  ffmpeg.stderr.on("data", (chunk: Buffer) =>
    console.error("[fragment] ffmpeg:", chunk.toString().trim())
  );

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      ffmpeg.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
        // Prosta kontrola przepływu: jak przeglądarka nie nadąża odbierać,
        // ffmpeg czeka, zamiast zapychać pamięć procesu.
        if ((controller.desiredSize ?? 0) <= 0) ffmpeg.stdout.pause();
      });
      ffmpeg.stdout.on("end", () => controller.close());
      ffmpeg.on("error", (error) => controller.error(error));
    },
    pull() {
      ffmpeg.stdout.resume();
    },
    cancel() {
      ffmpeg.kill("SIGKILL");
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        fragmentFilename(segment.councilor?.full_name, meeting.date, start)
      )}`,
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Nazwa pliku niesie atrybucję: kto, z której sesji i od której sekundy.
 * Wycinek krążący poza serwisem daje się wtedy sprawdzić u źródła.
 *
 * @param councilorName - `full_name` przypisanego radnego, albo
 *   `null`/`undefined` gdy segment nie ma potwierdzonego mówcy (wtedy
 *   używane jest „wypowiedz”).
 * @param date - data sesji (`meeting.date`, ISO `YYYY-MM-DD`).
 * @param start - sekunda początku wycinka w nagraniu (`segment.start_time`).
 * @returns nazwa pliku bez ścieżki, np.
 *   `Jan-Kowalski_2026-08-22_01-23-45.mp3`; znaki spoza liter/cyfr w
 *   `councilorName` są zamieniane na `-` (`replace(/[^\p{L}\p{N}]+/gu,
 *   "-")`), żeby nazwa była bezpieczna jako nazwa pliku w każdym systemie
 *   plików i w nagłówku `Content-Disposition`.
 */
function fragmentFilename(
  councilorName: string | null | undefined,
  date: string,
  start: number
) {
  const who = (councilorName ?? "wypowiedz").replace(/[^\p{L}\p{N}]+/gu, "-");
  const clock = new Date(Math.floor(start) * 1000)
    .toISOString()
    .slice(11, 19)
    .replace(/:/g, "-");
  return `${who}_${date}_${clock}.mp3`;
}
