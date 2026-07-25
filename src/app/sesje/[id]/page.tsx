import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SessionPlayer } from "@/components/session-player";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: meeting } = await supabase
    .from("meeting")
    .select("id, title, date, video_url, term:term_id(council:council_id(id, name))")
    .eq("id", id)
    .maybeSingle();

  if (!meeting || !meeting.video_url) notFound();

  const { data: segments } = await supabase
    .from("segment")
    .select("id, start_time, end_time, text")
    .eq("meeting_id", id)
    .order("start_time", { ascending: true });

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

      <SessionPlayer videoUrl={meeting.video_url} segments={segments ?? []} />
    </div>
  );
}
