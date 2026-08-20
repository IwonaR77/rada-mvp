"use client";

import { useState } from "react";
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

const W = 900;
const H = 420;
const PAD = { top: 16, right: 24, bottom: 44, left: 60 };

// Skala logarytmiczna na osi czasu, bo rozpiętość jest ponad czterocyfrowa:
// od 2 sekund do 13 godzin. Na skali liniowej wszyscy poza przewodniczącą
// leżeliby na jednej linii przy zerze i wykres nie pokazywałby niczego poza
// tym, że przewodnicząca prowadzi obrady. Oś jest wyraźnie opisana, bo skala
// logarytmiczna spłaszcza różnice i łatwo ją źle odczytać.
const TICKS = [
  { s: 10, label: "10 s" },
  { s: 60, label: "1 min" },
  { s: 600, label: "10 min" },
  { s: 3600, label: "1 godz." },
  { s: 36000, label: "10 godz." },
];

export function VotesVsSpeakingChart({
  points,
  correlation,
}: {
  points: VotesSpeakingPoint[];
  correlation: { all: number; withoutOfficers: number };
}) {
  const [active, setActive] = useState<VotesSpeakingPoint | null>(null);

  if (points.length < 5) return null;

  const maxVotes = Math.max(...points.map((p) => p.votes));
  const minSec = Math.min(...points.map((p) => p.seconds));
  const maxSec = Math.max(...points.map((p) => p.seconds));
  const loFloor = Math.max(1, Math.min(minSec, 10) / 2);
  const lo = Math.log10(loFloor);
  const hi = Math.log10(maxSec * 1.4);

  const x = (v: number) =>
    PAD.left + (v / (maxVotes * 1.06)) * (W - PAD.left - PAD.right);
  const y = (s: number) =>
    H - PAD.bottom - ((Math.log10(Math.max(s, loFloor)) - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  const xTicks = [0, 100, 200, 300, 400].filter((v) => v <= maxVotes * 1.06);

  return (
    <div className="flex flex-col gap-3">
      <div
        className="min-h-[1.5rem] text-sm text-zinc-700 dark:text-zinc-300"
        aria-live="polite"
      >
        {active ? (
          <span>
            <strong className="font-semibold">{active.fullName}</strong>
            {active.committeeCode ? ` (${active.committeeCode})` : ""} —{" "}
            {active.votes.toLocaleString("pl-PL")} głosów,{" "}
            {formatDuration(active.seconds)} mówienia
            {active.role ? `, ${active.role}` : ""}
          </span>
        ) : (
          <span className="text-zinc-400">
            Najedź na punkt, by zobaczyć radnego.
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[40rem]"
          role="img"
          aria-label="Wykres: liczba głosów w wyborach a łączny czas mówienia na sesjach"
        >
          {TICKS.filter((t) => t.s >= loFloor && t.s <= maxSec * 1.4).map((t) => (
            <g key={t.s}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
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
              y={H - PAD.bottom + 18}
              textAnchor="middle"
              className="fill-zinc-500 text-[11px]"
            >
              {v}
            </text>
          ))}
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={H - PAD.bottom}
            y2={H - PAD.bottom}
            className="stroke-zinc-300 dark:stroke-zinc-700"
            strokeWidth={1}
          />
          <text
            x={(PAD.left + W - PAD.right) / 2}
            y={H - 6}
            textAnchor="middle"
            className="fill-zinc-500 text-[11px]"
          >
            głosy w wyborach 2024
          </text>
          <text
            transform={`translate(14 ${(PAD.top + H - PAD.bottom) / 2}) rotate(-90)`}
            textAnchor="middle"
            className="fill-zinc-500 text-[11px]"
          >
            łączny czas mówienia (skala log.)
          </text>

          {points.map((p) => {
            const on = active?.councilorId === p.councilorId;
            return (
              <g
                key={p.councilorId}
                onMouseEnter={() => setActive(p)}
                onMouseLeave={() => setActive(null)}
                className="cursor-pointer"
              >
                <circle cx={x(p.votes)} cy={y(p.seconds)} r={14} fill="transparent" />
                <circle
                  cx={x(p.votes)}
                  cy={y(p.seconds)}
                  r={on ? 7 : 5}
                  style={{ fill: committeeColorVar(p.slot) }}
                  className="stroke-white dark:stroke-zinc-950"
                  strokeWidth={2}
                />
                <text
                  x={x(p.votes) + 10}
                  y={y(p.seconds) + 4}
                  className="fill-zinc-500 text-[10px]"
                  style={{ fontFamily: "var(--font-mono, monospace)" }}
                >
                  {p.committeeCode ?? "—"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="text-xs leading-relaxed text-zinc-500">
        Oś pionowa jest logarytmiczna — każdy stopień to dziesięciokrotność. Korelacja rang
        (Spearman) między liczbą głosów a czasem mówienia wynosi{" "}
        <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
          {fmtR(correlation.all)}
        </strong>
        , a po odjęciu przewodniczącej i wiceprzewodniczących —{" "}
        <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
          {fmtR(correlation.withoutOfficers)}
        </strong>
        . To zależność umiarkowana: radni z lepszym wynikiem wyborczym mówią zwykle więcej,
        ale o czasie na sesji decyduje przede wszystkim pełniona funkcja i indywidualny styl,
        a nie liczba głosów. Prowadzenie obrad to obowiązek przewodniczącej, nie aktywność.
      </p>
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
