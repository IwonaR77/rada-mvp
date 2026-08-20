import type { ElectionData } from "@/lib/election-data";
import { allocateSeats, type VoteMap } from "@/lib/electoral-systems";

/** One sentence of the generated note, plus the numbers it was derived from. */
export type NoteFact = { text: string };

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const pp = (x: number) =>
  `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1).replace(".", ",")} p.p.`;

function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const t = n % 10;
  const h = n % 100;
  return t >= 2 && t <= 4 && (h < 12 || h > 14) ? few : many;
}

const mandaty = (n: number) => `${n} ${plural(n, "mandat", "mandaty", "mandatów")}`;

/**
 * Składa notatkę „skąd ten podział mandatów" z policzonych faktów.
 *
 * Świadomie nie tłumaczy, DLACZEGO ludzie głosowali tak, a nie inaczej — tego
 * z protokołów PKW nie widać, a zgadywanie motywów konkretnych, żyjących osób
 * jest dokładnie tym, czego serwis nie robi. Tłumaczy wyłącznie mechanikę:
 * jak oddane głosy zamieniły się w mandaty i gdzie ta zamiana nie jest
 * proporcjonalna.
 *
 * Każde zdanie powstaje z liczb w bazie, nie z modelu językowego, więc nie
 * może się rozjechać z tabelą obok.
 */
export function buildDistributionNote(election: ElectionData, threshold = 0.05): NoteFact[] {
  const facts: NoteFact[] = [];
  const { committees, totalVotes, seats } = election;
  if (!totalVotes || !seats) return facts;

  const share = (c: (typeof committees)[number]) => ({
    votes: c.votes / totalVotes,
    seats: c.seats / seats,
  });

  facts.push({
    text:
      `W wyborach 7 kwietnia 2024 oddano ${totalVotes.toLocaleString("pl-PL")} ważnych głosów ` +
      `na listy ${committees.length} komitetów, a do obsadzenia było ${mandaty(seats)} ` +
      `w ${election.districts.length} okręgach ` +
      `(po ${election.districts.map((d) => d.seats).join(", ")}).`,
  });

  const below = committees.filter((c) => c.votes / totalVotes < threshold);
  const zeroSeats = committees.filter((c) => c.seats === 0 && c.votes / totalVotes >= threshold);

  if (below.length === 0) {
    facts.push({
      text:
        `Ustawowy próg ${pct(threshold)}, liczony w skali całej gminy, przekroczyły wszystkie ` +
        `komitety — więc to nie próg zdecydował o tym, kto wszedł do rady.`,
    });
  } else {
    facts.push({
      text:
        `Próg ${pct(threshold)} w skali gminy odciął ${below.length} ` +
        `${plural(below.length, "komitet", "komitety", "komitetów")}: ` +
        `${below.map((c) => `${c.shortName} (${pct(c.votes / totalVotes)})`).join(", ")}.`,
    });
  }

  if (zeroSeats.length) {
    const votes = zeroSeats.reduce((a, c) => a + c.votes, 0);
    facts.push({
      text:
        `Mimo to ${zeroSeats.map((c) => c.shortName).join(" i ")} ` +
        `${plural(zeroSeats.length, "nie ma", "nie mają", "nie ma")} w radzie ani jednego mandatu, ` +
        `choć ${plural(zeroSeats.length, "zebrał", "zebrały", "zebrały")} razem ` +
        `${votes.toLocaleString("pl-PL")} głosów, czyli ${pct(votes / totalVotes)}. ` +
        `Przy podziale na małe okręgi (${election.districts.map((d) => d.seats).join(", ")} mandatów) ` +
        `metoda D'Hondta wymaga w praktyce znacznie więcej niż ${pct(threshold)}, ` +
        `żeby zdobyć choć jedno miejsce.`,
    });
  }

  const over = [...committees].sort((a, b) => share(b).seats - share(b).votes - (share(a).seats - share(a).votes))[0];
  if (over && share(over).seats > share(over).votes) {
    facts.push({
      text:
        `Najbardziej zyskał ${over.shortName}: ${pct(share(over).votes)} głosów dało ` +
        `${pct(share(over).seats)} mandatów (${mandaty(over.seats)}), czyli ${pp(share(over).seats - share(over).votes)} ` +
        `ponad wynik wyborczy. D'Hondt systematycznie premiuje największe listy.`,
    });
  }

  const tie = findTieBreak(election);
  if (tie) {
    facts.push({
      text:
        `Ostatni mandat w okręgu ${tie.district} rozstrzygnął się na remisie ilorazów: ` +
        `${tie.winner} i ${tie.loser} miały identyczny iloraz ` +
        `${tie.quotient.toFixed(1).replace(".", ",")}. Kodeks wyborczy przyznaje wtedy mandat ` +
        `liście z większą liczbą głosów w okręgu — stąd ${tie.winner}.`,
    });
  }

  return facts;
}

/**
 * Szuka mandatu rozstrzygniętego regułą równych ilorazów (art. 232 §3 kw).
 *
 * Warto o nim napisać wprost, bo to jedyne miejsce, gdzie o składzie rady
 * zdecydował przepis proceduralny, a nie różnica głosów — i gdzie naiwna
 * implementacja D'Hondta daje inny wynik niż rzeczywistość.
 */
function findTieBreak(election: ElectionData) {
  for (const d of election.districts) {
    const votes: VoteMap = new Map();
    for (const c of election.candidates) {
      if (c.districtNumber !== d.number) continue;
      votes.set(c.committeeCode, (votes.get(c.committeeCode) ?? 0) + c.votes);
    }
    const allocated = allocateSeats(votes, d.seats, "dhondt");

    const quotients: { value: number; code: string; votes: number }[] = [];
    for (const [code, v] of votes) {
      for (let i = 1; i <= d.seats; i++) quotients.push({ value: v / i, code, votes: v });
    }
    quotients.sort((a, b) => b.value - a.value || b.votes - a.votes);
    const last = quotients[d.seats - 1];
    const next = quotients[d.seats];
    if (!last || !next || last.value !== next.value || last.code === next.code) continue;

    return {
      district: d.number,
      quotient: last.value,
      winner: shortOf(election, last.code),
      loser: shortOf(election, next.code),
      seats: allocated.get(last.code) ?? 0,
    };
  }
  return null;
}

function shortOf(election: ElectionData, code: string) {
  return election.committees.find((c) => c.code === code)?.shortName ?? code;
}
