import type { SimCandidate } from "@/lib/electoral-systems";

/**
 * Pojedynczy głos przechodni (STV) — z JAWNYM, wymyślonym modelem preferencji.
 *
 * ## Czego tu nie ma i dlaczego
 *
 * STV wymaga, żeby wyborca uszeregował kandydatów: pierwszy wybór, drugi,
 * trzeci. Polska karta ma jeden krzyżyk, więc dalszych preferencji NIE MA
 * w żadnych danych PKW i nie da się ich odtworzyć. Ta funkcja ich nie odkrywa
 * — ona je ZAKŁADA. Wynik jest tyle wart, ile założenie.
 *
 * ## Przyjęty model
 *
 * Karta oddana na kandydata X to pierwsza preferencja dla X, a kolejne
 * preferencje to pozostali kandydaci TEGO SAMEGO komitetu, w kolejności
 * liczby zdobytych głosów. Po ich wyczerpaniu karta wygasa (nie przechodzi
 * do innego komitetu).
 *
 * To model wyborcy lojalnego wobec komitetu. Jest skrajny w jedną stronę:
 * w prawdziwym STV część głosów przechodzi między komitetami, zwłaszcza
 * między blisko sobie stojącymi. Skutek jest przewidywalny i trzeba go
 * mówić wprost: przy tym założeniu STV zbiega do proporcjonalnego podziału
 * kwotą Droopa w obrębie komitetów, a różnice wobec metod kwotowych biorą
 * się prawie wyłącznie z zaokrągleń i kolejności eliminacji.
 *
 * ## Implementacja
 *
 * Kwota Droopa, transfer nadwyżek metodą Gregory'ego (ułamkową — cała paczka
 * kart zwycięzcy przechodzi dalej ze zmniejszoną wagą), eliminacja od dołu.
 * Liczone na paczkach kart, nie na pojedynczych kartach, bo model preferencji
 * jest deterministyczny w obrębie komitetu i wszystkie karty jednego
 * kandydata zachowują się identycznie.
 */

/** Paczka identycznych kart: `weight` głosów z tą samą listą preferencji. */
type Bundle = { weight: number; preferences: string[]; at: number };

export type StvResult = {
  elected: SimCandidate[];
  /** Kolejność zdarzeń w liczeniu — do pokazania, jak wynik powstał. */
  log: string[];
  /** Głosy, które wygasły, bo skończyły się preferencje. */
  exhausted: number;
};

export function countStv(candidates: SimCandidate[], seats: number): StvResult {
  const log: string[] = [];
  if (seats <= 0 || candidates.length === 0) {
    return { elected: [], log, exhausted: 0 };
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const byCommittee = new Map<string, SimCandidate[]>();
  for (const c of candidates) {
    const list = byCommittee.get(c.committeeCode) ?? [];
    list.push(c);
    byCommittee.set(c.committeeCode, list);
  }
  for (const list of byCommittee.values()) {
    list.sort((a, b) => b.votes - a.votes || a.listPosition - b.listPosition);
  }

  // Model preferencji: własny komitet, malejąco liczbą głosów.
  const bundles: Bundle[] = candidates
    .filter((c) => c.votes > 0)
    .map((c) => ({
      weight: c.votes,
      preferences: [
        c.id,
        ...byCommittee.get(c.committeeCode)!.filter((o) => o.id !== c.id).map((o) => o.id),
      ],
      at: 0,
    }));

  const totalVotes = bundles.reduce((a, b) => a + b.weight, 0);
  // Kwota Droopa: najmniejsza liczba głosów, której nie da się osiągnąć więcej
  // razy niż jest mandatów.
  const quota = Math.floor(totalVotes / (seats + 1)) + 1;
  log.push(
    `Kwota Droopa: ${quota.toLocaleString("pl-PL")} głosów ` +
      `(${totalVotes.toLocaleString("pl-PL")} ÷ ${seats + 1} + 1).`
  );

  const elected: SimCandidate[] = [];
  const eliminated = new Set<string>();
  const electedSet = new Set<string>();
  let exhausted = 0;

  const advance = (b: Bundle) => {
    while (
      b.at < b.preferences.length &&
      (electedSet.has(b.preferences[b.at]) || eliminated.has(b.preferences[b.at]))
    ) {
      b.at++;
    }
    return b.at < b.preferences.length ? b.preferences[b.at] : null;
  };

  const tally = () => {
    const totals = new Map<string, number>();
    for (const b of bundles) {
      const target = b.preferences[b.at];
      if (target === undefined) continue;
      totals.set(target, (totals.get(target) ?? 0) + b.weight);
    }
    return totals;
  };

  // Zabezpieczenie przed nieskończoną pętlą przy patologicznych danych —
  // każda runda albo kogoś wybiera, albo kogoś eliminuje.
  const maxRounds = candidates.length + seats + 2;
  for (let round = 0; round < maxRounds && elected.length < seats; round++) {
    for (const b of bundles) {
      if (b.at < b.preferences.length) advance(b);
    }
    const totals = tally();

    const winners = [...totals]
      .filter(([id, v]) => v >= quota && !electedSet.has(id))
      .sort((a, b) => b[1] - a[1]);

    if (winners.length) {
      for (const [id, votes] of winners) {
        if (elected.length >= seats) break;
        electedSet.add(id);
        elected.push(byId.get(id)!);
        const surplus = votes - quota;
        log.push(
          `${byId.get(id)!.fullName} osiąga kwotę (${Math.round(votes).toLocaleString("pl-PL")}), ` +
            `nadwyżka ${Math.round(surplus).toLocaleString("pl-PL")} przechodzi dalej.`
        );
        // Transfer Gregory'ego: wszystkie karty zwycięzcy idą dalej z wagą
        // przemnożoną przez udział nadwyżki, więc suma się zgadza.
        const factor = votes > 0 ? surplus / votes : 0;
        for (const b of bundles) {
          if (b.preferences[b.at] !== id) continue;
          b.weight *= factor;
          advance(b);
          if (b.at >= b.preferences.length) exhausted += b.weight;
        }
      }
      continue;
    }

    const remaining = [...totals].filter(
      ([id]) => !electedSet.has(id) && !eliminated.has(id)
    );
    if (!remaining.length) break;

    // Gdy zostało dokładnie tyle kandydatów, ile mandatów — wchodzą wszyscy,
    // tak jak w regulaminowym STV; dalsze eliminowanie nic by nie zmieniło.
    if (remaining.length <= seats - elected.length) {
      for (const [id] of remaining.sort((a, b) => b[1] - a[1])) {
        electedSet.add(id);
        elected.push(byId.get(id)!);
      }
      log.push("Zostało tylu kandydatów, ile wolnych mandatów — wchodzą bez kwoty.");
      break;
    }

    const [loserId, loserVotes] = remaining.sort((a, b) => a[1] - b[1])[0];
    eliminated.add(loserId);
    log.push(
      `Nikt nie osiąga kwoty — odpada ${byId.get(loserId)!.fullName} ` +
        `(${Math.round(loserVotes).toLocaleString("pl-PL")}), głosy przechodzą dalej.`
    );
    for (const b of bundles) {
      if (b.preferences[b.at] !== loserId) continue;
      advance(b);
      if (b.at >= b.preferences.length) exhausted += b.weight;
    }
  }

  if (exhausted > 0) {
    log.push(
      `Wygasło ${Math.round(exhausted).toLocaleString("pl-PL")} głosów — karty, ` +
        `którym skończyli się kandydaci własnego komitetu.`
    );
  }
  return { elected, log, exhausted };
}
