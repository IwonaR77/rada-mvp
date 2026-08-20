/**
 * Korelacja rang Spearmana — na ile monotoniczna jest zależność dwóch
 * wielkości.
 *
 * Rangi, a nie surowe wartości, bo porównywane tu wielkości mają skrajnie
 * różne rozkłady: liczba głosów mieści się w jednym rzędzie wielkości,
 * a czas mówienia w czterech, i jedna osoba prowadząca obrady potrafi sama
 * przeważyć korelację Pearsona. Spearman odpowiada na pytanie „czy kto ma
 * więcej głosów, ten zwykle mówi dłużej", a nie „o ile minut dłużej".
 *
 * Remisy dostają rangę średnią, dzięki czemu kilka osób o tym samym wyniku
 * nie przesuwa sztucznie pozostałych.
 */
export function spearman(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 3) return 0;
  return pearson(ranks(xs), ranks(ys));
}

function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const average = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k].i] = average;
    i = j + 1;
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}
