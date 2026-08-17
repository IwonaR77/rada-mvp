#!/usr/bin/env node
// Zrzuca do JSON-a wszystkie ZATWIERDZONE segmenty z przypisanym mówcą —
// materiał zarówno na wzorce głosu, jak i na testy rozpoznawania.
//
// Etykiety zbiorcze ("Zaproszony gość", "Mieszkaniec miasta", "Nieustalony
// mówca", "Nieustalony urzędnik") to NIE są osoby: pod każdą kryje się za
// każdym razem ktoś inny. Nie wchodzą do rejestru głosów i nie są celem
// rozpoznawania. Zostają w zrzucie z flagą `zbiorcza: true` wyłącznie jako
// kontrola negatywna w testach — na nich system MA się wstrzymać, a przyklejenie
// im nazwiska radnego to najgroźniejsza z możliwych pomyłek.
//
// `czysty` oznacza segment, którego sąsiedzi (poprzedni i następny w tej samej
// sesji) mają tego samego mówcę — czyli leży w środku czyjejś wypowiedzi,
// a nie na styku dwóch osób. Segmenty cięte są na pauzach, nie na zmianach
// mówcy, więc te ze styku bywają zanieczyszczone drugim głosem. Do wzorców
// bierzemy wyłącznie czyste.
//
// Użycie:
//   node scripts/voice/dump-groundtruth.mjs --out groq/work/glos/groundtruth.json

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { supabaseQuery, REPO_ROOT } from "../lib/db.mjs";

const ETYKIETY_ZBIORCZE = [
  "Zaproszony gość",
  "Mieszkaniec miasta",
  "Nieustalony mówca",
  "Nieustalony urzędnik",
];

// Duża paczka celowo: każde wywołanie to osobny proces `npx supabase`, który
// startuje kilka sekund. Przy 500 wierszach na stronę sam narzut startu
// przekraczał czas zapytań (14 tys. wierszy = 28 wywołań).
const PACZKA = 5000;

function parseArgs(argv) {
  const args = { out: "groq/work/glos/groundtruth.json" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
  }
  return args;
}

function pobierzWszystko(sql) {
  const wszystkie = [];
  for (let offset = 0; ; offset += PACZKA) {
    const paczka = supabaseQuery(`${sql} limit ${PACZKA} offset ${offset};`);
    wszystkie.push(...paczka);
    if (paczka.length < PACZKA) break;
  }
  return wszystkie;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  // lag/lead po czasie w obrębie sesji dają sąsiadów bez drugiego zapytania.
  const wiersze = pobierzWszystko(`
    with oznaczone as (
      select s.id, s.meeting_id, s.start_time, s.end_time, s.text,
             coalesce(s.confirmed_councilor_id::text, s.confirmed_official_id::text) as mowca_id,
             case when s.confirmed_councilor_id is not null then 'radny' else 'urzednik' end as typ,
             coalesce(c.full_name, o.full_name) as mowca,
             m.date, m.esesja_id,
             lag(coalesce(s.confirmed_councilor_id::text, s.confirmed_official_id::text))
               over (partition by s.meeting_id order by s.start_time) as poprzedni,
             lead(coalesce(s.confirmed_councilor_id::text, s.confirmed_official_id::text))
               over (partition by s.meeting_id order by s.start_time) as nastepny
        from segment s
        join meeting m on m.id = s.meeting_id
        left join councilor c on c.id = s.confirmed_councilor_id
        left join official o on o.id = s.confirmed_official_id
       where s.status = 'finalized'
         and (s.confirmed_councilor_id is not null or s.confirmed_official_id is not null)
    )
    select id, meeting_id, esesja_id, date, start_time, end_time, mowca_id, mowca, typ,
           (poprzedni is not distinct from mowca_id and nastepny is not distinct from mowca_id) as czysty
      from oznaczone
     order by esesja_id, start_time
  `);

  const segmenty = wiersze.map((r) => ({
    id: r.id,
    esesja_id: r.esesja_id,
    date: r.date,
    start: Number(r.start_time),
    end: Number(r.end_time),
    mowca_id: r.mowca_id,
    mowca: r.mowca,
    typ: r.typ,
    czysty: r.czysty === true || r.czysty === "t",
    zbiorcza: ETYKIETY_ZBIORCZE.includes(r.mowca),
  }));

  const outPath = path.isAbsolute(args.out) ? args.out : path.join(REPO_ROOT, args.out);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ segmenty }, null, 1) + "\n", "utf8");

  const osoby = new Map();
  for (const s of segmenty) {
    if (s.zbiorcza) continue;
    const w = osoby.get(s.mowca) ?? { sesje: new Set(), czyste: 0, sekundy: 0 };
    w.sesje.add(s.esesja_id);
    if (s.czysty && s.end - s.start >= 4) w.czyste++;
    w.sekundy += s.end - s.start;
    osoby.set(s.mowca, w);
  }
  const zdatni = [...osoby.entries()].filter(([, w]) => w.sesje.size >= 3 && w.czyste >= 10);

  console.log(`Segmentów zatwierdzonych: ${segmenty.length}`);
  console.log(`  w tym etykiety zbiorcze: ${segmenty.filter((s) => s.zbiorcza).length}`);
  console.log(`  czystych (≥4 s, w środku wypowiedzi): ${segmenty.filter((s) => s.czysty && !s.zbiorcza && s.end - s.start >= 4).length}`);
  console.log(`Osób (bez zbiorczych): ${osoby.size}, w tym z ≥3 sesji i ≥10 czystymi próbkami: ${zdatni.length}`);
  console.log(`Zapisano: ${path.relative(REPO_ROOT, outPath)}`);
}

main();
