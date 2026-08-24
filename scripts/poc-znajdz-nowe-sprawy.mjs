// PoC pamięci semantycznej spraw — systematyczne przeszukanie WSZYSTKICH
// bloków (radni + urzędnicy/goście/mieszkańcy) pod kątem tematów, które
// wracają na kilku sesjach, ale nie mają dziś żadnej `sprawy` w katalogu.
//
// Metoda (patrz notatki/dyskusja-z-chatgpt-pamiec-semantyczna.txt,
// project_semantic_matter_poc):
// 1. Pary bloków z różnych sesji o podobieństwie > PROG_PODOBIENSTWA.
// 2. Sklejenie par w klastry (union-find) — kilka wzmianek tego samego
//    tematu ma być jednym kandydatem, nie osobną pozycją na parę.
// 3. Odfiltrowanie formułek proceduralnych przez FANOUT: blok podobny do
//    bardzo wielu innych sesji (np. "Czy są pytania do projektu uchwały?")
//    to rytuał, nie temat. Prawdziwy powracający temat ma niski/średni
//    fanout — pojawia się tylko tam, gdzie realnie był poruszany.
//    (Nie blacklista fraz/nazwisk — ta metoda działa niezależnie od tego,
//    kto mówi i jak ujmie temat za każdym razem.)
// 4. Dla każdego klastra: najbliższa istniejąca `sprawa`. Nisko = kandydat
//    na nową sprawę; wysoko = już ujęte, pomijamy.
//
// Uruchomienie: set -a && source .env.backup && set +a && node scripts/poc-znajdz-nowe-sprawy.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { supabaseQuery } from "./lib/db.mjs";

const PROG_PODOBIENSTWA = 0.90;
const MIN_DLUGOSC_TEKSTU = 150;
const FANOUT_MIN = 1; // klaster musi obejmować co najmniej 2 sesje (1 inna + swoja)
const FANOUT_MAX = 6; // powyżej tego to prawdopodobnie rytuał/formułka
const PROG_POKRYCIA_SPRAWA = 0.87; // powyżej = uznajemy za już ujęte

// Cache — ciężkie zapytanie (self-join ~3700² par) liczy się na wolnej,
// darmowej instancji kilka minut; przy strojeniu progów fanout/pokrycia nie
// ma sensu liczyć go od nowa za każdym razem.
const CACHE_PLIK = "/tmp/poc-nowe-sprawy-pary-cache.json";
let pary;
if (existsSync(CACHE_PLIK)) {
  console.log(`Wczytuję pary z cache (${CACHE_PLIK})...`);
  pary = JSON.parse(readFileSync(CACHE_PLIK, "utf8"));
} else {
  console.log(`Szukam par bloków (różne sesje, podobieństwo > ${PROG_PODOBIENSTWA})...`);
  pary = supabaseQuery(`
    select b1.id as id1, b2.id as id2,
      1 - (b1.embedding <=> b2.embedding) as sim
    from speech_block_embedding b1
    join speech_block_embedding b2
      on b2.id > b1.id and b2.meeting_id <> b1.meeting_id
    where length(b1.text) > ${MIN_DLUGOSC_TEKSTU} and length(b2.text) > ${MIN_DLUGOSC_TEKSTU}
      and (1 - (b1.embedding <=> b2.embedding)) > ${PROG_PODOBIENSTWA}
  `);
  writeFileSync(CACHE_PLIK, JSON.stringify(pary));
}
console.log(`${pary.length} par.`);

console.log("\nPobieram metadane bloków...");
const wszystkieIdy = [...new Set(pary.flatMap((p) => [p.id1, p.id2]))];
const blokiById = new Map();
for (let i = 0; i < wszystkieIdy.length; i += 300) {
  const chunk = wszystkieIdy.slice(i, i + 300);
  const wiersze = supabaseQuery(`
    select b.id, b.meeting_id, b.text, m.date,
      coalesce(c.full_name, o.full_name) as mowca,
      case when b.councilor_id is not null then 'radny' else o.role end as rodzaj
    from speech_block_embedding b
    join meeting m on m.id = b.meeting_id
    left join councilor c on c.id = b.councilor_id
    left join official o on o.id = b.official_id
    where b.id in (${chunk.map((id) => `'${id}'`).join(",")})
  `);
  for (const w of wiersze) blokiById.set(w.id, w);
}

