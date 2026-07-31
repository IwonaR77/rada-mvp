"use client";

import { useState } from "react";
import Link from "next/link";

type HeatmapMeeting = {
  id: string;
  date: string;
  title: string | null;
};

type HeatmapCouncilor = {
  id: string;
  fullName: string;
  // Absent for non-councilor rows (burmistrz, jego zastępca, "Pozostali
  // urzędnicy") — there's no profile page to link to for those yet.
  href?: string;
};

// Sequential blue ramp, lightest → darkest (references/palette.md "Sequential hue").
// Zero seconds is its own gray "silence" color, kept out of the blue ramp entirely —
// the ramp only encodes "how much", starting from the lightest step actually used
// (MIN_STEP_INDEX) so even a small nonzero value still reads as visibly blue, not
// as a paler shade that could be mistaken for the zero-gray.
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
const ZERO_CELL_CLASS = "bg-zinc-200 dark:bg-zinc-700";

function formatDuration(totalSeconds: number) {
  const total = Math.round(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} godz. ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

function formatShortDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
  });
}

function colorFor(value: number, max: number) {
  if (max <= 0) return SEQUENTIAL_STEPS[MIN_STEP_INDEX];
  const ratio = Math.min(1, value / max);
  const span = SEQUENTIAL_STEPS.length - 1 - MIN_STEP_INDEX;
  const index = MIN_STEP_INDEX + Math.round(ratio * span);
  return SEQUENTIAL_STEPS[index];
}

type ActiveCell = {
  councilor: HeatmapCouncilor;
  meeting: HeatmapMeeting;
  seconds: number;
};

