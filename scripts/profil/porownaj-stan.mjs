#!/usr/bin/env node
// Porównanie dwóch stanów profilu radnego (Etap 4 planu przyrostowego —
// zbudowane 2026-08-23 po tym, jak 22 iteracje poleciały pod rząd BEZ tego
// narzędzia i bez baseline'u po drodze, co unieważniło sens eksperymentu).
//
// Deterministyczne, bez żadnego kolejnego wywołania modelu — cel jest taki,
// żeby ten krok nic nie kosztował i dawał się uruchamiać po każdej sesji.
//
// Sprawdza trzy rzeczy naraz:
// 1. Dopasowanie tez między dwoma stanami (Dice na bigramach znakowych,
//    dobór zachłanny) → precision/recall/F1 — "czy dwie ścieżki widzą te
//    same tematy".
// 2. Twarde kontrole: liczby wpisów w każdej kategorii, zbiór nazw spraw,
//    obecność słów z czarnej listy v6 (przymiotniki/rzeczowniki oceniające).
// 3. Kotwice — każdy cytat musi się dosłownie znaleźć w pliku źródłowym
//    sesji, którą cytuje (groq/work/profil/<radny>/sNN-*.md). Zerwana
//    kotwica to odpowiedź na "jak nie utrwalać pomyłki" z backlogu.
//
// Użycie:
//   node scripts/profil/porownaj-stan.mjs --radny karol-biedrzycki \
//     --a wyniki/jednorazowy-do-sesji-08-stan.json --etykieta-a "baseline (1-8)" \
//     --b wyniki/iter/08-stan.json --etykieta-b "iteracyjny (krok 8)"

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../lib/db.mjs";
import { dice } from "../../src/lib/text-similarity.ts";

function parseArgs(argv) {
  const args = { radny: null, a: null, b: null, etykietaA: "A", etykietaB: "B", prog: 0.5 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--radny") args.radny = argv[++i];
    else if (argv[i] === "--a") args.a = argv[++i];
    else if (argv[i] === "--b") args.b = argv[++i];
    else if (argv[i] === "--etykieta-a") args.etykietaA = argv[++i];
    else if (argv[i] === "--etykieta-b") args.etykietaB = argv[++i];
    else if (argv[i] === "--prog") args.prog = Number(argv[++i]);
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!args.radny || !args.a || !args.b) {
    console.error("Wymagane: --radny <slug> --a <stan.json> --b <stan.json>");
    process.exit(1);
  }
  return args;
}

function wczytaj(p) {
  return JSON.parse(readFileSync(path.isAbsolute(p) ? p : path.join(REPO_ROOT, p), "utf8"));
}

/** Dopasowanie zachłanne: dla każdej tezy z A szuka najlepszej wolnej tezy z B. */
function dopasujTematy(tematyA, tematyB, prog) {
  const pary = [];
  for (const ta of tematyA) {
    for (const tb of tematyB) {
      pary.push({ ta, tb, wynik: dice(ta.teza, tb.teza) });
    }
  }
  pary.sort((x, y) => y.wynik - x.wynik);

  const uzyteA = new Set();
  const uzyteB = new Set();
  const dopasowania = [];
  for (const p of pary) {
    if (p.wynik < prog) break;
    if (uzyteA.has(p.ta.id) || uzyteB.has(p.tb.id)) continue;
    uzyteA.add(p.ta.id);
    uzyteB.add(p.tb.id);
    dopasowania.push(p);
  }

  const tylkoA = tematyA.filter((t) => !uzyteA.has(t.id));
  const tylkoB = tematyB.filter((t) => !uzyteB.has(t.id));
  return { dopasowania, tylkoA, tylkoB };
}

