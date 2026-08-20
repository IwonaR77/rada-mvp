import {
  simulate,
  type SimCandidate,
  type SimulationConfig,
} from "@/lib/electoral-systems";

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


/**
 * Sprawdza, z których innych list w SWOIM okręgu kandydat zdobyłby mandat.
 *
 * Liczone przez faktyczne przeniesienie kandydata na daną listę i przeliczenie
 * całych wyborów od nowa — nie przez skrót arytmetyczny — bo przeniesienie
 * zmienia sumy obu list naraz, a przez próg gminny potrafi odbić się także na
 * pozostałych okręgach. Skrót łatwo by to zgubił.
 *
 * Założenie: kandydat zabiera na nową listę swoje głosy. Jest ono znacznie
 * mocniejsze niż przy przenoszeniu między okręgami — to ci sami wyborcy w tym
 * samym okręgu i mogli na tę osobę zagłosować niezależnie od szyldu — ale nie
 * jest darmowe: część głosów padła na komitet, nie na człowieka, i ta część by
 * za nim nie poszła.
 *
 * Kandydat trafia na koniec listy docelowej, bo pozycja rozstrzyga wyłącznie
 * remisy w liczbie głosów (art. 233 kw) — to najostrożniejsze założenie,
 * a nie takie, które sztucznie mu pomaga.
 *
 * @returns kod komitetu → lista kodów komitetów dających mandat, per kandydat
 */
export function findWinningAlternatives(
  candidates: SimCandidate[],
  seatsPerDistrict: Map<number, number>,
  config: SimulationConfig,
  targets: SimCandidate[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();

  for (const target of targets) {
    const inDistrict = [
      ...new Set(
        candidates
          .filter((c) => c.districtNumber === target.districtNumber)
          .map((c) => c.committeeCode)
      ),
    ];
    const winning: string[] = [];

    for (const code of inDistrict) {
      if (code === target.committeeCode) continue;
      const lastPosition = Math.max(
        0,
        ...candidates
          .filter((c) => c.committeeCode === code && c.districtNumber === target.districtNumber)
          .map((c) => c.listPosition)
      );
      const moved = candidates.map((c) =>
        c.id === target.id
          ? { ...c, committeeCode: code, listPosition: lastPosition + 1 }
          : c
      );
      const result = simulate(moved, seatsPerDistrict, config);
      if (result.elected.some((c) => c.id === target.id)) winning.push(code);
    }

    out.set(target.id, winning);
  }

  return out;
}
