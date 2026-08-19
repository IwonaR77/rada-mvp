import type { createClient } from "@/lib/supabase/server";

/**
 * Sekcja z uwagami redakcji doklejana do pobieranego promptu.
 *
 * Uwagi powstają przy konkretnym podsumowaniu („tego zabrakło"), ale ich
 * wartość jest szersza: raz zgłoszone przeoczenie zwykle powtarza się na
 * kolejnych sesjach, a nazwany w nim temat bywa jednocześnie tropem
 * brakującej sprawy. Dlatego trafiają do każdego pobrania promptu tej rady —
 * i podsumowań, i spraw — a nie tylko do tej jednej sesji, przy której je
 * zapisano.
 *
 * Numer sesji przy każdej uwadze jest podany jako **pochodzenie**, nie jako
 * zakres: „zgłoszono przy sesji 30" ma skłonić do sprawdzenia tego samego
 * braku w opracowywanym materiale, a nie do zignorowania uwagi przy innych
 * sesjach.
 *
 * Zakres po radzie, nigdy globalnie: uwagi z Rady Miejskiej nie mają
 * kształtować podsumowań powiatu.
 *
 * Odczyt podlega RLS — polityka na `summary_feedback` przepuszcza wyłącznie
 * managera tej rady, więc pobranie przez kogoś innego po prostu nie zobaczy
 * uwag zamiast wyciec.
 *
 * Zwraca też numery uwag, które faktycznie poszły do pliku: `minor` trafia do
 * nagłówka wersji (`prompt v7.12`), a pełna lista do `prompt_download` — bo
 * sama etykieta nie mówi, których numerów w paczce zabrakło, a zabraknąć
 * może, skoro uwagi da się wycofać.
 */
export type FeedbackSection = {
  /** Tekst doklejany do promptu; pusty, gdy rada nie ma żadnych uwag. */
  text: string;
  /** Numery uwag w tej paczce, rosnąco. */
  seqs: number[];
  /** Najwyższy numer w paczce; 0 = pobranie bez uwag. */
  minor: number;
};

