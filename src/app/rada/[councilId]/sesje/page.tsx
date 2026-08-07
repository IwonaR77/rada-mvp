import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SpeakingHeatmap } from "@/components/speaking-heatmap";
import { SessionTimelinePill } from "@/components/session-timeline-pill";
import { LiveMeetingRefresh } from "@/components/live-meeting-refresh";
import { CURRENT_SUMMARY_PROMPT_VERSION } from "@/lib/summary-prompt-version";
import { getSpeakingActivity, type CouncilorStat } from "@/lib/council-activity";

function formatDuration(totalSeconds: number) {
  const total = Math.round(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) return `${hours} godz. ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getInitials(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-pink-500",
];

function avatarColor(fullName: string) {
  let hash = 0;
  for (let i = 0; i < fullName.length; i++) {
    hash = (hash * 31 + fullName.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function Avatar({ fullName }: { fullName: string }) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(fullName)}`}
    >
      {getInitials(fullName)}
    </span>
  );
}

export default async function CouncilSessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ councilId: string }>;
  searchParams: Promise<{ kadencja?: string; temat?: string }>;
}) {
  const { councilId } = await params;
  const { kadencja, temat } = await searchParams;
  const supabase = await createClient();

  const { data: council } = await supabase
    .from("council")
    .select("id, name, city:city_id(name, coat_of_arms_url)")
    .eq("id", councilId)
    .maybeSingle();

  if (!council) notFound();

  const { data: terms } = await supabase
    .from("term")
    .select("id, label, start_date, end_date")
    .eq("council_id", councilId)
    .order("start_date", { ascending: false });

  const validTermIds = new Set((terms ?? []).map((t) => t.id));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let savedTermId: string | null = null;
  if (user) {
    const { data: appUser } = await supabase
      .from("app_user")
      .select("last_viewed_term_id")
      .eq("id", user.id)
      .maybeSingle();
    savedTermId = appUser?.last_viewed_term_id ?? null;
  }

  const selectedTermId =
    (kadencja && validTermIds.has(kadencja) ? kadencja : null) ??
    (savedTermId && validTermIds.has(savedTermId) ? savedTermId : null) ??
    terms?.[0]?.id ??
    null;

  if (user && selectedTermId && selectedTermId !== savedTermId) {
    await supabase
      .from("app_user")
      .update({ last_viewed_term_id: selectedTermId })
      .eq("id", user.id);
  }

  const selectedTerm = (terms ?? []).find((t) => t.id === selectedTermId);

  let stats: CouncilorStat[] = [];
  let meetings: {
    id: string;
    date: string;
    title: string | null;
    video_url: string | null;
    video_downloaded: boolean;
    transcript_status: string;
    topics: string[] | null;
    summary: string | null;
    summary_prompt_version: number | null;
  }[] = [];
  let allTags: string[] = [];
  let selectedTag: string | null = null;
  let taggingProgress = new Map<string, number>();
  let councilors: { id: string; fullName: string }[] = [];
  let heatmapMeetings: { id: string; date: string; title: string | null }[] =
    [];
  let heatmapMatrix: Record<string, Record<string, number>> = {};
  let heatmapExtraRows: { id: string; fullName: string }[] = [];
  let meetingNumbers = new Map<string, number>();

  const { data: officials } = await supabase
    .from("official")
    .select("id, full_name, role");

  if (selectedTermId) {
    const [
      activity,
      { data: meetingRows },
      { data: progressRows, error: progressError },
    ] = await Promise.all([
        getSpeakingActivity(supabase, selectedTermId, officials ?? []),
        supabase
          .from("meeting")
          .select(
            "id, date, title, video_url, video_downloaded, transcript_status, topics, summary, summary_prompt_version"
          )
          .eq("term_id", selectedTermId)
          .order("date", { ascending: false }),
        // Per-session tagging progress (finalized/total segments) for the
        // timeline's progress ring — a grouped aggregate, done server-side
        // via RPC rather than fetching every segment just to count them.
        supabase.rpc("meeting_tagging_progress", { p_term_id: selectedTermId }),
      ]);

    if (progressError) {
      console.error("meeting_tagging_progress RPC failed:", progressError);
    }
    meetings = meetingRows ?? [];
    // Chronological "Sesja Nr N" position — same computation and verified
    // numbering as SessionNeighborNav on /sesje/[id], so a session's number
    // reads the same on both pages instead of only existing once you click in.
    meetingNumbers = new Map(
      [...meetings]
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map((m, i) => [m.id, i + 1])
    );
    taggingProgress = new Map(
      (progressRows ?? []).map((r) => [
        r.meeting_id,
        r.total > 0 ? r.finalized / r.total : 0,
      ])
    );
    allTags = [
      ...new Set(meetings.flatMap((m) => m.topics ?? [])),
    ].sort((a, b) => a.localeCompare(b, "pl"));
    selectedTag = temat && allTags.includes(temat) ? temat : null;

    councilors = activity.councilors;
    heatmapMatrix = activity.heatmapMatrix;
    heatmapExtraRows = activity.heatmapExtraRows;
    heatmapMeetings = activity.heatmapMeetings;
    stats = activity.stats;
  }

  const mostActive = [...stats]
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, 3);
  const mostSilent = [...stats]
    .sort((a, b) => a.totalSeconds - b.totalSeconds)
    .slice(0, 3);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-16">
      {selectedTermId && <LiveMeetingRefresh termId={selectedTermId} />}
      <div>
        <Link
          href={`/rada/${council.id}`}
          className="text-sm text-zinc-500 hover:underline"
        >
          ← {council.name}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          {council.city?.coat_of_arms_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={council.city.coat_of_arms_url}
              alt={`Herb: ${council.city.name}`}
              className="h-12 w-auto"
            />
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Sesje — {council.name}
          </h1>
        </div>
        <p className="text-zinc-500">{council.city?.name}</p>
      </div>

      {!terms || terms.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
          Brak zarejestrowanych kadencji dla tej rady.
        </p>
      ) : (
        <>
          {terms.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {terms.map((t) => (
                <Link
                  key={t.id}
                  href={`/rada/${council.id}/sesje?kadencja=${t.id}`}
                  prefetch={false}
                  className={`rounded-full px-3 py-1 text-sm transition-colors ${
                    t.id === selectedTermId
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {t.label ?? formatDate(t.start_date)}
                </Link>
              ))}
            </div>
          )}

          {selectedTerm && (
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {selectedTerm.label ?? "Kadencja"}
              </h2>
              <p className="text-sm text-zinc-500">
                {formatDate(selectedTerm.start_date)}
                {selectedTerm.end_date
                  ? ` – ${formatDate(selectedTerm.end_date)}`
                  : " – obecnie"}
              </p>
            </div>
          )}

          {allTags.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
                  Tematy
                </h3>
                {selectedTag && (
                  <Link
                    href={`/rada/${council.id}/sesje${selectedTermId ? `?kadencja=${selectedTermId}` : ""}`}
                    prefetch={false}
                    className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    Wyczyść filtr
                  </Link>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => {
                  const isActive = tag === selectedTag;
                  const params = new URLSearchParams();
                  if (selectedTermId) params.set("kadencja", selectedTermId);
                  if (!isActive) params.set("temat", tag);
                  return (
                    <Link
                      key={tag}
                      href={`/rada/${council.id}/sesje?${params.toString()}`}
                      prefetch={false}
                      className={`rounded-full px-3 py-1 text-sm transition-colors ${
                        isActive
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {tag}
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Oś czasu sesji
            </h3>
            {meetings.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Brak zarejestrowanych sesji w tej kadencji.
              </p>
            ) : (
              <div className="overflow-x-auto pb-2">
                <div className="flex min-w-max items-start gap-1.5 px-2 pt-2">
                  {meetings.map((m) => {
                    const status = m.transcript_status ?? "nie rozpisana";
                    const matchesTag = selectedTag
                      ? (m.topics ?? []).includes(selectedTag)
                      : true;
                    const progress =
                      status === "rozpisana"
                        ? taggingProgress.get(m.id)
                        : undefined;
                    const hasSummary = Boolean(m.summary);
                    const summaryOutdated =
                      hasSummary &&
                      (m.summary_prompt_version ?? 0) <
                        CURRENT_SUMMARY_PROMPT_VERSION;
                    const tooltipParts = [m.title ?? undefined];
                    if (progress !== undefined) {
                      tooltipParts.push(
                        `otagowane: ${Math.round(progress * 100)}%`
                      );
                    }
                    if (hasSummary) {
                      tooltipParts.push(
                        summaryOutdated
                          ? "ma podsumowanie (nieaktualna wersja promptu)"
                          : "ma podsumowanie"
                      );
                    }
                    const tooltip = tooltipParts.filter(Boolean).join(" — ");

                    return (
                      <SessionTimelinePill
                        key={m.id}
                        meeting={{
                          id: m.id,
                          date: m.date,
                          hasVideo: Boolean(m.video_url),
                          hasTranscript: status === "rozpisana",
                          number: meetingNumbers.get(m.id) ?? 0,
                          progress,
                          hasSummary,
                          summaryOutdated,
                        }}
                        dimmed={!matchesTag}
                        emphasized={Boolean(selectedTag && matchesTag)}
                        title={tooltip || undefined}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Aktywność na sesjach
            </h3>
            <SpeakingHeatmap
              councilors={[
                ...councilors.map((c) => ({ ...c, href: `/radny/${c.id}` })),
                ...heatmapExtraRows,
              ]}
              meetings={heatmapMeetings}
              matrix={heatmapMatrix}
            />
          </section>

          <section className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
                Radni ({councilors.length})
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {councilors.map((c) => c.fullName).join(", ") || "—"}
              </p>
            </div>
            {officials && officials.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
                  Kluczowi urzędnicy
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {officials.map((o) => `${o.full_name} (${o.role})`).join(", ")}
                </p>
              </div>
            )}
          </section>

          {stats.every((c) => c.totalSeconds === 0) ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
              Jeszcze brak danych z sesji dla tej kadencji. Ranking pojawi się,
              gdy zostaną wgrane transkrypcje i sesje.
            </p>
          ) : (
            <div className="grid gap-8 sm:grid-cols-2">
              <section>
                <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
                  Najaktywniejsi
                </h3>
                <ol className="flex flex-col gap-2">
                  {mostActive.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                    >
                      <Avatar fullName={c.fullName} />
                      <span className="flex-1">{c.fullName}</span>
                      <span className="text-sm text-zinc-500">
                        {formatDuration(c.totalSeconds)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              <section>
                <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
                  Najcichsi
                </h3>
                <ol className="flex flex-col gap-2">
                  {mostSilent.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                    >
                      <Avatar fullName={c.fullName} />
                      <span className="flex-1">{c.fullName}</span>
                      <span className="text-sm text-zinc-500">
                        {formatDuration(c.totalSeconds)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
