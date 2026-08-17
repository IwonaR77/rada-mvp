#!/usr/bin/env node
// Odtwarza przypisania mówców na NOWEJ transkrypcji tej samej sesji, ze zrzutu
// zrobionego przez scripts/save-segment-assignments.mjs.
//
// Nowa transkrypcja tnie nagranie inaczej, więc jedyne, co łączy stare
// segmenty z nowymi, to oś czasu nagrania — ta sama w obu, bo źródło to ten
// sam plik wideo. Dopasowanie idzie po pokryciu czasowym: nowy segment
// dostaje mówcę, którego stare zatwierdzone segmenty pokrywają co najmniej
// połowę jego długości i co najmniej dwa razy więcej niż kolejny kandydat.
// Reszta zostaje `open` — lepiej zostawić do ręcznego oznaczenia niż zgadywać.
//
// Świadomie NIE sklejamy sąsiednich segmentów tego samego mówcy w bloki:
// w luce między nimi mogła być mowa, której stara transkrypcja nie złapała,
// a której nikt nie zatwierdził. Cisza między starymi segmentami nie jest
// niczyja.
//
// Kontrola na rozjechane znaczniki czasu: dla każdego dopasowania liczymy
// pokrycie słów starego i nowego tekstu w tym samym oknie. Jeśli mediana
// spada, to znak, że osie czasu się nie zgadzają i dopasowanie po czasie
// nie ma sensu — wtedy skrypt sam nie zapisze (patrz --mimo-rozjazdu).
//
// Użycie:
//   node scripts/restore-segment-assignments.mjs backups/przypisania-<...>.json
//   node scripts/restore-segment-assignments.mjs <plik.json> --zapisz
//
// Bez --zapisz to sucha próba: liczy, raportuje, nie rusza bazy.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { supabaseQuery, supabaseExec, sqlText } from "./lib/db.mjs";

const MIN_POKRYCIE = 0.5; // ułamek długości nowego segmentu, jaki musi pokryć zwycięzca
const MIN_PRZEWAGA = 2.0; // ile razy zwycięzca musi wyprzedzić drugiego kandydata
const MIN_PODOBIENSTWO = 0.5; // mediana pokrycia słów, poniżej której podejrzewamy rozjazd
const PACZKA = 500;
const PACZKA_UPDATE = 200;

function parseArgs(argv) {
  const args = { plik: null, zapisz: false, mimoRozjazdu: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--zapisz") args.zapisz = true;
    else if (a === "--mimo-rozjazdu") args.mimoRozjazdu = true;
    else if (!a.startsWith("--")) args.plik = a;
    else {
      console.error(`Nieznana flaga: ${a}`);
      process.exit(1);
    }
  }
  if (!args.plik) {
    console.error(
      "Użycie: node scripts/restore-segment-assignments.mjs <przypisania.json> [--zapisz]"
    );
    process.exit(1);
  }
  return args;
}

function pobierzSegmenty(meetingId) {
  const wszystkie = [];
  for (let offset = 0; ; offset += PACZKA) {
    const paczka = supabaseQuery(
      `select id, start_time, end_time, text, status,
              confirmed_councilor_id, confirmed_official_id
         from segment
        where meeting_id = ${sqlText(meetingId)}
        order by start_time, id
        limit ${PACZKA} offset ${offset};`
    );
    wszystkie.push(...paczka);
    if (paczka.length < PACZKA) break;
  }
  return wszystkie.map((s) => ({
    ...s,
    start_time: Number(s.start_time),
    end_time: Number(s.end_time),
  }));
}

const kluczMowcy = (a) => `${a.confirmed_councilor_id ?? ""}|${a.confirmed_official_id ?? ""}`;

