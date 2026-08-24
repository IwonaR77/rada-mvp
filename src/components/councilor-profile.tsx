import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { CURRENT_COUNCILOR_EVALUATION_PROMPT_VERSION } from "@/lib/councilor-evaluation-prompt-version";
import { getSpeakingActivity } from "@/lib/council-activity";
import { compareToAverage } from "@/lib/compare-to-average";
import { PercentileMeter } from "@/components/percentile-meter";
import { CouncilorSpeakingChart } from "@/components/councilor-speaking-chart";
import { mergeIntoBlocks } from "@/lib/speech-blocks";
import { CouncilorSpeeches } from "@/components/councilor-speeches";
import { AUDIO_CUT_ENABLED } from "@/lib/audio-cut";
import { clusterByAgreement } from "@/lib/hierarchical-clustering";
import {
  renderProfile,
  idTematowWWarstwiePelnej,
  diffStates,
  ZNACZNIK_ZMIANY,
  type ProfileState,
} from "@/lib/councilor-profile-state";

/**
 * Wczytuje przyrostowy profil radnego z historii rewizji
 * (`councilor_profile_revision`, zob. scripts/migrate-councilor-profile-
 * revision.sql i scripts/profil/wdroz-produkcyjnie.mjs). `null`, gdy łańcuch
 * tego radnego jeszcze się nie zaczął — wtedy profil pokazuje wyłącznie
 * dotychczasowy `session_activity_synthesis`, jak dziś.
 */
async function wczytajProfilIteracyjny(
  supabase: Awaited<ReturnType<typeof createClient>>,
  councilorId: string,
  termId: string | null
) {
  if (!termId) return null;

  const { data: rewizje } = await supabase
    .from("councilor_profile_revision")
    .select("seq, meeting_id, stan, created_at")
    .eq("councilor_id", councilorId)
    .eq("term_id", termId)
    .order("seq", { ascending: true });
  if (!rewizje || rewizje.length === 0) return null;

  const najnowsza = rewizje[rewizje.length - 1];
  const stanNajnowszy = najnowsza.stan as unknown as ProfileState;

  const [{ count: liczbaSesji }, { data: sesjeTerminu }] = await Promise.all([
    supabase
      .from("meeting")
      .select("id", { count: "exact", head: true })
      .eq("term_id", termId)
      .in("meeting_type", ["zwyczajna", "nadzwyczajna"]),
    supabase.from("meeting").select("id, date").eq("term_id", termId),
  ]);
  const totalSesji = liczbaSesji ?? stanNajnowszy.sesje_przetworzone;
  // Pasek nie ma pokazywać >100%, gdyby licznik sesji w bazie akurat spadł
  // poniżej tego, co radny już przetworzył (np. sesja usunięta po fakcie).
  const postepProcent =
    totalSesji > 0 ? Math.min(100, Math.round((100 * stanNajnowszy.sesje_przetworzone) / totalSesji)) : 100;
  const dogonil = stanNajnowszy.sesje_przetworzone >= totalSesji;

  const datyDoSesji: Record<string, string> = {};
  for (const s of sesjeTerminu ?? []) {
    if (s.date) datyDoSesji[s.date] = s.id;
  }

  // Historia "gdzie ten temat był ostatnio w pełni opisany" — budowana z
  // KAŻDEJ rewizji po kolei (rosnąco wg seq), żeby najnowszy zapis w mapie
  // dla danego tematu naturalnie odpowiadał najnowszej rewizji, w której był
  // jeszcze w warstwie pełnej. Nie wymaga osobnego przechowywania w bazie —
  // liczone przy odczycie z tego, co już mamy w `stan` każdej rewizji.
  const historiaPelnychTematow = new Map<string, number>();
  for (const rev of rewizje) {
    const stanRewizji = rev.stan as unknown as ProfileState;
    for (const tematId of idTematowWWarstwiePelnej(stanRewizji)) {
      historiaPelnychTematow.set(tematId, rev.seq);
    }
  }

  // Wyróżnienie "co dodał/zaktualizował ostatni krok" — porównanie tylko z
  // BEZPOŚREDNIO poprzedzającą rewizją (nie z całą wcześniejszą historią).
  // Brak poprzedniej rewizji (sam seed, łańcuch dopiero wystartował) celowo
  // NIE podświetla niczego — "co nowego od ostatniego razu" nie ma sensu bez
  // "ostatniego razu".
  const poprzedniaRewizja = rewizje.length >= 2 ? rewizje[rewizje.length - 2] : null;
  let zmienioneTematyIds: Set<string> | undefined;
  if (poprzedniaRewizja) {
    const zmiana = diffStates(poprzedniaRewizja.stan as unknown as ProfileState, stanNajnowszy);
    zmienioneTematyIds = new Set([...zmiana.nowe, ...zmiana.zmienione.map((z) => z.po)].map((t) => t.id));
  }

  return {
    notatka: renderProfile(stanNajnowszy, { datyDoSesji, historiaPelnychTematow, zmienioneTematyIds }),
    tematyZmienioneWOstatnimKroku: zmienioneTematyIds?.size ?? 0,
    postepProcent,
    sesjePrzetworzone: stanNajnowszy.sesje_przetworzone,
    totalSesji,
    dogonil,
    rewizje: rewizje
      .slice(0, -1) // najnowsza jest już pokazana wyżej, historia to tylko starsze
      .map((r, i) => {
        // seq w łańcuchu to numer rewizji, nie numer sesji — seed (pierwsza
        // rewizja) zwykle obejmuje kilka sesji naraz, więc "po sesji {seq}"
        // było mylące. Zakres liczony z sesje_przetworzone poprzedniej i tej
        // rewizji, bez potrzeby osobnej kolumny w bazie.
        const stanRewizji = r.stan as unknown as ProfileState;
        const poprzednia = i > 0 ? (rewizje[i - 1].stan as unknown as ProfileState) : null;
        const sesjaOd = (poprzednia?.sesje_przetworzone ?? 0) + 1;
        const sesjaDo = stanRewizji.sesje_przetworzone;
        // Ten sam diff co przy bieżącym opisie, tylko przesunięty o jeden
        // krok wstecz w łańcuchu — dzięki temu podświetlenie "co zmienił ten
        // krok" zostaje przy wpisie na stałe, gdy zsunie się do historii,
        // zamiast znikać w momencie, gdy przestaje być najnowszy.
        const zmiana = poprzednia ? diffStates(poprzednia, stanRewizji) : null;
        const zmienioneTematyIds = zmiana
          ? new Set([...zmiana.nowe, ...zmiana.zmienione.map((z) => z.po)].map((t) => t.id))
          : undefined;
        return {
          seq: r.seq,
          createdAt: r.created_at,
          sesjaOd,
          sesjaDo,
          tematyZmienioneWTymKroku: zmienioneTematyIds?.size ?? 0,
          notatka: renderProfile(stanRewizji, { datyDoSesji, zmienioneTematyIds }),
        };
      })
      .reverse(), // najnowsza z historycznych na górze listy rozwijanej
  };
}