export async function buildFeedbackSection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  opcje: {
    councilId: string;
    /** Wersja z nagłówka pliku promptu — do zbudowania etykiety `7.12`. */
    promptMajor: number;
    /** Sesja, przy której pobierany jest prompt — jej uwagi idą na górę. */
    currentMeetingId?: string;
    /**
     * Czy kazać modelowi przepisać wersję do wyniku. Tak przy podsumowaniach,
     * bo ich FORMAT ma linię „Wygenerowano" i to nią etykieta wraca do bazy.
     * Prompt spraw takiej linii nie ma — tam wersja i tak jest zapisana w
     * `prompt_download`, więc żądanie przepisania byłoby instrukcją bez
     * miejsca do wykonania.
     */
    echoVersion: boolean;
  }
): Promise<FeedbackSection> {
  const { councilId, promptMajor, currentMeetingId, echoVersion } = opcje;
  const [{ data: notes }, { data: meetings }] = await Promise.all([
    supabase
      .from("summary_feedback")
      .select(
        "seq, body, prompt_version, meeting_id, meeting:meeting_id!inner(date, term:term_id!inner(council_id))"
      )
      .eq("meeting.term.council_id", councilId)
      // Wycofane uwagi nie idą do promptu, ale ich numery zostają zajęte —
      // dziura w numeracji jest tu zamierzona, patrz scripts/migrate-feedback-seq.sql.
      .is("retired_at", null)
      .order("created_at", { ascending: false })
      .range(0, 199),
    // Numeracja sesji liczona z pozycji w kadencji — ta sama zasada, na której
    // stoi numeracja w nawigacji między sesjami i w nagłówku pobieranej
    // transkrypcji. Komisje nie są sesjami i jej nie przesuwają.
    supabase
      .from("meeting")
      .select("id, date, term_id, term:term_id!inner(council_id)")
      .eq("term.council_id", councilId)
      .neq("meeting_type", "komisja")
      .order("date", { ascending: true })
      .range(0, 999),
  ]);

  const pusta: FeedbackSection = { text: "", seqs: [], minor: 0 };
  if (!notes || notes.length === 0) return pusta;

  // `?? 0` tylko dla typów: numer wypełnia wyzwalacz w bazie, a ograniczenie
  // CHECK nie pozwala go zostawić pustym (scripts/migrate-feedback-seq.sql).
  // Kolumna jest nullowalna wyłącznie po to, żeby generator typów nie żądał
  // numeru od aplikacji, która nie ma jak go policzyć.
  const seqs = notes.map((f) => f.seq ?? 0).sort((a, b) => a - b);
  const minor = seqs[seqs.length - 1];

  const numberByMeeting = new Map<string, number>();
  const seenPerTerm = new Map<string, number>();
  for (const m of meetings ?? []) {
    const next = (seenPerTerm.get(m.term_id) ?? 0) + 1;
    seenPerTerm.set(m.term_id, next);
    numberByMeeting.set(m.id, next);
  }

  const line = (f: (typeof notes)[number]) => {
    const nr = numberByMeeting.get(f.meeting_id);
    const origin = nr ? `sesja nr ${nr}` : "sesja";
    return `- [#${f.seq} · zgłoszono przy: ${origin}, ${f.meeting?.date ?? "?"}, prompt v${f.prompt_version ?? "?"}] ${f.body}`;
  };

  const current = currentMeetingId
    ? notes.filter((f) => f.meeting_id === currentMeetingId)
    : [];
  const rest = notes.filter((f) => !current.includes(f));

  const text = [
    "",
    "---",
    "",
    "UWAGI REDAKCJI (dołączone automatycznie, nie są częścią promptu):",
    "",
    "To lista rzeczy, których zabrakło w dotychczasowych opracowaniach tej rady,",
    "zgłoszonych przez redakcję Serwisu.",
    "",
    "**Każda uwaga podaje sesję, przy której ją zgłoszono — to informacja",
    "o pochodzeniu, nie o zakresie.** Brak zauważony raz zwykle powtarza się",
    "gdzie indziej, więc sprawdź każdą uwagę także w materiale, który właśnie",
    "opracowujesz, nawet jeśli pochodzi z zupełnie innej sesji.",
    "",
    "**Traktuj je jako wskazówki, CZEGO SZUKAĆ w materiale — nigdy jako treść do",
    "wpisania.** Jeśli tematu z uwagi nie ma w tym konkretnym materiale, po prostu",
    "go pomiń. Dopisanie czegoś, o czym nie było mowy, jest błędem poważniejszym",
    "niż pominięcie, którego uwaga dotyczyła.",
    "",
    "Uwaga sprzed kilku wersji promptu mogła już zostać uwzględniona — numer",
    "wersji przy każdej pozycji mówi, którego promptu dotyczyła.",
    "",
    ...(current.length > 0
      ? [
          "Uwagi zgłoszone przy TYM materiale (dotyczą wprost tekstu, który robisz od nowa):",
          ...current.map(line),
          "",
          "Pozostałe uwagi dla tej rady — sprawdź, czy nie dotyczą też tego materiału:",
        ]
      : []),
    ...rest.map(line),
    "",
    // Powtórzone przy uwagach, a nie w samym pliku promptu: wersja z minorem
    // powstaje dopiero przy pobraniu, a podbicie treści promptu oznaczyłoby
    // wszystkie dotychczasowe opisy jako nieaktualne bez powodu.
    `Wersja tego pliku to **${promptMajor}.${minor}** — człon po kropce to numer`,
    "ostatniej uwagi wyżej.",
    ...(echoVersion
      ? [
          "",
          "Przepisz ją w całości w linii „Wygenerowano” jako",
          `„prompt v${promptMajor}.${minor}”, a nie samo „prompt v${promptMajor}” — inaczej po`,
          "fakcie nie będzie wiadomo, które uwagi ten tekst w ogóle widział.",
        ]
      : []),
    "",
  ].join("\n");

  return { text, seqs, minor };
}
