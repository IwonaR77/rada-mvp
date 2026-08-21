import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FavoriteCouncilButton } from "@/components/favorite-council-button";
import { SpeakingHeatmap } from "@/components/speaking-heatmap";
import { getSpeakingActivity } from "@/lib/council-activity";
import { TaggingProgress } from "@/components/tagging-progress";
import { VotesVsSpeakingChart } from "@/components/votes-vs-speaking-chart";
import { loadVotesVsSpeaking } from "@/lib/votes-vs-speaking";

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
  let taggingTime: {
    total_seconds: number;
    finalized_seconds: number;
    proposed_seconds: number;
  } | null = null;
  // Kwadrant jest tylko dla rad z zaimportowanym wynikiem wyborów, więc bywa
  // pusty — sekcja znika wtedy w całości.
  let votesVsSpeaking: Awaited<ReturnType<typeof loadVotesVsSpeaking>> = null;
  if (latestTerm) {
    const { data: officials } = await supabase
      .from("official")
      .select("id, full_name, role")
      .eq("council_id", councilId);
    const [loadedActivity, { data: timeRows }, loadedQuadrant] = await Promise.all([
      getSpeakingActivity(supabase, latestTerm.id, officials ?? []),
      // Postęp tagowania liczony czasem wypowiedzi — mówi, ile jeszcze zostało
      // do przesłuchania, czego heatmapa sama z siebie nie pokazuje: pusta
      // komórka może znaczyć "nie mówił" albo "nikt tego jeszcze nie tknął".
      supabase.rpc("term_tagging_time", { p_term_id: latestTerm.id }),
      loadVotesVsSpeaking(supabase, latestTerm.id),
    ]);
    activity = loadedActivity;
    taggingTime = timeRows?.[0] ?? null;
    votesVsSpeaking = loadedQuadrant;
  }

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-10 px-6 py-16">
      <div>
        <Link href="/mapa" className="text-sm text-zinc-500 hover:underline">
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
          href={`/rada/${council.id}/wybory`}
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Wybory
        </Link>
        <Link
          href={`/sprawy?councilId=${council.id}`}
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Sprawy
        </Link>
      </nav>

      {/* Heatmapa przed kwadrantem: pokazuje, kto mówił i na których sesjach,
          czyli materiał, z którego kwadrant liczy jedną ze swoich osi. Kwadrant
          czyta się lepiej, gdy się już wie, skąd wziął się czas mówienia — a nie
          odwrotnie. Pasek rozpisania zostaje przy heatmapie, bo opisuje
          kompletność właśnie tych danych. */}
      {activity && (
        <section>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Aktywność na sesjach {latestTerm?.label ? `— ${latestTerm.label}` : ""}
          </h3>
          {taggingTime && (
            <div className="mb-4">
              <TaggingProgress
                totalSeconds={Number(taggingTime.total_seconds)}
                finalizedSeconds={Number(taggingTime.finalized_seconds)}
                proposedSeconds={Number(taggingTime.proposed_seconds)}
              />
            </div>
          )}
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

      {votesVsSpeaking && votesVsSpeaking.points.length >= 5 && (
        <section>
          <h3 className="mb-1 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Głosy a czas mówienia {latestTerm?.label ? `— ${latestTerm.label}` : ""}
          </h3>
          <p className="mb-4 text-xs text-zinc-500">
            Każdy punkt to jeden radny: w poziomie liczba głosów oddanych na niego
            w wyborach, w pionie łączny czas, przez jaki mówił na sesjach tej kadencji.
            Linie przerywane to mediany obu wielkości.
          </p>
          <VotesVsSpeakingChart
            points={votesVsSpeaking.points}
            correlation={votesVsSpeaking.correlation}
          />
        </section>
      )}
    </div>
  );
}
