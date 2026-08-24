// Smoke test PoC embeddingów semantycznych (patrz notatki/dyskusja-z-chatgpt-pamiec-semantyczna.txt
// i pamięć project_semantic_matter_poc) — zanim cokolwiek dotknie bazy: czy
// mały lokalny model w ogóle odróżnia polskie zdania o tej samej sprawie
// (innymi słowami) od zdań o zupełnie innej sprawie.
//
// Uruchomienie: node scripts/poc-embeddingi-smoke-test.mjs
// (pierwsze uruchomienie pobiera model, ~470 MB, potem offline)

import { embedPassage, embedQuery, cosineSimilarity } from "./lib/embeddings.mjs";

const sprawy = [
  {
    id: "CASE-142 (transport)",
    text: "Mieszkańcy zgłosili brak połączeń autobusowych z sołectwami.",
  },
  {
    id: "CASE-budzet (drogi)",
    text: "Radni dyskutowali o wysokości budżetu na remont dróg gminnych.",
  },
  {
    id: "CASE-szkola (oświata)",
    text: "Poruszono temat remontu dachu w szkole podstawowej.",
  },
  {
    id: "CASE-smieci (odpady)",
    text: "Wzrosły opłaty za wywóz śmieci, mieszkańcy pytają o powód podwyżki.",
  },
];

// Świadomie inne słowa niż w sprawach wyżej — to jest test, nie dopasowanie
// tekstowe. Kolejność odpowiada kolejności spraw powyżej (case[i] powinien
// wygrać dla zapytania[i]).
const zapytania = [
  "Mieszkańcy ponownie zgłaszają problem dojazdu do miasta z odległych wsi.",
  "Skarżą się na stan nawierzchni na drodze gminnej, potrzebny remont.",
  "Awaria dachu w budynku szkoły wymaga pilnej naprawy przed zimą.",
  "Podwyżka cen za odbiór odpadów komunalnych budzi kontrowersje.",
];

const embeddingiSpraw = await Promise.all(
  sprawy.map(async (s) => ({ ...s, wektor: await embedPassage(s.text) }))
);

let trafienia = 0;
for (let i = 0; i < zapytania.length; i++) {
  const zapytanie = zapytania[i];
  const wektorZapytania = await embedQuery(zapytanie);
  const wyniki = embeddingiSpraw
    .map((s) => ({
      id: s.id,
      podobienstwo: cosineSimilarity(wektorZapytania, s.wektor),
    }))
    .sort((a, b) => b.podobienstwo - a.podobienstwo);

  const trafil = wyniki[0].id === sprawy[i].id;
  trafienia += trafil ? 1 : 0;

  console.log(`\n"${zapytanie}"`);
  console.log(`  oczekiwane: ${sprawy[i].id}${trafil ? " ✓ na 1. miejscu" : " ✗"}`);
  for (const w of wyniki) console.log(`  ${w.id}: ${w.podobienstwo.toFixed(3)}`);
}

console.log(`\n${trafienia}/${zapytania.length} zapytań trafiło we właściwą sprawę na 1. miejscu.`);
