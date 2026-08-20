"use client";

import { useMemo, useState } from "react";
import { committeeColorVar } from "@/lib/election-committee";

export type VotesSpeakingPoint = {
  councilorId: string;
  fullName: string;
  committeeCode: string | null;
  /** Palette slot for the committee, or null when it has none. */
  slot: number | null;
  votes: number;
  seconds: number;
  role: string | null;
};

const PLOT = 600;
const PAD = { top: 46, right: 30, bottom: 62, left: 74 };
const W = PAD.left + PLOT + PAD.right;
const H = PAD.top + PLOT + PAD.bottom;

// Skala logarytmiczna na osi czasu, bo rozpiętość jest ponad czterocyfrowa:
// od 2 sekund do blisko 13 godzin. Na skali liniowej wszyscy poza
// przewodniczącą leżeliby na jednej kresce przy zerze.
//
// Wybór skali NIE zmienia przydziału do ćwiartek — granicą jest mediana, więc
// decyduje wyłącznie kolejność, a nie odległości. Skala wpływa tu na to, jak
// punkty są rozłożone wewnątrz ćwiartki, nie na to, w której są.
const TIME_TICKS = [
  { s: 10, label: "10 s" },
  { s: 60, label: "1 min" },
  { s: 600, label: "10 min" },
  { s: 3600, label: "1 godz." },
  { s: 36000, label: "10 godz." },
];

/**
 * Cztery ćwiartki oznaczone literami, w kolejności czytania: A i B u góry,
 * C i D na dole.
 *
 * Litera nie niesie żadnej oceny — i o to chodzi. Układ jest wzorowany na
 * kwadrancie Gartnera, ale jego nazwy („Liderzy", „Gracze niszowi") opisują
 * firmy, a tu opisywałyby konkretnych, żyjących ludzi na publicznej stronie.
 * Grupa to etykieta na współrzędne, a opis pod nią mówi wprost, jakie to
 * współrzędne: po której stronie mediany leży wynik wyborczy i czas mówienia.
 */
const QUADRANTS = {
  topLeft: {
    name: "Grupa A",
    hint: "głosy poniżej mediany · czas powyżej mediany",
  },
  topRight: {
    name: "Grupa B",
    hint: "głosy powyżej mediany · czas powyżej mediany",
  },
  bottomLeft: {
    name: "Grupa C",
    hint: "głosy poniżej mediany · czas poniżej mediany",
  },
  bottomRight: {
    name: "Grupa D",
    hint: "głosy powyżej mediany · czas poniżej mediany",
  },
} as const;

/** Kolejność czytania — używana w legendzie, żeby litery szły A, B, C, D. */
const QUADRANT_ORDER = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

