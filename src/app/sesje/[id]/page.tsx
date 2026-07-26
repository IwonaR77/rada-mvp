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
      "id, title, date, video_url, term_id, term:term_id(council:council_id(id, name))"
    )
    .eq("id", id)
    .maybeSingle();

  if (!meeting || !meeting.video_url) notFound();

  const [{ data: segments }, { data: roster }, { data: officials }, { data: auth }] =
    await Promise.all([
      supabase
        .from("segment")
        .select(
          "id, start_time, end_time, text, confirmed_councilor_id, confirmed_official_id"
        )
        .eq("meeting_id", id)
        .order("start_time", { ascending: true }),
      supabase
        .from("councilor_term")
        .select("councilor:councilor_id(id, full_name)")
        .eq("term_id", meeting.term_id),
      supabase.from("official").select("id, full_name, role"),
      supabase.auth.getUser(),
    ]);

  let isAdmin = false;
  if (auth?.user) {
    const { data: appUser } = await supabase
      .from("app_user")
      .select("role")
      .eq("id", auth.user.id)
      .maybeSingle();
    isAdmin = appUser?.role === "admin" || appUser?.role === "moderator";
  }

  const councilors = (roster ?? [])
    .filter((r) => r.councilor)
    .map((r) => ({ id: r.councilor!.id, name: r.councilor!.full_name }));

  const council = meeting.term?.council;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-12">
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
