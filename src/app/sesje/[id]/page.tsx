import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SessionPlayer } from "@/components/session-player";
import { SessionNeighborNav } from "@/components/session-neighbor-nav";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

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
      "id, title, date, esesja_id, video_url, summary, topics, term_id, term:term_id(council:council_id(id, name))"
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

  const [segments, { data: roster }, { data: officials }, { data: termMeetings }, { data: topicRows }] =
    await Promise.all([
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
      }>((from, to) =>
        supabase
          .from("segment")
          .select(
            "id, start_time, end_time, text, confirmed_councilor_id, confirmed_official_id"
          )
          .eq("meeting_id", id)
          .order("start_time", { ascending: true })
          .range(from, to)
      ),
      supabase
        .from("councilor_term")
        .select("councilor:councilor_id(id, full_name)")
        .eq("term_id", meeting.term_id),
      supabase.from("official").select("id, full_name, role"),
      // Chronological position within the term (ascending, ALL sessions —
      // not just ones with a resolved video_url) matches the real Sesja
      // Nr N numbering used in official documents — verified against two
      // known sessions (86312 → 32 "Sesja XXXII", 87170 → 33 "Sesja
      // XXXIII") before relying on it here.
      supabase
        .from("meeting")
        .select("id, date, video_url")
        .eq("term_id", meeting.term_id)
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
    ]);

  const allTopics = [
    ...new Set((topicRows ?? []).flatMap((r) => r.topics ?? [])),
  ].sort((a, b) => a.localeCompare(b, "pl"));

  let isAdmin = false;
  if (user) {
    const { data: appUser } = await supabase
      .from("app_user")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    isAdmin = appUser?.role === "admin" || appUser?.role === "moderator";
  }

  const councilors = (roster ?? [])
    .filter((r) => r.councilor)
    .map((r) => ({ id: r.councilor!.id, name: r.councilor!.full_name }));

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
      : orderedMeetings.map((m, i) => ({
          id: m.id,
          date: m.date,
          hasVideo: Boolean(m.video_url),
          number: i + 1,
        }));
  // Newest first (leftmost), matching the timeline's reading direction.
  const neighborsNewestFirst = [...neighborWindow].reverse();

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-6 px-6 py-12">
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
        esesjaId={meeting.esesja_id}
        meetingDate={meeting.date}
        existingTopics={allTopics}
        summary={meeting.summary}
        videoUrl={meeting.video_url}
        segments={segments ?? []}
        councilors={councilors}
        officials={officials ?? []}
        isAdmin={isAdmin}
        initialSeek={initialSeek}
      />
    </div>
  );
}
