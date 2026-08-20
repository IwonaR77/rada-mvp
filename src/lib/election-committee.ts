/** Election committee a councilor won their seat from, as stored on `councilor_term`. */
export type Committee = {
  /** Full official name, e.g. "Komitet Wyborczy Wyborców Nam Zależy". */
  name: string;
  /** Curated short label (≤6 chars) for dense views, e.g. "NZ". */
  code: string;
};

/** A committee paired with the palette slot it was assigned and its seat count. */
export type CommitteeLegendEntry = Committee & { slot: number; count: number };

/**
 * Categorical hues from the project palette (the same instance the sequential
 * blue ramp in the heatmaps comes from), light and dark steps for all eight
 * slots.
 *
 * These are deliberately NOT the sole carrier of committee identity. Six or
 * more categorical colors cannot be told apart under protanopia — the palette
 * validator puts the worst pair of any six-of-eight subset at ΔE 2.7, far
 * under the ΔE 8 floor — so every place a color appears, the committee's
 * `code` appears next to it, and the color only makes the pattern jump out
 * pre-attentively for readers who can see it.
 */
export const COMMITTEE_SLOT_COUNT = 8;

/** Neutral used for councilors with no committee on record. */
export const NO_COMMITTEE_SLOT = null;

/** CSS custom-property name holding slot `n`'s hue, defined in `globals.css`. */
export function committeeColorVar(slot: number | null) {
  return slot === null
    ? "var(--committee-none)"
    : `var(--committee-${slot % COMMITTEE_SLOT_COUNT})`;
}

/**
 * Assigns each committee a stable palette slot.
 *
 * When `ballotOrder` is known (the committee's official list number on the
 * ballot) slots follow it. That number is fixed by the electoral commission
 * and does not depend on which committees happen to appear in the current
 * view, so a committee keeps its color whether it is shown among the six that
 * won seats or all eight that stood — the matrix and the election tables
 * cannot disagree about who is orange.
 *
 * Without a ballot number — a council whose election was never imported — it
 * falls back to alphabetical order, which is at least stable against a
 * by-election adding or removing one councilor. Color must follow the entity,
 * never its rank, so seat count is deliberately not used here.
 */
export function assignCommitteeSlots(
  committees: { code: string; ballotOrder?: number | null }[]
): Map<string, number> {
  const seen = new Map<string, number | null>();
  for (const c of committees) {
    if (!seen.has(c.code)) seen.set(c.code, c.ballotOrder ?? null);
  }
  const ordered = [...seen].sort(([codeA, orderA], [codeB, orderB]) => {
    if (orderA != null && orderB != null) return orderA - orderB;
    if (orderA != null) return -1;
    if (orderB != null) return 1;
    return codeA.localeCompare(codeB, "pl");
  });
  return new Map(ordered.map(([code], i) => [code, i]));
}

/**
 * Builds the legend for a roster: distinct committees, their seat counts and
 * palette slots, ordered largest-first for reading.
 *
 * @param members - one entry per councilor; `committee` is null when the
 * council has no committee data on record (only the first session of a term
 * reads the election result out loud, and not every council does it)
 * @param slotOf - slots computed elsewhere from ballot order; omit to fall
 * back to alphabetical assignment over the committees present here
 */
export function buildCommitteeLegend(
  members: { committee: Committee | null }[],
  slotOf?: Map<string, number>
): { legend: CommitteeLegendEntry[]; slotOf: Map<string, number> } {
  const counts = new Map<string, { committee: Committee; count: number }>();
  for (const m of members) {
    if (!m.committee) continue;
    const entry = counts.get(m.committee.code);
    if (entry) entry.count++;
    else counts.set(m.committee.code, { committee: m.committee, count: 1 });
  }

  const slots =
    slotOf ?? assignCommitteeSlots([...counts.values()].map((c) => ({ code: c.committee.code })));

  const legend = [...counts.values()]
    .map(({ committee, count }) => ({
      ...committee,
      count,
      slot: slots.get(committee.code) ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pl"));

  return { legend, slotOf: slots };
}
