"use client";

import { useState } from "react";
import Link from "next/link";

type HeatmapMeeting = {
  id: string;
  date: string;
  title: string | null;
  /** Numer sesji w kadencji — ta sama numeracja co w nawigacji między sesjami. */
  number: number;
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

// Kwadracik z sumą kadencji ma ŚWIADOMIE inną skalę niż komórki sesji, bo
// odpowiada na inne pytanie: nie „ile w tym dniu", tylko „jak głośna to
// w ogóle osoba". Wspólna niebieska rampa zlewałaby oba znaczenia w jedno.
//
// Skala jest zbudowana jak wysokość na mapie: trzy pasma intensywności, każde
// z własną barwą bazową, a wewnątrz pasma odcień ciemnieje z wartością. Dzięki
// temu widać naraz przynależność do grupy (barwa) i pozycję w grupie (odcień) —
// czego jedna ciągła rampa nie pokazuje, bo przy tak skośnym rozkładzie
// (prowadzący mówi wielokrotnie więcej niż mediana) prawie wszyscy lądują
// w jej jasnym końcu.
const PASMA = [
  { nazwa: "mało", kroki: ["#a7f3d0", "#6ee7b7", "#34d399", "#10b981"] },
  { nazwa: "średnio", kroki: ["#fde68a", "#fcd34d", "#fbbf24", "#f59e0b"] },
  { nazwa: "dużo", kroki: ["#fca5a5", "#f87171", "#ef4444", "#dc2626"] },
];

/**
 * Granice pasm — tercyle rozkładu, a nie równe trzecie części maksimum.
 *
 * Podział po wartości wrzucałby prawie wszystkich do „mało" (jedna osoba
 * mówiąca najwięcej rozciąga skalę), a pasma mają dzielić ludzi, nie sekundy.
 * Zera zostają poza rozkładem: cisza to osobny stan, nie najniższy poziom.
 */
function granicePasm(sumy: number[]): [number, number] {
  const niezerowe = sumy.filter((s) => s > 0).sort((a, b) => a - b);
  if (niezerowe.length === 0) return [0, 0];
  const kwantyl = (q: number) =>
    niezerowe[Math.min(niezerowe.length - 1, Math.floor(q * niezerowe.length))];
  return [kwantyl(1 / 3), kwantyl(2 / 3)];
}

function kolorSumy(
  total: number,
  granice: [number, number],
  zakresy: [number, number][]
) {
  const pasmo = total <= granice[0] ? 0 : total <= granice[1] ? 1 : 2;
  const { kroki } = PASMA[pasmo];
  const [min, max] = zakresy[pasmo];
  const udzial = max > min ? (total - min) / (max - min) : 1;
  return kroki[Math.round(udzial * (kroki.length - 1))];
}

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
  /** `null` dla kwadracika z sumą całej kadencji. */
  meeting: HeatmapMeeting | null;
  seconds: number;
};

