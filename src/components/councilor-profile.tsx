import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { CURRENT_COUNCILOR_EVALUATION_PROMPT_VERSION } from "@/lib/councilor-evaluation-prompt-version";
import { getSpeakingActivity } from "@/lib/council-activity";
import { compareToAverage } from "@/lib/compare-to-average";
import { PercentileMeter } from "@/components/percentile-meter";
import { clusterByAgreement } from "@/lib/hierarchical-clustering";

const MATTER_ROLE_LABEL: Record<string, string> = {
  inicjator: "Inicjator",
  poparcie: "Poparcie",
  sprzeciw: "Sprzeciw",
  zaangażowany: "Zaangażowany",
};

const MATTER_STATUS_LABEL: Record<string, string> = {
  proposed: "Oczekująca",
  approved: "Zatwierdzona",
  merged: "Scalona",
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
      "id, full_name, photo_url, interpellation_synthesis, interpellation_synthesis_updated_at, session_activity_synthesis, session_activity_synthesis_prompt_version"
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
        meeting_id: string;
        start_time: number;
        end_time: number;
        meeting: { term_id: string } | null;
      }>((from, to) =>
        supabase
          .from("segment")
          .select("meeting_id, start_time, end_time, meeting:meeting_id(term_id)")
          .eq("confirmed_councilor_id", id)
          .eq("status", "finalized")
          .range(from, to)
      ),
    ]);

  const council = termRow?.term?.council;
  const party = termRow?.party ?? null;

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
  const totalSpeakingSeconds = speakingSegmentsInTerm.reduce(
    (sum, s) => sum + (Number(s.end_time) - Number(s.start_time)),
    0
  );
  const sessionsSpokenIn = new Set(speakingSegmentsInTerm.map((s) => s.meeting_id)).size;

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

  const sessionActivityOutdated =
    Boolean(councilor.session_activity_synthesis) &&
    (councilor.session_activity_synthesis_prompt_version ?? 0) <
      CURRENT_COUNCILOR_EVALUATION_PROMPT_VERSION;

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

      <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Frekwencja i aktywność
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
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
      </section>

      {councilor.interpellation_synthesis && (
        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
            O czym pisze do urzędu
          </h2>
          <div className="rounded-2xl border border-zinc-200 p-4 text-sm leading-relaxed text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
            <ReactMarkdown
              components={{
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
          <p className="mt-2 text-xs text-zinc-400">
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

        {councilor.session_activity_synthesis && (
          <>
            <div className="rounded-2xl border border-zinc-200 p-4 text-sm leading-relaxed text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
              <ReactMarkdown
                components={{
                  p: (props) => <p className="mb-2 last:mb-0" {...props} />,
                }}
              >
                {councilor.session_activity_synthesis}
              </ReactMarkdown>
            </div>
            {sessionActivityOutdated && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Wygenerowane wg starszej wersji kryteriów oceny — do odświeżenia.
              </p>
            )}
          </>
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
                    href={`/rada/${matter.council_id}`}
                    className="text-sm text-zinc-800 hover:underline dark:text-zinc-200"
                  >
                    {matter.title}
                  </Link>
                  <div className="flex shrink-0 gap-1.5">
                    <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {MATTER_ROLE_LABEL[role] ?? role}
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {MATTER_STATUS_LABEL[matter.status] ?? matter.status}
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
  );
}
