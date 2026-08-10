// Polskie daty i pobieranie stron o niepewnym kodowaniu — wspólne dla skryptów
// scrapujących. Dotąd MONTHS istniało w trzech kopiach (discover-new-sessions,
// scrape-esesja-records, match-protokol-speakers.py), a każda nowa rada dokładała
// kolejną.

export const MONTHS = {
  stycznia: "01", lutego: "02", marca: "03", kwietnia: "04",
  maja: "05", czerwca: "06", lipca: "07", sierpnia: "08",
  września: "09", października: "10", listopada: "11", grudnia: "12",
};

/**
 * "29 lipca 2026" → "2026-07-29". Zwraca null, gdy nie ma dopasowania —
 * wołający decyduje, czy to pominąć, czy przerwać.
 */
export function parsePolishDate(text) {
  const m = text.match(/(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})/i);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
}

/**
 * Wariant dla slugów esesja.pl ("...wadniuaśrodaa26aczerwcaa2024"), gdzie
 * spacje zamieniono na literę "a".
 */
export function parsePolishDateFromSlug(slug) {
  const m = slug.match(/(\d{1,2})a([a-ząćęłńóśźż]+)a(\d{4})/i);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
}

/**
 * Pobiera stronę, sniffując kodowanie zamiast je zakładać — te same serwisy
 * bywają UTF-8 i windows-1250 bez deklaracji (gotcha #1 w scrape-esesja-records).
 */
export async function fetchDecoded(url) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 600).toString("latin1");
  const isUtf8 = /charset=["']?utf-?8/i.test(head);
  return isUtf8 ? buf.toString("utf8") : buf.toString("latin1");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
