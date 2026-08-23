#!/usr/bin/env node
// Runner przyrostowego budowania profilu radnego — odpala
// prompty/Prompt_Profil_Radnego_{Jednorazowy,Iteracyjny}_v2.md przez `claude -p`
// (bez klucza API, subskrypcja — decyzja z planu). Jedna iteracja = jeden
// proces potomny = gwarantowany czysty kontekst, bez ręcznego zarządzania
// historią rozmowy.
//
// Katalog roboczy subprocesu to /tmp, nie repo — inaczej każde wywołanie
// zaciąga CLAUDE.md/AGENTS.md tego projektu (ostrzeżenie o Next.js) i system
// pamięci, co dokłada tysiące tokenów kosztu niezwiązanego z zadaniem.
//
// Użycie:
//   node scripts/profil/uruchom-iteracje.mjs --tryb jednorazowy --radny karol-biedrzycki [--do-sesji 7]
//   node scripts/profil/uruchom-iteracje.mjs --tryb iteracyjny --radny karol-biedrzycki --od 8 [--do 8] [--seed-stan <plik>]
//
// Wymaga wcześniejszego `node scripts/profil/eksport-wsadu.mjs --radny "..."`.
//
// Tryb iteracyjny domyślnie przetwarza WYŁĄCZNIE jedną sesję (--do = --od,
// jeśli --do nie podano) — świadome ograniczenie po incydencie 2026-08-22,
// gdy 22 iteracje poleciały pod rząd bez porównania z żadnym baseline'em po
// drodze. Przejście do kolejnej sesji wymaga jawnej zgody użytkownika, nie
// samego uruchomienia narzędzia — narzędzie samo w sobie nie ma jak tej zgody
// wymusić, ale nie ułatwia już przypadkowego pociągnięcia serii bez niej.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { REPO_ROOT } from "../lib/db.mjs";

function parseArgs(argv) {
  const args = { tryb: null, radny: null, od: 1, do: null, doSesji: null, seedStan: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tryb") args.tryb = argv[++i];
    else if (argv[i] === "--radny") args.radny = argv[++i];
    else if (argv[i] === "--od") args.od = Number(argv[++i]);
    else if (argv[i] === "--do") args.do = Number(argv[++i]);
    else if (argv[i] === "--do-sesji") args.doSesji = Number(argv[++i]);
    else if (argv[i] === "--seed-stan") args.seedStan = argv[++i];
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!args.tryb || !args.radny) {
    console.error("Wymagane: --tryb jednorazowy|iteracyjny --radny <slug>");
    process.exit(1);
  }
  if (args.do === null) args.do = args.od;
  return args;
}

function wywolajClaude(promptText, cwd) {
  const out = execFileSync(
    "claude",
    ["-p", "--output-format", "json", "--model", "sonnet", "--allowedTools", ""],
    { input: promptText, encoding: "utf8", cwd, maxBuffer: 64 * 1024 * 1024, timeout: 600000 }
  );
  return JSON.parse(out);
}

function wyciagnijJson(tekst) {
  const dopasowanie = tekst.match(/```json\s*([\s\S]*?)```/);
  if (!dopasowanie) throw new Error(`Brak bloku \`\`\`json w odpowiedzi modelu:\n${tekst.slice(0, 500)}`);
  return JSON.parse(dopasowanie[1]);
}

// Oba pliki promptów kończą się szablonem do ręcznego wklejania
// ("Radny: [imię i nazwisko]\n...") — tu go odcinamy i doklejamy realne dane.
function bazowyPrompt(nazwaPliku) {
  const pelny = readFileSync(path.join(REPO_ROOT, "prompty", nazwaPliku), "utf8");
  return pelny.split(/\n---\n\nRadny: \[imię i nazwisko\]/)[0];
}

