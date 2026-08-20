/**
 * Przeliczniki głosów na mandaty — jeden silnik dla symulatora ordynacji
 * w aplikacji i dla weryfikacji importu w `scripts/import-wybory-pkw.mjs`.
 *
 * Ten sam kod w obu miejscach jest tu celem, nie oszczędnością. Import
 * sprawdza, czy silnik odtwarza oficjalny wynik PKW co do nazwiska; gdyby
 * strona liczyła własną kopią, ta weryfikacja niczego by nie dowodziła.
 * Skrypt importuje ten plik wprost — Node od wersji 24 zdejmuje typy sam.
 */

/** Liczba głosów na listę danego komitetu, kluczowana kodem komitetu. */
export type VoteMap = Map<string, number>;

/** Metody dzielnikowe i kwotowe, jakie umie {@link allocateSeats}. */
export type Method =
  | "dhondt"
  | "sainte-lague"
  | "sainte-lague-mod"
  | "hare-niemeyer"
  | "droop";

export const METHOD_LABELS: Record<Method, string> = {
  dhondt: "D'Hondt",
  "sainte-lague": "Sainte-Laguë",
  "sainte-lague-mod": "Sainte-Laguë zmodyfikowany",
  "hare-niemeyer": "Hare-Niemeyer",
  droop: "kwota Droopa",
};

function divisor(method: Method, i: number): number {
  // i liczone od 1
  if (method === "dhondt") return i;
  if (method === "sainte-lague") return 2 * i - 1;
  // Wariant skandynawski: pierwszy dzielnik podniesiony do 1,4, co utrudnia
  // wejście najmniejszym listom, nie oddając przewagi największym.
  return i === 1 ? 1.4 : 2 * i - 1;
}

/**
 * Metody dzielnikowe. Remis ilorazów rozstrzyga większa liczba głosów listy
 * — tak stanowi art. 232 §3 kodeksu wyborczego i bez tego przepisu podział
 * mandatów w Grójcu rozjeżdża się z rzeczywistością o jeden mandat (ostatni
 * mandat w okręgu 3: 1083/3 = 361,0 wobec 361/1 = 361,0).
 */
function allocateByDivisor(votes: VoteMap, seats: number, method: Method): VoteMap {
  const quotients: { value: number; votes: number; key: string }[] = [];
  for (const [key, v] of votes) {
    for (let i = 1; i <= seats; i++) {
      quotients.push({ value: v / divisor(method, i), votes: v, key });
    }
  }
  quotients.sort((a, b) => b.value - a.value || b.votes - a.votes || a.key.localeCompare(b.key));

  const result: VoteMap = new Map([...votes.keys()].map((k) => [k, 0]));
  for (const q of quotients.slice(0, seats)) result.set(q.key, (result.get(q.key) ?? 0) + 1);
  return result;
}

/**
 * Metody kwotowe (największych reszt). Hare dzieli głosy przez liczbę
 * mandatów, Droop przez liczbę mandatów + 1 — Droop jest odrobinę
 * korzystniejszy dla większych list.
 */
