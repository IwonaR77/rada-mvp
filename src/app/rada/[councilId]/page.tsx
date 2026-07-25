import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type CouncilorStat = {
  id: string;
  fullName: string;
  party: string | null;
  totalSeconds: number;
};

function formatDuration(totalSeconds: number) {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} godz. ${minutes % 60} min`;
}

export default async function CouncilDashboardPage({
  params,
}: {
  params: Promise<{ councilId: string }>;
}) {
  const { councilId } = await params;
  const supabase = await createClient();

  const { data: council } = await supabase
    .from("council")
    .select("id, name, city:city_id(name)")
    .eq("id", councilId)
    .maybeSingle();

  if (!council) notFound();

  const { data: currentTerm } = await supabase
    .from("term")
    .select("id, label")
    .eq("council_id", councilId)
    .is("end_date", null)
    .maybeSingle();

  let stats: CouncilorStat[] = [];

  if (currentTerm) {
    const { data: roster } = await supabase
      .from("councilor_term")
      .select("party, councilor:councilor_id(id, full_name)")
      .eq("term_id", currentTerm.id);

    const { data: segments } = await supabase
      .from("segment")
      .select("confirmed_councilor_id, start_time, end_time, meeting:meeting_id!inner(term_id)")
      .eq("status", "finalized")
      .eq("meeting.term_id", currentTerm.id);

    const totals = new Map<string, number>();
    for (const s of segments ?? []) {
      if (!s.confirmed_councilor_id) continue;
      const duration = Number(s.end_time) - Number(s.start_time);
      totals.set(
        s.confirmed_councilor_id,
        (totals.get(s.confirmed_councilor_id) ?? 0) + duration
      );
    }

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
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← Mapa
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {council.name}
        </h1>
        <p className="text-zinc-500">{council.city?.name}</p>
      </div>

      {stats.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
          Jeszcze brak danych z sesji dla tej rady. Ranking pojawi się, gdy
          zostaną wgrane transkrypcje i sesje.
        </p>
      ) : (
        <div className="grid gap-8 sm:grid-cols-2">
          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Najaktywniejsi
            </h2>
            <ol className="flex flex-col gap-2">
              {mostActive.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                >
                  <span>{c.fullName}</span>
                  <span className="text-sm text-zinc-500">
                    {formatDuration(c.totalSeconds)}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Najcichsi
            </h2>
            <ol className="flex flex-col gap-2">
              {mostSilent.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                >
                  <span>{c.fullName}</span>
                  <span className="text-sm text-zinc-500">
                    {formatDuration(c.totalSeconds)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}
