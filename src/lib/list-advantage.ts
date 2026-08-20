import type { SimCandidate } from "@/lib/electoral-systems";

export type MissedCandidate = SimCandidate & {
  /** Najsłabszy wynik, który zdobył mandat w TYM SAMYM okręgu. */
  districtThreshold: number;
};

export type ListAdvantage = {
  /** Próg wejścia w każdym okręgu: najsłabszy wynik, który dał tam mandat. */
  thresholds: { districtNumber: number; votes: number }[];
  /** Niewybrani, którzy przebili próg SWOJEGO okręgu, malejąco po głosach. */
  missedOut: MissedCandidate[];
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
 * Porównanie jest wyłącznie WEWNĄTRZOKRĘGOWE, bo mandaty dzieli się w okręgu.
 * Zestawianie kandydata z najsłabszym zwycięzcą w całej gminie wciągałoby na
 * listę ludzi, którzy nie weszliby także lokalnie — w Grójcu progi wynosiły
 * 78, 119 i 130 głosów, więc taki wykaz sugerowałby niesprawiedliwość
 * mocniejszą, niż wynika z danych.
 *
 * @param electedIds - kto ma mandat w rozpatrywanym wariancie liczenia;
 * parametr, a nie wynik PKW, żeby zestawienie reagowało na symulację
 */
export function findListAdvantage(
  candidates: SimCandidate[],
  electedIds: ReadonlySet<string>
): ListAdvantage {
  const winners = candidates.filter((c) => electedIds.has(c.id));
  if (!winners.length) return { thresholds: [], missedOut: [] };

  const byDistrict = new Map<number, number>();
  for (const w of winners) {
    const current = byDistrict.get(w.districtNumber);
    if (current === undefined || w.votes < current) {
      byDistrict.set(w.districtNumber, w.votes);
    }
  }

  const missedOut = candidates
    .flatMap((c) => {
      if (electedIds.has(c.id)) return [];
      const districtThreshold = byDistrict.get(c.districtNumber);
      if (districtThreshold === undefined || c.votes <= districtThreshold) return [];
      return [{ ...c, districtThreshold }];
    })
    .sort((a, b) => b.votes - a.votes || a.fullName.localeCompare(b.fullName, "pl"));

  return {
    thresholds: [...byDistrict]
      .map(([districtNumber, votes]) => ({ districtNumber, votes }))
      .sort((a, b) => a.districtNumber - b.districtNumber),
    missedOut,
  };
}
