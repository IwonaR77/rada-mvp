// Same sequential blue ramp as speaking-heatmap.tsx, reused here so a
// "how does this compare" meter reads consistently across the app.
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

function colorForPercentile(percentile: number) {
  const ratio = Math.min(1, Math.max(0, percentile / 100));
  const span = SEQUENTIAL_STEPS.length - 1 - MIN_STEP_INDEX;
  const index = MIN_STEP_INDEX + Math.round(ratio * span);
  return SEQUENTIAL_STEPS[index];
}

export function PercentileMeter({
  label,
  valueLabel,
  compareLabel,
  percentile,
}: {
  label: string;
  valueLabel: string;
  compareLabel?: string | null;
  percentile: number | null;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </h3>
      <p className="mb-2 text-sm text-zinc-700 dark:text-zinc-300">
        {valueLabel}
        {compareLabel ? ` — ${compareLabel}` : ""}
      </p>
      {percentile !== null && (
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
          <div
            className="h-full rounded-full"
            style={{
              width: `${percentile}%`,
              backgroundColor: colorForPercentile(percentile),
            }}
          />
          <div
            className="absolute top-0 h-full w-px bg-zinc-400 dark:bg-zinc-500"
            style={{ left: "50%" }}
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}
