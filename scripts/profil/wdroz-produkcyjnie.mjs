#!/usr/bin/env node
// Runner produkcyjny przyrostowego profilu radnego — jeden krok (jedna
// sesja) na uruchomienie, dla każdego radnego aktualnie w "puli aktywnych".
// Zob. plan .claude/plans/tranquil-wibbling-lerdorf.md (Wariant 2 — delta) i
// notatkę project_profil_skalowanie_kroku w pamięci.
//
// Od promptu v8 (2026-09-06) krok iteracyjny NIE wstrzykuje już pełnego
// poprzedniego stanu do promptu ani nie każe modelowi zwracać całego nowego
// stanu — model dostaje skrócony indeks istniejących tematów
// (buildShortIndex) i zwraca wyłącznie deltę (co się wydarzyło w tej sesji);
// `applyDelta()` w src/lib/councilor-profile-delta.ts stosuje ją
// deterministycznie do pełnego stanu. Krok "seed-jednorazowa" (pierwsze
// sesje kadencji, bez poprzedniego stanu do porównania) zostaje bez zmian —
// zwraca od razu pełny stan, jak dotąd.
//
// W przeciwieństwie do scripts/profil/uruchom-iteracje.mjs (eksperymentalny,
// pliki pośrednie w groq/work/profil/, tylko jeden radny na raz) ten skrypt:
// - działa wprost na bazie (scripts/lib/profil-eksport.mjs), bez plików
//   pośrednich w groq/work/,
// - w jednym uruchomieniu robi krok dla WSZYSTKICH radnych z puli aktywnych,
//   wybranych wg rankingu liczby sesji z wypowiedziami,
// - zapisuje każdy krok jako nowy wiersz w `councilor_profile_revision`
//   (SUPABASE_DB_URL, jak scripts/migrate-wybory.sql).
//
// Pula jest w całości wyliczana z bazy (z historii rewizji) — bez osobnej
// kolumny "kto jest aktywny", więc kolejne uruchomienia są bezstanowe:
// pierwsi wg rankingu radni, którzy jeszcze NIE dogonili najnowszej sesji
// swojej kadencji, zajmują miejsca w puli (--szerokosc-puli, domyślnie 2).
// Radny, który dogonił, po prostu nie zajmuje już miejsca — kolejny wg
// rankingu wchodzi na jego miejsce przy następnym uruchomieniu automatycznie.
//
// Pierwszy krok danego radnego to zawsze seed: jednorazowy baseline z
// pierwszych min(3, liczba_sesji) sesji kadencji (method='seed-jednorazowa',
// pierwsze sesje kadencji są czysto proceduralne). Kolejne kroki to jedna
// sesja iteracyjnie (method='iteracyjna'), aż `stan.sesje_przetworzone`
// (utrzymywane przez applyDelta, nie przez model) dogoni liczbę sesji
// kadencji.
//
// Jeśli model zwróci NIEJEDNOZNACZNE dopasowanie tematu (dwóch kandydatów
// pasuje podobnie dobrze) — krok tego radnego jest WSTRZYMYWANY (nic nie
// zapisujemy, `seq` się nie przesuwa), do ręcznego rozstrzygnięcia przez
// scripts/profil/zastosuj-delte-reczna.mjs. Bezstanowa pula sama gwarantuje,
// że ten sam krok zostanie ponowiony przy kolejnym uruchomieniu.
//
// Użycie:
//   node scripts/profil/wdroz-produkcyjnie.mjs [--szerokosc-puli 2] [--sucho] [--tylko-radny "Imię Nazwisko"]
//
// --sucho: buduje wsad i pokazuje, co by się stało, ale NIE woła `claude -p`
// i NIE zapisuje nic do bazy — do weryfikacji okablowania bez kosztu.
//
// --tylko-radny: krok wyłącznie dla jednego radnego (musi już być w puli wg
// rankingu, w zakresie --szerokosc-puli) — do dokończenia przerwanego kroku
// (np. po zerwaniu połączenia z bazą, albo po ręcznym rozstrzygnięciu
// NIEJEDNOZNACZNE) bez ponownego, niezamierzonego przesuwania pozostałych
// radnych z puli o kolejny krok w tym samym uruchomieniu.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, supabaseQuery, supabaseExec } from "../lib/db.mjs";
import {
  zbudujDaneRadnego,
  trescSesji,
  pobierzRankingAktywnosci,
  dograjCzasySegmentow,
} from "../lib/profil-eksport.mjs";
import { embedPassage, cosineSimilarity } from "../lib/embeddings.mjs";
import { buildShortIndex } from "../../src/lib/councilor-profile-index.ts";
import { applyDelta, validateDelta } from "../../src/lib/councilor-profile-delta.ts";

