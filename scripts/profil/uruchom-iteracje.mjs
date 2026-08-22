#!/usr/bin/env node
// Runner przyrostowego budowania profilu radnego — odpala
// prompty/Prompt_Profil_Radnego_{Jednorazowy,Iteracyjny}_v1.md przez `claude -p`
// (bez klucza API, subskrypcja — decyzja z planu). Jedna iteracja = jeden
// proces potomny = gwarantowany czysty kontekst, bez ręcznego zarządzania
// historią rozmowy.
//
// Katalog roboczy subprocesu to /tmp, nie repo — inaczej każde wywołanie
// zaciąga CLAUDE.md/AGENTS.md tego projektu (ostrzeżenie o Next.js) i system
// pamięci, co dokłada tysiące tokenów kosztu niezwiązanego z zadaniem.
//
// Użycie:
//   node scripts/profil/uruchom-iteracje.mjs --tryb jednorazowy --radny karol-biedrzycki
//   node scripts/profil/uruchom-iteracje.mjs --tryb iteracyjny --radny karol-biedrzycki [--od 5]
//
// Wymaga wcześniejszego `node scripts/profil/eksport-wsadu.mjs --radny "..."`.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { REPO_ROOT } from "../lib/db.mjs";

function parseArgs(argv) {
  const args = { tryb: null, radny: null, od: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tryb") args.tryb = argv[++i];
    else if (argv[i] === "--radny") args.radny = argv[++i];
    else if (argv[i] === "--od") args.od = Number(argv[++i]);
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!args.tryb || !args.radny) {
    console.error("Wymagane: --tryb jednorazowy|iteracyjny --radny <slug>");
    process.exit(1);
  }
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
  const { tryb, radny, od } = parseArgs(process.argv.slice(2));
  const wsadDir = path.join(REPO_ROOT, "groq", "work", "profil", radny);
  const meta = JSON.parse(readFileSync(path.join(wsadDir, "00-meta.json"), "utf8"));
  const wynikiDir = path.join(wsadDir, "wyniki");
  mkdirSync(wynikiDir, { recursive: true });

  const scratchCwd = path.join("/tmp", `profil-runner-${radny}`);
  mkdirSync(scratchCwd, { recursive: true });

  if (tryb === "jednorazowy") {
    const bazowy = bazowyPrompt("Prompt_Profil_Radnego_Jednorazowy_v1.md");
    const calosc = readFileSync(path.join(wsadDir, "calosc.md"), "utf8");
    const wejscie = `${bazowy}\n\n---\n\nRadny: ${meta.radny}\nKadencja: ${meta.kadencja}\n\nDane wszystkich sesji tej kadencji (wypowiedzi, spory, sprawy, interpelacje, po kolei sesja po sesji):\n\n${calosc}`;

    console.log(
      `Jednorazowy: wywołuję claude -p (${Math.round(wejscie.length / 1000)} tys. znaków wejścia)...`
    );
    const start = Date.now();
    const odpowiedz = wywolajClaude(wejscie, scratchCwd);
    const czas = Math.round((Date.now() - start) / 1000);
    console.log(`Gotowe w ${czas}s, koszt: $${(odpowiedz.total_cost_usd ?? 0).toFixed(3)}`);

    writeFileSync(path.join(wynikiDir, "jednorazowy-surowa-odpowiedz.md"), odpowiedz.result);
    const stan = wyciagnijJson(odpowiedz.result);
    writeFileSync(path.join(wynikiDir, "jednorazowy-stan.json"), JSON.stringify(stan, null, 2));
    const notatka = odpowiedz.result.split("```json")[0].trim();
    writeFileSync(path.join(wynikiDir, "jednorazowy-notatka.md"), notatka);
    console.log(`Zapisano do ${wynikiDir}`);
    return;
  }

  if (tryb === "iteracyjny") {
    const bazowy = bazowyPrompt("Prompt_Profil_Radnego_Iteracyjny_v1.md");
    const iterDir = path.join(wynikiDir, "iter");
    mkdirSync(iterDir, { recursive: true });

    let stan = null;
    if (od > 1) {
      const poprzedniPlik = path.join(iterDir, `${String(od - 1).padStart(2, "0")}-stan.json`);
      stan = JSON.parse(readFileSync(poprzedniPlik, "utf8"));
      console.log(`Wznawiam od sesji ${od}, wczytano stan z ${poprzedniPlik}`);
    }

    let calkowityKoszt = 0;
    for (let idx = od - 1; idx < meta.sesje.length; idx++) {
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

    writeFileSync(path.join(wynikiDir, "iteracyjny-stan-final.json"), JSON.stringify(stan, null, 2));
    console.log(
      `Gotowe. Łączny koszt: $${calkowityKoszt.toFixed(2)}. Finalny stan: ${wynikiDir}/iteracyjny-stan-final.json`
    );
    return;
  }

  console.error(`Nieznany tryb: ${tryb}`);
  process.exit(1);
}

main();
