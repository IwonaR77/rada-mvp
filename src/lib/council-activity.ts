import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Łączny czas mówienia jednego radnego w kadencji — podstawa podium
 * „najaktywniejsi / milczący" i porównań na profilu radnego.
 */
export type CouncilorStat = {
  id: string;
  fullName: string;
  /** Klub radnego; `null`, gdy rada go nie podaje (tak jest dziś w obu radach). */
  party: string | null;
  /**
   * Suma długości otagowanych wypowiedzi. Zero znaczy „nikt nie otagował",
   * a nie „milczał" — przy niskim pokryciu tagowania te dwa przypadki są
   * nierozróżnialne i nie wolno ich mylić w tekstach o konkretnych osobach.
   */
  totalSeconds: number;
};

/** Komplet danych o mówieniu w jednej kadencji: podium, heatmapa i jej osie. */
export type SpeakingActivity = {
  /** Skład rady w tej kadencji — wiersze heatmapy, także ci z zerem sekund. */
  councilors: { id: string; fullName: string }[];
  /** Kolumny heatmapy: sesje z zaimportowanym transkryptem, od najnowszej. */
  heatmapMeetings: {
    id: string;
    date: string;
    title: string | null;
    /** Numer sesji w kadencji — ta sama numeracja co w nawigacji i nagłówku
        transkryptu: pozycja chronologiczna wśród posiedzeń rady (bez komisji). */
    number: number;
  }[];
  /**
   * Sekundy mówienia: `[id mówcy][id sesji]`. Brak klucza = brak wypowiedzi.
   *
   * Liczone per BLOK (przylegające segmenty jednego mówcy, od początku
   * pierwszego do końca ostatniego), a nie przez sumowanie długości
   * pojedynczych segmentów — pauza w środku jednej ciągłej wypowiedzi to
   * nadal czas, w którym mówca trzymał głos. Różnica na dzisiejszych danych
   * to +17%. Szczegóły i uzasadnienie progu: `term_speaking_blocks`
   * w `scripts/migrate-speaking-blocks.sql`.
   *
   * Uwaga: `stats` (podium) liczy nadal per segment, więc suma wiersza
   * heatmapy jest WYŻSZA niż `totalSeconds` tej samej osoby. To świadoma
   * różnica, nie rozjazd do naprawienia w locie — zmiana `stats` przesunęłaby
   * wszystkie dotychczasowe liczby na profilach radnych.
   */
  heatmapMatrix: Record<string, Record<string, number>>;
  /**
   * Dodatkowe wiersze heatmapy dla urzędników (burmistrz, jego zastępca,
   * zbiorczy wiersz „Pozostali urzędnicy”) — dołączane pod składem rady.
   * Pusta tablica dla rady, w której nikt taki nie wystąpił.
   */
  heatmapExtraRows: { id: string; fullName: string }[];
  stats: CouncilorStat[];
};

/**
 * Przerwa (w sekundach), po której blok się kończy, mimo że kolejny segment
 * należy do tego samego mówcy. Bez progu pojedynczy błąd tagowania potrafi
 * skleić dwugodzinny „blok" — taki w bazie jest. Wartości 30–120 s dają wyniki
 * w granicach 2% od siebie, więc to nie jest pokrętło do strojenia liczb.
 */
const SPEAKING_BLOCK_MAX_GAP_SECONDS = 60;

/**
 * Role pozycji technicznych z listy mówców — wpisów, które nie są osobami.
 *
 * Trzymane po roli, nie po nazwisku: nazwę etykiety można kiedyś zmienić,
 * a rola jest tym, co je klasyfikuje (patrz scripts/seed-nieustalony-mowca.sql
 * i scripts/seed-halucynacja.sql).
 */
const ROLE_TECHNICZNE = new Set(["Nie do ustalenia", "Błąd rozpoznawania mowy"]);

const EMPTY_ACTIVITY: SpeakingActivity = {
  councilors: [],
  heatmapMeetings: [],
  heatmapMatrix: {},
  heatmapExtraRows: [],
  stats: [],
};

