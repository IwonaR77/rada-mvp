import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FavoriteCouncilButton } from "@/components/favorite-council-button";
import { SpeakingHeatmap } from "@/components/speaking-heatmap";
import { getSpeakingActivity } from "@/lib/council-activity";

export default async function CouncilHubPage({
  params,
}: {
  params: Promise<{ councilId: string }>;
}) {
  const { councilId } = await params;
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

  const { data: latestTerm } = await supabase
    .from("term")
    .select("id, label")
    .eq("council_id", councilId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  let activity: Awaited<ReturnType<typeof getSpeakingActivity>> | null = null;
  if (latestTerm) {
    const { data: officials } = await supabase
      .from("official")
      .select("id, full_name, role");
    activity = await getSpeakingActivity(supabase, latestTerm.id, officials ?? []);
  }

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

      <nav className="flex flex-wrap gap-2">
        <Link
          href={`/rada/${council.id}/radni`}
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Radni
        </Link>
        <Link
          href={`/rada/${council.id}/sesje`}
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Sesje
        </Link>
        <Link
          href={`/rada/${council.id}/glosy`}
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Głosy
        </Link>
        <Link
          href={`/sprawy?councilId=${council.id}`}
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Sprawy
        </Link>
      </nav>

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
    </div>
  );
}
