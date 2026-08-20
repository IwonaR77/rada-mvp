"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { clusterByAgreement, type PairAgreement } from "@/lib/hierarchical-clustering";
import {
  buildCommitteeLegend,
  committeeColorVar,
  type Committee,
} from "@/lib/election-committee";

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

export type MatrixCouncilor = {
  id: string;
  fullName: string;
  committee: Committee | null;
};

type Grouping = "glosowania" | "komitety";

/** Small color+code badge — the code is what actually identifies the committee. */
function CommitteeBadge({
  committee,
  slot,
}: {
  committee: Committee | null;
  slot: number | null;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      title={committee?.name ?? "Brak danych o komitecie wyborczym"}
    >
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ backgroundColor: committeeColorVar(slot) }}
      />
      <span className="w-8 shrink-0 font-mono text-[10px] leading-none text-zinc-500 dark:text-zinc-400">
        {committee?.code ?? "—"}
      </span>
    </span>
  );
}

export function VotingCorrelationMatrix({
  councilors,
  pairs,
  slotOf: externalSlots,
}: {
  councilors: MatrixCouncilor[];
  pairs: PairAgreement[];
  /**
   * Palette slots computed from the official ballot order, when the term's
   * election has been imported. Passing them in keeps a committee the same
   * color here and on the election tables, which show two more committees
   * that never won a seat and would otherwise shift everyone's slot.
   */
  slotOf?: Map<string, number>;
}) {
  const [active, setActive] = useState<{ a: string; b: string; pct: number } | null>(
    null
  );
  const [grouping, setGrouping] = useState<Grouping>("glosowania");

  const byId = useMemo(
    () => new Map(councilors.map((c) => [c.id, c])),
    [councilors]
  );
  const { legend, slotOf } = useMemo(
    () => buildCommitteeLegend(councilors, externalSlots),
    [councilors, externalSlots]
  );
  const hasCommittees = legend.length > 0;
  const slotById = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of councilors) {
      const slot = c.committee ? slotOf.get(c.committee.code) : undefined;
      if (slot !== undefined) map.set(c.id, slot);
    }
    return map;
  }, [councilors, slotOf]);
  const slotFor = (id: string) => slotById.get(id) ?? null;

  const { order: clusterOrder, clusterOf, clusterCount } = useMemo(
    () => clusterByAgreement(councilors.map((c) => c.id), pairs),
    [councilors, pairs]
  );

  // The clustering is always what defines the "Grupy głosujące podobnie" cards
  // below; `grouping` only swaps which of the two partitions drives the axis
  // order and the separator gaps, so the reader can flip between "who votes
  // together" and "who was elected together" on the very same cells.
  const showCommitteeOrder = grouping === "komitety" && hasCommittees;
  const groupIndexOf = (id: string) =>
    showCommitteeOrder ? slotFor(id) ?? legend.length : clusterOf.get(id) ?? 0;

  const order = useMemo(() => {
    if (!showCommitteeOrder) return clusterOrder;
    // Rank committees by seat count (legend order) so the largest bloc leads;
    // inside a committee keep the clustering's order, which puts the members
    // that actually vote alike next to each other.
    const rank = new Map(legend.map((entry, i) => [entry.slot, i]));
    const rankOf = (id: string) =>
      rank.get(slotById.get(id) ?? -1) ?? legend.length;
    return [...clusterOrder].sort((a, b) => rankOf(a) - rankOf(b));
  }, [showCommitteeOrder, clusterOrder, legend, slotById]);

  const pctByPair = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of pairs)
      map.set(p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`, p.agreementPct);
    return map;
  }, [pairs]);
  const pctOf = (x: string, y: string) =>
    pctByPair.get(x < y ? `${x}|${y}` : `${y}|${x}`);

  const clusters = useMemo(() => {
    const out: { id: string; fullName: string }[][] = Array.from(
      { length: clusterCount },
      () => []
    );
    for (const id of clusterOrder) {
      out[clusterOf.get(id) ?? 0].push({
        id,
        fullName: byId.get(id)?.fullName ?? "?",
      });
    }
    return out;
  }, [clusterOrder, clusterOf, clusterCount, byId]);

  if (order.length < 3) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
        Za mało radnych ze wspólnymi głosowaniami, by policzyć korelację.
      </p>
    );
  }

  const activeA = active && byId.get(active.a);
  const activeB = active && byId.get(active.b);

  return (
    <div className="flex flex-col gap-4">
      {hasCommittees && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            Ułóż wg
          </span>
          {(
            [
              ["glosowania", "podobieństwa głosowań"],
              ["komitety", "komitetu wyborczego"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setGrouping(value)}
              aria-pressed={grouping === value}
              className={`rounded-full px-3 py-1 text-sm transition-colors ${
                grouping === value
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div
        className="min-h-[1.5rem] text-sm text-zinc-700 dark:text-zinc-300"
        aria-live="polite"
      >
        {active && activeA && activeB ? (
          <span>
            <strong className="font-semibold">{active.pct}%</strong> —{" "}
            {activeA.fullName}
            {activeA.committee ? ` (${activeA.committee.code})` : ""} /{" "}
            {activeB.fullName}
            {activeB.committee ? ` (${activeB.committee.code})` : ""}
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
            const rowGroupEnd =
              rowIndex < order.length - 1 &&
              groupIndexOf(rowId) !== groupIndexOf(order[rowIndex + 1]);
            const rowName = byId.get(rowId)?.fullName ?? "?";
            return (
              <div key={rowId} className="flex items-center gap-[2px]">
                {hasCommittees && (
                  <CommitteeBadge
                    committee={byId.get(rowId)?.committee ?? null}
                    slot={slotFor(rowId)}
                  />
                )}
                <Link
                  href={`/radny/${rowId}`}
                  prefetch={false}
                  className="w-40 shrink-0 truncate pr-2 text-right text-xs text-zinc-700 hover:underline dark:text-zinc-300"
                >
                  {rowName}
                </Link>
                <div className={`flex gap-[2px] ${rowGroupEnd ? "pb-1" : ""}`}>
                  {order.map((colId, colIndex) => {
                    const colGroupEnd =
                      colIndex < order.length - 1 &&
                      groupIndexOf(colId) !== groupIndexOf(order[colIndex + 1]);
                    const edge = colGroupEnd ? "mr-1" : "";
                    if (colId === rowId) {
                      return (
                        <div
                          key={colId}
                          className={`h-4 w-4 shrink-0 rounded-[3px] ${DIAGONAL_CLASS} ${edge}`}
                        />
                      );
                    }
                    const pct = pctOf(rowId, colId);
                    const colName = byId.get(colId)?.fullName ?? "?";
                    return (
                      <div
                        key={colId}
                        tabIndex={0}
                        role="button"
                        aria-label={`${rowName} i ${colName}: ${pct ?? "brak danych"}%`}
                        onMouseEnter={() =>
                          pct !== undefined && setActive({ a: rowId, b: colId, pct })
                        }
                        onFocus={() =>
                          pct !== undefined && setActive({ a: rowId, b: colId, pct })
                        }
                        onMouseLeave={() => setActive(null)}
                        onBlur={() => setActive(null)}
                        className={`h-4 w-4 shrink-0 cursor-pointer rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 ${edge} ${pct === undefined ? DIAGONAL_CLASS : ""}`}
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

      {hasCommittees && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Komitety wyborcze ({legend.length})
          </h3>
          <ul className="flex flex-col gap-1">
            {legend.map((entry) => (
              <li
                key={entry.name}
                className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
              >
                <CommitteeBadge committee={entry} slot={entry.slot} />
                <span>{entry.name}</span>
                <span className="text-zinc-500">
                  — {entry.count}{" "}
                  {entry.count === 1
                    ? "mandat"
                    : entry.count < 5
                      ? "mandaty"
                      : "mandatów"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-500">
            Podział z odczytu wyników wyborów na pierwszej sesji kadencji.
            Komitet wyborczy to nie to samo co klub radnych ani deklarowana
            przynależność partyjna.
          </p>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Grupy głosujące podobnie ({clusterCount})
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clusters.map((members, i) => (
            <div
              key={i}
              className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <h4 className="mb-1.5 text-xs font-semibold text-zinc-500">
                Grupa {i + 1} ({members.length})
              </h4>
              <ul className="flex flex-col gap-0.5">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    {hasCommittees && (
                      <CommitteeBadge
                        committee={byId.get(m.id)?.committee ?? null}
                        slot={slotFor(m.id)}
                      />
                    )}
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
