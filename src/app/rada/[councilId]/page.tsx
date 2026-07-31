import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SpeakingHeatmap } from "@/components/speaking-heatmap";
import { FavoriteCouncilButton } from "@/components/favorite-council-button";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

type CouncilorStat = {
  id: string;
  fullName: string;
  party: string | null;
  totalSeconds: number;
};

const STATUS_DOT_CLASS: Record<string, string> = {
  "nie rozpisana": "bg-zinc-300 dark:bg-zinc-700",
  "w trakcie": "bg-amber-400",
  rozpisana: "bg-emerald-500",
};

// Same hues as STATUS_DOT_CLASS, as a border instead of a fill — used for
// sessions without a summary yet, so a hollow vs. filled dot communicates
// "has summary" at a glance instead of only in the hover tooltip.
const STATUS_DOT_BORDER_CLASS: Record<string, string> = {
  "nie rozpisana": "border-zinc-300 dark:border-zinc-700",
  "w trakcie": "border-amber-400",
  rozpisana: "border-emerald-500",
};

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

function formatShortDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
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

export default async function CouncilDashboardPage({
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
  let isFavoriteCouncil = false;
  if (user) {
    const { data: appUser } = await supabase
      .from("app_user")
      .select("last_viewed_term_id, favorite_council_id")
      .eq("id", user.id)
      .maybeSingle();
    savedTermId = appUser?.last_viewed_term_id ?? null;
    isFavoriteCouncil = appUser?.favorite_council_id === councilId;
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
  }[] = [];
  let allTags: string[] = [];
  let selectedTag: string | null = null;
  let taggingProgress = new Map<string, number>();
  let councilors: { id: string; fullName: string }[] = [];
  let heatmapMeetings: { id: string; date: string; title: string | null }[] =
    [];
  const heatmapMatrix: Record<string, Record<string, number>> = {};
  let heatmapExtraRows: { id: string; fullName: string }[] = [];
  let meetingNumbers = new Map<string, number>();

  const { data: officials } = await supabase
    .from("official")
    .select("id, full_name, role");

  if (selectedTermId) {
    const [
      { data: roster },
      segments,
      { data: meetingRows },
      { data: progressRows, error: progressError },
    ] = await Promise.all([
        supabase
          .from("councilor_term")
          .select("party, councilor:councilor_id(id, full_name)")
          .eq("term_id", selectedTermId),
        // See the same note in /sesje/[id]/page.tsx — a single .range()
        // request can't exceed PostgREST's server-side max-rows cap no
        // matter how wide a range is asked for; paginate instead.
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
            .eq("meeting.term_id", selectedTermId)
            .range(from, to)
        ),
        supabase
          .from("meeting")
          .select(
            "id, date, title, video_url, video_downloaded, transcript_status, topics, summary"
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

    councilors = (roster ?? [])
      .filter((r) => r.councilor)
      .map((r) => ({ id: r.councilor!.id, fullName: r.councilor!.full_name }));

    const totals = new Map<string, number>();
    for (const s of segments ?? []) {
      if (!s.confirmed_councilor_id) continue;
      const duration = Number(s.end_time) - Number(s.start_time);
      totals.set(
        s.confirmed_councilor_id,
        (totals.get(s.confirmed_councilor_id) ?? 0) + duration
      );
      heatmapMatrix[s.confirmed_councilor_id] ??= {};
      heatmapMatrix[s.confirmed_councilor_id][s.meeting_id] =
        (heatmapMatrix[s.confirmed_councilor_id][s.meeting_id] ?? 0) +
        duration;
    }

    // Burmistrz and his deputy get their own heatmap rows (they're frequent,
    // named participants); every other official (skarbnik, sekretarz,
    // naczelnicy, urzędnicy odpowiadający na interpelacje, ...) is folded
    // into one combined "Pozostali urzędnicy" row so the heatmap doesn't
    // grow a long tail of near-empty rows for people who spoke once or twice.
    const officialRows = officials ?? [];
    const burmistrz = officialRows.find((o) =>
      o.role.toLowerCase().startsWith("burmistrz")
    );
    const zastepcaBurmistrza = officialRows.find((o) =>
      o.role.toLowerCase().startsWith("zastępca burmistrza")
    );
    const POZOSTALI_URZEDNICY_ID = "__pozostali_urzednicy__";
    const pozostaliIds = new Set(
      officialRows
        .filter((o) => o.id !== burmistrz?.id && o.id !== zastepcaBurmistrza?.id)
        .map((o) => o.id)
    );
    let pozostaliHasData = false;

    for (const s of segments ?? []) {
      if (!s.confirmed_official_id) continue;
      const duration = Number(s.end_time) - Number(s.start_time);
      const key =
        s.confirmed_official_id === burmistrz?.id
          ? burmistrz.id
          : s.confirmed_official_id === zastepcaBurmistrza?.id
            ? zastepcaBurmistrza.id
            : pozostaliIds.has(s.confirmed_official_id)
              ? POZOSTALI_URZEDNICY_ID
              : null;
      if (!key) continue;
      if (key === POZOSTALI_URZEDNICY_ID) pozostaliHasData = true;
      heatmapMatrix[key] ??= {};
      heatmapMatrix[key][s.meeting_id] =
        (heatmapMatrix[key][s.meeting_id] ?? 0) + duration;
    }

    heatmapExtraRows = [
      ...(burmistrz ? [{ id: burmistrz.id, fullName: burmistrz.full_name }] : []),
      ...(zastepcaBurmistrza
        ? [{ id: zastepcaBurmistrza.id, fullName: zastepcaBurmistrza.full_name }]
        : []),
      ...(pozostaliHasData
        ? [{ id: POZOSTALI_URZEDNICY_ID, fullName: "Pozostali urzędnicy" }]
        : []),
    ];
    // A session shows up as a column as soon as its transcript is imported
    // (transcript_status "rozpisana"), even before anyone's been tagged —
    // it just renders fully gray until tagging starts filling it in.
    heatmapMeetings = (meetingRows ?? [])
      .filter((m) => m.transcript_status === "rozpisana")
      .map((m) => ({ id: m.id, date: m.date, title: m.title }));

    stats = (roster ?? [])
      .filter((r) => r.councilor)
      .map((r) => ({
        id: r.councilor!.id,
        fullName: r.councilor!.full_name,
        party: r.party,
        totalSeconds: totals.get(r.councilor!.id) ?? 0,
      }));
  }

  const mostActive = [...stats]
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, 3);
  const mostSilent = [...stats]
    .sort((a, b) => a.totalSeconds - b.totalSeconds)
    .slice(0, 3);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-16">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← Mapa
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
            {council.name}
          </h1>
          {user && (
            <FavoriteCouncilButton
              councilId={council.id}
              initialIsFavorite={isFavoriteCouncil}
            />
          )}
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
                  href={`/rada/${council.id}?kadencja=${t.id}`}
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
                    href={`/rada/${council.id}${selectedTermId ? `?kadencja=${selectedTermId}` : ""}`}
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
                      href={`/rada/${council.id}?${params.toString()}`}
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
                <div className="relative flex min-w-max items-start gap-7 px-2 pt-2">
                  <div className="absolute left-2 right-2 top-[18px] h-px bg-zinc-200 dark:bg-zinc-800" />
                  {meetings.map((m) => {
                    const hasContent = Boolean(m.video_url);
                    const status = m.transcript_status ?? "nie rozpisana";
                    const matchesTag = selectedTag
                      ? (m.topics ?? []).includes(selectedTag)
                      : true;
                    const progress =
                      status === "rozpisana"
                        ? taggingProgress.get(m.id)
                        : undefined;
                    const hasSummary = Boolean(m.summary);
                    const tooltipParts = [m.title ?? undefined];
                    if (progress !== undefined) {
                      tooltipParts.push(
                        `otagowane: ${Math.round(progress * 100)}%`
                      );
                    }
                    if (hasSummary) tooltipParts.push("ma podsumowanie");
                    const tooltip = tooltipParts.filter(Boolean).join(" — ");

                    // A thin radial progress ring around the status dot —
                    // one hue (emerald, "done" semantics), only shown once
                    // a session is transcribed, so untranscribed sessions
                    // keep the plain, uncluttered dot. Radius must clear the
                    // dot's white/black halo ring (ring-2, outer edge ~r=14
                    // now that the dot is big enough to hold the session
                    // number) with a visible gap, or the opaque halo paints
                    // over the thin arc entirely — confirmed via screenshot
                    // that too small a gap here fully occludes it.
                    const RADIUS = 16;
                    const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
                    const BOX = 36;
                    const CENTER = BOX / 2;
                    const dotTextClass = hasSummary
                      ? "text-white"
                      : "text-zinc-900 dark:text-zinc-100";
                    const marker = (
                      <div
                        className={`flex flex-col items-center gap-2 transition-opacity ${
                          matchesTag ? "" : "opacity-25"
                        }`}
                      >
                        <div
                          className="relative flex items-center justify-center"
                          style={{ height: BOX, width: BOX }}
                        >
                          {progress !== undefined && (
                            <svg
                              viewBox={`0 0 ${BOX} ${BOX}`}
                              width={BOX}
                              height={BOX}
                              className="absolute inset-0 -rotate-90"
                            >
                              <circle
                                cx={CENTER}
                                cy={CENTER}
                                r={RADIUS}
                                fill="none"
                                strokeWidth="2"
                                className="stroke-zinc-300 dark:stroke-zinc-600"
                              />
                              <circle
                                cx={CENTER}
                                cy={CENTER}
                                r={RADIUS}
                                fill="none"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeDasharray={CIRCUMFERENCE}
                                strokeDashoffset={
                                  CIRCUMFERENCE * (1 - progress)
                                }
                                className="stroke-emerald-600 dark:stroke-emerald-400 transition-[stroke-dashoffset]"
                              />
                            </svg>
                          )}
                          <span
                            className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold leading-none ring-2 ring-white dark:ring-black ${dotTextClass} ${
                              hasSummary
                                ? (STATUS_DOT_CLASS[status] ?? STATUS_DOT_CLASS["nie rozpisana"])
                                : `bg-white dark:bg-black border-2 ${STATUS_DOT_BORDER_CLASS[status] ?? STATUS_DOT_BORDER_CLASS["nie rozpisana"]}`
                            } ${
                              selectedTag && matchesTag
                                ? "outline outline-2 outline-offset-2 outline-zinc-900 dark:outline-zinc-100"
                                : ""
                            }`}
                          >
                            {meetingNumbers.get(m.id)}
                          </span>
                        </div>
                        <span className="whitespace-nowrap text-xs text-zinc-500">
                          {formatShortDate(m.date)}
                        </span>
                      </div>
                    );
                    return hasContent ? (
                      <Link
                        key={m.id}
                        href={`/sesje/${m.id}`}
                        prefetch={false}
                        title={tooltip || undefined}
                        className="shrink-0 hover:opacity-70"
                      >
                        {marker}
                      </Link>
                    ) : (
                      <div
                        key={m.id}
                        title={tooltip || undefined}
                        className="shrink-0"
                      >
                        {marker}
                      </div>
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
