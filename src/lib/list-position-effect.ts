import type { ElectionData } from "@/lib/election-data";
import type { SimCandidate } from "@/lib/electoral-systems";

/** Jedna lista wyborcza: kandydaci JEDNEGO komitetu w JEDNYM okręgu. */
export type BallotList = {
  committeeCode: string;
  districtNumber: number;
  /** Kandydaci w kolejności z karty do głosowania — nigdy posortowani głosami. */
  candidates: (SimCandidate & { wonMandate: boolean })[];
  votes: number;
  seats: number;
};

export type PositionBucket = {
  label: string;
  candidates: number;
  seats: number;
  averageVotes: number;
};

export type PositionEffect = {
  buckets: PositionBucket[];
  /** Listy, które zdobyły choć jeden mandat. */
  listsWithSeats: number;
  /** Z ilu z nich najlepszy wynik miała „jedynka". */
  topWasFirst: number;
  /** Z ilu z nich najlepszy wynik miała osoba z ostatniego miejsca. */
  topWasLast: number;
};

/**
 * Grupuje kandydatów w listy wyborcze, w kolejności z karty do głosowania.
 *
 * Kolejność jest tu treścią, nie porządkiem porządkowym: całe pytanie brzmi,
 * czy miejsce na liście przekłada się na wynik, więc posortowanie tego głosami
 * skasowałoby dokładnie tę informację, dla której ten widok istnieje.
 */
export function buildBallotLists(election: ElectionData): BallotList[] {
  const lists = new Map<string, BallotList>();
  for (const c of election.candidates) {
    const key = `${c.committeeCode}|${c.districtNumber}`;
    let list = lists.get(key);
    if (!list) {
      list = {
        committeeCode: c.committeeCode,
        districtNumber: c.districtNumber,
        candidates: [],
        votes: 0,
        seats: 0,
      };
      lists.set(key, list);
    }
    const wonMandate = election.actualElectedIds.has(c.id);
    list.candidates.push({ ...c, wonMandate });
    list.votes += c.votes;
    if (wonMandate) list.seats++;
  }
  for (const list of lists.values()) {
    list.candidates.sort((a, b) => a.listPosition - b.listPosition);
  }
  return [...lists.values()].sort(
    (a, b) =>
      a.districtNumber - b.districtNumber ||
      a.committeeCode.localeCompare(b.committeeCode, "pl")
  );
}

/**
 * Mierzy, ile znaczy miejsce na liście.
 *
 * Trzy kubełki, nie dziesięć, bo efekt nie jest liniowy: liczy się pierwsze
 * miejsce, ostatnie miejsce („kotwica" — na wielu listach to drugi najlepszy
 * wynik) i cała reszta. Rozbicie na każdą pozycję z osobna rozmywa to w szumie,
 * bo listy mają różną długość i pozycja 7. na liście siedmioosobowej znaczy coś
 * zupełnie innego niż 7. na dziesięcioosobowej.
 */
export function measurePositionEffect(lists: BallotList[]): PositionEffect {
  const buckets = new Map<string, { candidates: number; seats: number; votes: number }>([
    ["Pierwsze miejsce", { candidates: 0, seats: 0, votes: 0 }],
    ["Ostatnie miejsce", { candidates: 0, seats: 0, votes: 0 }],
    ["Środek listy", { candidates: 0, seats: 0, votes: 0 }],
  ]);

  let listsWithSeats = 0;
  let topWasFirst = 0;
  let topWasLast = 0;

  for (const list of lists) {
    const last = list.candidates.length;
    for (const c of list.candidates) {
      const key =
        c.listPosition === 1
          ? "Pierwsze miejsce"
          : c.listPosition === last
            ? "Ostatnie miejsce"
            : "Środek listy";
      const bucket = buckets.get(key)!;
      bucket.candidates++;
      bucket.votes += c.votes;
      if (c.wonMandate) bucket.seats++;
    }

    if (list.seats > 0) {
      listsWithSeats++;
      const top = [...list.candidates].sort((a, b) => b.votes - a.votes)[0];
      if (top.listPosition === 1) topWasFirst++;
      else if (top.listPosition === last) topWasLast++;
    }
  }

  return {
    buckets: [...buckets].map(([label, b]) => ({
      label,
      candidates: b.candidates,
      seats: b.seats,
      averageVotes: b.candidates ? b.votes / b.candidates : 0,
    })),
    listsWithSeats,
    topWasFirst,
    topWasLast,
  };
}