/**
 * Liczy, kto ile mówił w danej kadencji, i składa z tego dane pod podium
 * i heatmapę.
 *
 * Wspólne dla huba rady (tylko najnowsza kadencja, bez przełącznika) i
 * `/sesje` (pełne przełączanie kadencji) — ta sama arytmetyka i ten sam
 * kształt heatmapy, żeby nie rozjechały się w dwie implementacje.
 *
 * Liczone są **wyłącznie segmenty o statusie `finalized`**: propozycje
 * przypisania mówcy (redaktorskie i te z rozpoznawania głosu) nie mogą
 * wpływać na publiczne statystyki o konkretnych osobach, dopóki nie
 * zatwierdzi ich moderator.
 *
 * @param supabase Klient serwerowy — funkcja liczy po stronie serwera i
 *   podlega RLS wołającego.
 * @param termId Kadencja; wyznacza jednocześnie radę, bo `term` należy do
 *   dokładnie jednej rady.
 * @param officials Urzędnicy **tej samej rady** co kadencja. Lista przychodzi
 *   z zewnątrz, bo wołający i tak ją pobiera do innych celów — ale musi być
 *   zakresowana radą (`official.council_id`), inaczej urzędnicy jednej rady
 *   trafią do heatmapy drugiej.
 * @returns Puste `SpeakingActivity`, gdy kadencja nie ma składu; nigdy nie
 *   rzuca wyjątku przy braku danych.
 *
 * @remarks
 * Wyróżnienie burmistrza i jego zastępcy osobnymi wierszami jest z natury
 * gminne. W radzie powiatu starosta i zarząd **są radnymi**, więc siedzą już
 * w składzie rady, a `heatmapExtraRows` obejmie tam co najwyżej urzędników
 * starostwa — to poprawne zachowanie, nie brakująca obsługa.
 */
