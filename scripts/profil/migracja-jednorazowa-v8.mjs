#!/usr/bin/env node
// Jednorazowa interwencja przy przejściu na Wariant 2 (delta) — plan
// .claude/plans/tranquil-wibbling-lerdorf.md §6. NIE dotyka żadnego istniejącego
// wiersza `councilor_profile_revision` — dla każdego (councilor_id, term_id)
// zapisuje JEDNĄ nową rewizję (seq+1), method='migracja-reczna', tylko jeśli
// najnowszy `stan` ma `spory` powyżej nowego limitu (LIMIT_SPOROW,
// councilor-profile-delta.ts) — dokładnie ta sama reguła scalania, której i
// tak będzie używał applyDelta() przy zwykłych krokach, tylko uruchomiona raz
// z góry, żeby przećwiczyć ją na realnych danych PRZED zaufaniem jej w
// produkcyjnym pipeline (patrz plan, rozdział "Wdrożenie krok po kroku").
//
// `tematy` NIE wymaga tej migracji — applyDelta i tak sam scali nadmiar przy
// najbliższym zwykłym kroku tego radnego (LIMIT_TEMATOW jest egzekwowany
// bezwarunkowo, niezależnie od tego, skąd wziął się nadmiar).
//
// Wymaga scripts/migrate-councilor-profile-revision-v8.sql zastosowanego
// wcześniej (poszerzenie `method` o 'migracja-reczna').
//
// Użycie:
//   node scripts/profil/migracja-jednorazowa-v8.mjs [--sucho]

import { execFileSync } from "node:child_process";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { supabaseQuery, supabaseExec } from "../lib/db.mjs";
import { LIMIT_SPOROW, wymusLimity } from "../../src/lib/councilor-profile-delta.ts";

const PROMPT_VERSION = 8;

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

function budujPromptScalaniaSporow(a, b) {
  return `Dwa spory z profilu radnego dotyczą w istocie tej samej sprawy i mają zostać scalone w jeden wpis. Napisz wspólny opis przedmiotu (\`temat\`) i wspólny opis stanowisk (\`stanowiska\`) obejmujący oba — bez oceny, kto miał rację.

Spór A: temat="${a.temat}", stanowiska="${a.stanowiska}"
Spór B: temat="${b.temat}", stanowiska="${b.stanowiska}"

Zwróć WYŁĄCZNIE jeden blok:
\`\`\`json
{ "temat": "...", "stanowiska": "..." }
\`\`\``;
}

// Nie powinna nigdy zostać wywołana w tej migracji (tylko `spory` są tu
// scalane), ale wymusLimity() wymaga obu pól w ctx — jasny błąd zamiast
// cichego zepsucia, gdyby to jednak się zdarzyło.
function generujWspolnaTeze() {
  throw new Error("migracja-jednorazowa-v8: scalanie tematów nie powinno tu wystąpić.");
}

/** Sprawdza unikalność/format id we wszystkich listach z tożsamością —
 * `DOPASOWANIE` po `id` tego wymaga. Tylko loguje, nic nie naprawia. */
function sprawdzIdy(stan, etykieta) {
  const listy = [
    ["tematy", "t"],
    ["spory", "s"],
    ["mieszkancy", "m"],
    ["interpelacje_powiazane", "i"],
  ];
  for (const [pole, prefix] of listy) {
    const widziane = new Set();
    for (const item of stan[pole] ?? []) {
      if (!new RegExp(`^${prefix}\\d+$`).test(item.id)) {
        console.log(`  ⚠ [${etykieta}] ${pole}: id "${item.id}" nie pasuje do wzorca ^${prefix}\\d+$`);
      }
      if (widziane.has(item.id)) {
        console.log(`  ⚠ [${etykieta}] ${pole}: zduplikowane id "${item.id}"`);
      }
      widziane.add(item.id);
    }
  }
}

async function main() {
  const sucho = process.argv.includes("--sucho");
  if (sucho) console.log("Tryb --sucho: bez wywołań claude -p i bez zapisu do bazy.\n");

  const lancuchy = supabaseQuery(`
    select distinct on (councilor_id, term_id)
      councilor_id, term_id, seq, meeting_id, stan
    from councilor_profile_revision
    order by councilor_id, term_id, seq desc
  `);

  let dotknietych = 0;
  for (const rev of lancuchy) {
    const etykieta = `${rev.stan.radny ?? rev.councilor_id} / ${rev.stan.kadencja ?? rev.term_id}`;
    sprawdzIdy(rev.stan, etykieta);

    if ((rev.stan.spory?.length ?? 0) <= LIMIT_SPOROW) continue;

    console.log(`[${etykieta}] spory: ${rev.stan.spory.length} > limit ${LIMIT_SPOROW} — wymaga scalenia.`);
    dotknietych++;
    if (sucho) continue;

    const scratchCwd = path.join("/tmp", `migracja-v8-${rev.councilor_id}`);
    mkdirSync(scratchCwd, { recursive: true });
    const kosztScalen = { suma: 0, liczba: 0 };
    function sledzKosztScalenia(odp) {
      kosztScalen.suma += odp.total_cost_usd ?? 0;
      kosztScalen.liczba++;
      return odp;
    }
    const ctx = {
      generujWspolnaTeze,
      generujWspolnySpor: async (a, b) =>
        wyciagnijJson(sledzKosztScalenia(wywolajClaude(budujPromptScalaniaSporow(a, b), scratchCwd)).result),
    };
    const nowyStan = await wymusLimity(rev.stan, ctx);

    supabaseExec(`
      insert into councilor_profile_revision (councilor_id, term_id, seq, meeting_id, method, stan, prompt_version)
      values ('${rev.councilor_id}', '${rev.term_id}', ${rev.seq + 1}, '${rev.meeting_id}', 'migracja-reczna', $cpr_json$${JSON.stringify(nowyStan)}$cpr_json$::jsonb, ${PROMPT_VERSION})
    `);
    console.log(
      `  zapisano rewizję seq=${rev.seq + 1} (method='migracja-reczna'), spory: ${nowyStan.spory.length}, ` +
        `koszt scalania (${kosztScalen.liczba}×): $${kosztScalen.suma.toFixed(3)}`
    );
  }

  console.log(`\n${dotknietych === 0 ? "Nikt nie przekracza limitu spory — migracja niepotrzebna." : `${dotknietych} łańcuch(ów) dotkniętych.`}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
