import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SessionPlayer } from "@/components/session-player";

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
      "id, title, date, video_url, summary, term_id, term:term_id(council:council_id(id, name))"
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

  const [{ data: segments }, { data: roster }, { data: officials }, { data: termMeetings }] =
    await Promise.all([
      supabase
        .from("segment")
        .select(
          "id, start_time, end_time, text, confirmed_councilor_id, confirmed_official_id"
        )
        .eq("meeting_id", id)
        .order("start_time", { ascending: true })
        // Supabase/PostgREST silently caps unranged selects (default 1000
        // rows) — a single long session can already exceed that, so this
        // must be explicit rather than relying on the default.
        .range(0, 9999),
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
    ]);

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
  // A generous window rather than a fixed handful — the row wraps
  // (flex-wrap) rather than scrolling, so it naturally fills however much
  // width is available instead of hardcoding a pill count.
  const NEIGHBOR_RADIUS = 10;
  const neighborWindow =
    currentIndex === -1
      ? []
      : orderedMeetings
          .slice(
            Math.max(0, currentIndex - NEIGHBOR_RADIUS),
            currentIndex + NEIGHBOR_RADIUS + 1
          )
          .map((m, i) => ({
            id: m.id,
            date: m.date,
            hasVideo: Boolean(m.video_url),
            number: Math.max(0, currentIndex - NEIGHBOR_RADIUS) + i + 1,
          }));
  // Newest first (leftmost), matching the timeline's reading direction.
  const neighborsNewestFirst = [...neighborWindow].reverse();

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-6 px-6 py-12">
      {neighborsNewestFirst.length > 1 && (
        <nav className="flex flex-wrap items-center gap-1.5 text-sm">
          {neighborsNewestFirst.map((m) =>
            m.hasVideo ? (
              <Link
                key={m.id}
                href={`/sesje/${m.id}`}
                prefetch={false}
                title={m.date}
                className={`rounded-full px-3 py-1 transition-colors ${
                  m.id === meeting.id
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {m.number}
              </Link>
            ) : (
              <span
                key={m.id}
                title={`${m.date} — brak nagrania/transkrypcji`}
                className="cursor-default rounded-full border border-dashed border-zinc-200 px-3 py-1 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700"
              >
                {m.number}
              </span>
            )
          )}
        </nav>
      )}

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
      </div>

      <SessionPlayer
        meetingId={meeting.id}
        meetingTitle={meeting.title ?? meeting.id}
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
