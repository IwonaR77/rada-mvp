#!/usr/bin/env node
// Ręczne rozstrzygnięcie kroku wstrzymanego przez NIEJEDNOZNACZNE dopasowanie
// tematu (zob. wdroz-produkcyjnie.mjs i plan .claude/plans/tranquil-wibbling-
// lerdorf.md §4). Operator (w praktyce: sesja Claude Code) ogląda kandydatów
// wypisanych przy wstrzymanym kroku, sam decyduje NOWY/DOPASOWANIE dla spornej
// pozycji, zapisuje pełną, poprawioną deltę do pliku JSON (ten sam kształt co
// SCHEMAT DELTY w Prompt_Profil_Radnego_Iteracyjny_v8.md — bez pozycji
// NIEJEDNOZNACZNE, te muszą być już rozstrzygnięte na NOWY albo DOPASOWANIE)
// i uruchamia ten skrypt zamiast czekać, aż wdroz-produkcyjnie.mjs znowu
// trafi na ten sam impas.
//
// Reużywa dokładnie ten sam pipeline walidacji/stosowania co driver
// produkcyjny (validateDelta/applyDelta) — jedyna różnica to źródło delty
// (plik zamiast `claude -p`) i `method='migracja-reczna'` w zapisanej
// rewizji, dla odróżnienia od zwykłych kroków automatycznych.
//
// Użycie:
//   node scripts/profil/zastosuj-delte-reczna.mjs --radny "Imię Nazwisko" --plik-delty patch.json [--sucho]

import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { supabaseQuery, supabaseExec } from "../lib/db.mjs";
import { zbudujDaneRadnego, trescSesji, dograjCzasySegmentow } from "../lib/profil-eksport.mjs";
import { embedPassage, cosineSimilarity } from "../lib/embeddings.mjs";
import { buildShortIndex } from "../../src/lib/councilor-profile-index.ts";
import { applyDelta, validateDelta } from "../../src/lib/councilor-profile-delta.ts";

// Ten sam mechanizm co wdroz-produkcyjnie.mjs — zob. komentarz tam.
function stworzPodobienstwoEmbeddingowe() {
  const cache = new Map();
  async function wektor(tekst) {
    if (!cache.has(tekst)) cache.set(tekst, await embedPassage(tekst));
    return cache.get(tekst);
  }
  return async (a, b) => {
    const [va, vb] = await Promise.all([wektor(a), wektor(b)]);
    return cosineSimilarity(va, vb);
  };
}

const NAZWA_RADY = "Rada Miejska w Grójcu";
const PROMPT_VERSION = 8;

function parseArgs(argv) {
  const args = { radny: null, plikDelty: null, sucho: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--radny") args.radny = argv[++i];
    else if (argv[i] === "--plik-delty") args.plikDelty = argv[++i];
    else if (argv[i] === "--sucho") args.sucho = true;
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!args.radny || !args.plikDelty) {
    console.error("Wymagane: --radny \"Imię Nazwisko\" --plik-delty patch.json");
    process.exit(1);
  }
  return args;
}

function wywolajClaude(promptText, cwd) {
  const out = execFileSync(
    "claude",
    ["-p", "--output-format", "json", "--model", "sonnet", "--allowedTools", ""],
    { input: promptText, encoding: "utf8", cwd, maxBuffer: 64 * 1024 * 1024, timeout: 900000 }
  );
  return JSON.parse(out);
}

function wyciagnijJson(tekst) {
  const dopasowanie = tekst.match(/```json\s*([\s\S]*?)```/);
  if (!dopasowanie) throw new Error(`Brak bloku \`\`\`json w odpowiedzi modelu:\n${tekst.slice(0, 500)}`);
  return JSON.parse(dopasowanie[1]);
}

function budujPromptScalaniaTematow(a, b) {
  return `Dwa tematy z profilu radnego reprezentują w istocie tę samą, szerszą tematykę i mają zostać scalone w jeden wpis. Napisz wspólną etykietę (\`teza\`, mianownik) i wspólne \`zdanie\` (zaczyna się małą literą, bez kropki na końcu, czasownik czynności dobrany swobodnie do treści obu — bez przymiotników/rzeczowników oceniających), obejmujące oba dotychczasowe tematy.

Temat A: teza="${a.teza}"${a.zdanie ? `, zdanie="${a.zdanie}"` : ""}
Temat B: teza="${b.teza}"${b.zdanie ? `, zdanie="${b.zdanie}"` : ""}

Zwróć WYŁĄCZNIE jeden blok:
\`\`\`json
{ "teza": "...", "zdanie": "..." }
\`\`\``;
}

