// Bigramowe podobieństwo (Dice) na znakach — scentralizowane z trzech miejsc,
// które dotąd trzymały tę samą funkcję osobno: `councilor-profile-state.ts`
// (miękkie dopasowanie zgłoszenia mieszkańców do tematu), `porownaj-stan.mjs`
// (dopasowanie tez między dwoma stanami do porównania) i teraz
// `councilor-profile-delta.ts` (wybór najbardziej podobnej pary tematów/
// sporów do scalenia przy przekroczeniu limitu).

export function bigramy(tekst: string): Set<string> {
  const znorm = tekst.toLocaleLowerCase("pl-PL").replace(/\s+/g, " ").trim();
  const zestaw = new Set<string>();
  for (let i = 0; i < znorm.length - 1; i++) zestaw.add(znorm.slice(i, i + 2));
  return zestaw;
}

export function dice(a: string, b: string): number {
  const ba = bigramy(a);
  const bb = bigramy(b);
  if (ba.size === 0 || bb.size === 0) return 0;
  let wspolne = 0;
  for (const x of ba) if (bb.has(x)) wspolne++;
  return (2 * wspolne) / (ba.size + bb.size);
}
