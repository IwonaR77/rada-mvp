"use client";

import { useState } from "react";
import Link from "next/link";

export type PunktMowienia = {
  meetingId: string;
  numer: number;
  data: string;
  sekundy: number;
};

// Jedna seria, więc jedna barwa — legenda byłaby tu szumem, bo tytuł mówi, co
// jest pokazane. Nasycenie niesie tę samą wielkość co wysokość (rampa
// sekwencyjna z references/palette.md): to podwojenie tego samego kanału, nie
// druga zmienna, i jest tu potrzebne, bo przy wspólnej skali dla wszystkich
// radnych słupki osoby mówiącej mało są bardzo niskie — sam kształt przestaje
// je odróżniać, a odcień jeszcze tak.
const RAMPA = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7",
  "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b",
];

// Odcień po skali logarytmicznej, mimo że wysokość idzie liniowo: rozkład
// czasów jest skrajnie skośny (jedna sesja z czterdziestoma minutami na tle
// dziesiątek dwuminutowych), więc liniowy odcień dałby wszystkim poza
// szczytem ten sam najjaśniejszy krok.
function odcien(sekundy: number, maks: number) {
  if (sekundy <= 0 || maks <= 0) return RAMPA[0];
  const udzial = Math.min(1, Math.log1p(sekundy) / Math.log1p(maks));
  return RAMPA[Math.round(udzial * (RAMPA.length - 1))];
}

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

export function CouncilorSpeakingChart({
  punkty,
  maks,
}: {
  punkty: PunktMowienia[];
  /** Wspólny sufit skali: najdłuższa wypowiedź RADNEGO w tej kadencji. */
  maks: number;
}) {
  const [aktywny, setAktywny] = useState<PunktMowienia | null>(null);

  if (punkty.length === 0 || maks <= 0) return null;
  const wlasneMaks = Math.max(...punkty.map((p) => p.sekundy));

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
          // Skala WSPÓLNA dla wszystkich profili — inaczej wykresy dwóch osób
          // wyglądają identycznie, mimo że jedna mówiła dziesięć razy dłużej.
          const udzial = p.sekundy / maks;
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
                  className="w-full rounded-t-[3px] transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70"
                  style={{
                    height: `${Math.max(2, udzial * 100)}%`,
                    backgroundColor: odcien(p.sekundy, maks),
                  }}
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
        <span>
          pełna wysokość = {czas(maks)}, wspólnie dla wszystkich radnych
          {wlasneMaks > 0 && ` · tu najwięcej ${czas(wlasneMaks)}`}
        </span>
        <span>sesja {punkty[punkty.length - 1].numer}</span>
      </div>
    </div>
  );
}
