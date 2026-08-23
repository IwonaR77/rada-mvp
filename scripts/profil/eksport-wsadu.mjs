#!/usr/bin/env node
// Eksport wsadu do przyrostowego budowania profilu radnego
// (prompty/Prompt_Profil_Radnego_Iteracyjny_v1.md i .../Jednorazowy_v1.md).
//
// Dla jednego radnego: jeden plik markdown na sesję jego kadencji (wypowiedzi
// sklejone w bloki jak na /radny/[id], kontekst przed/po ≤300 znaków, fragment
// "Spory i dyskusje" gdy radny wymieniony z nazwiska, powiązane sprawy),
// 00-meta.json (lista sesji + interpelacje + otagowanie) i calosc.md
// (konkatenacja wszystkich sesji — wsad promptu jednorazowego/baseline).
//
// Budowanie treści jednej sesji (bloki/kontekst/spory/sprawy/interpelacje)
// woła scripts/lib/profil-eksport.mjs — ten sam kod, którego używa runner
// produkcyjny scripts/profil/wdroz-produkcyjnie.mjs, działający wprost na
// bazie bez plików pośrednich. Ten skrypt zostaje jako narzędzie
// diagnostyczne/eksperymentalne (pliki do ręcznej inspekcji w groq/work/profil/).
//
// Użycie:
//   node scripts/profil/eksport-wsadu.mjs --radny "Karol Biedrzycki"

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../lib/db.mjs";
import { zbudujDaneRadnego, trescSesji } from "../lib/profil-eksport.mjs";
import { slugifyRadny } from "../../src/lib/profil-slug.ts";

const NAZWA_RADY = "Rada Miejska w Grójcu";

function parseArgs(argv) {
  const args = { radny: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--radny") args.radny = argv[++i];
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!args.radny) {
    console.error('Wymagane: --radny "Imię Nazwisko"');
    process.exit(1);
  }
  return args;
}

function main() {
  const { radny } = parseArgs(process.argv.slice(2));

  const dane = zbudujDaneRadnego(NAZWA_RADY, radny);
  const { councilor, termRow, meetings, interpelacje } = dane;

  const dirName = slugifyRadny(councilor.full_name);
  const outDir = path.join(REPO_ROOT, "groq", "work", "profil", dirName);
  mkdirSync(outDir, { recursive: true });

  const meta = [];
  const sessionFiles = [];

  meetings.forEach((meeting, idx) => {
    const nrPliku = String(idx + 1).padStart(2, "0");
    const { tresc, liczbaBlokowRadnego, procentOtagowania } = trescSesji(dane, idx);

    const nazwaPliku = `s${nrPliku}-${meeting.date}.md`;
    writeFileSync(path.join(outDir, nazwaPliku), tresc + "\n");
    sessionFiles.push(nazwaPliku);

    meta.push({
      plik: nazwaPliku,
      meeting_id: meeting.id,
      data: meeting.date,
      tytul: meeting.title,
      esesja_id: meeting.esesja_id,
      procent_otagowania: procentOtagowania,
      liczba_blokow_radnego: liczbaBlokowRadnego,
    });
  });

  writeFileSync(
    path.join(outDir, "00-meta.json"),
    JSON.stringify(
      {
        radny: councilor.full_name,
        councilor_id: councilor.id,
        kadencja: termRow.label,
        term_id: termRow.term_id,
        liczba_sesji: meetings.length,
        liczba_sesji_z_wypowiedziami: meta.filter((m) => m.liczba_blokow_radnego > 0).length,
        interpelacje_wszystkie: interpelacje.map((i) => ({
          data: i.submitted_date,
          tytul: i.title,
          streszczenie: i.summary,
        })),
        sesje: meta,
      },
      null,
      2
    )
  );

  const calosc = sessionFiles
    .map((f) => readFileSync(path.join(outDir, f), "utf8"))
    .join("\n\n===\n\n");
  writeFileSync(path.join(outDir, "calosc.md"), calosc);

  console.log(
    `Zapisano ${sessionFiles.length} plików sesji (${meta.filter((m) => m.liczba_blokow_radnego > 0).length} z wypowiedziami) + 00-meta.json + calosc.md do ${outDir}`
  );
}

main();