function HeatmapRow({
  councilor: c,
  meetings,
  matrix,
  max,
  onActivate,
  onDeactivate,
}: {
  councilor: HeatmapCouncilor;
  meetings: HeatmapMeeting[];
  matrix: Record<string, Record<string, number>>;
  max: number;
  onActivate: (cell: ActiveCell) => void;
  onDeactivate: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {c.href ? (
        <Link
          href={c.href}
          prefetch={false}
          className="w-40 shrink-0 truncate text-xs text-zinc-600 hover:underline dark:text-zinc-400"
        >
          {c.fullName}
        </Link>
      ) : (
        <span className="w-40 shrink-0 truncate text-xs text-zinc-600 dark:text-zinc-400">
          {c.fullName}
        </span>
      )}
      <div className="flex gap-[2px]">
        {meetings.map((m) => {
          const seconds = matrix[c.id]?.[m.id] ?? 0;
          return (
            <div
              key={m.id}
              tabIndex={0}
              role="button"
              aria-label={`${c.fullName}, ${formatShortDate(m.date)}: ${formatDuration(seconds)}`}
              onMouseEnter={() => onActivate({ councilor: c, meeting: m, seconds })}
              onFocus={() => onActivate({ councilor: c, meeting: m, seconds })}
              onMouseLeave={onDeactivate}
              onBlur={onDeactivate}
              className={`h-4 w-4 shrink-0 cursor-pointer rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 ${seconds <= 0 ? ZERO_CELL_CLASS : ""}`}
              style={
                seconds > 0 ? { backgroundColor: colorFor(seconds, max) } : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}

export function SpeakingHeatmap({
  councilors,
  meetings,
  matrix,
}: {
  councilors: HeatmapCouncilor[];
  meetings: HeatmapMeeting[];
  matrix: Record<string, Record<string, number>>;
}) {
  const [active, setActive] = useState<{
    councilor: HeatmapCouncilor;
    meeting: HeatmapMeeting;
    seconds: number;
  } | null>(null);
  const [showTable, setShowTable] = useState(false);

  const max = Math.max(
    0,
    ...councilors.flatMap((c) =>
      meetings.map((m) => matrix[c.id]?.[m.id] ?? 0)
    )
  );

  // Newest session leftmost, matching the timeline above (scroll reaches older sessions).
  const orderedMeetings = [...meetings].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0
  );
  const totalFor = (c: HeatmapCouncilor) =>
    meetings.reduce((sum, m) => sum + (matrix[c.id]?.[m.id] ?? 0), 0);
  const byTotalDesc = (a: HeatmapCouncilor, b: HeatmapCouncilor) =>
    totalFor(b) - totalFor(a);
  // Radni first (sorted by activity), then a divider, then urzędnicy — rather
  // than one global ranking where e.g. a quiet burmistrz would otherwise land
  // in the middle of the radni.
  const orderedCouncilorRows = councilors.filter((c) => c.href).sort(byTotalDesc);
  const orderedOfficialRows = councilors.filter((c) => !c.href).sort(byTotalDesc);
  const orderedCouncilors = [...orderedCouncilorRows, ...orderedOfficialRows];

  if (meetings.length === 0 || councilors.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
        Brak jeszcze rozpisanych sesji z przypisanymi wypowiedziami w tej
        kadencji.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className={`h-3 w-3 shrink-0 rounded-[3px] ${ZERO_CELL_CLASS}`} />
          <span>cisza</span>
          <span className="mx-1 text-zinc-300 dark:text-zinc-700">|</span>
          <span>mniej</span>
          <span
            className="h-3 w-32 rounded-full"
            style={{
              background: `linear-gradient(to right, ${SEQUENTIAL_STEPS[MIN_STEP_INDEX]}, ${SEQUENTIAL_STEPS[SEQUENTIAL_STEPS.length - 1]})`,
            }}
          />
          <span>więcej ({formatDuration(max)})</span>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          {showTable ? "Ukryj widok tabeli" : "Pokaż jako tabelę"}
        </button>
      </div>

      <div
        className="min-h-[1.5rem] text-sm text-zinc-700 dark:text-zinc-300"
        aria-live="polite"
      >
        {active ? (
          <span>
            <strong className="font-semibold">
              {formatDuration(active.seconds)}
            </strong>{" "}
            — {active.councilor.fullName},{" "}
            <Link
              href={`/sesje/${active.meeting.id}`}
              className="underline hover:no-underline"
            >
              {active.meeting.title ?? formatShortDate(active.meeting.date)}
            </Link>{" "}
            ({formatShortDate(active.meeting.date)})
          </span>
        ) : (
          <span className="text-zinc-400">
            Najedź lub przejdź Tabem po komórce, by zobaczyć szczegóły.
          </span>
        )}
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="inline-flex flex-col gap-[2px]">
          {orderedCouncilorRows.map((c) => (
            <HeatmapRow
              key={c.id}
              councilor={c}
              meetings={orderedMeetings}
              matrix={matrix}
              max={max}
              onActivate={setActive}
              onDeactivate={() => setActive(null)}
            />
          ))}
          {orderedCouncilorRows.length > 0 && orderedOfficialRows.length > 0 && (
            <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
          )}
          {orderedOfficialRows.map((c) => (
            <HeatmapRow
              key={c.id}
              councilor={c}
              meetings={orderedMeetings}
              matrix={matrix}
              max={max}
              onActivate={setActive}
              onDeactivate={() => setActive(null)}
            />
          ))}
          <div className="flex items-center gap-2 pt-1">
            <span className="w-40 shrink-0" />
            <div className="flex gap-[2px]">
              {orderedMeetings.map((m) => (
                <span
                  key={m.id}
                  className="w-4 shrink-0 whitespace-nowrap text-[10px] text-zinc-400"
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                >
                  {formatShortDate(m.date)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showTable && (
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <caption className="sr-only">
              Czas wypowiedzi radnych w poszczególnych sesjach
            </caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-zinc-200 p-2 text-left dark:border-zinc-800">
                  Radny
                </th>
                {orderedMeetings.map((m) => (
                  <th
                    key={m.id}
                    scope="col"
                    className="border-b border-zinc-200 p-2 text-left font-normal text-zinc-500 dark:border-zinc-800"
                  >
                    {formatShortDate(m.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedCouncilors.map((c, i) => {
                // Thicker divider on the last radny row, marking the
                // boundary before the urzędnicy rows begin.
                const isLastCouncilor =
                  i === orderedCouncilorRows.length - 1 &&
                  orderedOfficialRows.length > 0;
                const rowBorder = isLastCouncilor
                  ? "border-b-2 border-zinc-300 dark:border-zinc-700"
                  : "border-b border-zinc-100 dark:border-zinc-900";
                return (
                  <tr key={c.id}>
                    <th scope="row" className={`${rowBorder} p-2 text-left font-normal`}>
                      {c.href ? (
                        <Link href={c.href} prefetch={false} className="hover:underline">
                          {c.fullName}
                        </Link>
                      ) : (
                        c.fullName
                      )}
                    </th>
                    {orderedMeetings.map((m) => (
                      <td
                        key={m.id}
                        className={`${rowBorder} p-2 text-zinc-600 dark:text-zinc-400`}
                      >
                        {formatDuration(matrix[c.id]?.[m.id] ?? 0)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