// react-markdown emits plain <ul>/<ol>, które pod Tailwind Preflight
// renderują się bez znaczników i wcięcia (list-style/padding wyzerowane) —
// bez tego overrride'u każda lista w tekście wygląda jak zbite akapity, nie
// lista. Ten sam wzorzec co w session-player.tsx i legal-document.tsx.
const MARKDOWN_LIST_COMPONENTS = {
  ul: (props: React.ComponentPropsWithoutRef<"ul">) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0" {...props} />
  ),
  ol: (props: React.ComponentPropsWithoutRef<"ol">) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0" {...props} />
  ),
};

// Linki do sesji wewnątrz tekstu iteracyjnego profilu (renderProfile wstawia
// `[data](/sesje/[id])` za daty, gdy ma mapę dat na meeting.id) — nawigacja
// wewnętrzna, bez target="_blank" (inaczej niż interpelacyjny `a` niżej,
// który linkuje do zewnętrznych PDF-ów).
const MARKDOWN_LINK_COMPONENT = {
  a: (props: React.ComponentPropsWithoutRef<"a">) => (
    <a
      {...props}
      className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 hover:decoration-zinc-500 dark:decoration-zinc-700 dark:hover:text-zinc-100"
    />
  ),
};

// Punkty tematów dodanych/zaktualizowanych w ostatnim kroku łańcucha
// (zob. ZNACZNIK_ZMIANY w councilor-profile-state.ts) — sam renderProfile
// wstawia niewidoczny znacznik na początku takiego punktu w markdownie,
// tutaj wykrywamy go w pierwszym dziecku <li> i zamieniamy na kolor,
// zamiast dopuszczać surowe HTML w markdownie (rehype-raw) tylko dla tego.
const NOWY_TEMAT_LI_COMPONENT = {
  li: (props: React.ComponentPropsWithoutRef<"li">) => {
    const kids = Array.isArray(props.children) ? props.children : [props.children];
    const pierwsze = kids[0];
    if (typeof pierwsze === "string" && pierwsze.startsWith(ZNACZNIK_ZMIANY)) {
      return (
        <li className="text-blue-900 dark:text-blue-300">
          {pierwsze.slice(ZNACZNIK_ZMIANY.length)}
          {kids.slice(1)}
        </li>
      );
    }
    return <li {...props} />;
  },
};