// Podobieństwo semantyczne (embedding lokalny, nie Dice na tekście) dla
// scalDoLimitu — zob. komentarz przy tej funkcji w councilor-profile-delta.ts.
// Cache tekst→wektor w domknięciu: te same tezy/tematy bywają porównywane w
// wielu parach w jednym wywołaniu scalDoLimitu, model liczy się raz na tekst.
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
  const args = { szerokoscPuli: 2, sucho: false, tylkoRadny: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--szerokosc-puli") args.szerokoscPuli = Number(argv[++i]);
    else if (argv[i] === "--sucho") args.sucho = true;
    else if (argv[i] === "--tylko-radny") args.tylkoRadny = argv[++i];
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
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

// Mikro-wywołania LLM, tylko o parę scalanych tematów/sporów (nie cały
// stan) — wołane przez applyDelta() wyłącznie przy przekroczeniu limitu
// (rzadko, raz na dziesiątki sesji per radny). Zachowują dzisiejszą jakość
// prozy scalonej etykiety zamiast mechanicznej konkatenacji.
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

// Oba pliki promptów kończą się szablonem do ręcznego wklejania — tu go
// odcinamy i doklejamy realne dane (ten sam wzorzec co uruchom-iteracje.mjs).
function bazowyPrompt(nazwaPliku) {
  const pelny = readFileSync(path.join(REPO_ROOT, "prompty", nazwaPliku), "utf8");
  return pelny.split(/\n---\n\nRadny: \[imię i nazwisko\]/)[0];
}

/** Najnowsza rewizja per (radny, kadencja) — `null`, gdy łańcuch się nie zaczął. */
function ostatniaRewizja(councilorId, termId) {
  const [rev] = supabaseQuery(`
    select seq, meeting_id, stan, method
    from councilor_profile_revision
    where councilor_id = '${councilorId}' and term_id = '${termId}'
    order by seq desc
    limit 1
  `);
  return rev ?? null;
}

/**
 * Kolejny krok w łańcuchu danego radnego — `null`, gdy radny już dogonił
 * najnowszą sesję swojej kadencji (nie zajmuje wtedy miejsca w puli).
 * `sesje_przetworzone` w ostatniej rewizji jest źródłem prawdy (utrzymywane
 * przez applyDelta wg promptu, nie przeliczane tutaj), więc kolejna sesja do
 * przetworzenia to zawsze indeks 0-based = `sesje_przetworzone`.
 */
function nastepnyKrok(ostatnia, liczbaSesji) {
  if (!ostatnia) {
    const doIdxWlacznie = Math.min(3, liczbaSesji) - 1;
    return { seq: 1, method: "seed-jednorazowa", odIdx: 0, doIdxWlacznie };
  }
  const sesjePrzetworzonePrzed = ostatnia.stan.sesje_przetworzone ?? 0;
  if (sesjePrzetworzonePrzed >= liczbaSesji) return null;
  return { seq: ostatnia.seq + 1, method: "iteracyjna", idx: sesjePrzetworzonePrzed };
}

async function main() {
  const { szerokoscPuli, sucho, tylkoRadny } = parseArgs(process.argv.slice(2));
  if (sucho) console.log("Tryb --sucho: bez wywołań claude -p i bez zapisu do bazy.\n");
  if (tylkoRadny) console.log(`Tryb --tylko-radny: krok wyłącznie dla "${tylkoRadny}", reszta puli pomijana.\n`);

  const ranking = pobierzRankingAktywnosci(NAZWA_RADY);
  const promptJednorazowy = bazowyPrompt("Prompt_Profil_Radnego_Jednorazowy_v8.md");
  const promptIteracyjny = bazowyPrompt("Prompt_Profil_Radnego_Iteracyjny_v8.md");
  const podobienstwo = stworzPodobienstwoEmbeddingowe();

  let wPuli = 0;

  for (const radny of ranking) {
    if (wPuli >= szerokoscPuli) break;

    const [{ n: liczbaSesji }] = supabaseQuery(`
      select count(*)::int as n from meeting
      where term_id = '${radny.term_id}' and meeting_type in ('zwyczajna', 'nadzwyczajna')
    `);

    const ostatnia = ostatniaRewizja(radny.councilor_id, radny.term_id);
    const krok = nastepnyKrok(ostatnia, liczbaSesji);
    if (!krok) continue; // dogonił — nie zajmuje miejsca, kolejny wg rankingu wejdzie zamiast niego

    wPuli++;
    console.log(
      `[${wPuli}/${szerokoscPuli}] ${radny.full_name} — krok ${krok.seq} (${krok.method}), ` +
        `sesje przed krokiem: ${ostatnia?.stan.sesje_przetworzone ?? 0}/${liczbaSesji}`
    );

    if (tylkoRadny && radny.full_name !== tylkoRadny) {
      console.log(`  pominięty (--tylko-radny "${tylkoRadny}")`);
      continue;
    }

    const wymaganeIdx =
      krok.method === "seed-jednorazowa"
        ? Array.from({ length: krok.doIdxWlacznie - krok.odIdx + 1 }, (_, i) => krok.odIdx + i)
        : [krok.idx];
    const dane = zbudujDaneRadnego(NAZWA_RADY, radny.full_name, wymaganeIdx);
    const scratchCwd = path.join("/tmp", `profil-runner-${radny.councilor_id}`);
    mkdirSync(scratchCwd, { recursive: true });

    let wejscie;
    let meetingIdRewizji;
    let index = null; // tylko dla iteracyjna — skrócony indeks wysłany modelowi, potrzebny też do validateDelta
    if (krok.method === "seed-jednorazowa") {
      const corpus = [];
      for (let idx = krok.odIdx; idx <= krok.doIdxWlacznie; idx++) corpus.push(trescSesji(dane, idx).tresc);
      meetingIdRewizji = dane.meetings[krok.doIdxWlacznie].id;
      wejscie = `${promptJednorazowy}\n\n---\n\nRadny: ${dane.councilor.full_name}\nKadencja: ${dane.termRow.label}\n\nDane pierwszych ${krok.doIdxWlacznie + 1} sesji tej kadencji (wypowiedzi, spory, sprawy, interpelacje, po kolei sesja po sesji):\n\n${corpus.join("\n\n===\n\n")}`;
    } else {
      const { tresc } = trescSesji(dane, krok.idx);
      meetingIdRewizji = dane.meetings[krok.idx].id;
      index = buildShortIndex(ostatnia.stan);
      wejscie = `${promptIteracyjny}\n\n---\n\nRadny: ${dane.councilor.full_name}\nKadencja: ${dane.termRow.label}\n\nIndeks istniejących tematów:\n\n${JSON.stringify(index, null, 2)}\n\nNowa sesja (dane pełne — wypowiedzi, spory, sprawy, interpelacje, jeśli występują):\n\n${tresc}`;
    }

    if (sucho) {
      const indexInfo = index ? `, w tym indeks: ${Math.round(JSON.stringify(index).length / 1000)} tys. znaków (${index.tematy.length} tematów)` : "";
      console.log(`  wejście: ${Math.round(wejscie.length / 1000)} tys. znaków${indexInfo}, meeting_id rewizji: ${meetingIdRewizji}`);
      continue;
    }

    const start = Date.now();
    const odpowiedz = wywolajClaude(wejscie, scratchCwd);
    const czas = Math.round((Date.now() - start) / 1000);
    const kosztGlowny = odpowiedz.total_cost_usd ?? 0;
    console.log(`  główne wywołanie gotowe w ${czas}s`);

    // Mikro-wywołania scalania (przy przekroczeniu limitu tematów/sporów)
    // każde kosztują osobno — bez tego licznika ten koszt ginął całkowicie
    // z logów (zaobserwowane 2026-09-06 na pierwszym realnym kroku v8 dla
    // Kozłowskiej: ~13 mikro-wywołań na krok, zero widoczności kosztu).
    const kosztScalen = { suma: 0, liczba: 0 };
    function sledzKosztScalenia(odp) {
      kosztScalen.suma += odp.total_cost_usd ?? 0;
      kosztScalen.liczba++;
      return odp;
    }

    let stan;
    if (krok.method === "seed-jednorazowa") {
      stan = wyciagnijJson(odpowiedz.result);
    } else {
      const delta = wyciagnijJson(odpowiedz.result);
      const walidacja = validateDelta(delta, index);
      if (walidacja.ostrzezenia.length > 0) {
        console.log("  ostrzeżenia walidacji delty:");
        for (const o of walidacja.ostrzezenia) console.log(`    - ${o}`);
      }
      if (walidacja.niejednoznaczne.length > 0) {
        console.log(`  NIEJEDNOZNACZNE (${walidacja.niejednoznaczne.length}) — krok wstrzymany, NIC nie zapisano do bazy:`);
        for (const n of walidacja.niejednoznaczne) {
          console.log(`    kandydaci: ${n.kandydaci.join(", ")} — ${n.uzasadnienie}`);
          console.log(`    treść zgłoszona przez model: ${JSON.stringify(n.dane)}`);
        }
        console.log(
          `  Rozstrzygnij ręcznie (scripts/profil/zastosuj-delte-reczna.mjs), potem ponów: ` +
            `node scripts/profil/wdroz-produkcyjnie.mjs --tylko-radny "${radny.full_name}"`
        );
        continue;
      }
      const ctx = {
        sesjaData: dane.meetings[krok.idx].date,
        meetingId: meetingIdRewizji,
        generujWspolnaTeze: async (a, b) =>
          wyciagnijJson(sledzKosztScalenia(wywolajClaude(budujPromptScalaniaTematow(a, b), scratchCwd)).result),
        generujWspolnySpor: async (a, b) =>
          wyciagnijJson(sledzKosztScalenia(wywolajClaude(budujPromptScalaniaSporow(a, b), scratchCwd)).result),
        podobienstwo,
      };
      stan = await applyDelta(ostatnia.stan, walidacja.delta, ctx);
    }
    dograjCzasySegmentow(stan, dane);

    // Dollar-quoting zamiast ręcznego escapowania cudzysłowów/backslashy —
    // JSON od modelu jest zbyt zmienny, by bezpiecznie polegać na sqlEscape.
    supabaseExec(`
      insert into councilor_profile_revision (councilor_id, term_id, seq, meeting_id, method, stan, prompt_version)
      values ('${radny.councilor_id}', '${radny.term_id}', ${krok.seq}, '${meetingIdRewizji}', '${krok.method}', $cpr_json$${JSON.stringify(stan)}$cpr_json$::jsonb, ${PROMPT_VERSION})
    `);
    const kosztLacznie = kosztGlowny + kosztScalen.suma;
    const opisScalen = kosztScalen.liczba > 0 ? ` + scalanie (${kosztScalen.liczba}×): $${kosztScalen.suma.toFixed(3)}` : "";
    console.log(`  koszt: główne $${kosztGlowny.toFixed(3)}${opisScalen} = razem $${kosztLacznie.toFixed(3)}`);
    console.log(`  zapisano rewizję seq=${krok.seq} do councilor_profile_revision`);
  }

  if (wPuli === 0) console.log("Nikt w puli — wszyscy w zakresie --szerokosc-puli już dogonili bieżącą sesję.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
