import type { ElectionData } from "@/lib/election-data";
import { buildBallotLists, measurePositionEffect } from "@/lib/list-position-effect";
import { committeeColorVar } from "@/lib/election-committee";

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const num = (x: number) => x.toLocaleString("pl-PL", { maximumFractionDigits: 1 });

export function BallotLists({
  election,
  slotOf,
}: {
  election: ElectionData;
  slotOf: Map<string, number>;
}) {
  const lists = buildBallotLists(election);
  const effect = measurePositionEffect(lists);
  const shortOf = new Map(election.committees.map((c) => [c.code, c.shortName]));
  const districts = [...new Set(lists.map((l) => l.districtNumber))].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-8">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                Miejsce na liście
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500">
                Kandydatów
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500">
                Mandaty
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500">
                Szansa na mandat
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500">
                Śr. głosów
              </th>
            </tr>
          </thead>
          <tbody>
            {effect.buckets.map((b) => (
              <tr key={b.label}>
                <td className="border-t border-zinc-200 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                  {b.label}
                </td>
                <td className="border-t border-zinc-200 px-3 py-2 text-right text-sm tabular-nums text-zinc-500 dark:border-zinc-800">
                  {b.candidates}
                </td>
                <td className="border-t border-zinc-200 px-3 py-2 text-right text-sm font-semibold tabular-nums text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
                  {b.seats}
                </td>
                <td className="border-t border-zinc-200 px-3 py-2 text-right text-sm tabular-nums text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                  {pct(b.candidates ? b.seats / b.candidates : 0)}
                </td>
                <td className="border-t border-zinc-200 px-3 py-2 text-right text-sm tabular-nums text-zinc-500 dark:border-zinc-800">
                  {num(b.averageVotes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Miejsce na liście waży więcej niż cokolwiek innego poza samym komitetem. Na{" "}
        <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
          {effect.listsWithSeats} z {effect.listsWithSeats}
        </strong>{" "}
        list, które zdobyły choć jeden mandat, najwięcej głosów zebrała osoba z pierwszego
        ({effect.topWasFirst}) albo z ostatniego miejsca ({effect.topWasLast}) — ani razu
        ktoś ze środka. Ostatnia pozycja to znana „kotwica&rdquo;: bywa czytana jak wyróżnienie,
        podobnie jak otwarcie listy.
      </p>

      {districts.map((district) => (
        <div key={district}>
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Okręg {district}
          </h4>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            {lists
              .filter((l) => l.districtNumber === district)
              .map((list) => {
                const max = Math.max(...list.candidates.map((c) => c.votes), 1);
                const last = list.candidates.length;
                return (
                  <div
                    key={`${list.committeeCode}|${district}`}
                    className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: committeeColorVar(slotOf.get(list.committeeCode) ?? null) }}
                      />
                      <span className="truncate text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        {shortOf.get(list.committeeCode) ?? list.committeeCode}
                      </span>
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-zinc-500">
                        {list.seats} mand.
                      </span>
                    </div>
                    <ol className="flex flex-col gap-1">
                      {list.candidates.map((c) => (
                        <li key={c.id} className="flex items-center gap-2">
                          <span
                            className={`w-4 shrink-0 text-right font-mono text-[10px] ${
                              c.listPosition === 1 || c.listPosition === last
                                ? "text-zinc-700 dark:text-zinc-300"
                                : "text-zinc-400"
                            }`}
                          >
                            {c.listPosition}
                          </span>
                          <span
                            className={`min-w-0 flex-1 truncate text-xs ${
                              c.wonMandate
                                ? "font-semibold text-zinc-900 dark:text-zinc-100"
                                : "text-zinc-500"
                            }`}
                            title={c.fullName}
                          >
                            {c.fullName}
                          </span>
                          <span className="flex w-20 shrink-0 items-center gap-1">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                              <span
                                className="block h-full rounded-full"
                                style={{
                                  width: `${(c.votes / max) * 100}%`,
                                  backgroundColor: committeeColorVar(
                                    slotOf.get(list.committeeCode) ?? null
                                  ),
                                }}
                              />
                            </span>
                            <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-zinc-500">
                              {c.votes}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
          </div>
        </div>
      ))}

      <p className="text-xs text-zinc-500">
        Listy w kolejności z karty do głosowania — celowo nieposortowane głosami, bo właśnie
        kolejność jest tu przedmiotem obserwacji. Pogrubieni kandydaci zdobyli mandat.
      </p>
    </div>
  );
}
