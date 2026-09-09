#!/usr/bin/env node
// Naprawia istniejące "kosze-na-wszystko" (tematy scalone łańcuchowo między
// krokami, sprzed naprawy scalDoLimitu — zob. src/lib/councilor-profile-
// delta.ts i .claude/plans/purrfect-riding-valiant.md) dla jednego radnego:
// 1. Odtwarza pełną historię scaleń (rekonstruuj-linie-scalen.mjs) — bez LLM.
// 2. Zastępuje KAŻDY temat z historią scalania jego odtworzonymi, czystymi
//    liśćmi (świeże id dla wszystkich — bez ryzyka kolizji z ponownie
//    użytym starym numerem, zob. nextId w councilor-profile-delta.ts).
// 3. Sprowadza wynikową (zwykle powiększoną) listę z powrotem do
//    LIMIT_TEMATOW przez `wymusLimity` — TYM RAZEM naprawionym algorytmem
//    (kategoria + podobieństwo semantyczne + `scalony`), więc nowe scalenia
//    będą trafne, nie kosze-na-wszystko.
// 4. Zapisuje wynik do TEGO SAMEGO, najnowszego wiersza
//    `councilor_profile_revision` (UPDATE `stan`, `seq`/`meeting_id`/`method`
//    bez zmian) — to korekta treści istniejącego kroku, nie nowy krok
//    łańcucha (nie przetwarza nowej sesji).
//
// Domyślnie TRYB SUCHY (tylko podgląd, zero zapisu i zero wywołań `claude -p`
// poza ewentualnym scalaniem przy podglądzie... nie, --sucho nie woła w ogóle
// claude -p, pokazuje tylko listę PRZED kompakcją). Zapis wymaga jawnego
// `--zapisz`.
//
// Użycie:
//   node scripts/profil/napraw-kosze-tematow.mjs --radny "Imię Nazwisko" [--zapisz]

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { supabaseQuery, supabaseExec } from "../lib/db.mjs";
import { embedPassage, cosineSimilarity } from "../lib/embeddings.mjs";
import { nextId, wymusLimity } from "../../src/lib/councilor-profile-delta.ts";
import { rekonstruujTematy } from "./rekonstruuj-linie-scalen.mjs";

const NAZWA_RADY = "Rada Miejska w Grójcu";

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

// Te same prompty co wdroz-produkcyjnie.mjs/zastosuj-delte-reczna.mjs —
// zdublowane celowo (ustalona konwencja w tym katalogu, krótkie funkcje,
// nie warto wydzielać modułu dla dwóch linijek szablonu).
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

function znajdzRadnego(pelnaNazwa) {
  const [wiersz] = supabaseQuery(`
    select c.id as councilor_id, ct.term_id, c.full_name
    from councilor c
    join councilor_term ct on ct.councilor_id = c.id
    join term t on t.id = ct.term_id
    join council co on co.id = t.council_id
    where co.name = '${NAZWA_RADY.replace(/'/g, "''")}' and c.full_name ilike '${pelnaNazwa.replace(/'/g, "''")}'
    order by t.start_date desc
    limit 1
  `);
  if (!wiersz) throw new Error(`Nie znaleziono radnego "${pelnaNazwa}".`);
  return wiersz;
}

function ostatniaRewizja(councilorId, termId) {
  const [rev] = supabaseQuery(`
    select seq, meeting_id, method, stan
    from councilor_profile_revision
    where councilor_id = '${councilorId}' and term_id = '${termId}'
    order by seq desc
    limit 1
  `);
  if (!rev) throw new Error("Brak żadnej rewizji.");
  return rev;
}