type QuadrantKey = keyof typeof QUADRANTS;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function VotesVsSpeakingChart({
  points,
  correlation,
}: {
  points: VotesSpeakingPoint[];
  correlation: { all: number; withoutOfficers: number };
}) {
  const [active, setActive] = useState<VotesSpeakingPoint | null>(null);

  const geometry = useMemo(() => {
    if (points.length < 5) return null;

    const maxVotes = Math.max(...points.map((p) => p.votes));
    const minSec = Math.min(...points.map((p) => p.seconds));
    const maxSec = Math.max(...points.map((p) => p.seconds));
    const floor = Math.max(1, Math.min(minSec, 10) / 2);
    const lo = Math.log10(floor);
    const hi = Math.log10(maxSec * 1.5);

    const x = (v: number) => PAD.left + (v / (maxVotes * 1.08)) * PLOT;
    const y = (s: number) =>
      PAD.top + PLOT - ((Math.log10(Math.max(s, floor)) - lo) / (hi - lo)) * PLOT;

    const votesMedian = median(points.map((p) => p.votes));
    const secondsMedian = median(points.map((p) => p.seconds));

    const quadrantOf = (p: VotesSpeakingPoint): QuadrantKey => {
      const right = p.votes >= votesMedian;
      const top = p.seconds >= secondsMedian;
      if (top && right) return "topRight";
      if (top) return "topLeft";
      if (right) return "bottomRight";
      return "bottomLeft";
    };

    // Etykiety kodów komitetów odsuwane w pionie, gdy nachodzą na siebie —
    // przy 21 punktach i skupisku w lewym dolnym rogu bez tego zlewają się
    // w plamę. Prosty zachłanny algorytm: kolejny punkt schodzi w dół, dopóki
    // nie przestaje kolidować z już rozstawionymi.
    const placed: { x: number; y: number }[] = [];
    const labelOffsets = new Map<string, number>();
    for (const p of [...points].sort((a, b) => y(a.seconds) - y(b.seconds))) {
      const px = x(p.votes);
      const py = y(p.seconds);
      let shift = 0;
      while (
        placed.some((q) => Math.abs(q.x - px) < 26 && Math.abs(q.y - (py + shift)) < 11) &&
        Math.abs(shift) < 26
      ) {
        shift = shift <= 0 ? -shift + 5 : -shift;
      }
      placed.push({ x: px, y: py + shift });
      labelOffsets.set(p.councilorId, shift);
    }

    const counts = points.reduce(
      (acc, p) => {
        acc[quadrantOf(p)]++;
        return acc;
      },
      { topRight: 0, topLeft: 0, bottomRight: 0, bottomLeft: 0 } as Record<QuadrantKey, number>
    );

    return {
      x,
      y,
      floor,
      maxSec,
      maxVotes,
      votesMedian,
      secondsMedian,
      quadrantOf,
      labelOffsets,
      counts,
    };
  }, [points]);

  if (!geometry) return null;

  const {
    x,
    y,
    floor,
    maxSec,
    maxVotes,
    votesMedian,
    secondsMedian,
    quadrantOf,
    labelOffsets,
    counts,
  } = geometry;

  const midX = x(votesMedian);
  const midY = y(secondsMedian);
  const xTicks = [0, 100, 200, 300, 400].filter((v) => v <= maxVotes * 1.08);

  const corners: { key: QuadrantKey; tx: number; ty: number; anchor: "start" | "end" }[] = [
    { key: "topLeft", tx: PAD.left + 10, ty: PAD.top + 18, anchor: "start" },
    { key: "topRight", tx: PAD.left + PLOT - 10, ty: PAD.top + 18, anchor: "end" },
    { key: "bottomLeft", tx: PAD.left + 10, ty: PAD.top + PLOT - 10, anchor: "start" },
    { key: "bottomRight", tx: PAD.left + PLOT - 10, ty: PAD.top + PLOT - 10, anchor: "end" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div
        className="min-h-[2.75rem] text-sm text-zinc-700 dark:text-zinc-300"
        aria-live="polite"
      >
        {active ? (
          <span>
            <strong className="font-semibold">{active.fullName}</strong>
            {active.committeeCode ? ` (${active.committeeCode})` : ""} —{" "}
            {active.votes.toLocaleString("pl-PL")} głosów,{" "}
            {formatDuration(active.seconds)} mówienia
            {active.role ? `, ${active.role}` : ""}
            <span className="block text-xs text-zinc-500">
              {QUADRANTS[quadrantOf(active)].name} — {QUADRANTS[quadrantOf(active)].hint}
            </span>
          </span>
        ) : (
          <span className="text-zinc-400">Najedź na punkt, by zobaczyć radnego.</span>
        )}
      </div>

      <div className="mx-auto w-full max-w-[46rem]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Kwadrant: liczba głosów w wyborach a łączny czas mówienia na sesjach, podzielony medianami na cztery ćwiartki"
        >
          <rect
            x={PAD.left}
            y={PAD.top}
            width={PLOT}
            height={PLOT}
            className="fill-zinc-50/60 stroke-zinc-200 dark:fill-zinc-900/40 dark:stroke-zinc-800"
            strokeWidth={1}
          />

          {TIME_TICKS.filter((t) => t.s >= floor && t.s <= maxSec * 1.5).map((t) => (
            <g key={t.s}>
              <line
                x1={PAD.left}
                x2={PAD.left + PLOT}
                y1={y(t.s)}
                y2={y(t.s)}
                className="stroke-zinc-200 dark:stroke-zinc-800"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t.s) + 4}
                textAnchor="end"
                className="fill-zinc-500 text-[11px]"
              >
                {t.label}
              </text>
            </g>
          ))}
          {xTicks.map((v) => (
            <text
              key={v}
              x={x(v)}
              y={PAD.top + PLOT + 18}
              textAnchor="middle"
              className="fill-zinc-500 text-[11px]"
            >
              {v}
            </text>
          ))}

          {/* Osie podziału: mediany, nie środek wykresu — dzięki temu po każdej
              stronie leży połowa rady, niezależnie od skali osi. */}
          <line
            x1={midX}
            x2={midX}
            y1={PAD.top}
            y2={PAD.top + PLOT}
            className="stroke-zinc-400 dark:stroke-zinc-600"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
          <line
            x1={PAD.left}
            x2={PAD.left + PLOT}
            y1={midY}
            y2={midY}
            className="stroke-zinc-400 dark:stroke-zinc-600"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
          <text
            x={midX + 5}
            y={PAD.top + PLOT + 34}
            textAnchor="middle"
            className="fill-zinc-400 text-[10px]"
          >
            mediana {Math.round(votesMedian)} gł.
          </text>
          <text
            x={PAD.left - 8}
            y={midY - 6}
            textAnchor="end"
            className="fill-zinc-400 text-[10px]"
          >
            mediana
          </text>

          {corners.map((c) => (
            <text
              key={c.key}
              x={c.tx}
              y={c.ty}
              textAnchor={c.anchor}
              className="fill-zinc-400 text-[11px] font-semibold uppercase tracking-wide dark:fill-zinc-500"
            >
              {QUADRANTS[c.key].name} ({counts[c.key]})
            </text>
          ))}

          <text
            x={PAD.left + PLOT / 2}
            y={H - 8}
            textAnchor="middle"
            className="fill-zinc-500 text-[11px]"
          >
            głosy w wyborach 2024
          </text>
          <text
            transform={`translate(16 ${PAD.top + PLOT / 2}) rotate(-90)`}
            textAnchor="middle"
            className="fill-zinc-500 text-[11px]"
          >
            łączny czas mówienia (skala log.)
          </text>

          {points.map((p) => {
            const on = active?.councilorId === p.councilorId;
            const cx = x(p.votes);
            const cy = y(p.seconds);
            const isOfficer = Boolean(p.role);
            return (
              <g
                key={p.councilorId}
                onMouseEnter={() => setActive(p)}
                onMouseLeave={() => setActive(null)}
                className="cursor-pointer"
              >
                <circle cx={cx} cy={cy} r={15} fill="transparent" />
                {isOfficer ? (
                  // Prezydium ma inny kształt, bo jego czas przy mikrofonie
                  // wynika z prowadzenia obrad, a nie z aktywności własnej.
                  <rect
                    x={cx - (on ? 7 : 5)}
                    y={cy - (on ? 7 : 5)}
                    width={(on ? 7 : 5) * 2}
                    height={(on ? 7 : 5) * 2}
                    style={{ fill: committeeColorVar(p.slot) }}
                    className="stroke-white dark:stroke-zinc-950"
                    strokeWidth={2}
                  />
                ) : (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={on ? 7 : 5}
                    style={{ fill: committeeColorVar(p.slot) }}
                    className="stroke-white dark:stroke-zinc-950"
                    strokeWidth={2}
                  />
                )}
                <text
                  x={cx + 10}
                  y={cy + 4 + (labelOffsets.get(p.councilorId) ?? 0)}
                  className={on ? "fill-zinc-900 dark:fill-zinc-100" : "fill-zinc-500"}
                  style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "10px" }}
                >
                  {p.committeeCode ?? "—"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-2">
        <div className="grid gap-2 sm:grid-cols-2">
          {QUADRANT_ORDER.map((key) => (
            <div
              key={key}
              className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800"
            >
              <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {QUADRANTS[key].name}{" "}
                <span className="font-normal text-zinc-400">
                  — {counts[key]} {counts[key] === 1 ? "radny" : "radnych"}
                </span>
              </div>
              <div className="text-xs text-zinc-500">{QUADRANTS[key].hint}</div>
            </div>
          ))}
        </div>

        <p className="text-xs leading-relaxed text-zinc-500">
          Grupy A–D to wyłącznie oznaczenie ćwiartki, bez wartościowania: podział przebiega
          po medianach obu wielkości, nie po środku wykresu, więc po każdej stronie linii
          leży połowa rady. Kwadratami zaznaczono prezydium (przewodnicząca
          i wiceprzewodniczący): ich czas przy mikrofonie wynika z prowadzenia obrad, więc
          wysoka pozycja w pionie nie mówi o ich własnej aktywności. Korelacja rang
          (Spearman) między liczbą głosów a czasem mówienia wynosi{" "}
          <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
            {fmtR(correlation.all)}
          </strong>
          , a bez prezydium{" "}
          <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
            {fmtR(correlation.withoutOfficers)}
          </strong>{" "}
          — zależność umiarkowana, więc ćwiartki opisują położenie na dwóch osiach, a nie
          jakość pracy radnego. Czas mówienia liczony z otagowanych wypowiedzi (dziś ok. 82%
          segmentów), więc dla wszystkich jest zaniżony.
        </p>
      </div>
    </div>
  );
}

function fmtR(r: number) {
  return `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2).replace(".", ",")}`;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} godz. ${m % 60} min`;
}
