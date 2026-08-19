import { spawn } from "node:child_process";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { AUDIO_CUT_ENABLED } from "@/lib/audio-cut";

// Wycinek nagrania dla jednego bloku wypowiedzi — mp3 do zacytowania poza
// serwisem.
//
// ffmpeg czyta wprost z HLS-a sesji, z `-ss` PRZED `-i`: pozycję liczy wtedy
// z playlisty i ściąga tylko potrzebne kawałki .ts, więc kilkuminutowy
// fragment schodzi w sekundy, bez pobierania całej sesji.
//
// Trasa istnieje tylko tam, gdzie jest ffmpeg — czyli na serwerze domowym
// (usługa systemd czyta .env.local), nie na Vercelu. Bez zmiennej
// RADA_AUDIO_CUT wygląda jak nieistniejąca, a przycisk się nie renderuje.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dłuższy wycinek to już nie cytat, tylko kopia sesji. */
const MAX_FRAGMENT_SECONDS = 20 * 60;

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
