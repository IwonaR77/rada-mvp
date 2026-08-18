#!/usr/bin/env node
// Zrzuca segmenty jednej sesji, które czekają na mówcę — wejście dla
// extract-embeddings.py (--segmenty), gdy sesji nie ma w groundtruth.
//
// Groundtruth zawiera wyłącznie segmenty JUŻ przypisane; do rozpoznawania
// potrzebne jest dokładnie to, czego tam nie ma. Stąd osobny zrzut.
//
// Domyślnie bierze tylko segmenty bez mówcy i ze statusem `open`: przypisanych
// (`finalized`) nie ruszamy, a `proposed` to cudza propozycja — jej nadpisanie
// bez decyzji człowieka podmieniałoby jedną hipotezę na drugą po cichu.
//
// Użycie:
//   node scripts/voice/dump-segments.mjs --esesja 52314 \
//       --out groq/work/glos/segmenty-52314.json [--wszystkie]
//   node scripts/voice/dump-segments.mjs --esesja 63845 --status open,proposed ...

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { supabaseQuery, REPO_ROOT } from "../lib/db.mjs";

function parseArgs(argv) {
  const args = { wszystkie: false, status: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--esesja") args.esesja = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--wszystkie") args.wszystkie = true;
    else if (argv[i] === "--status") args.status = argv[++i];
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!args.esesja || !args.out) {
    console.error("Wymagane: --esesja <id> --out <plik.json>");
    process.exit(1);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  // `--status proposed` służy do KONFRONTACJI z cudzą hipotezą (np. propozycją
  // z protokołu), a nie do jej nadpisania: zrzut niesie wtedy także nazwisko,
  // które ktoś już zaproponował, żeby dało się porównać jedno z drugim.
  const statusy = args.status
    ? args.status.split(",").map((s) => `'${s.trim()}'`).join(",")
    : null;
  const warunek = statusy
    ? `and s.status in (${statusy})`
    : args.wszystkie
      ? ""
      : `and s.status = 'open'
         and s.confirmed_councilor_id is null and s.confirmed_official_id is null`;

  const wiersze = supabaseQuery(`
    select s.id, s.start_time, s.end_time, s.status, m.date, m.esesja_id,
           coalesce(c.full_name, o.full_name) as mowca
      from segment s
      join meeting m on m.id = s.meeting_id
      left join councilor c on c.id = s.confirmed_councilor_id
      left join official o on o.id = s.confirmed_official_id
     where m.esesja_id = '${args.esesja}' ${warunek}
     order by s.start_time
     limit 20000
  `);

  const segmenty = wiersze.map((r) => ({
    id: r.id,
    esesja_id: r.esesja_id,
    date: r.date,
    start: Number(r.start_time),
    end: Number(r.end_time),
    status: r.status,
    mowca: r.mowca ?? null,
  }));

  const outPath = path.isAbsolute(args.out) ? args.out : path.join(REPO_ROOT, args.out);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ segmenty }, null, 1) + "\n", "utf8");

  const sekundy = segmenty.reduce((a, s) => a + (s.end - s.start), 0);
  console.log(`Sesja ${args.esesja}: ${segmenty.length} segmentów bez mówcy `
    + `(${(sekundy / 60).toFixed(0)} min mowy)`);
  console.log(`Zapisano: ${path.relative(REPO_ROOT, outPath)}`);
}

main();