const MATTER_ROLE_LABEL: Record<string, string> = {
  inicjator: "Inicjator",
  poparcie: "Poparcie",
  sprzeciw: "Sprzeciw",
  zaangażowany: "Zaangażowany",
};

function formatDate(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function CouncilorProfile({
  councilorId,
  showBackLink = true,
}: {
  councilorId: string;
  showBackLink?: boolean;
}) {
  const id = councilorId;
  const supabase = await createClient();

  const { data: councilor } = await supabase
    .from("councilor")
    .select(
      "id, full_name, photo_url, interpellation_synthesis, interpellation_synthesis_updated_at, session_activity_synthesis, session_activity_synthesis_prompt_version, session_activity_synthesis_updated_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!councilor) notFound();

  const [
    { data: termRow },
    votes,
    { data: interpellations },
    { data: matterRows },
    speakingSegments,
    { data: bookmarkRows },
    {
      data: { user },
    },
  ] = await Promise.all([
      supabase
        .from("councilor_term")
        .select(
          "party, term:term_id(id, label, start_date, council:council_id(id, name))"
        )
        .eq("councilor_id", id)
        .order("term(start_date)", { ascending: false })
        .limit(1)
        .maybeSingle(),
      fetchAllRows<{
        choice: string;
        resolution: {
          id: string;
          title: string;
          esesja_number: string | null;
          meeting: { id: string; date: string; title: string | null; term_id: string } | null;
        } | null;
      }>((from, to) =>
        supabase
          .from("resolution_vote")
          .select(
            "choice, resolution:resolution_id(id, title, esesja_number, meeting:meeting_id(id, date, title, term_id))"
          )
          .eq("councilor_id", id)
          .range(from, to)
      ),
      supabase
        .from("interpellation")
        .select(
          "id, title, submitted_date, pdf_url, response_author_name, response_date, response_pdf_url"
        )
        .eq("author_councilor_id", id)
        .order("submitted_date", { ascending: false }),
      supabase
        .from("matter_participant")
        .select("role, matter:matter_id(id, title, status, council_id)")
        .eq("councilor_id", id),
      fetchAllRows<{
        id: string;
        meeting_id: string;
        start_time: number;
        end_time: number;
        text: string;
        meeting: { term_id: string; date: string; title: string | null } | null;
      }>((from, to) =>
        supabase
          .from("segment")
          .select(
            "id, meeting_id, start_time, end_time, text, meeting:meeting_id(term_id, date, title)"
          )
          .eq("confirmed_councilor_id", id)
          .eq("status", "finalized")
          .range(from, to)
      ),
      // Zakładki są prywatne — zakresu po użytkowniku nie ma tu w zapytaniu,
      // bo robi to polityka RLS (niezalogowany dostaje po prostu pustą listę).
      supabase
        .from("bookmark")
        .select("id, segment_id, meeting_id, anchor_seconds, note")
        .eq("councilor_id", id),
      supabase.auth.getUser(),
    ]);

  const council = termRow?.term?.council;
  const party = termRow?.party ?? null;

  // Zakładki niosą wolny tekst (notatka) — sam browse (samo zalogowanie) to
  // za mało, wymagamy co najmniej "vote" (poziom redaktora), tak jak przy
  // przypisywaniu mówców w transkrypcjach.
  const { data: canBookmark } = user
    ? await supabase.rpc("user_has_permission", {
        uid: user.id,
        perm: "vote",
        target_council_id: council?.id,
      })
    : { data: false };

  const sortedVotes = [...votes]
    .filter((v) => v.resolution)
    .sort((a, b) =>
      (b.resolution!.meeting?.date ?? "").localeCompare(
        a.resolution!.meeting?.date ?? ""
      )
    );

  const MATTER_ROLE_ORDER = ["inicjator", "poparcie", "sprzeciw", "zaangażowany"];
  const matters = (matterRows ?? [])
    .filter((r) => r.matter)
    .map((r) => ({ role: r.role, matter: r.matter! }))
    .sort(
      (a, b) =>
        MATTER_ROLE_ORDER.indexOf(a.role) - MATTER_ROLE_ORDER.indexOf(b.role)
    );

  const currentTermId = termRow?.term?.id ?? null;

  const speakingSegmentsInTerm = currentTermId
    ? speakingSegments.filter((s) => s.meeting?.term_id === currentTermId)
    : speakingSegments;

  // Czas mówienia liczony PER BLOK, tak samo jak na heatmapie rady — liczy go
  // baza, bo blok przerywa wtrącenie innej osoby albo segment nieotagowany,
  // czego nie da się odtworzyć z samych wypowiedzi tej jednej osoby. Do
  // 18.08.2026 sumowaliśmy tu długości segmentów i profil pokazywał liczbę
  // o ~17% niższą niż ta sama osoba na stronie rady.
  const { data: czasyPoSesjach } = currentTermId
    ? await supabase.rpc("councilor_speaking_by_meeting", {
        p_councilor_id: councilorId,
        p_term_id: currentTermId,
      })
    : { data: null };
  const totalSpeakingSeconds = (czasyPoSesjach ?? []).reduce(
    (sum, r) => sum + Number(r.seconds),
    0
  );
  const sessionsSpokenIn = (czasyPoSesjach ?? []).filter(
    (r) => Number(r.seconds) > 0
  ).length;
  // Numer sesji liczony po dacie rosnąco (tak numeruje je cała reszta
  // serwisu), ale wyświetlane od najnowszej — ta sama reguła co na heatmapie
  // rady i na pasku sesji: najświeższe po lewej.
  const punktyMowienia = (czasyPoSesjach ?? [])
    .map((r, i) => ({
      meetingId: r.meeting_id,
      numer: i + 1,
      data: r.meeting_date,
      sekundy: Number(r.seconds),
    }))
    .reverse();

  const votesInTerm = currentTermId
    ? sortedVotes.filter((v) => v.resolution!.meeting?.term_id === currentTermId)
    : sortedVotes;
  const presentVotesInTerm = votesInTerm.filter((v) => v.choice !== "nieobecny");
  const attendancePct =
    votesInTerm.length > 0
      ? Math.round((100 * presentVotesInTerm.length) / votesInTerm.length)
      : null;

  // Session-level attendance — a per-vote "nieobecny" ratio can look low
  // just because one session had many uchwały; grouping by session first
  // gives the more meaningful "was she there" figure. There's no separate
  // attendance/kworum table in this data, so two proxies are combined:
  // resolution_vote (recorded per councilor per resolution, absentees
  // included — but only exists for sessions that had at least one uchwała)
  // and, for sessions with none on the agenda, this councilor's own
  // confirmed segments (a recorded utterance is solid proof of presence;
  // its absence isn't proof of the opposite, so those specific sessions
  // are excluded from the denominator entirely rather than counted as
  // "absent" on silence alone).
  const sessionsByMeeting = new Map<string, { choice: string }[]>();
  for (const v of votesInTerm) {
    const meetingId = v.resolution?.meeting?.id;
    if (!meetingId) continue;
    if (!sessionsByMeeting.has(meetingId)) sessionsByMeeting.set(meetingId, []);
    sessionsByMeeting.get(meetingId)!.push({ choice: v.choice });
  }
  const sessionsPresentFromVotes = [...sessionsByMeeting.values()].filter(
    (votesInSession) => votesInSession.some((v) => v.choice !== "nieobecny")
  ).length;
  const meetingIdsFromSegments = new Set(
    speakingSegmentsInTerm.map((s) => s.meeting_id)
  );
  const segmentOnlyMeetingIds = [...meetingIdsFromSegments].filter(
    (meetingId) => !sessionsByMeeting.has(meetingId)
  );
  const sessionsWithSignal = sessionsByMeeting.size + segmentOnlyMeetingIds.length;
  const sessionsPresent = sessionsPresentFromVotes + segmentOnlyMeetingIds.length;
  const sessionAttendancePct =
    sessionsWithSignal > 0
      ? Math.round((100 * sessionsPresent) / sessionsWithSignal)
      : null;

  // Relative standing for all three KPI tiles — a raw number doesn't say
  // whether it's high or low; compare against the rest of the term's
  // roster (officials excluded, they aren't on a comparable footing here).
  let activityComparison = null as ReturnType<typeof compareToAverage>;
  let sessionAttendanceComparison = null as ReturnType<typeof compareToAverage>;
  let voteAttendanceComparison = null as ReturnType<typeof compareToAverage>;
  let votingBloc: { id: string; fullName: string; agreementPct: number }[] = [];
  if (currentTermId) {
    const [{ data: officials }, { data: attendanceRows }, { data: correlationRows }] =
      await Promise.all([
        // Urzędnicy są zakresowani radą — bez filtra profil radnego powiatu
        // liczyłby aktywność mówców razem z urzędnikami gminy.
        supabase.from("official").select("id, full_name, role").eq("council_id", council?.id ?? ""),
        supabase.rpc("term_attendance_stats", { p_term_id: currentTermId }),
        supabase.rpc("term_voting_correlation", { p_term_id: currentTermId }),
      ]);
    const activity = await getSpeakingActivity(supabase, currentTermId, officials ?? []);
    if (totalSpeakingSeconds > 0) {
      activityComparison = compareToAverage(
        totalSpeakingSeconds,
        activity.stats.map((s) => s.totalSeconds)
      );
    }
    const rows = attendanceRows ?? [];
    if (sessionAttendancePct !== null) {
      sessionAttendanceComparison = compareToAverage(
        sessionAttendancePct,
        rows.map((r) => r.session_attendance_pct)
      );
    }
    if (attendancePct !== null) {
      voteAttendanceComparison = compareToAverage(
        attendancePct,
        rows.map((r) => r.vote_attendance_pct)
      );
    }

    // Same clustering as the council-wide matrix (/rada/[id]/sesje) — just
    // surfacing which group this one councilor landed in, not the whole grid.
    const pairs = (correlationRows ?? []).map((r) => ({
      a: r.councilor_a,
      b: r.councilor_b,
      agreementPct: r.agreement_pct,
    }));
    const rosterIds = activity.councilors.map((c) => c.id);
    if (rosterIds.includes(id) && pairs.length > 0) {
      const { clusterOf } = clusterByAgreement(rosterIds, pairs);
      const myCluster = clusterOf.get(id);
      const nameById = new Map(activity.councilors.map((c) => [c.id, c.fullName]));
      const pctByPair = new Map<string, number>();
      const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
      for (const p of pairs) pctByPair.set(pairKey(p.a, p.b), p.agreementPct);
      votingBloc = rosterIds
        .filter((otherId) => otherId !== id && clusterOf.get(otherId) === myCluster)
        .map((otherId) => ({
          id: otherId,
          fullName: nameById.get(otherId) ?? "?",
          agreementPct: pctByPair.get(pairKey(id, otherId)) ?? 0,
        }))
        .sort((a, b) => b.agreementPct - a.agreementPct);
    }
  }

  // Wypowiedzi zgrupowane sesjami, od najnowszej. Bez ograniczenia do
  // bieżącej kadencji — to archiwum tego, co ten radny powiedział, a nie
  // wskaźnik porównawczy jak kafelki wyżej.
  const speechSessions = [
    ...speakingSegments
      .reduce((acc, s) => {
        const group = acc.get(s.meeting_id) ?? {
          meetingId: s.meeting_id,
          date: s.meeting?.date ?? "",
          title: s.meeting?.title ?? null,
          segments: [] as typeof speakingSegments,
        };
        group.segments.push(s);
        acc.set(s.meeting_id, group);
        return acc;
      }, new Map<string, { meetingId: string; date: string; title: string | null; segments: typeof speakingSegments }>())
      .values(),
  ]
    .map(({ segments, ...meeting }) => ({
      ...meeting,
      blocks: mergeIntoBlocks(segments),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Sloty w pasku zakładek mają iść w tej samej kolejności, co bloki na
  // ekranie — pasek czyta się wtedy jak oś panelu, a nie jak stos ostatnich
  // kliknięć. Zakładka bez swojego bloku (segment po cofnięciu przypisania
  // nie jest już „finalized") ląduje na końcu, zamiast znikać bez śladu.
  const blockOrder = new Map<string, number>();
  speechSessions.forEach((session, sessionIndex) =>
    session.blocks.forEach((block, blockIndex) =>
      blockOrder.set(block.segmentId, sessionIndex * 100_000 + blockIndex)
    )
  );
  const bookmarks = (bookmarkRows ?? [])
    .map((b) => ({
      id: b.id,
      segmentId: b.segment_id,
      meetingId: b.meeting_id,
      anchorSeconds: Number(b.anchor_seconds),
      note: b.note,
      orphaned: !blockOrder.has(b.segment_id),
    }))
    .sort(
      (a, b) =>
        (blockOrder.get(a.segmentId) ?? Number.MAX_SAFE_INTEGER) -
        (blockOrder.get(b.segmentId) ?? Number.MAX_SAFE_INTEGER)
    );

  const sessionActivityOutdated =
    Boolean(councilor.session_activity_synthesis) &&
    (councilor.session_activity_synthesis_prompt_version ?? 0) <
      CURRENT_COUNCILOR_EVALUATION_PROMPT_VERSION;

  const profilIteracyjny = await wczytajProfilIteracyjny(supabase, id, currentTermId);

  function formatSpeakingDuration(totalSeconds: number) {
    const total = Math.round(totalSeconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours > 0) return `${hours} godz. ${minutes} min`;
    if (minutes > 0) return `${minutes} min`;
    return `${total} s`;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        {showBackLink && council && (
          <Link
            href={`/rada/${council.id}`}
            className="text-sm text-zinc-500 hover:underline"
          >
            ← {council.name}
          </Link>
        )}
        <div className="mt-2 flex items-center gap-4">
          {councilor.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={councilor.photo_url}
              alt={councilor.full_name}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-200 text-xl font-semibold text-zinc-500 dark:bg-zinc-800">
              {councilor.full_name.charAt(0)}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {councilor.full_name}
            </h1>
            {party && <p className="text-sm text-zinc-500">{party}</p>}
          </div>
        </div>
      </div>

      {/* Wypowiedzi w drugiej kolumnie, nie pod spodem: to archiwum do
          przeglądania obok liczb, a nie kolejna sekcja na końcu profilu.
          Dopiero od xl — niżej kolumna zwęziłaby transkrypcję do paska.
          Własne przewijanie, bo panel bywa dłuższy niż cała reszta. */}
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-8">
        <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Frekwencja i aktywność
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            <PercentileMeter
              label="Na sesjach"
              valueLabel={
                sessionAttendancePct === null
                  ? "Brak sesji z sygnałem obecności."
                  : `${sessionAttendancePct}% (${sessionsPresent}/${sessionsWithSignal} sesji)`
              }
              compareLabel={sessionAttendanceComparison?.band}
              percentile={sessionAttendanceComparison?.percentile ?? null}
            />
            <PercentileMeter
              label="Na głosowaniach"
              valueLabel={
                attendancePct === null
                  ? "Brak zarejestrowanych głosowań."
                  : `${attendancePct}%`
              }
              compareLabel={voteAttendanceComparison?.band}
              percentile={voteAttendanceComparison?.percentile ?? null}
            />
            <PercentileMeter
              label="Przy mikrofonie"
              valueLabel={
                sessionsSpokenIn === 0
                  ? "Brak zarejestrowanych wypowiedzi."
                  : `${formatSpeakingDuration(totalSpeakingSeconds)}, na ${sessionsSpokenIn} ${sessionsSpokenIn === 1 ? "sesji" : "sesjach"}`
              }
              compareLabel={activityComparison?.band}
              percentile={activityComparison?.percentile ?? null}
            />
          </div>

          {punktyMowienia.length > 0 && (
            <div className="mt-6 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Czas wypowiedzi na kolejnych sesjach
              </h3>
              <CouncilorSpeakingChart
                punkty={punktyMowienia}
                maks={Number(czasyPoSesjach?.[0]?.max_seconds ?? 0)}
              />
            </div>
          )}
        </section>

        {councilor.interpellation_synthesis && (
          <section>
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
              O czym pisze do urzędu
            </h2>
            <div className="rounded-2xl border border-zinc-200 p-4 text-sm leading-relaxed text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
              <ReactMarkdown
                components={{
                  ...MARKDOWN_LIST_COMPONENTS,
                  p: (props) => <p className="mb-0" {...props} />,
                  a: (props) => (
                    <a
                      {...props}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 hover:decoration-zinc-500 dark:decoration-zinc-700 dark:hover:text-zinc-100"
                    />
                  ),
                }}
              >
                {councilor.interpellation_synthesis}
              </ReactMarkdown>
            </div>
            {/* Bez wersji kryteriów, bo ta synteza nie ma w bazie kolumny
                z numerem promptu — inaczej niż opis aktywności na sesjach.
                Zostaje data, żeby czytelnik przynajmniej wiedział, jak świeży
                jest ten tekst i że powstał maszynowo. */}
            <p className="mt-2 text-xs text-zinc-500">
              Opis wygenerowany maszynowo
              {councilor.interpellation_synthesis_updated_at &&
                ` · ${formatDate(councilor.interpellation_synthesis_updated_at)}`}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Synteza tematów interpelacji — porównanie z przebiegiem dyskusji
              na sesji jest dostępne tylko tam, gdzie dana sesja ma już gotowe
              podsumowanie (nie wszystkie sesje kadencji są jeszcze
              rozpisane).
            </p>
          </section>
        )}

        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Aktywność na sesjach i zaangażowanie w sprawy
            {termRow?.term?.label ? ` — ${termRow.term.label}` : ""}
          </h2>

          {profilIteracyjny && (
            <div className="mb-6">
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Profil budowany sesja po sesji
                </p>
                <p className="shrink-0 text-xs text-zinc-500">
                  Sesja {profilIteracyjny.sesjePrzetworzone} z {profilIteracyjny.totalSesji}
                </p>
              </div>
              <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${profilIteracyjny.postepProcent}%` }}
                />
              </div>
              {!profilIteracyjny.dogonil && (
                <p className="mb-3 text-xs text-zinc-500">
                  Aktualizacja w toku — kolejne sesje dochodzą stopniowo, nie
                  jednorazowo.
                </p>
              )}
              {profilIteracyjny.tematyZmienioneWOstatnimKroku > 0 && (
                <p className="mb-2 text-xs text-blue-900 dark:text-blue-300">
                  Na granatowo: tematy dodane lub zaktualizowane w ostatnim kroku.
                </p>
              )}
              <div className="rounded-2xl border border-zinc-200 p-4 text-sm leading-relaxed text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                <ReactMarkdown
                  components={{
                    ...MARKDOWN_LIST_COMPONENTS,
                    ...MARKDOWN_LINK_COMPONENT,
                    ...NOWY_TEMAT_LI_COMPONENT,
                    p: (props) => <p className="mb-2 last:mb-0" {...props} />,
                  }}
                >
                  {profilIteracyjny.notatka}
                </ReactMarkdown>
              </div>
              {profilIteracyjny.rewizje.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                    Wcześniejsze wersje ({profilIteracyjny.rewizje.length})
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    {profilIteracyjny.rewizje.map((r) => (
                      <details
                        key={r.seq}
                        id={`rewizja-${r.seq}`}
                        className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                      >
                        <summary className="cursor-pointer text-xs text-zinc-500">
                          {r.sesjaOd === r.sesjaDo
                            ? `Wersja po sesji ${r.sesjaDo}`
                            : `Wersja po sesjach ${r.sesjaOd}–${r.sesjaDo}`}{" "}
                          — {formatDate(r.createdAt)}
                        </summary>
                        <div className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                          {r.tematyZmienioneWTymKroku > 0 && (
                            <p className="mb-2 text-xs text-blue-900 dark:text-blue-300">
                              Na granatowo: tematy dodane lub zaktualizowane w tym kroku.
                            </p>
                          )}
                          <ReactMarkdown
                            components={{
                              ...MARKDOWN_LIST_COMPONENTS,
                              ...MARKDOWN_LINK_COMPONENT,
                              ...NOWY_TEMAT_LI_COMPONENT,
                              p: (props) => <p className="mb-2 last:mb-0" {...props} />,
                            }}
                          >
                            {r.notatka}
                          </ReactMarkdown>
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {councilor.session_activity_synthesis && (
            <>
              {/* Baner ma stać PRZED opisem, nie po nim — czytelnik ma poznać
                  zasady, zanim przeczyta treść, którą te zasady ograniczają,
                  a nie trafić na zastrzeżenie dopiero w drobnym druku pod
                  spodem. To wprost odpowiedź na pytanie "czy to opinia o
                  radnym" — serwis celowo nie publikuje charakterystyk
                  radnych (ryzyko zniesławienia), więc czytelnik ma się o tym
                  dowiedzieć z samej strony, nie dopiero z treści prompta. */}
              <div className="mb-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                <p className="mb-2 font-medium text-zinc-700 dark:text-zinc-300">
                  {profilIteracyjny ? "Jak powstał opis niżej" : "Jak powstał ten opis"}
                </p>
                {profilIteracyjny && (
                  <p className="mb-2">
                    To opis sprzed wdrożenia budowania profilu sesja po sesji —
                    zamrożony, nieaktualizowany. Nowszy opis, rosnący wraz z
                    kolejnymi sesjami, jest wyżej.
                  </p>
                )}
                <p className="mb-2">
                  Poniższy opis jest wygenerowany automatycznie na podstawie
                  transkrypcji wypowiedzi tego radnego na sesjach rady oraz
                  fragmentów podsumowań sesji, w których jest wymieniony z
                  imienia i nazwiska — czyli wyłącznie tego, co ten radny
                  powiedział publicznie na forum rady.
                </p>
                <p className="mb-2">
                  Nie zawiera ocen, opinii, charakterystyk ani żadnej innej
                  treści oceniającej postawę, styl czy skuteczność radnego —
                  to celowa zasada redakcyjna tego serwisu, nie przeoczenie.
                  Opis relacjonuje, jakich tematów dotyczyły wypowiedzi i w
                  jakich sporach radny brał udział, tak jak dziennikarz
                  opisujący przebieg sesji, nigdy jak recenzent oceniający
                  radnego.
                </p>
                <p>
                  Transkrypcja bywa niepełna — brak wzmianki o jakimś temacie
                  oznacza, że nie ma go w dostarczonym materiale, a nie że
                  radny się do niego nie odniósł. Pełna treść instrukcji, wg
                  której ten opis powstaje, jest jawna:{" "}
                  <Link
                    href="/prompt-oceny-radnych"
                    className="underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900 dark:decoration-zinc-600 dark:hover:text-zinc-100"
                  >
                    kryteria oceny w wersji{" "}
                    {councilor.session_activity_synthesis_prompt_version ?? "?"}
                  </Link>
                  .
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-200 p-4 text-sm leading-relaxed text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                <ReactMarkdown
                  components={{
                    ...MARKDOWN_LIST_COMPONENTS,
                    p: (props) => <p className="mb-2 last:mb-0" {...props} />,
                  }}
                >
                  {councilor.session_activity_synthesis}
                </ReactMarkdown>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Opis wygenerowany maszynowo
                {councilor.session_activity_synthesis_updated_at &&
                  ` · ${formatDate(councilor.session_activity_synthesis_updated_at)}`}
              </p>
              {sessionActivityOutdated && !profilIteracyjny && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  Obowiązują już nowsze kryteria (wersja{" "}
                  {CURRENT_COUNCILOR_EVALUATION_PROMPT_VERSION}) — opis do
                  odświeżenia.
                </p>
              )}
            </>
          )}

          {!profilIteracyjny && !councilor.session_activity_synthesis && (
            <p className="text-sm text-zinc-500">
              Profil tego radnego jeszcze nie ma opisu aktywności na sesjach —
              w kolejce do wdrożenia budowania sesja po sesji.
            </p>
          )}

          {matters.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Sprawy ({matters.length})
              </h3>
              <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {matters.map(({ role, matter }) => (
                  <li
                    key={matter.id}
                    className="flex flex-col gap-1.5 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <Link
                      href={`/sprawy/${matter.id}`}
                      className="text-sm text-zinc-800 hover:underline dark:text-zinc-200"
                    >
                      {matter.title}
                    </Link>
                    <div className="flex shrink-0 gap-1.5">
                      <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {MATTER_ROLE_LABEL[role] ?? role}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {votingBloc.length > 0 && (
          <section>
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Korelacja głosowań
            </h2>
            <p className="mb-4 text-xs text-zinc-500">
              Grupa radnych, z którymi ten radny najczęściej głosuje tak samo w
              uchwałach bez jednomyślności — wyznaczona automatycznie
              (klastrowanie), nie z deklaracji klubowej. Pełna macierz dla
              całej rady jest na stronie sesji.
            </p>
            <ul className="flex flex-col gap-1.5">
              {votingBloc.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <Link
                    href={`/radny/${s.id}`}
                    className="truncate text-zinc-700 hover:underline dark:text-zinc-300"
                  >
                    {s.fullName}
                  </Link>
                  <span className="shrink-0 font-mono text-xs text-zinc-400">
                    {Math.round(s.agreementPct)}%
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Wszystkie interpelacje i zapytania ({interpellations?.length ?? 0})
          </h2>
          {!interpellations || interpellations.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Brak zarejestrowanych interpelacji tego radnego.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {interpellations.map((i) => (
                <li key={i.id} className="flex flex-col gap-1.5 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-400">
                      {formatDate(i.submitted_date)}
                    </span>
                    {i.pdf_url && (
                      <a
                        href={i.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                      >
                        Pobierz PDF
                      </a>
                    )}
                  </div>
                  <span className="text-sm text-zinc-800 dark:text-zinc-200">
                    {i.title}
                  </span>
                  {i.response_author_name ? (
                    <p className="text-xs text-zinc-500">
                      Odpowiedź: {i.response_author_name}
                      {i.response_date && ` — ${formatDate(i.response_date)}`}
                      {i.response_pdf_url && (
                        <>
                          {" "}
                          <a
                            href={i.response_pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
                          >
                            (PDF)
                          </a>
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Brak odpowiedzi
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        </div>

        <aside className="w-full min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:flex-1 lg:overflow-y-auto">
          <CouncilorSpeeches
            sessions={speechSessions}
            councilorId={id}
            councilorName={councilor.full_name}
            bookmarks={bookmarks}
            canBookmark={Boolean(canBookmark)}
            canDownloadAudio={AUDIO_CUT_ENABLED}
          />
        </aside>
      </div>
    </div>
  );
}
