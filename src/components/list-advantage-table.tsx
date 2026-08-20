"use client";

import { useMemo } from "react";
import { findListAdvantage, findWinningAlternatives } from "@/lib/list-advantage";
import { committeeColorVar } from "@/lib/election-committee";
import type { SimCandidate, SimulationConfig } from "@/lib/electoral-systems";

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500";
const TD = "border-t border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800";
const NUM = `${TD} text-right tabular-nums`;

export function ListAdvantageTable({
  candidates,
  electedIds,
  committees,
  slotOf,
  seatsPerDistrict,
  config,
}: {
  candidates: SimCandidate[];
  /** Kto ma mandat w AKTUALNIE wybranym wariancie liczenia. */
  electedIds: string[];
  committees: { code: string; shortName: string }[];
  slotOf: Record<string, number>;
  seatsPerDistrict: Map<number, number>;
  /**
   * Wariant liczenia do sprawdzenia „a gdyby z innej listy". `null` wyłącza tę
   * kolumnę — przy STV trzeba by przeliczyć kilkadziesiąt pełnych liczeń kart,
   * co w przeglądarce jest zauważalnie wolne, a samo zestawienie działa i bez niej.
   */
  config: SimulationConfig | null;
}) {
  const elected = useMemo(() => new Set(electedIds), [electedIds]);
  const { thresholds, missedOut } = useMemo(
    () => findListAdvantage(candidates, elected),
    [candidates, elected]
  );
  const alternatives = useMemo(
    () =>
      config ? findWinningAlternatives(candidates, seatsPerDistrict, config, missedOut) : null,
    [config, candidates, seatsPerDistrict, missedOut]
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
              {alternatives && (
                <th className={`${TH} text-right`}>Weszłaby z innej listy</th>
              )}
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
                  {alternatives && (
                    <AlternativesCell
                      codes={alternatives.get(c.id) ?? []}
                      total={
                        new Set(
                          candidates
                            .filter((o) => o.districtNumber === c.districtNumber)
                            .map((o) => o.committeeCode)
                        ).size - 1
                      }
                      shortOf={shortOf}
                    />
                  )}
                </tr>
            ))}
          </tbody>
        </table>
      </div>

      {alternatives && (
        <p className="max-w-3xl text-xs leading-relaxed text-zinc-500">
          Ostatnia kolumna odpowiada na pytanie „a gdyby ta sama osoba kandydowała w tym
          samym okręgu z innej listy?&rdquo; — liczone przez faktyczne przeniesienie
          kandydata i przeliczenie całych wyborów od nowa, bez zmiany choćby jednego głosu.
          Zakładamy przy tym, że kandydat zabiera swoje głosy na nową listę. W samorządzie
          to założenie jest mocne: szyld waży tu znacznie mniej niż w wyborach krajowych —
          pięć z ośmiu list w Grójcu wystawiły komitety wyborców, a nie partie, jeden nosi
          wprost nazwisko swojego lidera i głosuje się przede wszystkim na osoby znane
          z sąsiedztwa. Przeniesienie nie jest jednak 1:1: część głosów padła na komitet,
          nie na człowieka, i ta część by za kandydatem nie poszła.
        </p>
      )}

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

function AlternativesCell({
  codes,
  total,
  shortOf,
}: {
  codes: string[];
  total: number;
  shortOf: Map<string, string>;
}) {
  return (
    <td className={`${NUM} align-top`}>
      {codes.length ? (
        <>
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
            {codes.length} z {total}
          </span>
          <span
            className="block max-w-[16rem] text-xs font-normal text-zinc-500"
            title={codes.map((c) => shortOf.get(c) ?? c).join(", ")}
          >
            {codes.join(", ")}
          </span>
        </>
      ) : (
        <span className="text-zinc-400">z żadnej</span>
      )}
    </td>
  );
}