async function main() {
  const argv = process.argv.slice(2);
  const radnyIdx = argv.indexOf("--radny");
  if (radnyIdx === -1 || !argv[radnyIdx + 1]) {
    console.error('Użycie: node scripts/profil/napraw-kosze-tematow.mjs --radny "Imię Nazwisko" [--zapisz]');
    process.exit(1);
  }
  const radny = argv[radnyIdx + 1];
  const zapisz = argv.includes("--zapisz");

  const radnyRow = znajdzRadnego(radny);
  const { ostrzezenia, odtworz } = rekonstruujTematy(radnyRow);
  const ostatnia = ostatniaRewizja(radnyRow.councilor_id, radnyRow.term_id);

  console.log(`Radny: ${radnyRow.full_name} (seq=${ostatnia.seq}, ${ostatnia.stan.tematy.length} tematów przed naprawą)`);
  if (ostrzezenia.length > 0) {
    console.log(`\nOstrzeżenia rekonstrukcji (${ostrzezenia.length}), te tematy NIE są odtwarzane w pełni:`);
    for (const o of ostrzezenia) console.log(`  - ${o}`);
  }

  // Zastąp każdy temat z historią scalania jego odtworzonymi liśćmi — świeże
  // id dla WSZYSTKICH (łącznie z "przetrwałym" id, dla bezpieczeństwa: stary
  // numer mógł zostać ponownie użyty przez nextId po tym, jak oryginał zniknął).
  const nietkniete = [];
  const doOdtworzenia = [];
  for (const t of ostatnia.stan.tematy) {
    const czesci = odtworz(t.id);
    if (czesci.length === 1) nietkniete.push(t);
    else doOdtworzenia.push({ oryginalny: t, czesci });
  }

  const noweTematy = [...nietkniete];
  for (const { oryginalny, czesci } of doOdtworzenia) {
    for (const c of czesci) {
      noweTematy.push({ ...c, id: nextId("t", noweTematy), scalony: undefined });
    }
  }

  console.log(
    `\nOdtworzono ${doOdtworzenia.length} tematów z historią scalania → ${noweTematy.length - nietkniete.length} liści. ` +
      `Razem przed rekompakcją: ${noweTematy.length} (limit: 40).`
  );

  if (!zapisz) {
    console.log("\nTryb podglądu (bez --zapisz) — pełna lista tematów PRZED rekompakcją:");
    for (const t of noweTematy) {
      console.log(`  ${t.id}: "${t.teza}" (${t.wystapien} wyst.)`);
    }
    console.log("\nNic nie zapisano. Uruchom z --zapisz, żeby wykonać rekompakcję (naprawionym algorytmem) i zapisać.");
    return;
  }

  const nowyStan = { ...ostatnia.stan, tematy: noweTematy };
  const scratchCwd = path.join("/tmp", `napraw-kosze-${radnyRow.councilor_id}`);
  mkdirSync(scratchCwd, { recursive: true });
  const kosztScalen = { suma: 0, liczba: 0 };
  function sledzKosztScalenia(odp) {
    kosztScalen.suma += odp.total_cost_usd ?? 0;
    kosztScalen.liczba++;
    return odp;
  }
  const ctx = {
    generujWspolnaTeze: async (a, b) =>
      wyciagnijJson(sledzKosztScalenia(wywolajClaude(budujPromptScalaniaTematow(a, b), scratchCwd)).result),
    generujWspolnySpor: async (a, b) =>
      wyciagnijJson(sledzKosztScalenia(wywolajClaude(budujPromptScalaniaSporow(a, b), scratchCwd)).result),
    podobienstwo: stworzPodobienstwoEmbeddingowe(),
  };

  const stanPoKompakcji = await wymusLimity(nowyStan, ctx);
  console.log(
    `\nPo rekompakcji naprawionym algorytmem: ${stanPoKompakcji.tematy.length} tematów ` +
      `(koszt scalania: ${kosztScalen.liczba}× = $${kosztScalen.suma.toFixed(3)}).`
  );

  supabaseExec(`
    update councilor_profile_revision
    set stan = $cpr_json$${JSON.stringify(stanPoKompakcji)}$cpr_json$::jsonb
    where councilor_id = '${radnyRow.councilor_id}' and term_id = '${radnyRow.term_id}' and seq = ${ostatnia.seq}
  `);
  console.log(`Zapisano naprawiony stan do seq=${ostatnia.seq} (UPDATE, metoda/meeting_id bez zmian).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
