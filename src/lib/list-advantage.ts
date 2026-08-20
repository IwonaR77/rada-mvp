import type { SimCandidate } from "@/lib/electoral-systems";

export type MissedCandidate = SimCandidate & {
  /** Najsłabszy wynik, który zdobył mandat w TYM SAMYM okręgu. */
  districtThreshold: number;
};

export type ListAdvantage = {
  /** Najsłabszy wynik, który w ogóle zdobył mandat. */
  weakestWinner: SimCandidate | null;
  /** Niewybrani z lepszym wynikiem niż {@link weakestWinner}, malejąco. */
  missedOut: MissedCandidate[];
  /** Ilu z nich przegrało mimo wyniku lepszego także od progu w SWOIM okręgu. */
  aboveOwnDistrict: number;
};

/**
 * Znajduje kandydatów, których pokonała nie liczba głosów, tylko lista,
 * na której stali.
 *
 * W systemie proporcjonalnym mandat dostaje się dwuetapowo: najpierw liczbę
 * mandatów dostaje LISTA, dopiero potem dzieli się je między jej kandydatów.
 * Kandydat z dobrym wynikiem osobistym na słabej liście przegrywa więc
 * z kimś, kto zebrał mniej głosów, ale trafił na listę, która wzięła mandat.
 * To nie jest błąd systemu — to jego konstrukcja — ale nie widać jej, dopóki
 * nie zestawi się tych ludzi obok siebie.
 *
 * `districtThreshold` jest tu istotny, bo mandaty dzieli się w OKRĘGU: ktoś
 * z 95 głosami w okręgu, gdzie najsłabszy zwycięzca miał 130, nie „powinien"
 * był wejść nawet lokalnie. Bez tej kolumny zestawienie sugerowałoby
 * niesprawiedliwość mocniejszą, niż wynika z danych.
 *
 * @param electedIds - kto ma mandat w rozpatrywanym wariancie liczenia;
 * parametr, a nie wynik PKW, żeby zestawienie reagowało na symulację
 */
export function findListAdvantage(
  candidates: SimCandidate[],
  electedIds: ReadonlySet<string>
): ListAdvantage {
  const winners = candidates.filter((c) => electedIds.has(c.id));
  if (!winners.length) {
    return { weakestWinner: null, missedOut: [], aboveOwnDistrict: 0 };
  }

  const weakestWinner = winners.reduce((a, b) => (b.votes < a.votes ? b : a));

  const districtThresholds = new Map<number, number>();
  for (const w of winners) {
    const current = districtThresholds.get(w.districtNumber);
    if (current === undefined || w.votes < current) {
      districtThresholds.set(w.districtNumber, w.votes);
    }
  }

  const missedOut = candidates
    .filter((c) => !electedIds.has(c.id) && c.votes > weakestWinner.votes)
    .map((c) => ({
      ...c,
      districtThreshold: districtThresholds.get(c.districtNumber) ?? weakestWinner.votes,
    }))
    .sort((a, b) => b.votes - a.votes || a.fullName.localeCompare(b.fullName, "pl"));

  return {
    weakestWinner,
    missedOut,
    aboveOwnDistrict: missedOut.filter((c) => c.votes > c.districtThreshold).length,
  };
}
