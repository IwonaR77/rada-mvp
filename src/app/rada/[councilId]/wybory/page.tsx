import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadElection } from "@/lib/election-data";
import { assignCommitteeSlots } from "@/lib/election-committee";
import { ElectoralSimulator } from "@/components/electoral-simulator";
import { BallotLists } from "@/components/ballot-lists";

export default async function CouncilElectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ councilId: string }>;
  searchParams: Promise<{ kadencja?: string }>;
}) {
  const { councilId } = await params;
  const { kadencja } = await searchParams;
  const supabase = await createClient();

  const { data: council } = await supabase
    .from("council")
    .select("id, name")
    .eq("id", councilId)
    .maybeSingle();
  if (!council) notFound();

  const { data: terms } = await supabase
    .from("term")
    .select("id, label, start_date")
    .eq("council_id", councilId)
    .order("start_date", { ascending: false });

  const termId =
    (kadencja && terms?.some((t) => t.id === kadencja) ? kadencja : null) ??
    terms?.[0]?.id ??
    null;
  const term = terms?.find((t) => t.id === termId);
  const election = termId ? await loadElection(supabase, termId) : null;

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href={`/rada/${council.id}/glosy${termId ? `?kadencja=${termId}` : ""}`}
          className="text-sm text-zinc-500 hover:underline"
        >
          ← Głosy — {council.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Symulator ordynacji — {council.name}
        </h1>
        {term && <p className="text-zinc-500">{term.label}</p>}
      </div>

      {!election ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
          Dla tej kadencji nie zaimportowano jeszcze wyników wyborów.
        </p>
      ) : (
        <>
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Ta sama karta do głosowania, inny sposób liczenia. Poniżej można przeliczyć
            rzeczywiste głosy z 7 kwietnia 2024 innymi metodami podziału mandatów, przy innym
            podziale na okręgi i przy innym progu — i zobaczyć imiennie, kto zasiadałby w radzie.
            Wszystkie liczby pochodzą z protokołów PKW; przelicza je ten sam kod, którym
            sprawdziliśmy, że potrafi odtworzyć oficjalny wynik co do nazwiska.
          </p>

          <ElectoralSimulator
            candidates={election.candidates}
            districtSeats={election.districts.map((d) => [d.number, d.seats] as [number, number])}
            committees={election.committees.map((c) => ({
              code: c.code,
              shortName: c.shortName,
              votes: c.votes,
            }))}
            actualSeats={Object.fromEntries(election.committees.map((c) => [c.code, c.seats]))}
            actualElectedIds={[...election.actualElectedIds]}
            slotOf={Object.fromEntries(
              assignCommitteeSlots(
                election.committees.map((c) => ({ code: c.code, ballotOrder: c.listNumber }))
              )
            )}
          />

          <section>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Miejsce na liście — czy „jedynki&rdquo; wchodzą?
            </h2>
            <BallotLists
              election={election}
              slotOf={assignCommitteeSlots(
                election.committees.map((c) => ({ code: c.code, ballotOrder: c.listNumber }))
              )}
            />
          </section>

          <div className="max-w-3xl rounded-2xl border border-zinc-200 p-4 text-sm leading-relaxed text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Jak to czytać
            </h2>
            <p className="mb-2">
              Punktem odniesienia jest wynik z dnia wyborów, a nie dzisiejszy skład rady —
              dlatego w składzie widnieją Dariusz Gwiazda i Jarosław Rupiewicz, którzy mandaty
              zdobyli, ale ich nie objęli (wybór na burmistrza i zrzeczenie się mandatu).
              Mieszanie wyniku wyborów z późniejszymi zmianami zaciemniłoby porównanie samych
              ordynacji. Nazwiska zapisane są tak, jak w protokołach PKW.
            </p>
            <p>
              Przeliczenie dotyczy wyłącznie arytmetyki: te same karty, inny wzór. Przy innej
              ordynacji inaczej zawiązałyby się komitety, inaczej wyglądałaby kampania
              i część wyborców zagłosowałaby inaczej — tego żaden symulator nie policzy.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