function HeatmapRow({
  councilor: c,
  meetings,
  matrix,
  max,
  total,
  kolorSumaryczny,
  onActivate,
  onDeactivate,
}: {
  councilor: HeatmapCouncilor;
  meetings: HeatmapMeeting[];
  matrix: Record<string, Record<string, number>>;
  max: number;
  total: number;
  /** Barwa kwadracika z sumą kadencji; `null`, gdy osoba w ogóle nie mówiła. */
  kolorSumaryczny: string | null;
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
      <span className="w-24 shrink-0 text-right text-xs text-zinc-500 dark:text-zinc-400">
        {formatDuration(total)}
      </span>
      {/* Suma kadencji jako kwadracik tej samej wielkości co komórki sesji,
          ale w innej skali — oddzielony przerwą, żeby nie czytał się jak
          kolejna sesja. */}
      <div
        tabIndex={0}
        role="button"
        aria-label={`${c.fullName}, cała kadencja: ${formatDuration(total)}`}
        onMouseEnter={() => onActivate({ councilor: c, meeting: null, seconds: total })}
        onFocus={() => onActivate({ councilor: c, meeting: null, seconds: total })}
        onMouseLeave={onDeactivate}
        onBlur={onDeactivate}
        className={`mr-2 h-4 w-4 shrink-0 cursor-pointer rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 ${kolorSumaryczny ? "" : ZERO_CELL_CLASS}`}
        style={kolorSumaryczny ? { backgroundColor: kolorSumaryczny } : undefined}
      />
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
  const [active, setActive] = useState<ActiveCell | null>(null);
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

  // Pasma liczymy raz, dla WSZYSTKICH wierszy naraz (radni i urzędnicy razem):
  // gdyby każda grupa miała własne tercyle, ten sam czas mówienia znaczyłby
  // w dwóch miejscach tabeli co innego.
  const wszystkieSumy = orderedCouncilors.map(totalFor);
  const granice = granicePasm(wszystkieSumy);
  const zakresyPasm: [number, number][] = [0, 1, 2].map((nr) => {
    const wPasmie = wszystkieSumy.filter(
      (s) =>
        s > 0 &&
        (nr === 0 ? s <= granice[0] : nr === 1 ? s > granice[0] && s <= granice[1] : s > granice[1])
    );
    return wPasmie.length > 0
      ? [Math.min(...wPasmie), Math.max(...wPasmie)]
      : [0, 0];
  }) as [number, number][];
  const kolorSumyDla = (total: number) =>
    total > 0 ? kolorSumy(total, granice, zakresyPasm) : null;

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
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="text-zinc-400">suma kadencji:</span>
          {PASMA.map((pasmo) => (
            <span key={pasmo.nazwa} className="flex items-center gap-1">
              <span
                className="h-3 w-8 rounded-[3px]"
                style={{
                  background: `linear-gradient(to right, ${pasmo.kroki[0]}, ${pasmo.kroki[pasmo.kroki.length - 1]})`,
                }}
              />
              {pasmo.nazwa}
            </span>
          ))}
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
            {active.meeting ? (
              <>
                <Link
                  href={`/sesje/${active.meeting.id}`}
                  className="underline hover:no-underline"
                >
                  sesja nr {active.meeting.number}
                  {active.meeting.title ? ` — ${active.meeting.title}` : ""}
                </Link>{" "}
                ({formatShortDate(active.meeting.date)})
              </>
            ) : (
              "cała kadencja"
            )}
          </span>
        ) : (
          <span className="text-zinc-400">
            Najedź lub przejdź Tabem po komórce, by zobaczyć szczegóły.
          </span>
        )}
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="inline-flex flex-col gap-[2px]">
          <div className="flex items-center gap-2 pb-1">
            <span className="w-40 shrink-0" />
            <span className="w-24 shrink-0 text-right text-[10px] uppercase tracking-wide text-zinc-400">
              Razem
            </span>
            {/* Pusty slot pod kwadracik sumy — kolumny muszą się zgadzać
                z wierszami, a `mr-2` w wierszu odpowiada tej samej przerwie. */}
            <span className="mr-2 w-4 shrink-0" />
            {/* Numer sesji u góry; data zostaje pod spodem, bo numer jest tym,
                czym sesje nazywa się w dokumentach, a data tym, po czym się je
                znajduje w kalendarzu. */}
            <div className="flex gap-[2px]">
              {orderedMeetings.map((m) => (
                <span
                  key={m.id}
                  className="w-4 shrink-0 text-center text-[9px] tabular-nums text-zinc-400"
                  title={`Sesja nr ${m.number}`}
                >
                  {m.number}
                </span>
              ))}
            </div>
          </div>
          {orderedCouncilorRows.map((c) => (
            <HeatmapRow
              key={c.id}
              councilor={c}
              meetings={orderedMeetings}
              matrix={matrix}
              max={max}
              total={totalFor(c)}
              kolorSumaryczny={kolorSumyDla(totalFor(c))}
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
              total={totalFor(c)}
              kolorSumaryczny={kolorSumyDla(totalFor(c))}
              onActivate={setActive}
              onDeactivate={() => setActive(null)}
            />
          ))}
          <div className="flex items-center gap-2 pt-1">
            <span className="w-40 shrink-0" />
            <span className="w-24 shrink-0" />
            <span className="mr-2 w-4 shrink-0" />
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
                <th scope="col" className="border-b border-zinc-200 p-2 text-left font-normal text-zinc-500 dark:border-zinc-800">
                  Razem
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
                    <td className={`${rowBorder} p-2 font-medium text-zinc-700 dark:text-zinc-300`}>
                      {formatDuration(totalFor(c))}
                    </td>
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