function budujPromptScalaniaSporow(a, b) {
  return `Dwa spory z profilu radnego dotyczą w istocie tej samej sprawy i mają zostać scalone w jeden wpis. Napisz wspólny opis przedmiotu (\`temat\`) i wspólny opis stanowisk (\`stanowiska\`) obejmujący oba — bez oceny, kto miał rację.

Spór A: temat="${a.temat}", stanowiska="${a.stanowiska}"
Spór B: temat="${b.temat}", stanowiska="${b.stanowiska}"

Zwróć WYŁĄCZNIE jeden blok:
\`\`\`json
{ "temat": "...", "stanowiska": "..." }
\`\`\``;
}

function ostatniaRewizja(councilorId, termId) {
  const [rev] = supabaseQuery(`
    select seq, meeting_id, stan
    from councilor_profile_revision
    where councilor_id = '${councilorId}' and term_id = '${termId}'
    order by seq desc
    limit 1
  `);
  return rev ?? null;
}

async function main() {
  const { radny, plikDelty, sucho } = parseArgs(process.argv.slice(2));

  const [radnyRow] = supabaseQuery(`
    select c.id as councilor_id, ct.term_id
    from councilor c
    join councilor_term ct on ct.councilor_id = c.id
    join term t on t.id = ct.term_id
    join council co on co.id = t.council_id
    where co.name = '${NAZWA_RADY.replace(/'/g, "''")}' and c.full_name ilike '${radny.replace(/'/g, "''")}'
    order by t.start_date desc
    limit 1
  `);
  if (!radnyRow) throw new Error(`Nie znaleziono radnego "${radny}".`);

  const ostatnia = ostatniaRewizja(radnyRow.councilor_id, radnyRow.term_id);
  if (!ostatnia) throw new Error(`Brak łańcucha rewizji dla "${radny}" — ten skrypt dotyczy tylko wstrzymanego kroku iteracyjnego.`);

  const sesjaIdx = ostatnia.stan.sesje_przetworzone ?? 0;
  const dane = zbudujDaneRadnego(NAZWA_RADY, radny, [sesjaIdx]);
  const meetingIdRewizji = dane.meetings[sesjaIdx].id;
  const index = buildShortIndex(ostatnia.stan);

  const surowaDelta = JSON.parse(readFileSync(plikDelty, "utf8"));
  const walidacja = validateDelta(surowaDelta, index);
  if (walidacja.ostrzezenia.length > 0) {
    console.log("Ostrzeżenia walidacji delty:");
    for (const o of walidacja.ostrzezenia) console.log(`  - ${o}`);
  }
  if (walidacja.niejednoznaczne.length > 0) {
    console.error(`Delta z pliku nadal zawiera ${walidacja.niejednoznaczne.length} pozycję/e NIEJEDNOZNACZNE — rozstrzygnij je w pliku przed ponownym uruchomieniem.`);
    process.exit(1);
  }

  if (sucho) {
    console.log("Tryb --sucho: delta poprawna, nic nie zapisano.");
    console.log(JSON.stringify(walidacja.delta, null, 2));
    return;
  }

  const scratchCwd = path.join("/tmp", `zastosuj-delte-reczna-${radnyRow.councilor_id}`);
  mkdirSync(scratchCwd, { recursive: true });
  const kosztScalen = { suma: 0, liczba: 0 };
  function sledzKosztScalenia(odp) {
    kosztScalen.suma += odp.total_cost_usd ?? 0;
    kosztScalen.liczba++;
    return odp;
  }
  const ctx = {
    sesjaData: dane.meetings[sesjaIdx].date,
    meetingId: meetingIdRewizji,
    generujWspolnaTeze: async (a, b) =>
      wyciagnijJson(sledzKosztScalenia(wywolajClaude(budujPromptScalaniaTematow(a, b), scratchCwd)).result),
    generujWspolnySpor: async (a, b) =>
      wyciagnijJson(sledzKosztScalenia(wywolajClaude(budujPromptScalaniaSporow(a, b), scratchCwd)).result),
    podobienstwo: stworzPodobienstwoEmbeddingowe(),
  };
  const stan = await applyDelta(ostatnia.stan, walidacja.delta, ctx);
  dograjCzasySegmentow(stan, dane);

  supabaseExec(`
    insert into councilor_profile_revision (councilor_id, term_id, seq, meeting_id, method, stan, prompt_version)
    values ('${radnyRow.councilor_id}', '${radnyRow.term_id}', ${ostatnia.seq + 1}, '${meetingIdRewizji}', 'migracja-reczna', $cpr_json$${JSON.stringify(stan)}$cpr_json$::jsonb, ${PROMPT_VERSION})
  `);
  const opisScalen = kosztScalen.liczba > 0 ? `, koszt scalania (${kosztScalen.liczba}×): $${kosztScalen.suma.toFixed(3)}` : "";
  console.log(`Zapisano rewizję seq=${ostatnia.seq + 1} (method='migracja-reczna') dla "${radny}"${opisScalen}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
