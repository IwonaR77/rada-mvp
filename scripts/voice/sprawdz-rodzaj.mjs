#!/usr/bin/env node
// Kontrola przypisań mówców kanałem NIEZALEŻNYM od dźwięku: polskie końcówki
// pierwszej osoby zdradzają płeć mówiącego („chciałbym" vs „chciałabym"), więc
// jeśli rozpoznawanie głosem przypisało wypowiedź osobie niewłaściwej płci,
// widać to w samym tekście.
//
// To nie jest test skuteczności — rozstrzygającą końcówkę ma kilka procent
// segmentów, a pomyłka między dwiema osobami tej samej płci przejdzie tędy bez
// echa. To tania siatka na najgrubsze błędy, do przejrzenia przed zatwierdzeniem
// partii propozycji.
//
// Przy okazji zapisuje podgląd całej sesji (czas, mówca, początek wypowiedzi)
// do przejrzenia okiem — jednym plikiem, bez klikania po interfejsie.
//
// Użycie:
//   node scripts/voice/sprawdz-rodzaj.mjs --esesja 56686
//   node scripts/voice/sprawdz-rodzaj.mjs --esesja 56686 --status proposed

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { supabaseQuery, REPO_ROOT } from "../lib/db.mjs";
// Reguły mieszkają w src/lib/rodzaj-mowcy.mjs, żeby interfejs (podświetlanie
// segmentu) i ten skrypt nie rozjechały się przy kolejnej poprawce.
import {
  sprzecznyRodzaj,
  plecPoImieniu,
  ETYKIETY_BEZ_PLCI,
} from "../../src/lib/rodzaj-mowcy.mjs";

function parseArgs(argv) {
  const args = { status: "all" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--esesja") args.esesja = argv[++i];
    else if (argv[i] === "--status") args.status = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!args.esesja) {
    console.error("Wymagane: --esesja <id> [--status proposed|finalized|all] [--out <plik>]");
    process.exit(1);
  }
  args.out ??= `groq/work/glos/podglad-${args.esesja}.txt`;
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const segmenty = supabaseQuery(`
    select s.start_time, s.status, s.text,
           coalesce(c.full_name, o.full_name) as mowca
      from segment s
      join meeting m on m.id = s.meeting_id
      left join councilor c on c.id = s.confirmed_councilor_id
      left join official o on o.id = s.confirmed_official_id
     where m.esesja_id = '${args.esesja}'
     order by s.start_time
     limit 20000
  `);

  const linie = segmenty.map((s) => {
    const t = Number(s.start_time);
    const czas = `${String(Math.floor(t / 60)).padStart(3)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    return `${czas}  ${(s.mowca ?? "—").padEnd(24)} ${(s.text ?? "").slice(0, 95)}`;
  });
  const outPath = path.isAbsolute(args.out) ? args.out : path.join(REPO_ROOT, args.out);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, linie.join("\n") + "\n", "utf8");

  let sprawdzone = 0;
  let sprzeczne = 0;
  for (const s of segmenty) {
    if (!s.mowca) continue;
    if (args.status !== "all" && s.status !== args.status) continue;

    // Etykiety zbiorcze odpadają PRZED licznikiem, nie dopiero w regule:
    // inaczej „sprawdzone" liczyłoby wypowiedzi, których ta kontrola nie jest
    // w stanie rozstrzygnąć, i sesja z wieloma gośćmi wyglądałaby na
    // prześwietloną szerzej, niż była.
    if (ETYKIETY_BEZ_PLCI.has(s.mowca)) continue;

    if (!/[aiyeęąóu]ł(am|abym|em|bym)\b/iu.test(s.text ?? "")) continue;
    sprawdzone++;
    const plec = plecPoImieniu(s.mowca);
    if (sprzecznyRodzaj(s.text ?? "", s.mowca)) {
      sprzeczne++;
      const t = Number(s.start_time);
      console.log(
        `  SPRZECZNOŚĆ ${String(Math.floor(t / 60))}:${String(Math.floor(t % 60)).padStart(2, "0")} ` +
          `${s.mowca} (${plec}): ${(s.text ?? "").slice(0, 110)}`
      );
    }
  }

  console.log(
    `\nSesja ${args.esesja}: ${segmenty.length} segmentów, ` +
      `${sprawdzone} z rozstrzygającą końcówką, sprzecznych z płcią mówcy: ${sprzeczne}`
  );
  console.log(`Podgląd: ${path.relative(REPO_ROOT, outPath)}`);
}

main();
