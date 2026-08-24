"use client";

import { useRef, useState } from "react";
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
// Rampa idzie od najbledszego kroku: cisza nie jest już „jeszcze jaśniejszym
// błękitem", tylko pustym kwadratem z obwódką, więc nie ma czego mylić i można
// wykorzystać cały zakres barw na to, co naprawdę zmierzone.
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
const MIN_STEP_INDEX = 0;
// Cisza jako pusty kwadrat z obwódką, a nie wypełnienie: różni się od komórek
// z pomiarem RODZAJEM, nie odcieniem, więc najbledszy błękit może być naprawdę
// blady i nikt nie weźmie go za zero.
const ZERO_CELL_CLASS =
  "bg-transparent ring-1 ring-inset ring-zinc-300 dark:ring-zinc-700";

// Kwadracik z sumą kadencji dzieli rampę i skalę logarytmiczną z komórkami
// sesji (ta sama funkcja `colorFor`), tylko liczoną względem maksimum sum
// kadencji zamiast maksimum pojedynczej sesji — bo odpowiada na inne pytanie
// („jak głośna w ogóle jest ta osoba", nie „ile w tym dniu"), ale nie ma
// powodu do osobnej palety barw.

function formatDuration(totalSeconds: number) {
  const total = Math.round(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} godz. ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

// Widok tabeli, w przeciwieństwie do etykiety pod kursorem, jest kolumną liczb
// do porównywania wzrokiem — stąd jeden format godz:min:sek (jak w Excelu),
// zawsze trzyczłonowy i zawsze wyrównany co do cyfry, zamiast "X godz. Y min"
// / "Y min Z s" / "Z s" mieszanych w zależności od wielkości wartości.
function formatDurationTable(totalSeconds: number) {
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatShortDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Krok rampy dla wartości — skala LOGARYTMICZNA, nie liniowa.
 *
 * Czasy mówienia są skrajnie skośne: prowadzący obrady zbiera w jednej sesji
 * kilkanaście minut, a typowy radny kilkadziesiąt sekund. Przy podziale
 * liniowym maksimum rozciąga skalę tak, że niemal wszystko poniżej niego
 * wpada w jeden, najjaśniejszy krok i heatmapa pokazuje wyłącznie „kto
 * prowadził" — czyli to, co i tak wiadomo. Logarytm rozkłada te małe różnice
 * na całą rampę, kosztem rozdzielczości u samej góry, gdzie i tak wystarczy
 * „bardzo dużo".
 *
 * `log1p`, a nie `log`, żeby jednosekundowa wypowiedź nie wpadła w minus
 * nieskończoność.
 */
function colorFor(value: number, max: number) {
  if (max <= 0) return SEQUENTIAL_STEPS[MIN_STEP_INDEX];
  const ratio = Math.min(1, Math.log1p(value) / Math.log1p(max));
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
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const tableRef = useRef<HTMLTableElement>(null);

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

  const maxTotal = Math.max(0, ...orderedCouncilors.map(totalFor));
  const kolorSumyDla = (total: number) =>
    total > 0 ? colorFor(total, maxTotal) : null;

  // Zaznaczenie myszką tabeli szerszej niż okno (kilkadziesiąt kolumn sesji
  // w poziomo przewijanym kontenerze) jest w przeglądarce zawodne — dociągnięcie
  // kursora do krawędzi nie przewija samego kontenera. Schowek wypełniamy więc
  // wprost: TSV jako text/plain (działa wszędzie) i outerHTML tabeli jako
  // text/html (Excel/Sheets odtworzą z niego realną siatkę komórek), więc
  // wklejenie działa bez ręcznego zaznaczania.
  async function copyTableToClipboard() {
    const header = ["Radny", "Razem", ...orderedMeetings.map((m) => formatShortDate(m.date))];
    const rows = orderedCouncilors.map((c) => [
      c.fullName,
      formatDurationTable(totalFor(c)),
      ...orderedMeetings.map((m) => formatDurationTable(matrix[c.id]?.[m.id] ?? 0)),
    ]);
    const tsv = [header, ...rows].map((r) => r.join("\t")).join("\n");

    try {
      const html = tableRef.current?.outerHTML;
      if (html && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([tsv], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(tsv);
      }
      setCopyState("copied");
    } catch {
      setCopyState("error");
    } finally {
      setTimeout(() => setCopyState("idle"), 2000);
    }
  }

  if (meetings.length === 0 || councilors.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
        Brak jeszcze rozpisanych sesji z przypisanymi wypowiedziami w tej
        kadencji.
      </p>
    );
  }

  return (
    // Szerokość z zawartości (`w-fit`) i wyśrodkowanie, tak jak kwadrant:
    // przy 110rem kontenera i ~28 sesjach siatka zajmowała niecałą połowę
    // szerokości i wisiała przy lewej krawędzi. `max-w-full` zostawia
    // przewijanie poziome, gdy sesji przybędzie ponad szerokość ekranu —
    // wtedy siatka po prostu przestaje się mieścić i przewija się od lewej.
    <div className="mx-auto flex w-fit max-w-full flex-col gap-3">
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
          <span className="text-zinc-400">skala logarytmiczna</span>
        </div>
        <div className="flex items-center gap-3">
          {showTable && (
            <button
              type="button"
              onClick={copyTableToClipboard}
              className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              {copyState === "copied"
                ? "Skopiowano — wklej w Excelu/Arkuszach"
                : copyState === "error"
                  ? "Nie udało się skopiować"
                  : "Kopiuj tabelę"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            {showTable ? "Ukryj widok tabeli" : "Pokaż jako tabelę"}
          </button>
        </div>
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
                <Link
                  key={m.id}
                  href={`/sesje/${m.id}`}
                  prefetch={false}
                  className="block w-4 shrink-0 text-center text-[9px] tabular-nums text-zinc-400 hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
                  title={`Sesja nr ${m.number} — ${formatShortDate(m.date)}`}
                >
                  {m.number}
                </Link>
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
          {/* Pełna siatka (border na każdej komórce, nie tylko border-b) i
              jedna stała grubość wszędzie — poprzednia wersja pogrubiała
              obramowanie ostatniego wiersza radnych, żeby zaznaczyć granicę
              przed urzędnikami, ale przy border-collapse to zmieniało
              wysokość akurat tego wiersza. Granicę sekcji zaznacza teraz samo
              tło wiersza (bg na <tr> z urzędnikami), więc żadna komórka nie
              odstaje wysokością. */}
          <table ref={tableRef} className="min-w-full border-collapse text-sm">
            <caption className="sr-only">
              Czas wypowiedzi radnych w poszczególnych sesjach
            </caption>
            <thead>
              <tr>
                <th scope="col" className="border border-zinc-300 p-2 text-left dark:border-zinc-700">
                  Radny
                </th>
                <th scope="col" className="border border-zinc-300 p-2 text-right font-normal text-zinc-500 dark:border-zinc-700">
                  Razem
                </th>
                {orderedMeetings.map((m) => (
                  <th
                    key={m.id}
                    scope="col"
                    className="whitespace-nowrap border border-zinc-300 p-2 text-right font-normal text-zinc-500 dark:border-zinc-700"
                  >
                    {formatShortDate(m.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedCouncilors.map((c, i) => {
                // Granica przed pierwszym wierszem urzędników — jasne tło,
                // bez zmiany grubości obramowania (patrz komentarz wyżej).
                const isFirstOfficial =
                  i === orderedCouncilorRows.length &&
                  orderedOfficialRows.length > 0;
                const rowBg = isFirstOfficial
                  ? "bg-zinc-50 dark:bg-zinc-900/50"
                  : "";
                const cellBorder = "border border-zinc-300 dark:border-zinc-700";
                return (
                  <tr key={c.id} className={rowBg}>
                    <th scope="row" className={`${cellBorder} whitespace-nowrap p-2 text-left font-normal`}>
                      {c.href ? (
                        <Link href={c.href} prefetch={false} className="hover:underline">
                          {c.fullName}
                        </Link>
                      ) : (
                        c.fullName
                      )}
                    </th>
                    <td className={`${cellBorder} p-2 text-right font-medium tabular-nums text-zinc-700 dark:text-zinc-300`}>
                      {formatDurationTable(totalFor(c))}
                    </td>
                    {orderedMeetings.map((m) => (
                      <td
                        key={m.id}
                        className={`${cellBorder} p-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400`}
                      >
                        {formatDurationTable(matrix[c.id]?.[m.id] ?? 0)}
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