function precisionRecallF1(dopasowania, tylkoA, tylkoB) {
  const tp = dopasowania.length;
  const recall = tp + tylkoA.length > 0 ? tp / (tp + tylkoA.length) : 1;
  const precision = tp + tylkoB.length > 0 ? tp / (tp + tylkoB.length) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

// Czarna lista z Prompt_Ocena_Radnych_v6.md — na wypadek gdyby model mimo
// instrukcji wsunął ocenę do samej `teza`/`temat`/`stanowiska` zamiast
// neutralnego opisu czynności.
const CZARNA_LISTA = [
  "aktywny", "aktywna", "aktywnie", "wycofany", "wycofana", "konfliktowy", "konfliktowa",
  "konstruktywny", "konstruktywna", "zaangażowany", "zaangażowana", "bierny", "bierna",
  "skuteczny", "skuteczna", "nieskuteczny", "nieskuteczna",
];

function normalizujDoPorownania(tekst) {
  return tekst
    .toLocaleLowerCase("pl-PL")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function zbierzCaleTezy(stan) {
  const teksty = [];
  for (const t of stan.tematy ?? []) teksty.push(t.teza);
  for (const s of stan.spory ?? []) teksty.push(s.temat, s.stanowiska);
  return teksty;
}

function sprawdzCzarnaListe(stan, etykieta) {
  const trafienia = [];
  for (const tekst of zbierzCaleTezy(stan)) {
    const znorm = normalizujDoPorownania(tekst);
    for (const slowo of CZARNA_LISTA) {
      if (new RegExp(`\\b${slowo}\\b`).test(znorm)) {
        trafienia.push({ slowo, fragment: tekst.slice(0, 80) });
      }
    }
  }
  if (trafienia.length > 0) {
    console.log(`\n⚠ Czarna lista — trafienia w ${etykieta}:`);
    for (const t of trafienia) console.log(`  „${t.slowo}" w: ${t.fragment}...`);
  }
  return trafienia;
}

// `po_mowil_o` ma być TA SAMA treść co `teza`, tylko w innym przypadku —
// jeśli bigramowe podobieństwo jest niskie, model raczej sparafrazował niż
// odmienił, co podważa sens tego pola (zob. dyskusja o "teza vs po_mowil_o"
// w Prompt_Profil_Radnego_Iteracyjny_v2.md).
const PROG_ZGODNOSCI_ODMIANY = 0.3;

function sprawdzOdmiane(stan, etykieta) {
  const podejrzane = [];
  for (const t of stan.tematy ?? []) {
    if (!t.po_mowil_o) continue;
    const wynik = dice(t.teza, t.po_mowil_o);
    if (wynik < PROG_ZGODNOSCI_ODMIANY) {
      podejrzane.push({ teza: t.teza, po_mowil_o: t.po_mowil_o, wynik });
    }
  }
  if (podejrzane.length > 0) {
    console.log(`\n⚠ Podejrzana odmiana (teza vs po_mowil_o) w ${etykieta}:`);
    for (const p of podejrzane) {
      console.log(`  „${p.teza}" → „${p.po_mowil_o}" (podobieństwo ${p.wynik.toFixed(2)})`);
    }
  }
  return podejrzane;
}

/** Zbiera wszystkie {sesja, kotwica} z dowolnej kategorii stanu, pomijając puste. */
function zbierzKotwice(stan) {
  const wpisy = [];
  for (const t of stan.tematy ?? []) {
    if (t.kotwica?.cytat) wpisy.push({ sesja: t.kotwica.sesja, cytat: t.kotwica.cytat, zrodlo: `temat „${t.teza}"` });
  }
  for (const forma of Object.values(stan.udzial_forma ?? {})) {
    for (const p of forma.przyklady ?? []) {
      if (p.kotwica) wpisy.push({ sesja: p.sesja, cytat: p.kotwica, zrodlo: `udział (${p.opis ?? p.punkt ?? "?"})` });
    }
  }
  for (const m of stan.mieszkancy ?? []) {
    if (m.kotwica) wpisy.push({ sesja: m.sesja, cytat: m.kotwica, zrodlo: `mieszkańcy: ${m.temat}` });
  }
  for (const s of stan.spory ?? []) {
    if (s.kotwica) wpisy.push({ sesja: s.sesja, cytat: s.kotwica, zrodlo: `spór: ${s.temat}` });
  }
  return wpisy;
}

function znajdzPlikSesji(wsadDir, dataSesji) {
  const pliki = readdirSync(wsadDir).filter((f) => f.includes(dataSesji) && f.endsWith(".md"));
  return pliki[0] ?? null;
}

function sprawdzKotwice(stan, wsadDir, etykieta) {
  const wpisy = zbierzKotwice(stan);
  const zerwane = [];
  const cachePlikow = new Map();

  for (const w of wpisy) {
    const nazwaPliku = znajdzPlikSesji(wsadDir, w.sesja);
    if (!nazwaPliku) {
      zerwane.push({ ...w, powod: "brak pliku źródłowego dla tej daty sesji" });
      continue;
    }
    if (!cachePlikow.has(nazwaPliku)) {
      cachePlikow.set(nazwaPliku, normalizujDoPorownania(readFileSync(path.join(wsadDir, nazwaPliku), "utf8")));
    }
    const zrodlo = cachePlikow.get(nazwaPliku);
    const cytatZnorm = normalizujDoPorownania(w.cytat);
    if (!zrodlo.includes(cytatZnorm)) {
      zerwane.push({ ...w, powod: `nie znaleziono w ${nazwaPliku}` });
    }
  }

  console.log(`\nKotwice w ${etykieta}: ${wpisy.length} łącznie, ${zerwane.length} zerwanych.`);
  for (const z of zerwane) {
    console.log(`  ✗ [${z.sesja}] ${z.zrodlo} — „${z.cytat.slice(0, 70)}..." (${z.powod})`);
  }
  return { total: wpisy.length, zerwane };
}

function main() {
  const { radny, a, b, etykietaA, etykietaB, prog } = parseArgs(process.argv.slice(2));
  const wsadDir = path.join(REPO_ROOT, "groq", "work", "profil", radny);

  const stanA = wczytaj(a);
  const stanB = wczytaj(b);

  console.log(`=== Porównanie: ${etykietaA} vs ${etykietaB} (radny: ${stanA.radny ?? radny}) ===\n`);

  console.log("Liczby wpisów:");
  console.log(`  ${"kategoria".padEnd(24)}${etykietaA.padEnd(20)}${etykietaB}`);
  for (const klucz of ["tematy", "spory", "mieszkancy", "interpelacje_powiazane", "odrzucone"]) {
    console.log(`  ${klucz.padEnd(24)}${String((stanA[klucz] ?? []).length).padEnd(20)}${(stanB[klucz] ?? []).length}`);
  }

  const { dopasowania, tylkoA, tylkoB } = dopasujTematy(stanA.tematy ?? [], stanB.tematy ?? [], prog);
  const { precision, recall, f1 } = precisionRecallF1(dopasowania, tylkoA, tylkoB);

  console.log(
    `\nDopasowanie tez (próg Dice ${prog}): precision=${precision.toFixed(2)} recall=${recall.toFixed(2)} F1=${f1.toFixed(2)}`
  );
  console.log(`  ${dopasowania.length} dopasowanych, ${tylkoA.length} tylko w ${etykietaA}, ${tylkoB.length} tylko w ${etykietaB}`);
  if (tylkoA.length > 0) {
    console.log(`\n  Tylko w ${etykietaA} (baseline widzi, druga strona nie):`);
    for (const t of tylkoA) console.log(`    - ${t.teza}`);
  }
  if (tylkoB.length > 0) {
    console.log(`\n  Tylko w ${etykietaB}:`);
    for (const t of tylkoB) console.log(`    - ${t.teza}`);
  }

  const sprawyA = new Set((stanA.tematy ?? []).map((t) => t.sprawa).filter(Boolean));
  const sprawyB = new Set((stanB.tematy ?? []).map((t) => t.sprawa).filter(Boolean));
  const sprawyTylkoA = [...sprawyA].filter((s) => !sprawyB.has(s));
  const sprawyTylkoB = [...sprawyB].filter((s) => !sprawyA.has(s));
  if (sprawyTylkoA.length > 0 || sprawyTylkoB.length > 0) {
    console.log(`\nRóżnica w nazwach spraw:`);
    if (sprawyTylkoA.length > 0) console.log(`  tylko w ${etykietaA}: ${sprawyTylkoA.join("; ")}`);
    if (sprawyTylkoB.length > 0) console.log(`  tylko w ${etykietaB}: ${sprawyTylkoB.join("; ")}`);
  }

  sprawdzCzarnaListe(stanA, etykietaA);
  sprawdzCzarnaListe(stanB, etykietaB);
  sprawdzOdmiane(stanA, etykietaA);
  sprawdzOdmiane(stanB, etykietaB);

  const kotwiceA = sprawdzKotwice(stanA, wsadDir, etykietaA);
  const kotwiceB = sprawdzKotwice(stanB, wsadDir, etykietaB);

  console.log(`\n=== Podsumowanie ===`);
  console.log(`F1 tez: ${f1.toFixed(2)}`);
  console.log(`Zerwane kotwice: ${kotwiceA.zerwane.length + kotwiceB.zerwane.length} / ${kotwiceA.total + kotwiceB.total}`);
  console.log(
    f1 >= 0.85 && kotwiceA.zerwane.length === 0 && kotwiceB.zerwane.length === 0
      ? "PRÓG SPEŁNIONY (F1≥0,85, zero zerwanych kotwic) — wg kryterium z planu."
      : "Próg NIE spełniony — patrz różnice wyżej przed decyzją o kolejnym kroku."
  );
}

main();