export async function getSpeakingActivity(
  supabase: SupabaseClient,
  termId: string,
  officials: { id: string; full_name: string; role: string }[]
): Promise<SpeakingActivity> {
  const [{ data: roster }, segments, { data: meetingRows }, { data: blockRows }] =
    await Promise.all([
    supabase
      .from("councilor_term")
      .select("party, councilor:councilor_id(id, full_name)")
      .eq("term_id", termId),
    // See the same note in /sesje/[id]/page.tsx — a single .range() request
    // can't exceed PostgREST's server-side max-rows cap no matter how wide
    // a range is asked for; paginate instead.
    fetchAllRows<{
      confirmed_councilor_id: string | null;
      confirmed_official_id: string | null;
      meeting_id: string;
      start_time: number;
      end_time: number;
    }>((from, to) =>
      supabase
        .from("segment")
        .select(
          "confirmed_councilor_id, confirmed_official_id, meeting_id, start_time, end_time, meeting:meeting_id!inner(term_id)"
        )
        .eq("status", "finalized")
        .eq("meeting.term_id", termId)
        .range(from, to)
    ),
    supabase
      .from("meeting")
      .select("id, date, title, transcript_status")
      .eq("term_id", termId)
      // Komisja meetings share this table but aren't "sesje" — currently
      // excluded from the heatmap anyway by the transcript_status filter
      // below (nothing sets 'rozpisana' on a komisja meeting today), but
      // that's an indirect invariant, not an enforced one — filter here
      // too rather than rely on it staying true.
      .neq("meeting_type", "komisja")
      .order("date", { ascending: false }),
    // Bloki liczy baza, nie aplikacja: poprawny podział wymaga kolejności
    // WSZYSTKICH segmentów sesji, także nieotagowanych, a powyższy fetch
    // ściąga wyłącznie `finalized` — patrz komentarz przy funkcji.
    supabase.rpc("term_speaking_blocks", {
      p_term_id: termId,
      p_max_gap: SPEAKING_BLOCK_MAX_GAP_SECONDS,
    }),
  ]);

  if (!roster) return EMPTY_ACTIVITY;

  const councilors = roster
    .filter((r) => r.councilor)
    .map((r) => ({ id: r.councilor!.id, fullName: r.councilor!.full_name }));

  const heatmapMatrix: Record<string, Record<string, number>> = {};

  // Podium liczy nadal per segment — patrz uwaga przy `heatmapMatrix`.
  const totals = new Map<string, number>();
  for (const s of segments) {
    if (!s.confirmed_councilor_id) continue;
    const duration = Number(s.end_time) - Number(s.start_time);
    totals.set(
      s.confirmed_councilor_id,
      (totals.get(s.confirmed_councilor_id) ?? 0) + duration
    );
  }

  // Burmistrz and his deputy get their own heatmap rows (they're frequent,
  // named participants); every other official (skarbnik, sekretarz,
  // naczelnicy, urzędnicy odpowiadający na interpelacje, ...) is folded
  // into one combined "Pozostali urzędnicy" row so the heatmap doesn't
  // grow a long tail of near-empty rows for people who spoke once or twice.
  const burmistrz = officials.find((o) =>
    o.role.toLowerCase().startsWith("burmistrz")
  );
  const zastepcaBurmistrza = officials.find((o) =>
    o.role.toLowerCase().startsWith("zastępca burmistrza")
  );
  const POZOSTALI_URZEDNICY_ID = "__pozostali_urzednicy__";
  const pozostaliIds = new Set(
    officials
      .filter((o) => o.id !== burmistrz?.id && o.id !== zastepcaBurmistrza?.id)
      // Pozycje techniczne, nie osoby: „Nieustalony mówca" znaczy
      // „sprawdzone, nie da się ustalić kto mówi", a „Halucynacja
      // transkrypcji" — że tych słów w ogóle nikt nie wypowiedział.
      // Wpuszczenie ich do wiersza „Pozostali urzędnicy" dopisywałoby
      // urzędnikom czas wypowiedzi, które nie są ich (albo niczyje).
      .filter((o) => !ROLE_TECHNICZNE.has(o.role))
      .map((o) => o.id)
  );
  let pozostaliHasData = false;

  // Jeden przebieg po wynikach RPC — radni trafiają do heatmapy pod własnym
  // id, urzędnicy przez powyższe składanie wierszy.
  for (const row of blockRows ?? []) {
    const seconds = Number(row.total_seconds);
    const key = row.is_councilor_flag
      ? row.speaker_id
      : row.speaker_id === burmistrz?.id
        ? burmistrz.id
        : row.speaker_id === zastepcaBurmistrza?.id
          ? zastepcaBurmistrza.id
          : pozostaliIds.has(row.speaker_id)
            ? POZOSTALI_URZEDNICY_ID
            : null;
    if (!key) continue;
    if (key === POZOSTALI_URZEDNICY_ID) pozostaliHasData = true;
    heatmapMatrix[key] ??= {};
    heatmapMatrix[key][row.mtg_id] =
      (heatmapMatrix[key][row.mtg_id] ?? 0) + seconds;
  }

  const heatmapExtraRows = [
    ...(burmistrz ? [{ id: burmistrz.id, fullName: burmistrz.full_name }] : []),
    ...(zastepcaBurmistrza
      ? [{ id: zastepcaBurmistrza.id, fullName: zastepcaBurmistrza.full_name }]
      : []),
    ...(pozostaliHasData
      ? [{ id: POZOSTALI_URZEDNICY_ID, fullName: "Pozostali urzędnicy" }]
      : []),
  ];

  // A session shows up as a column as soon as its transcript is imported
  // (transcript_status "rozpisana"), even before anyone's been tagged — it
  // just renders fully gray until tagging starts filling it in.
  // Numer liczony po WSZYSTKICH posiedzeniach kadencji, nie po samych
  // rozpisanych: numeracja ma się zgadzać z tą w nawigacji między sesjami,
  // a nie przeskakiwać za każdym razem, gdy dochodzi nowy transkrypt.
  const numerSesji = new Map<string, number>();
  [...(meetingRows ?? [])]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .forEach((m, i) => numerSesji.set(m.id, i + 1));

  const heatmapMeetings = (meetingRows ?? [])
    .filter((m) => m.transcript_status === "rozpisana")
    .map((m) => ({
      id: m.id,
      date: m.date,
      title: m.title,
      number: numerSesji.get(m.id) ?? 0,
    }));

  const stats = roster
    .filter((r) => r.councilor)
    .map((r) => ({
      id: r.councilor!.id,
      fullName: r.councilor!.full_name,
      party: r.party,
      totalSeconds: totals.get(r.councilor!.id) ?? 0,
    }));

  return { councilors, heatmapMeetings, heatmapMatrix, heatmapExtraRows, stats };
}
