// Shared 5-tier relative-comparison scale for KPI tiles on /radny/[id] — a raw
// number (speaking time, attendance %) doesn't say whether it's high or low on
// its own; this ranks it against the rest of the term's roster.
export type Comparison = { percentile: number; band: string };

export function compareToAverage(value: number, allValues: number[]): Comparison | null {
  if (allValues.length < 2) return null;
  const rank = allValues.filter((v) => v < value).length;
  const percentile = Math.round((100 * rank) / (allValues.length - 1));
  let band: string;
  if (percentile >= 90) band = "dużo powyżej średniej";
  else if (percentile >= 60) band = "powyżej średniej";
  else if (percentile >= 40) band = "w średniej";
  else if (percentile >= 10) band = "poniżej średniej";
  else band = "dużo poniżej średniej";
  return { percentile, band };
}
