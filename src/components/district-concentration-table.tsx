"use client";

import { useMemo } from "react";
import { analyseConcentration } from "@/lib/district-concentration";
import { committeeColorVar } from "@/lib/election-committee";
import type { Method, SimCandidate } from "@/lib/electoral-systems";

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500";
const TD = "border-t border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800";
const NUM = `${TD} text-right tabular-nums`;

export function DistrictConcentrationTable({
  candidates,
  seatsPerDistrict,
  electedIds,
  committees,
  slotOf,
  method,
  threshold,
}: {
  candidates: SimCandidate[];
  seatsPerDistrict: Map<number, number>;
  electedIds: string[];
  committees: { code: string; shortName: string }[];
  slotOf: Record<string, number>;
  method: Method;
  threshold: number;
}) {
  const elected = useMemo(() => new Set(electedIds), [electedIds]);
  const rows = useMemo(
    () => analyseConcentration(candidates, seatsPerDistrict, elected, method, threshold),
    [candidates, seatsPerDistrict, elected, method, threshold]
  );
  const shortOf = new Map(committees.map((c) => [c.code, c.shortName]));

  const gains = rows.filter((r) => r.bestSeats > r.actualSeats);
  const totalGain = gains.reduce((a, r) => a + (r.bestSeats - r.actualSeats), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-3xl rounded-2xl border border-amber-300/60 bg-amber-50/40 p-3 text-xs leading-relaxed text-zinc-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-zinc-300">
        <strong className="font-semibold">To nie jest porada wyborcza ani zarzut.</strong>{" "}
        Kolumna „maksimum&rdquo; zakłada, że głosy komitetu dałoby się dowolnie przesypać
        między okręgami — a nie da się. Wyborca głosuje tam, gdzie mieszka; komitet decyduje
        tylko o tym, gdzie postawi kandydatów, nie gdzie mieszkają jego zwolennicy, a
        przeniesiony kandydat nie zabiera ze sobą swoich wyborców. Czytać to jako miarę
        tego, ile dany komitet traci na rozproszeniu poparcia między trzy okręgi. Spójnym
        scenariuszem „co gdyby&rdquo; jest przełącznik „jeden okręg&rdquo; wyżej: tam zmienia
        się prawo, a nie miejsce zamieszkania wyborców.
      </div>

      {gains.length === 0 ? (
        <p className="text-sm text-zinc-500">
          W tym wariancie żaden komitet nie zyskałby mandatu na innym rozłożeniu głosów
          między okręgami — podział na okręgi nikogo tu nie kosztuje.
        </p>
      ) : (
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Podział na okręgi kosztuje{" "}
          <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
            {gains.length}
          </strong>{" "}
          {gains.length === 1 ? "komitet" : gains.length < 5 ? "komitety" : "komitetów"}{" "}
          łącznie <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
            {totalGain}
          </strong>{" "}
          {totalGain === 1 ? "mandat" : totalGain < 5 ? "mandaty" : "mandatów"} — tyle więcej
          wzięłyby przy idealnej, nieosiągalnej koncentracji tych samych głosów.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={TH}>Komitet</th>
              <th className={`${TH} text-right`}>Głosy</th>
              <th className={`${TH} text-right`}>Mandaty</th>
              <th className={`${TH} text-right`}>Maksimum</th>
              <th className={`${TH} text-right`}>Różnica</th>
              <th className={`${TH} text-right`}>Rozkład dający maksimum</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.bestSeats - r.actualSeats;
              return (
                <tr key={r.committeeCode}>
                  <td className={TD}>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: committeeColorVar(slotOf[r.committeeCode] ?? null) }}
                      />
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {shortOf.get(r.committeeCode) ?? r.committeeCode}
                      </span>
                    </span>
                  </td>
                  <td className={`${NUM} text-zinc-500`}>{r.votes.toLocaleString("pl-PL")}</td>
                  <td className={`${NUM} text-zinc-500`}>{r.actualSeats}</td>
                  <td className={`${NUM} font-semibold text-zinc-900 dark:text-zinc-100`}>
                    {r.bestSeats}
                  </td>
                  <td
                    className={`${NUM} ${
                      diff > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-400"
                    }`}
                  >
                    {diff > 0 ? `+${diff}` : "0"}
                  </td>
                  <td className={`${NUM} text-xs text-zinc-500`}>
                    {r.bestSplit.length
                      ? r.bestSplit
                          .map((s) => `${s.votes}→${s.seats}`)
                          .join("  ·  ")
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-zinc-500">
          „Rozkład dający maksimum&rdquo; to głosy w okręgach 1 · 2 · 3 i liczba mandatów,
          jaką każdy z nich by dał. Nadwyżka ponad minimum potrzebne do tych mandatów jest
          doliczona do pierwszego okręgu, żeby suma zgadzała się z rzeczywistą liczbą głosów.
        </p>
      </div>
    </div>
  );
}
