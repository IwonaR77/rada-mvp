import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SessionPlayer } from "@/components/session-player";
import { SessionNeighborNav } from "@/components/session-neighbor-nav";
import { LiveMeetingRefresh } from "@/components/live-meeting-refresh";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { CURRENT_SUMMARY_PROMPT_VERSION } from "@/lib/summary-prompt-version";
import { SummaryManager } from "@/components/summary-manager";
import { TaggingProgress } from "@/components/tagging-progress";

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const initialSeek = t ? Number(t) : undefined;
  const supabase = await createClient();

  const { data: meeting } = await supabase
    .from("meeting")
    .select(
      "id, title, date, esesja_id, source_id, video_url, summary, summary_prompt_version, topics, term_id, term:term_id(council:council_id(id, name))"
    )
    .eq("id", id)
    .maybeSingle();

  if (!meeting || !meeting.video_url) notFound();

  // Must run before the Promise.all below, not inside it — concurrent calls
  // sharing one client can each try to refresh an expired access token with
  // the same (single-use) refresh token, and all but the first fail with
  // "Invalid Refresh Token: Already Used".
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const councilId = meeting.term?.council?.id;

  const [
    segments,
    { data: roster },
    { data: officials },
    { data: termMeetings },
    { data: topicRows },
    { data: progressRows, error: progressError },
  ] = await Promise.all([
      // PostgREST enforces a server-side max-rows cap that a single
      // .range() request can't exceed regardless of how wide a range is
      // requested — paginate until a page comes back short instead of
      // guessing the cap's value. Long sessions can have 1000+ segments.
      fetchAllRows<{
        id: string;
        start_time: number;
        end_time: number;
        text: string;
        confirmed_councilor_id: string | null;
        confirmed_official_id: string | null;
        status: string;
      }>((from, to) =>
        supabase
          .from("segment")
          .select(
            "id, start_time, end_time, text, confirmed_councilor_id, confirmed_official_id, status"
          )
          .eq("meeting_id", id)
          .order("start_time", { ascending: true })
          .range(from, to)
      ),
      supabase
        .from("councilor_term")
        // role jedzie razem ze składem: nagłówek pobieranej transkrypcji
        // podaje funkcje (przewodniczący, starosta...), żeby podsumowanie
        // nie musiało ich zgadywać z przebiegu obrad.
        .select("role, councilor:councilor_id(id, full_name)")
        .eq("term_id", meeting.term_id),
      // Urzędnicy są zakresowani radą: sesja powiatu nie może proponować do
      // otagowania urzędników gminy i odwrotnie.
      supabase.from("official").select("id, full_name, role").eq("council_id", councilId ?? ""),
      // Chronological position within the term (ascending, ALL sessions —
      // not just ones with a resolved video_url) matches the real Sesja
      // Nr N numbering used in official documents — verified against two
      // known sessions (86312 → 32 "Sesja XXXII", 87170 → 33 "Sesja
      // XXXIII") before relying on it here.
      supabase
        .from("meeting")
        .select(
          "id, date, video_url, summary, summary_prompt_version, transcript_status"
        )
        .eq("term_id", meeting.term_id)
        // Komisja meetings share this table but aren't "sesje" — excluded
        // so they don't shift the verified Sesja Nr N numbering (see the
        // comment above) or appear in the neighbor nav.
        .neq("meeting_type", "komisja")
        .order("date", { ascending: true }),
      // Every topic tag used anywhere in this council's sessions (any
      // term) — embedded in the .txt export so the summary prompt reuses
      // existing tags instead of coining near-duplicate variants.
      councilId
        ? supabase
            .from("meeting")
            .select("topics, term:term_id!inner(council_id)")
            .eq("term.council_id", councilId)
            .not("topics", "is", null)
        : Promise.resolve({ data: null }),
      // Per-session tagging progress for the neighbor nav's pills — same RPC
      // and semantics as the /rada/[councilId] timeline.
      supabase.rpc("meeting_tagging_progress", { p_term_id: meeting.term_id }),
    ]);

  if (progressError) {
    console.error("meeting_tagging_progress RPC failed:", progressError);
  }
  const taggingProgress = new Map(
    (progressRows ?? []).map((r) => [
      r.meeting_id,
      r.total > 0 ? r.finalized / r.total : 0,
    ])
  );

  const allTopics = [
    ...new Set((topicRows ?? []).flatMap((r) => r.topics ?? [])),
  ].sort((a, b) => a.localeCompare(b, "pl"));

  // Ile wypowiedzi ma przypisanych każdy mówca w CAŁEJ radzie, nie tylko w tej
  // sesji — na liście przy tagowaniu odróżnia osobę faktycznie używaną od
  // wpisu, który nigdy nikomu nie posłużył (literówka, osoba dodana „na
  // wszelki wypadek"). Tylko te drugie da się usunąć.
  const { data: usageRows } = councilId
    ? await supabase.rpc("council_speaker_usage", { p_council_id: councilId })
    : { data: null };
  const speakerUsage = Object.fromEntries(
    (usageRows ?? []).map((r) => [r.speaker_id, Number(r.segments)])
  );

  let isAdmin = false;
  let canAssign = false;
  let finalizePermission = false;
  let canDownloadTranscript = false;
  let canManageSummary = false;
  if (user) {
    const { data: appUser } = await supabase
      .from("app_user")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    isAdmin = appUser?.role === "admin" || appUser?.role === "moderator";

    const [
      { data: canVote },
      { data: canFinalize },
      { data: canDownload },
      { data: isManager },
    ] = await Promise.all([
        supabase.rpc("user_has_permission", {
          uid: user.id,
          perm: "vote",
          target_council_id: councilId ?? undefined,
        }),
        supabase.rpc("user_has_permission", {
          uid: user.id,
          perm: "finalize_vote",
          target_council_id: councilId ?? undefined,
        }),
        supabase.rpc("user_has_permission", {
          uid: user.id,
          perm: "download_txt_srt",
          target_council_id: councilId ?? undefined,
        }),
        supabase.rpc("user_has_permission", {
          uid: user.id,
          perm: "full_access",
          target_council_id: councilId ?? undefined,
        }),
      ]);
    canAssign = Boolean(canVote) || Boolean(canFinalize);
    finalizePermission = Boolean(canFinalize);
    canDownloadTranscript = Boolean(canDownload);
    canManageSummary = Boolean(isManager);
  }

  // Uwagi do promptu widzi tylko manager tej rady (polityka RLS na
  // summary_feedback), więc zapytanie ma sens dopiero po sprawdzeniu.
  const feedbackRows = canManageSummary
    ? (
        await supabase
          .from("summary_feedback")
          .select(
            "id, body, created_at, prompt_version, author:author_id(id, display_name)"
          )
          .eq("meeting_id", id)
          .order("created_at", { ascending: false })
          .range(0, 199)
      ).data ?? []
    : [];

  const councilors = (roster ?? [])
    .filter((r) => r.councilor)
    .map((r) => ({
      id: r.councilor!.id,
      name: r.councilor!.full_name,
      role: r.role ?? undefined,
    }));

  const council = meeting.term?.council;

  const orderedMeetings = termMeetings ?? [];
  const currentIndex = orderedMeetings.findIndex((m) => m.id === meeting.id);
  // The whole term, not a fixed handful — the row stays single-line and
  // centers on the current session (justify-center + overflow-hidden), so
  // it clips symmetrically on both ends instead of stopping abruptly
  // partway across the width like a fixed ±N window did.
  const neighborWindow =
    currentIndex === -1
      ? []
      : orderedMeetings.map((m, i) => {
          const status = m.transcript_status ?? "nie rozpisana";
          return {
            id: m.id,
            date: m.date,
            hasVideo: Boolean(m.video_url),
            number: i + 1,
            hasTranscript: status === "rozpisana",
            progress:
              status === "rozpisana" ? taggingProgress.get(m.id) : undefined,
            hasSummary: Boolean(m.summary),
            summaryOutdated:
              Boolean(m.summary) &&
              (m.summary_prompt_version ?? 0) < CURRENT_SUMMARY_PROMPT_VERSION,
          };
        });
  // Newest first (leftmost), matching the timeline's reading direction.
  const neighborsNewestFirst = [...neighborWindow].reverse();

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-6 px-6 py-12">
      <LiveMeetingRefresh termId={meeting.term_id} />
      <SessionNeighborNav
        meetings={neighborsNewestFirst}
        currentId={meeting.id}
      />

      <div>
        {council && (
          <Link
            href={`/rada/${council.id}`}
            className="text-sm text-zinc-500 hover:underline"
          >
            ← {council.name}
          </Link>
        )}
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {meeting.title}
        </h1>
        <p className="text-zinc-500">{meeting.date}</p>
        {council && meeting.topics && meeting.topics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {meeting.topics.map((tag) => (
              <Link
                key={tag}
                href={`/rada/${council.id}?temat=${encodeURIComponent(tag)}`}
                prefetch={false}
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                {tag}
              </Link>
            ))}
          </div>
        )}
      </div>

      <SessionPlayer
        meetingId={meeting.id}
        meetingTitle={meeting.title ?? meeting.id}
        sessionKey={meeting.esesja_id ?? meeting.source_id}
        sessionNumber={currentIndex >= 0 ? currentIndex + 1 : null}
        councilName={council?.name ?? null}
        meetingDate={meeting.date}
        existingTopics={allTopics}
        summary={meeting.summary}
        summaryPromptVersion={meeting.summary_prompt_version}
        currentPromptVersion={CURRENT_SUMMARY_PROMPT_VERSION}
        videoUrl={meeting.video_url}
        segments={segments ?? []}
        councilors={councilors}
        officials={officials ?? []}
        speakerUsage={speakerUsage}
        isAdmin={isAdmin}
        canAssign={canAssign}
        canFinalize={finalizePermission}
        canDownloadTranscript={canDownloadTranscript}
        taggingProgress={
          // Liczone z segmentów już pobranych na tę stronę — postęp tej jednej
          // sesji nie wymaga osobnego zapytania, w odróżnieniu od widoku rady.
          (() => {
            const dur = (s: { start_time: number; end_time: number }) =>
              Number(s.end_time) - Number(s.start_time);
            const all = segments ?? [];
            return (
              <TaggingProgress
                label="Przypisani mówcy w tej sesji"
                totalSeconds={all.reduce((a, s) => a + dur(s), 0)}
                finalizedSeconds={all
                  .filter((s) => s.status === "finalized")
                  .reduce((a, s) => a + dur(s), 0)}
                proposedSeconds={all
                  .filter((s) => s.status === "proposed")
                  .reduce((a, s) => a + dur(s), 0)}
              />
            );
          })()
        }
        summaryManager={
          canManageSummary ? (
            <SummaryManager
              meetingId={meeting.id}
              currentPromptVersion={CURRENT_SUMMARY_PROMPT_VERSION}
              summaryPromptVersion={meeting.summary_prompt_version}
              hasSummary={Boolean(meeting.summary)}
              feedback={feedbackRows.map((f) => ({
                id: f.id,
                body: f.body,
                createdAt: f.created_at,
                promptVersion: f.prompt_version,
                authorName: f.author?.display_name ?? "Manager",
                isOwn: f.author?.id === user?.id,
              }))}
            />
          ) : undefined
        }
        initialSeek={initialSeek}
      />
    </div>
  );
}