function main() {
  const { tryb, radny, od, do: doWlacznie, doSesji, seedStan } = parseArgs(process.argv.slice(2));
  const wsadDir = path.join(REPO_ROOT, "groq", "work", "profil", radny);
  const meta = JSON.parse(readFileSync(path.join(wsadDir, "00-meta.json"), "utf8"));
  const wynikiDir = path.join(wsadDir, "wyniki");
  mkdirSync(wynikiDir, { recursive: true });

  const scratchCwd = path.join("/tmp", `profil-runner-${radny}`);
  mkdirSync(scratchCwd, { recursive: true });

  if (tryb === "jednorazowy") {
    const bazowy = bazowyPrompt("Prompt_Profil_Radnego_Jednorazowy_v2.md");
    // --do-sesji N: baseline liczony tylko z pierwszych N sesji (checkpoint
    // do porównania z krokiem iteracyjnym po tej samej sesji) — bez flagi,
    // pełny wsad z calosc.md jak dotychczas.
    const corpus = doSesji
      ? meta.sesje
          .slice(0, doSesji)
          .map((s) => readFileSync(path.join(wsadDir, s.plik), "utf8"))
          .join("\n\n===\n\n")
      : readFileSync(path.join(wsadDir, "calosc.md"), "utf8");
    const sufiks = doSesji ? `-do-sesji-${String(doSesji).padStart(2, "0")}` : "";
    const wejscie = `${bazowy}\n\n---\n\nRadny: ${meta.radny}\nKadencja: ${meta.kadencja}\n\nDane ${doSesji ? `pierwszych ${doSesji} sesji` : "wszystkich sesji"} tej kadencji (wypowiedzi, spory, sprawy, interpelacje, po kolei sesja po sesji):\n\n${corpus}`;

    console.log(
      `Jednorazowy${sufiks}: wywołuję claude -p (${Math.round(wejscie.length / 1000)} tys. znaków wejścia)...`
    );
    const start = Date.now();
    const odpowiedz = wywolajClaude(wejscie, scratchCwd);
    const czas = Math.round((Date.now() - start) / 1000);
    console.log(`Gotowe w ${czas}s, koszt: $${(odpowiedz.total_cost_usd ?? 0).toFixed(3)}`);

    writeFileSync(path.join(wynikiDir, `jednorazowy${sufiks}-surowa-odpowiedz.md`), odpowiedz.result);
    const stan = wyciagnijJson(odpowiedz.result);
    writeFileSync(path.join(wynikiDir, `jednorazowy${sufiks}-stan.json`), JSON.stringify(stan, null, 2));
    const notatka = odpowiedz.result.split("```json")[0].trim();
    writeFileSync(path.join(wynikiDir, `jednorazowy${sufiks}-notatka.md`), notatka);
    console.log(`Zapisano do ${wynikiDir}`);
    return;
  }

  if (tryb === "iteracyjny") {
    const bazowy = bazowyPrompt("Prompt_Profil_Radnego_Iteracyjny_v2.md");
    const iterDir = path.join(wynikiDir, "iter");
    mkdirSync(iterDir, { recursive: true });

    let stan = null;
    if (seedStan) {
      stan = JSON.parse(readFileSync(seedStan, "utf8"));
      console.log(`Sesja startowa ${od}: wczytano stan-seed z ${seedStan} (wyjątkowy, poza normalnym łańcuchem iter/).`);
    } else if (od > 1) {
      const poprzedniPlik = path.join(iterDir, `${String(od - 1).padStart(2, "0")}-stan.json`);
      stan = JSON.parse(readFileSync(poprzedniPlik, "utf8"));
      console.log(`Wznawiam od sesji ${od}, wczytano stan z ${poprzedniPlik}`);
    }

    console.log(`Zakres: sesje ${od}–${doWlacznie} (${doWlacznie - od + 1} wywołań). Dalej nie idzie bez ponownego uruchomienia.`);

    let calkowityKoszt = 0;
    for (let idx = od - 1; idx < doWlacznie && idx < meta.sesje.length; idx++) {
      const sesja = meta.sesje[idx];
      const tresc = readFileSync(path.join(wsadDir, sesja.plik), "utf8");
      const nrIteracji = idx + 1;

      const wejscie = `${bazowy}\n\n---\n\nRadny: ${meta.radny}\nKadencja: ${meta.kadencja}\n\nPoprzedni stan:\n\n${
        stan ? JSON.stringify(stan, null, 2) : "null — pierwsza sesja"
      }\n\nNowa sesja (dane pełne — wypowiedzi, spory, sprawy, interpelacje, jeśli występują):\n\n${tresc}`;

      process.stdout.write(`[${nrIteracji}/${meta.sesje.length}] ${sesja.data} — `);
      const start = Date.now();
      const odpowiedz = wywolajClaude(wejscie, scratchCwd);
      const czas = Math.round((Date.now() - start) / 1000);
      calkowityKoszt += odpowiedz.total_cost_usd ?? 0;
      console.log(
        `${czas}s, $${(odpowiedz.total_cost_usd ?? 0).toFixed(3)} (suma: $${calkowityKoszt.toFixed(2)})`
      );

      stan = wyciagnijJson(odpowiedz.result);
      writeFileSync(
        path.join(iterDir, `${String(nrIteracji).padStart(2, "0")}-stan.json`),
        JSON.stringify(stan, null, 2)
      );
      writeFileSync(
        path.join(iterDir, `${String(nrIteracji).padStart(2, "0")}-surowa-odpowiedz.md`),
        odpowiedz.result
      );
    }

    // "final" tylko gdy naprawdę doszliśmy do ostatniej sesji kadencji —
    // inaczej councilor-profile.tsx (który woli ten plik nad najświeższym
    // iter/NN-stan.json) pokazałby przedwczesny stan jako gotowy wynik.
    const toNaprawdeKoniec = doWlacznie >= meta.sesje.length;
    if (toNaprawdeKoniec) {
      writeFileSync(path.join(wynikiDir, "iteracyjny-stan-final.json"), JSON.stringify(stan, null, 2));
    }
    console.log(
      `Gotowe (sesje ${od}–${Math.min(doWlacznie, meta.sesje.length)} z ${meta.sesje.length}). Łączny koszt: $${calkowityKoszt.toFixed(2)}.` +
        (toNaprawdeKoniec
          ? ` Finalny stan: ${wynikiDir}/iteracyjny-stan-final.json`
          : ` Stan kroku: ${iterDir}/${String(Math.min(doWlacznie, meta.sesje.length)).padStart(2, "0")}-stan.json`)
    );
    return;
  }

  console.error(`Nieznany tryb: ${tryb}`);
  process.exit(1);
}

main();
