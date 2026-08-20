import { allocateSeats, type Method, type SimCandidate, type VoteMap } from "@/lib/electoral-systems";

export type ConcentrationRow = {
  committeeCode: string;
  votes: number;
  actualSeats: number;
  /** Górna granica mandatów przy najlepszym możliwym rozłożeniu głosów na okręgi. */
  bestSeats: number;
  /** Rozkład głosów po okręgach, który tę granicę osiąga. */
  bestSplit: { districtNumber: number; votes: number; seats: number }[];
};

/**
 * Ile mandatów komitet mógłby wziąć, gdyby te same głosy rozłożyły się między
 * okręgami inaczej.
 *
 * ## Co ta liczba znaczy, a czego NIE znaczy
 *
 * To GÓRNA GRANICA przy założeniu, którego nie da się zrealizować: że głosy
 * komitetu można dowolnie przesypać między okręgami. Nie można — wyborca
 * głosuje tam, gdzie mieszka, a komitet decyduje tylko o tym, gdzie postawi
 * kandydatów, nie gdzie mieszkają jego zwolennicy. Przeniesienie kandydata do
 * innego okręgu nie zabiera ze sobą jego wyborców.
 *
 * Dlatego wynik czytać jako miarę KOSZTU PODZIAŁU NA OKRĘGI dla danego
 * komitetu — ile mandatów gubi na rozproszeniu poparcia — a nie jako poradę
 * wyborczą ani zarzut, że komitet źle ustawił listy. Spójnym scenariuszem
 * kontrfaktycznym jest wariant „jeden okręg" w symulatorze: tam zmienia się
 * prawo, a nie geografia wyborców.
 *
 * ## Jak liczone
 *
 * Mandaty w okręgu zależą wyłącznie od sumy głosów listy, więc dla każdego
 * okręgu wystarczy próg: ile głosów trzeba, by wziąć k mandatów przy głosach
 * pozostałych komitetów bez zmian. Potem szukamy takiego (k₁, k₂, k₃), żeby
 * suma progów zmieściła się w całkowitej liczbie głosów komitetu.
 *
 * Wynik sprawdzony (2026-08-20) przeciwko dokładnemu programowaniu
 * dynamicznemu po realnych wartościach głosów kandydatów — zgodny dla
 * wszystkich ośmiu komitetów, a tańszy o kilka rzędów wielkości, bo głosy
 * kandydatów są na tyle drobne, że praktycznie każdy podział sumy jest
 * osiągalny.
 */
export function analyseConcentration(
  candidates: SimCandidate[],
  seatsPerDistrict: Map<number, number>,
  electedIds: ReadonlySet<string>,
  method: Method,
  threshold: number
): ConcentrationRow[] {
  const districts = [...seatsPerDistrict.keys()].sort((a, b) => a - b);

  const votesByCommitteeDistrict = new Map<string, Map<number, number>>();
  const totals = new Map<string, number>();
  const actualSeats = new Map<string, number>();
  for (const c of candidates) {
    const perDistrict = votesByCommitteeDistrict.get(c.committeeCode) ?? new Map();
    perDistrict.set(c.districtNumber, (perDistrict.get(c.districtNumber) ?? 0) + c.votes);
    votesByCommitteeDistrict.set(c.committeeCode, perDistrict);
    totals.set(c.committeeCode, (totals.get(c.committeeCode) ?? 0) + c.votes);
    actualSeats.set(c.committeeCode, (actualSeats.get(c.committeeCode) ?? 0) + (electedIds.has(c.id) ? 1 : 0));
  }

  const grandTotal = [...totals.values()].reduce((a, b) => a + b, 0);

  return [...totals.keys()]
    .map((code) => {
      const votes = totals.get(code)!;
      const actual = actualSeats.get(code) ?? 0;

      // Próg gminny liczy się od sumy głosów, a ta się nie zmienia przy
      // przesypywaniu między okręgami — komitet pod progiem zostaje pod nim.
      if (grandTotal > 0 && votes / grandTotal < threshold) {
        return { committeeCode: code, votes, actualSeats: actual, bestSeats: 0, bestSplit: [] };
      }

      const thresholds = districts.map((d) =>
        seatThresholds(code, d, votesByCommitteeDistrict, seatsPerDistrict.get(d) ?? 0, method, threshold, grandTotal, totals)
      );

      let best = { seats: -1, combo: [] as number[] };
      const walk = (i: number, used: number, combo: number[]) => {
        if (i === districts.length) {
          const sum = combo.reduce((a, b) => a + b, 0);
          if (sum > best.seats) best = { seats: sum, combo: [...combo] };
          return;
        }
        for (let k = 0; k < thresholds[i].length; k++) {
          const need = thresholds[i][k];
          if (!Number.isFinite(need) || used + need > votes) continue;
          walk(i + 1, used + need, [...combo, k]);
        }
      };
      walk(0, 0, []);

      const combo = best.combo;
      const bestSplit = districts.map((d, i) => ({
        districtNumber: d,
        votes: Number.isFinite(thresholds[i][combo[i] ?? 0]) ? thresholds[i][combo[i] ?? 0] : 0,
        seats: combo[i] ?? 0,
      }));
      // Nadwyżkę ponad sumę progów dokładamy do pierwszego okręgu, żeby
      // pokazywany rozkład sumował się do rzeczywistej liczby głosów.
      const spent = bestSplit.reduce((a, s) => a + s.votes, 0);
      if (bestSplit.length) bestSplit[0].votes += votes - spent;

      return {
        committeeCode: code,
        votes,
        actualSeats: actual,
        bestSeats: Math.max(best.seats, 0),
        bestSplit,
      };
    })
    .sort((a, b) => b.bestSeats - b.actualSeats - (a.bestSeats - a.actualSeats) || b.votes - a.votes);
}

/** Najmniejsza liczba głosów dająca k mandatów w okręgu, przy reszcie bez zmian. */
function seatThresholds(
  code: string,
  district: number,
  votesByCommitteeDistrict: Map<string, Map<number, number>>,
  seats: number,
  method: Method,
  threshold: number,
  grandTotal: number,
  totals: Map<string, number>
): number[] {
  const others: VoteMap = new Map();
  for (const [otherCode, perDistrict] of votesByCommitteeDistrict) {
    if (otherCode === code) continue;
    // Komitety pod progiem gminnym nie uczestniczą w podziale.
    if (grandTotal > 0 && (totals.get(otherCode) ?? 0) / grandTotal < threshold) continue;
    others.set(otherCode, perDistrict.get(district) ?? 0);
  }

  const maxOther = Math.max(0, ...others.values());
  const ceiling = maxOther * (seats + 1) + seats + 1;
  const out = [0];
  for (let k = 1; k <= seats; k++) {
    let lo = 0;
    let hi = ceiling;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const got = allocateSeats(new Map([...others, [code, mid]]), seats, method).get(code) ?? 0;
      if (got >= k) hi = mid;
      else lo = mid + 1;
    }
    out.push(lo <= ceiling ? lo : Infinity);
  }
  return out;
}
