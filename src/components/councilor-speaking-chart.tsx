"use client";

import { useState } from "react";
import Link from "next/link";

export type PunktMowienia = {
  meetingId: string;
  numer: number;
  data: string;
  sekundy: number;
};

// Jedna seria, więc jeden kolor — legenda byłaby tu szumem, bo tytuł mówi, co
// jest pokazane (references/palette.md, „Sequential hue"). Wersja ciemna to ten
// sam odcień o krok jaśniejszy, dobrany pod ciemne tło, a nie automatyczne
// odwrócenie.
const SLUPEK = "#2a78d6";
const SLUPEK_CIEMNY = "#3987e5";

function czas(sekundy: number) {
  const m = Math.round(sekundy / 60);
  if (m >= 60) return `${Math.floor(m / 60)} godz. ${m % 60} min`;
  return m > 0 ? `${m} min` : `${Math.round(sekundy)} s`;
}

function dataPl(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function CouncilorSpeakingChart({ punkty }: { punkty: PunktMowienia[] }) {
  const [aktywny, setAktywny] = useState<PunktMowienia | null>(null);

  if (punkty.length === 0) return null;
  const max = Math.max(...punkty.map((p) => p.sekundy));
  if (max <= 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {/* Szczegóły nad wykresem, nie w dymku przy kursorze: dymek przy 33
          wąskich słupkach zasłaniałby sąsiednie, a tu i tak jest miejsce. */}
      <div className="min-h-[1.5rem] text-sm text-zinc-700 dark:text-zinc-300" aria-live="polite">
        {aktywny ? (
          <span>
            <strong className="font-semibold">
              {aktywny.sekundy > 0 ? czas(aktywny.sekundy) : "nie zabrał(a) głosu"}
            </strong>{" "}
            —{" "}
            <Link href={`/sesje/${aktywny.meetingId}`} className="underline hover:no-underline">
              sesja nr {aktywny.numer}
            </Link>{" "}
            ({dataPl(aktywny.data)})
          </span>
        ) : (
          <span className="text-zinc-400">
            Najedź lub przejdź Tabem po słupku, by zobaczyć szczegóły.
          </span>
        )}
      </div>

      <div className="flex h-40 items-end gap-[3px]">
        {punkty.map((p) => {
          const udzial = p.sekundy / max;
          return (
            <button
              key={p.meetingId}
              type="button"
              onMouseEnter={() => setAktywny(p)}
              onFocus={() => setAktywny(p)}
              onMouseLeave={() => setAktywny(null)}
              onBlur={() => setAktywny(null)}
              aria-label={`Sesja nr ${p.numer}, ${dataPl(p.data)}: ${p.sekundy > 0 ? czas(p.sekundy) : "brak wypowiedzi"}`}
              className="group flex h-full flex-1 flex-col justify-end outline-none"
            >
              {/* Zero to BRAK słupka, nie słupek zerowej wysokości: „nie zabrał
                  głosu" ma się różnić od „mówił przez chwilę" rodzajem, a nie
                  grubością piksela. */}
              {p.sekundy > 0 ? (
                <span
                  className="w-full rounded-t-[3px] bg-[var(--slupek)] transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70 dark:bg-[var(--slupek-ciemny)]"
                  style={
                    {
                      height: `${Math.max(2, udzial * 100)}%`,
                      "--slupek": SLUPEK,
                      "--slupek-ciemny": SLUPEK_CIEMNY,
                    } as React.CSSProperties
                  }
                />
              ) : (
                <span className="h-[2px] w-full rounded-full bg-zinc-200 dark:bg-zinc-700" />
              )}
            </button>
          );
        })}
      </div>

      {/* Podpisy zgodne z kolejnością słupków: najnowsza sesja po lewej. */}
      <div className="flex items-center justify-between text-[10px] text-zinc-400">
        <span>sesja {punkty[0].numer} (najnowsza)</span>
        <span>najwięcej: {czas(max)}</span>
        <span>sesja {punkty[punkty.length - 1].numer}</span>
      </div>
    </div>
  );
}
