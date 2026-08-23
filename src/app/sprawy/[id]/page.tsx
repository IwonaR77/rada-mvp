import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MatterCard, type Matter } from "@/components/matter-list";

export default async function SprawaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: matter } = await supabase
    .from("matter")
    .select(
      `id, title, status, notes, council_id, thread_id,
       matter_tag(tag),
       matter_participant(role, councilor:councilor_id(id, full_name)),
       matter_reference(id, note, meeting:meeting_id(id, date), interpellation:interpellation_id(id, title, pdf_url))`
    )
    .eq("id", id)
    .maybeSingle();

  if (!matter) notFound();

  const [{ data: council }, { data: thread }, { data: canApproveData }] =
    await Promise.all([
      supabase
        .from("council")
        .select("id, name")
        .eq("id", matter.council_id)
        .maybeSingle(),
      matter.thread_id
        ? supabase
            .from("matter_thread")
            .select("id, title, description")
            .eq("id", matter.thread_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      user
        ? supabase.rpc("user_has_permission", {
            uid: user.id,
            perm: "finalize_vote",
            target_council_id: matter.council_id,
          })
        : Promise.resolve({ data: false }),
    ]);

  const canApprove = Boolean(canApproveData);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-12">
      <div>
        <Link
          href={`/sprawy${council ? `?councilId=${council.id}` : ""}`}
          className="text-sm text-zinc-500 hover:underline"
        >
          ← Sprawy{council ? ` — ${council.name}` : ""}
        </Link>
      </div>

      {thread && (
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Wątek: {thread.title}
        </p>
      )}

      <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        <MatterCard matter={matter as unknown as Matter} canApprove={canApprove} />
      </ul>
    </div>
  );
}