function slowa(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

/** Ułamek słów nowego segmentu obecnych w starym tekście z tego samego okna. */
function podobienstwo(nowyText, staryText) {
  const a = slowa(nowyText);
  const b = slowa(staryText);
  if (a.size === 0 || b.size === 0) return null;
  let wspolne = 0;
  for (const w of a) if (b.has(w)) wspolne++;
  return wspolne / a.size;
}

function mediana(liczby) {
  if (liczby.length === 0) return null;
  const s = [...liczby].sort((x, y) => x - y);
  const p = Math.floor(s.length / 2);
  return s.length % 2 ? s[p] : (s[p - 1] + s[p]) / 2;
}

/**
 * Dopasowuje stare przypisania do nowych segmentów po pokryciu czasowym.
 * Czysta funkcja — bez bazy, żeby dało się ją sprawdzić na danych z palca.
 */
export function dopasujPrzypisania(nowe, stare) {
  // Dwa wskaźniki po posortowanych tablicach zamiast porównywania każdego
  // z każdym: przy ~1000 nowych i ~330 starych segmentach różnica jest bez
  // znaczenia, ale okno „stare segmenty stykające się z tym nowym" i tak jest
  // potrzebne do kontroli tekstu, więc lepiej mieć je wprost.
  const posortowaneStare = [...stare].sort((a, b) => a.start_time - b.start_time);
  let pierwszy = 0;

  const doZapisu = [];
  const podobienstwa = [];
  const powody = { poza_zakresem: 0, za_male_pokrycie: 0, niejednoznaczne: 0, juz_finalized: 0 };
  const zakresOd = posortowaneStare[0].start_time;
  const zakresDo = posortowaneStare.at(-1).end_time;

  for (const nowy of nowe) {
    if (nowy.status === "finalized") {
      powody.juz_finalized++;
      continue;
    }
    const dlugosc = nowy.end_time - nowy.start_time;
    if (dlugosc <= 0) continue;

    while (
      pierwszy < posortowaneStare.length &&
      posortowaneStare[pierwszy].end_time <= nowy.start_time
    ) {
      pierwszy++;
    }

    const pokrycie = new Map(); // klucz mówcy → sekundy pokrycia
    const okno = [];
    for (let i = pierwszy; i < posortowaneStare.length; i++) {
      const stary = posortowaneStare[i];
      if (stary.start_time >= nowy.end_time) break;
      const wspolne =
        Math.min(nowy.end_time, stary.end_time) - Math.max(nowy.start_time, stary.start_time);
      if (wspolne <= 0) continue;
      const k = kluczMowcy(stary);
      pokrycie.set(k, (pokrycie.get(k) ?? 0) + wspolne);
      okno.push(stary);
    }

    if (pokrycie.size === 0) {
      if (nowy.end_time < zakresOd || nowy.start_time > zakresDo) powody.poza_zakresem++;
      else powody.za_male_pokrycie++;
      continue;
    }

    const ranking = [...pokrycie.entries()].sort((a, b) => b[1] - a[1]);
    const [klucz, ile] = ranking[0];
    const drugi = ranking[1]?.[1] ?? 0;

    if (ile < MIN_POKRYCIE * dlugosc) {
      powody.za_male_pokrycie++;
      continue;
    }
    if (drugi > 0 && ile < MIN_PRZEWAGA * drugi) {
      powody.niejednoznaczne++;
      continue;
    }

    const wzorzec = okno.find((s) => kluczMowcy(s) === klucz);
    const p = podobienstwo(nowy.text, okno.map((s) => s.text).join(" "));
    if (p !== null) podobienstwa.push(p);

    doZapisu.push({
      id: nowy.id,
      confirmed_councilor_id: wzorzec.confirmed_councilor_id,
      confirmed_official_id: wzorzec.confirmed_official_id,
      finalized_by: wzorzec.finalized_by,
      finalized_at: wzorzec.finalized_at,
    });
  }

  return { doZapisu, podobienstwa, powody };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const zrzut = JSON.parse(readFileSync(args.plik, "utf8"));
  const stare = zrzut.przypisania ?? [];

  if (stare.length === 0) {
    console.error("Zrzut nie zawiera żadnych przypisań.");
    process.exit(1);
  }

  const nowe = pobierzSegmenty(zrzut.meeting_id);
  if (nowe.length === 0) {
    console.error(
      "Ta sesja nie ma teraz żadnych segmentów — najpierw zaimportuj nową transkrypcję."
    );
    process.exit(1);
  }

  const juzPrzypisane = nowe.filter((s) => s.status === "finalized").length;
  if (juzPrzypisane > 0) {
    console.log(
      `Uwaga: ${juzPrzypisane} segmentów jest już zatwierdzonych — zostaną pominięte.`
    );
  }

  const { doZapisu, podobienstwa, powody } = dopasujPrzypisania(nowe, stare);
  const med = mediana(podobienstwa);
  const czasStary = stare.reduce((s, x) => s + (x.end_time - x.start_time), 0);
  const dopasowane = new Set(doZapisu.map((d) => d.id));
  const czasNowy = nowe
    .filter((n) => dopasowane.has(n.id))
    .reduce((s, x) => s + (x.end_time - x.start_time), 0);

  console.log(`Sesja: ${zrzut.title ?? zrzut.date} (${zrzut.meeting_id})`);
  console.log(`Zrzut: ${stare.length} zatwierdzonych segmentów, ${(czasStary / 60).toFixed(1)} min`);
  console.log(`W bazie teraz: ${nowe.length} segmentów`);
  console.log(
    `Dopasowano: ${doZapisu.length} segmentów, ${(czasNowy / 60).toFixed(1)} min ` +
      `(${((czasNowy / czasStary) * 100).toFixed(0)}% odtworzonego czasu)`
  );
  console.log(
    `Bez dopasowania — poza zakresem zrzutu: ${powody.poza_zakresem}, ` +
      `za małe pokrycie: ${powody.za_male_pokrycie}, ` +
      `niejednoznaczne: ${powody.niejednoznaczne}, już zatwierdzone: ${powody.juz_finalized}`
  );
  console.log(
    `Zgodność tekstu (mediana pokrycia słów): ${med === null ? "brak danych" : med.toFixed(2)}`
  );

  if (med !== null && med < MIN_PODOBIENSTWO) {
    console.log(
      `\nTeksty nie zgadzają się w tych samych oknach czasowych — to wygląda na ` +
        `rozjazd osi czasu, a nie na inne cięcie segmentów. Sprawdź ręcznie przed zapisem.`
    );
    if (args.zapisz && !args.mimoRozjazdu) {
      console.error("Nie zapisuję. Świadomy zapis: dopisz --mimo-rozjazdu.");
      process.exit(1);
    }
  }

  if (!args.zapisz) {
    console.log("\nSucha próba — nic nie zapisano. Zapis: dopisz --zapisz.");
    return;
  }
  if (doZapisu.length === 0) {
    console.log("\nNie ma czego zapisać.");
    return;
  }

  for (let i = 0; i < doZapisu.length; i += PACZKA_UPDATE) {
    const paczka = doZapisu.slice(i, i + PACZKA_UPDATE);
    const values = paczka
      .map(
        (d) =>
          `(${sqlText(d.id)},${sqlText(d.confirmed_councilor_id)},` +
          `${sqlText(d.confirmed_official_id)},${sqlText(d.finalized_by)},${sqlText(d.finalized_at)})`
      )
      .join(",");
    supabaseExec(
      `update segment s
          set confirmed_councilor_id = v.cid::uuid,
              confirmed_official_id = v.oid::uuid,
              finalized_by = v.fby::uuid,
              finalized_at = v.fat::timestamptz,
              status = 'finalized'
         from (values ${values}) as v(id, cid, oid, fby, fat)
        where s.id = v.id::uuid;`
    );
  }

  console.log(`\nZapisano przypisania dla ${doZapisu.length} segmentów.`);
}

// Uruchamiamy main() tylko z linii poleceń — sam import (test dopasowania)
// nie ma dotykać bazy.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
