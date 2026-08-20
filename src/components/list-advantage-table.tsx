"use client";

import { useMemo } from "react";
import { findListAdvantage } from "@/lib/list-advantage";
import { committeeColorVar } from "@/lib/election-committee";
import type { SimCandidate } from "@/lib/electoral-systems";

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500";
const TD = "border-t border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800";
const NUM = `${TD} text-right tabular-nums`;

export function ListAdvantageTable({
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
  const { thresholds, missedOut } = useMemo(
    () => findListAdvantage(candidates, elected),
    [candidates, elected]
  );
  const shortOf = new Map(committees.map((c) => [c.code, c.shortName]));

  if (!thresholds.length) return null;

  const thresholdList = thresholds
    .map((t) => `okręg ${t.districtNumber} — ${t.votes}`)
    .join(", ");

  if (!missedOut.length) {
    return (
      <p className="text-sm text-zinc-500">
        W tym wariancie nikt niewybrany nie przebił progu swojego okręgu ({thresholdList}).
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Mandaty dzieli się w okręgu, a najsłabszy wynik, który dał tam mandat, wyniósł:{" "}
        <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
          {thresholdList}
        </strong>{" "}
        {thresholds.length === 1 ? "głosów" : "głosów"}. Mimo to{" "}
        <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
          {missedOut.length}
        </strong>{" "}
        {missedOut.length === 1 ? "osoba przebiła ten próg" : "osób przebiło ten próg"} we
        własnym okręgu i mandatu nie {missedOut.length === 1 ? "dostała" : "dostało"}. To
        premia za obecność na właściwej liście: mandat najpierw dostaje LISTA, a dopiero
        potem dzieli się go między jej kandydatów.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={TH}>Kandydat</th>
              <th className={TH}>Komitet</th>
              <th className={`${TH} text-right`}>Okręg</th>
              <th className={`${TH} text-right`}>Miejsce</th>
              <th className={`${TH} text-right`}>Głosy</th>
              <th className={`${TH} text-right`}>Próg w okręgu</th>
            </tr>
          </thead>
          <tbody>
            {missedOut.map((c) => (
              <tr key={c.id}>
                  <td className={`${TD} text-zinc-700 dark:text-zinc-300`}>{c.fullName}</td>
                  <td className={TD}>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: committeeColorVar(slotOf[c.committeeCode] ?? null) }}
                      />
                      <span className="text-zinc-500">{shortOf.get(c.committeeCode)}</span>
                    </span>
                  </td>
                  <td className={`${NUM} text-zinc-500`}>{c.districtNumber}</td>
                  <td className={`${NUM} text-zinc-500`}>{c.listPosition}</td>
                  <td className={`${NUM} font-semibold text-zinc-900 dark:text-zinc-100`}>
                    {c.votes}
                  </td>
                  <td className={`${NUM} text-zinc-500`}>
                    {c.districtThreshold}
                    <span className="ml-2 text-rose-700 dark:text-rose-400">
                      +{c.votes - c.districtThreshold}
                    </span>
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="max-w-3xl text-xs leading-relaxed text-zinc-500">
        Wykaz obejmuje wyłącznie osoby, które przebiły próg SWOJEGO okręgu — porównywanie
        ich z najsłabszym zwycięzcą w całej gminie byłoby mylące, bo progi w okręgach różnią
        się nawet o kilkadziesiąt głosów. Na czerwono, o ile głosów każda z nich ten próg
        przebiła. To nie jest błąd systemu, tylko jego konstrukcja — ale widać ją dopiero,
        gdy zestawi się te osoby obok siebie.
      </p>
    </div>
  );
}