function allocateByQuota(votes: VoteMap, seats: number, method: Method): VoteMap {
  const total = [...votes.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return new Map([...votes.keys()].map((k) => [k, 0]));
  const quota = method === "droop" ? total / (seats + 1) + 1 : total / seats;

  const result: VoteMap = new Map();
  for (const [k, v] of votes) result.set(k, Math.floor(v / quota));

  let assigned = [...result.values()].reduce((a, b) => a + b, 0);
  // Kwota Droopa potrafi rozdać o jeden mandat za dużo przy skrajnie
  // nierównym rozkładzie — wtedy odbieramy od listy z najmniejszą resztą.
  const byRemainder = [...votes.keys()].sort((a, b) => {
    const ra = votes.get(a)! - (result.get(a) ?? 0) * quota;
    const rb = votes.get(b)! - (result.get(b) ?? 0) * quota;
    return rb - ra || votes.get(b)! - votes.get(a)! || a.localeCompare(b);
  });
  for (const k of byRemainder) {
    if (assigned >= seats) break;
    result.set(k, (result.get(k) ?? 0) + 1);
    assigned++;
  }
  for (const k of [...byRemainder].reverse()) {
    if (assigned <= seats) break;
    if ((result.get(k) ?? 0) > 0) {
      result.set(k, result.get(k)! - 1);
      assigned--;
    }
  }
  return result;
}

/** Rozdziela `seats` mandatów między listy według wybranej metody. */
export function allocateSeats(votes: VoteMap, seats: number, method: Method): VoteMap {
  if (seats <= 0) return new Map([...votes.keys()].map((k) => [k, 0]));
  return method === "hare-niemeyer" || method === "droop"
    ? allocateByQuota(votes, seats, method)
    : allocateByDivisor(votes, seats, method);
}

/** Kandydat na potrzeby podziału mandatów wewnątrz listy. */
export type SimCandidate = {
  id: string;
  fullName: string;
  committeeCode: string;
  districtNumber: number;
  listPosition: number;
  votes: number;
  councilorId: string | null;
};

/**
 * Podział mandatów wewnątrz listy: art. 233 kodeksu wyborczego — mandaty biorą
 * kandydaci z największą liczbą głosów, a przy równej liczbie głosów wyższa
 * pozycja na liście.
 */
export function seatsToCandidates(candidates: SimCandidate[], seats: number): SimCandidate[] {
  return [...candidates]
    .sort((a, b) => b.votes - a.votes || a.listPosition - b.listPosition)
    .slice(0, seats);
}

export type SimulationConfig = {
  method: Method;
  /** `false` scala wszystkie okręgi w jeden okręg na całą radę. */
  perDistrict: boolean;
  /** Próg wejścia liczony w skali gminy, np. 0.05. Art. 415 §2 kw. */
  threshold: number;
};

export type SimulationResult = {
  /** Mandaty per kod komitetu. */
  seatsByCommittee: VoteMap;
  /** Imienny skład rady, posortowany malejąco liczbą głosów. */
  elected: SimCandidate[];
  /** Komitety odcięte progiem. */
  belowThreshold: string[];
};

/**
 * Przelicza te same głosy inną ordynacją.
 *
 * Uwaga na interpretację wyniku: to przeliczenie oddanych głosów innym wzorem,
 * a nie prognoza. Przy innej ordynacji inaczej zawiązałyby się komitety
 * i inaczej głosowaliby wyborcy — modelujemy arytmetykę, nie zachowania.
 */
export function simulate(
  candidates: SimCandidate[],
  seatsPerDistrict: Map<number, number>,
  config: SimulationConfig
): SimulationResult {
  const gmina: VoteMap = new Map();
  for (const c of candidates) {
    gmina.set(c.committeeCode, (gmina.get(c.committeeCode) ?? 0) + c.votes);
  }
  const total = [...gmina.values()].reduce((a, b) => a + b, 0);
  const passed = new Set(
    [...gmina].filter(([, v]) => total > 0 && v / total >= config.threshold).map(([k]) => k)
  );
  const belowThreshold = [...gmina.keys()].filter((k) => !passed.has(k));

  const seatsByCommittee: VoteMap = new Map([...gmina.keys()].map((k) => [k, 0]));
  const elected: SimCandidate[] = [];

  const groups: { seats: number; pool: SimCandidate[] }[] = config.perDistrict
    ? [...seatsPerDistrict].map(([number, seats]) => ({
        seats,
        pool: candidates.filter((c) => c.districtNumber === number),
      }))
    : [
        {
          seats: [...seatsPerDistrict.values()].reduce((a, b) => a + b, 0),
          pool: candidates,
        },
      ];

  for (const group of groups) {
    const votes: VoteMap = new Map();
    for (const c of group.pool) {
      if (!passed.has(c.committeeCode)) continue;
      votes.set(c.committeeCode, (votes.get(c.committeeCode) ?? 0) + c.votes);
    }
    const allocation = allocateSeats(votes, group.seats, config.method);
    for (const [code, n] of allocation) {
      if (!n) continue;
      seatsByCommittee.set(code, (seatsByCommittee.get(code) ?? 0) + n);
      elected.push(
        ...seatsToCandidates(
          group.pool.filter((c) => c.committeeCode === code),
          n
        )
      );
    }
  }

  elected.sort((a, b) => b.votes - a.votes || a.fullName.localeCompare(b.fullName, "pl"));
  return { seatsByCommittee, elected, belowThreshold };
}
