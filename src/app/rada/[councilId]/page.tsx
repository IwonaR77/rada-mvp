import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FavoriteCouncilButton } from "@/components/favorite-council-button";
import { SpeakingHeatmap } from "@/components/speaking-heatmap";
import { getSpeakingActivity } from "@/lib/council-activity";
import {
  ThreadGroup,
  groupByThread,
  collectTags,
  filterMattersByTag,
  type Matter,
  type Thread,
} from "@/components/matter-list";

export default async function CouncilHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ councilId: string }>;
  searchParams: Promise<{ tag?: string }>;
}) {
  const { councilId } = await params;
  const { tag } = await searchParams;
  const supabase = await createClient();

  const { data: council } = await supabase
    .from("council")
    .select("id, name, city:city_id(name, coat_of_arms_url)")
    .eq("id", councilId)
    .maybeSingle();

  if (!council) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isFavoriteCouncil = false;
  if (user) {
    const { data: appUser } = await supabase
      .from("app_user")
      .select("favorite_council_id")
      .eq("id", user.id)
      .maybeSingle();
    isFavoriteCouncil = appUser?.favorite_council_id === councilId;
  }

  const [{ data: latestTerm }, { data: matters }, { data: threads }] =
    await Promise.all([
      supabase
        .from("term")
        .select("id, label")
        .eq("council_id", councilId)
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("matter")
        .select(
          `id, title, status, notes, council_id, thread_id,
           matter_tag(tag),
           matter_participant(role, councilor:councilor_id(id, full_name)),
           matter_reference(id, note, meeting:meeting_id(id, date), interpellation:interpellation_id(id, title, pdf_url))`
        )
        .eq("council_id", councilId)
        .order("created_at", { ascending: true }),
      supabase
        .from("matter_thread")
        .select("id, title, description")
        .eq("council_id", councilId),
    ]);

  let councilors: { id: string; full_name: string }[] = [];
  let activity: Awaited<ReturnType<typeof getSpeakingActivity>> | null = null;
  if (latestTerm) {
    const { data: officials } = await supabase
      .from("official")
      .select("id, full_name, role");
    activity = await getSpeakingActivity(supabase, latestTerm.id, officials ?? []);
    councilors = [...activity.councilors]
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "pl"))
      .map((c) => ({ id: c.id, full_name: c.fullName }));
  }

  const rows = (matters ?? []) as unknown as Matter[];
  const threadsById = new Map((threads ?? []).map((t) => [t.id, t as Thread]));

  let canApprove = false;
  if (user) {
    const { data } = await supabase.rpc("user_has_permission", {
      uid: user.id,
      perm: "finalize_vote",
      target_council_id: councilId,
    });
    canApprove = Boolean(data);
  }
  const canApproveByCouncil = new Map([[councilId, canApprove]]);

  const allTags = collectTags(rows);
  const selectedTag = tag && allTags.includes(tag) ? tag : null;
  const filteredRows = filterMattersByTag(rows, selectedTag);
  const approved = filteredRows.filter((m) => m.status === "approved");
  const proposed = filteredRows.filter((m) => m.status === "proposed");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-16">
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

      {councilors.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Radni {latestTerm?.label ? `— ${latestTerm.label}` : ""} (
            {councilors.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {councilors.map((c) => (
              <Link
                key={c.id}
                href={`/radny/${c.id}`}
                className="rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                {c.full_name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {activity && (
        <section>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Aktywność na sesjach {latestTerm?.label ? `— ${latestTerm.label}` : ""}
          </h3>
          <SpeakingHeatmap
            councilors={[
              ...activity.councilors.map((c) => ({ ...c, href: `/radny/${c.id}` })),
              ...activity.heatmapExtraRows,
            ]}
            meetings={activity.heatmapMeetings}
            matrix={activity.heatmapMatrix}
          />
        </section>
      )}

      {allTags.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Tematy
            </h3>
            {selectedTag && (
              <Link
                href={`/rada/${council.id}`}
                prefetch={false}
                className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Wyczyść filtr
              </Link>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {allTags.map((t) => {
              const isActive = t === selectedTag;
              return (
                <Link
                  key={t}
                  href={isActive ? `/rada/${council.id}` : `/rada/${council.id}?tag=${encodeURIComponent(t)}`}
                  prefetch={false}
                  className={`rounded-full px-3 py-1 text-sm transition-colors ${
                    isActive
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {t}
                </Link>
              );
            })}
          </div>
        </section>
      )}

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
          <p className="text-sm text-zinc-500">
            Brak spraw oczekujących na akceptację.
          </p>
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
