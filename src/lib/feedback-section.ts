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
 */
export async function buildFeedbackSection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  councilId: string,
  currentMeetingId?: string
): Promise<string> {
  const [{ data: notes }, { data: meetings }] = await Promise.all([
    supabase
      .from("summary_feedback")
      .select(
        "body, prompt_version, meeting_id, meeting:meeting_id!inner(date, term:term_id!inner(council_id))"
      )
      .eq("meeting.term.council_id", councilId)
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

  if (!notes || notes.length === 0) return "";

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
    return `- [zgłoszono przy: ${origin}, ${f.meeting?.date ?? "?"}, prompt v${f.prompt_version ?? "?"}] ${f.body}`;
  };

  const current = currentMeetingId
    ? notes.filter((f) => f.meeting_id === currentMeetingId)
    : [];
  const rest = notes.filter((f) => !current.includes(f));

  return [
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
  ].join("\n");
}
