#!/usr/bin/env node
// Pokazuje posiedzenia komisji bez protokołu i zapisuje gotowy wniosek do pliku.
//
// TEN SKRYPT NICZEGO NIE WYSYŁA ani nie zmienia stanu w bazie — czyta i pisze
// plik do gitignorowanego `wnioski/`. Wersję roboczą w Gmailu zakłada osobny
// skrypt (`wniosek-do-gmaila.mjs`), a wysyła zawsze człowiek.
//
// Czyta z bazy, nie ze strony: harmonogram wprowadza `sync-komisje.mjs`, a
// tutaj liczy się jeszcze to, o co już pytaliśmy — czego strona esesji nie wie.
//
//   node scripts/komisje-bez-protokolu.mjs [--dni 21]

import { writeFileSync, mkdirSync } from "node:fs";
import {
  zalegleposiedzenia,
  trescWniosku,
  temat,
  PROG_DNI,
} from "./lib/foi.mjs";

const COUNCIL_ID = "846c8bce-7f11-4825-91dd-fe80cedf5289";
const KATALOG = "wnioski";

function arg(nazwa, domyslna) {
  const i = process.argv.indexOf(`--${nazwa}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : domyslna;
}

async function main() {
  const progDni = Number(arg("dni", PROG_DNI));
  const od = arg("od", null);
  const wszystkie = await zalegleposiedzenia(COUNCIL_ID, progDni);
  // Zaległość z całej kadencji to inna sprawa niż bieżące pilnowanie: wniosek
  // o 92 protokoły z dwóch lat urząd może potraktować jako informację
  // przetworzoną i zażądać wykazania szczególnie istotnego interesu
  // publicznego, zamiast po prostu odpowiedzieć. `--od` pozwala pociąć to na
  // porcje; automat po nadrobieniu zaległości i tak będzie miał po kilka
  // pozycji na raz.
  const zalegle = od ? wszystkie.filter((p) => p.date >= od) : wszystkie;

  if (zalegle.length === 0) {
    console.log(
      `Brak posiedzeń bez protokołu starszych niż ${progDni} dni, o które jeszcze nie pytaliśmy.`
    );
    return;
  }

  console.log(
    `Posiedzenia bez protokołu starsze niż ${progDni} dni, bez złożonego wniosku: ${zalegle.length}\n`
  );
  for (const p of zalegle) {
    console.log(`  ${p.date}  ${p.komisja}${p.number ? ` (nr ${p.number})` : ""}`);
  }

  mkdirSync(KATALOG, { recursive: true });
  const plik = `${KATALOG}/wniosek-komisje-${new Date().toISOString().slice(0, 10)}.txt`;
  writeFileSync(plik, `Temat: ${temat(zalegle)}\n\n${trescWniosku(zalegle)}`, "utf-8");
  console.log(`\nWniosek zbiorczy na ${zalegle.length} posiedzeń: ${plik}`);
  console.log("Nic nie zostało wysłane, baza nietknięta.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
