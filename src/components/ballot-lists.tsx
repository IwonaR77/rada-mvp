"use client";

import { useMemo } from "react";
import { buildBallotLists, measurePositionEffect } from "@/lib/list-position-effect";
import { committeeColorVar } from "@/lib/election-committee";
import type { SimCandidate } from "@/lib/electoral-systems";

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const num = (x: number) => x.toLocaleString("pl-PL", { maximumFractionDigits: 1 });

export function BallotLists({
  candidates,
  electedIds,
  committees,
  slotOf,
}: {
  candidates: SimCandidate[];
  /** Kto ma mandat w AKTUALNIE wybranym wariancie liczenia. */
  electedIds: string[];
  committees: { code: string; shortName: string }[];
  slotOf: Record<string, number>;
}) {
  const elected = useMemo(() => new Set(electedIds), [electedIds]);
  const lists = useMemo(() => buildBallotLists(candidates, elected), [candidates, elected]);
  const effect = useMemo(() => measurePositionEffect(lists), [lists]);
  const shortOf = new Map(committees.map((c) => [c.code, c.shortName]));
  const districts = [...new Set(lists.map((l) => l.districtNumber))].sort((a, b) => a - b);
  // Jedna skala dla wszystkich słupków w całych wyborach, a nie osobna dla
  // każdej listy. Normalizacja per lista wyrównywała wszystkie „jedynki" do
  // pełnej długości i sugerowała, że kandydat z 76 głosami zrobił taki sam
  // wynik jak ten z 341 — czyli kasowała dokładnie to porównanie, które ten
  // widok ma umożliwiać.
  const maxVotes = Math.max(...lists.flatMap((l) => l.candidates.map((c) => c.votes)), 1);

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

      <div className="flex max-w-3xl flex-col gap-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        <p>
          Miejsce na liście idzie w parze z wynikiem mocniej niż cokolwiek innego poza samym
          komitetem. Na{" "}
          <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
            {effect.topWasFirst + effect.topWasLast} z {effect.listsWithSeats}
          </strong>{" "}
          list, które zdobyły choć jeden mandat, najwięcej głosów zebrała osoba z pierwszego
          ({effect.topWasFirst}) albo z ostatniego miejsca ({effect.topWasLast}) — ani razu
          ktoś ze środka. „Jedynki&rdquo; to {pct(effect.firstPlaceShare.candidates)} kandydatów,
          a zebrały {pct(effect.firstPlaceShare.votes)} wszystkich głosów.
        </p>
        <p className="rounded-2xl border border-zinc-200 p-3 text-xs dark:border-zinc-800">
          <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
            Czego z tego NIE wynika:
          </strong>{" "}
          że samo miejsce na liście przynosi głosy. Komitety stawiają na pierwszym miejscu
          osoby już rozpoznawalne w mieście — swoich założycieli, liderów i kandydatów na
          burmistrza — więc strzałka może biec w drugą stronę: to nie „jedynka&rdquo; robi wynik,
          tylko ktoś z gotowym wynikiem dostaje „jedynkę&rdquo;. W tych wyborach każdy z czterech
          kandydatów na burmistrza otwierał listę swojego komitetu. Rozstrzygnąć tego z
          samych protokołów się nie da; te liczby pokazują współwystępowanie, nie przyczynę.
          Ostatnia pozycja to z kolei znana „kotwica&rdquo; — bywa czytana jak wyróżnienie,
          podobnie jak otwarcie listy.
        </p>
      </div>

      {districts.map((district) => (
        <div key={district}>
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Okręg {district}
          </h4>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            {lists
              .filter((l) => l.districtNumber === district)
              .map((list) => {
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
                        style={{ backgroundColor: committeeColorVar(slotOf[list.committeeCode] ?? null) }}
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
                                  width: `${(c.votes / maxVotes) * 100}%`,
                                  backgroundColor: committeeColorVar(
                                    slotOf[list.committeeCode] ?? null
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
        kolejność jest tu przedmiotem obserwacji. Słupki mają wspólną skalę dla wszystkich list ({maxVotes} głosów = pełna
        długość), więc da się je porównywać między komitetami i okręgami.
      </p>
    </div>
  );
}
