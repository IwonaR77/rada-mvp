"use client";

import { useState } from "react";
import Link from "next/link";
import { clusterByAgreement, type PairAgreement } from "@/lib/hierarchical-clustering";

// Same sequential blue ramp as speaking-heatmap.tsx / percentile-meter.tsx.
const SEQUENTIAL_STEPS = [
  "#cde2fb",
  "#b7d3f6",
  "#9ec5f4",
  "#86b6ef",
  "#6da7ec",
  "#5598e7",
  "#3987e5",
  "#2a78d6",
  "#256abf",
  "#1c5cab",
  "#184f95",
  "#104281",
  "#0d366b",
];
const MIN_STEP_INDEX = 3;
const DIAGONAL_CLASS = "bg-zinc-100 dark:bg-zinc-800";

function colorForAgreement(pct: number) {
  const ratio = Math.min(1, Math.max(0, pct / 100));
  const span = SEQUENTIAL_STEPS.length - 1 - MIN_STEP_INDEX;
  const index = MIN_STEP_INDEX + Math.round(ratio * span);
  return SEQUENTIAL_STEPS[index];
}

const CLUSTER_LABEL_COLORS = [
  "text-blue-700 dark:text-blue-400",
  "text-emerald-700 dark:text-emerald-400",
  "text-amber-700 dark:text-amber-400",
  "text-rose-700 dark:text-rose-400",
  "text-violet-700 dark:text-violet-400",
  "text-cyan-700 dark:text-cyan-400",
];

export function VotingCorrelationMatrix({
  councilors,
  pairs,
}: {
  councilors: { id: string; fullName: string }[];
  pairs: PairAgreement[];
}) {
  const [active, setActive] = useState<{ a: string; b: string; pct: number } | null>(
    null
  );

  const nameById = new Map(councilors.map((c) => [c.id, c.fullName]));
  const ids = councilors.map((c) => c.id);
  const { order, clusterOf, clusterCount } = clusterByAgreement(ids, pairs);

  const pctByPair = new Map<string, number>();
  const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  for (const p of pairs) pctByPair.set(key(p.a, p.b), p.agreementPct);

  const clusters: { id: string; fullName: string }[][] = Array.from(
    { length: clusterCount },
    () => []
  );
  for (const id of order) {
    const c = clusterOf.get(id) ?? 0;
    clusters[c].push({ id, fullName: nameById.get(id) ?? "?" });
  }

  if (order.length < 3) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
        Za mało radnych ze wspólnymi głosowaniami, by policzyć korelację.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="min-h-[1.5rem] text-sm text-zinc-700 dark:text-zinc-300"
        aria-live="polite"
      >
        {active ? (
          <span>
            <strong className="font-semibold">{active.pct}%</strong> —{" "}
            {nameById.get(active.a)} / {nameById.get(active.b)}
          </span>
        ) : (
          <span className="text-zinc-400">
            Najedź na komórkę, by zobaczyć zgodność dwóch radnych.
          </span>
        )}
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="inline-flex flex-col gap-[2px]">
          {order.map((rowId, rowIndex) => {
            const rowClusterEnd =
              rowIndex < order.length - 1 &&
              clusterOf.get(rowId) !== clusterOf.get(order[rowIndex + 1]);
            return (
              <div key={rowId} className="flex items-center gap-[2px]">
                <Link
                  href={`/radny/${rowId}`}
                  prefetch={false}
                  className={`w-40 shrink-0 truncate pr-2 text-right text-xs hover:underline ${CLUSTER_LABEL_COLORS[(clusterOf.get(rowId) ?? 0) % CLUSTER_LABEL_COLORS.length]}`}
                >
                  {nameById.get(rowId)}
                </Link>
                <div className={`flex gap-[2px] ${rowClusterEnd ? "pb-1" : ""}`}>
                  {order.map((colId, colIndex) => {
                    const colClusterEnd =
                      colIndex < order.length - 1 &&
                      clusterOf.get(colId) !== clusterOf.get(order[colIndex + 1]);
                    if (colId === rowId) {
                      return (
                        <div
                          key={colId}
                          className={`h-4 w-4 shrink-0 rounded-[3px] ${DIAGONAL_CLASS} ${colClusterEnd ? "mr-1" : ""}`}
                        />
                      );
                    }
                    const pct = pctByPair.get(key(rowId, colId));
                    return (
                      <div
                        key={colId}
                        tabIndex={0}
                        role="button"
                        aria-label={`${nameById.get(rowId)} i ${nameById.get(colId)}: ${pct ?? "brak danych"}%`}
                        onMouseEnter={() =>
                          pct !== undefined && setActive({ a: rowId, b: colId, pct })
                        }
                        onFocus={() =>
                          pct !== undefined && setActive({ a: rowId, b: colId, pct })
                        }
                        onMouseLeave={() => setActive(null)}
                        onBlur={() => setActive(null)}
                        className={`h-4 w-4 shrink-0 cursor-pointer rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 ${colClusterEnd ? "mr-1" : ""} ${pct === undefined ? DIAGONAL_CLASS : ""}`}
                        style={
                          pct !== undefined
                            ? { backgroundColor: colorForAgreement(pct) }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Grupy głosujące podobnie ({clusterCount})
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clusters.map((members, i) => (
            <div key={i} className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
              <h4
                className={`mb-1.5 text-xs font-semibold ${CLUSTER_LABEL_COLORS[i % CLUSTER_LABEL_COLORS.length]}`}
              >
                Grupa {i + 1} ({members.length})
              </h4>
              <ul className="flex flex-col gap-0.5">
                {members.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/radny/${m.id}`}
                      prefetch={false}
                      className="text-sm text-zinc-700 hover:underline dark:text-zinc-300"
                    >
                      {m.fullName}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Grupy wyznaczone automatycznie na podstawie zgodności głosowań w
          uchwałach bez jednomyślności (klastrowanie hierarchiczne) — nie
          pochodzą z deklaracji przynależności klubowej.
        </p>
      </div>
    </div>
  );
}
