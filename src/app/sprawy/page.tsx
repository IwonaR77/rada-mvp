import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  ThreadGroup,
  groupByThread,
  type Matter,
  type Thread,
} from "@/components/matter-list";

export default async function SprawyPage({
  searchParams,
}: {
  searchParams: Promise<{ councilId?: string }>;
}) {
  const { councilId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let query = supabase
    .from("matter")
    .select(
      `id, title, status, notes, council_id, thread_id,
       matter_tag(tag),
       matter_participant(role, councilor:councilor_id(id, full_name)),
       matter_reference(id, note, meeting:meeting_id(id, date), interpellation:interpellation_id(id, title, pdf_url))`
    )
    .order("created_at", { ascending: true });
  if (councilId) query = query.eq("council_id", councilId);

  let threadsQuery = supabase
    .from("matter_thread")
    .select("id, title, description");
  if (councilId) threadsQuery = threadsQuery.eq("council_id", councilId);

  const [{ data: matters }, { data: council }, { data: threads }] =
    await Promise.all([
      query,
      councilId
        ? supabase.from("council").select("id, name").eq("id", councilId).maybeSingle()
        : Promise.resolve({ data: null }),
      threadsQuery,
    ]);

  const rows = (matters ?? []) as unknown as Matter[];
  const threadsById = new Map((threads ?? []).map((t) => [t.id, t as Thread]));

  const canApproveByCouncil = new Map<string, boolean>();
  if (user) {
    const distinctCouncilIds = [...new Set(rows.map((m) => m.council_id))];
    const results = await Promise.all(
      distinctCouncilIds.map((councilId) =>
        supabase.rpc("user_has_permission", {
          uid: user.id,
          perm: "finalize_vote",
          target_council_id: councilId,
        })
      )
    );
    distinctCouncilIds.forEach((councilId, i) => {
      canApproveByCouncil.set(councilId, Boolean(results[i].data));
    });
  }

  const approved = rows.filter((m) => m.status === "approved");
  const proposed = rows.filter((m) => m.status === "proposed");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-12">
      <div>
        {council && (
          <Link
            href={`/rada/${council.id}`}
            className="text-sm text-zinc-500 hover:underline"
          >
            ← {council.name}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Sprawy{council ? ` — ${council.name}` : ""}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Wątki i sprawy powracające na sesjach i w interpelacjach — niezależnie
          od tego, ilu radnych je prowadzi i jak długo trwają.
        </p>
      </div>

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Zatwierdzone ({approved.length})
        </h2>
        {approved.length === 0 ? (
          <p className="text-sm text-zinc-500">Brak zatwierdzonych spraw.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {groupByThread(approved, threadsById).map((group, i) => (
              <ThreadGroup
                key={group.thread?.id ?? `untitled-${i}`}
                thread={group.thread}
                matters={group.matters}
                canApproveByCouncil={canApproveByCouncil}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Oczekujące na akceptację ({proposed.length})
        </h2>
        {proposed.length === 0 ? (
          <p className="text-sm text-zinc-500">Brak spraw oczekujących na akceptację.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {groupByThread(proposed, threadsById).map((group, i) => (
              <ThreadGroup
                key={group.thread?.id ?? `untitled-${i}`}
                thread={group.thread}
                matters={group.matters}
                canApproveByCouncil={canApproveByCouncil}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