// --- Fanout BEZPOŚREDNI per blok (nie transytywny!) — liczba różnych
// sesji, z którymi TEN KONKRETNY blok ma bezpośrednią krawędź. Formułki
// proceduralne łączą się transytywnie w jeden gigantyczny łańcuch
// (A~B~C~D mimo że A i D wcale nie są podobne) — dlatego licznik musi
// patrzeć tylko na bezpośrednich sąsiadów, nie na cały connected component.
const sasiedziPoSesji = new Map(); // blockId -> Set(meeting_id sąsiadów)
function dodajSasiada(id, sasiadId) {
  const sesjaSasiada = blokiById.get(sasiadId)?.meeting_id;
  if (!sesjaSasiada) return;
  if (!sasiedziPoSesji.has(id)) sasiedziPoSesji.set(id, new Set());
  sasiedziPoSesji.get(id).add(sesjaSasiada);
}
for (const p of pary) {
  dodajSasiada(p.id1, p.id2);
  dodajSasiada(p.id2, p.id1);
}

const niskiFanout = new Set(
  [...sasiedziPoSesji.entries()]
    .filter(([, sesje]) => sesje.size >= FANOUT_MIN && sesje.size <= FANOUT_MAX)
    .map(([id]) => id)
);
console.log(`${niskiFanout.size} bloków z fanoutem ${FANOUT_MIN}-${FANOUT_MAX} sesji (odrzucone: huby-formułki o wyższym fanout).`);

// --- Union-find, ale TYLKO nad krawędziami między dwoma już niskofanoutowymi
// blokami — hub (formułka) nigdy nie wejdzie do łańcucha, więc nie ma czym
// sklejać niepowiązanych tematów.
const parent = new Map();
function find(x) {
  if (!parent.has(x)) parent.set(x, x);
  let r = x;
  while (parent.get(r) !== r) r = parent.get(r);
  parent.set(x, r);
  return r;
}
function union(a, b) {
  const ra = find(a), rb = find(b);
  if (ra !== rb) parent.set(ra, rb);
}
for (const p of pary) {
  if (niskiFanout.has(p.id1) && niskiFanout.has(p.id2)) union(p.id1, p.id2);
}

const klastry = new Map(); // root -> Set(blockId)
for (const id of niskiFanout) {
  const root = find(id);
  if (!klastry.has(root)) klastry.set(root, new Set());
  klastry.get(root).add(id);
}
console.log(`${klastry.size} klastrów po filtrze fanout.`);

const kandydaci = [];
for (const [, idsSet] of klastry) {
  const ids = [...idsSet];
  const sesje = new Set(ids.map((id) => blokiById.get(id)?.meeting_id));
  kandydaci.push({ ids, sesje: sesje.size });
}

// --- Dla każdego klastra: najbliższa istniejąca sprawa ---
console.log("\nSprawdzam pokrycie istniejącymi sprawami...");
const raport = [];
for (const k of kandydaci) {
  // Reprezentant klastra do porównania ze sprawami: najdłuższy tekst (najwięcej treści).
  const reprezentant = k.ids
    .map((id) => blokiById.get(id))
    .filter(Boolean)
    .sort((a, b) => b.text.length - a.text.length)[0];
  if (!reprezentant) continue;

  const [dopasowanie] = supabaseQuery(`
    select mt.title, round((1 - (mt.embedding <=> b.embedding))::numeric, 3) as podob
    from speech_block_embedding b, matter mt
    where b.id = '${reprezentant.id}' and mt.embedding is not null
    order by mt.embedding <=> b.embedding
    limit 1
  `);

  raport.push({
    sesje: k.sesje,
    najblizszaSprawa: dopasowanie?.title ?? null,
    podobienstwoSprawy: dopasowanie?.podob ?? null,
    nowa: !dopasowanie || dopasowanie.podob < PROG_POKRYCIA_SPRAWA,
    bloki: k.ids
      .map((id) => blokiById.get(id))
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date)),
  });
}

raport.sort((a, b) => Number(b.nowa) - Number(a.nowa) || b.sesje - a.sesje);

console.log(`\n${"=".repeat(80)}`);
console.log(`WYNIK: ${raport.filter((r) => r.nowa).length} kandydatów na nowe sprawy, ${raport.filter((r) => !r.nowa).length} już ujętych.`);
console.log("=".repeat(80));

for (const r of raport) {
  console.log(`\n[${r.nowa ? "NOWA?" : "już ujęta"}] ${r.sesje} sesje${r.podobienstwoSprawy != null ? `, najbliższa sprawa: "${r.najblizszaSprawa}" (${r.podobienstwoSprawy})` : ", brak dopasowania"}`);
  for (const b of r.bloki) {
    console.log(`  ${b.date} | ${b.mowca} (${b.rodzaj}): ${b.text.slice(0, 140).replace(/\s+/g, " ")}`);
  }
}
