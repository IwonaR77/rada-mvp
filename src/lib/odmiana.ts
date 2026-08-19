/**
 * Polska odmiana rzeczownika przy liczebniku: 1 uwaga, 2–4 uwagi, 5+ uwag,
 * ale 12–14 uwag (nastki idą z formą mnogą dopełniaczową).
 *
 * Trzy formy, bo tyle ich rozróżnia polszczyzna — angielskie `n === 1 ? a : b`
 * daje „2 uwag" i „5 uwagi".
 */
export function odmien(
  n: number,
  pojedyncza: string,
  mnoga: string,
  dopelniacz: string
): string {
  if (n === 1) return pojedyncza;
  const dziesiatki = n % 100;
  const jednosci = n % 10;
  const jestMnoga =
    jednosci >= 2 && jednosci <= 4 && !(dziesiatki >= 12 && dziesiatki <= 14);
  return jestMnoga ? mnoga : dopelniacz;
}

/** „uwaga" / „uwagi" / „uwag" — uwagi redakcji do promptów. */
export function odmienUwagi(n: number): string {
  return odmien(n, "uwaga", "uwagi", "uwag");
}
