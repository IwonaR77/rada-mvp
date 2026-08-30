#!/usr/bin/env node
// Runner produkcyjny przyrostowego profilu radnego — jeden krok (jedna
// sesja) na uruchomienie, dla każdego radnego aktualnie w "puli aktywnych".
// Zob. plan .claude/plans/wracamy-do-idei-iteracyjnego-staged-dongarra.md
// i notatkę project_produkcyjne_wdrozenie_profilu w pamięci.
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
// (utrzymywane przez sam model wg promptu) dogoni liczbę sesji kadencji.
//
// Użycie:
//   node scripts/profil/wdroz-produkcyjnie.mjs [--szerokosc-puli 2] [--sucho] [--tylko-radny "Imię Nazwisko"]
//
// --sucho: buduje wsad i pokazuje, co by się stało, ale NIE woła `claude -p`
// i NIE zapisuje nic do bazy — do weryfikacji okablowania bez kosztu.
//
// --tylko-radny: krok wyłącznie dla jednego radnego (musi już być w puli wg
// rankingu, w zakresie --szerokosc-puli) — do dokończenia przerwanego kroku
// (np. po zerwaniu połączenia z bazą) bez ponownego, niezamierzonego
// przesuwania pozostałych radnych z puli o kolejny krok w tym samym uruchomieniu.

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

const NAZWA_RADY = "Rada Miejska w Grójcu";
const PROMPT_VERSION = 7;

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
 * przez sam model wg promptu, nie przeliczane tutaj), więc kolejna sesja do
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

function main() {
  const { szerokoscPuli, sucho, tylkoRadny } = parseArgs(process.argv.slice(2));
  if (sucho) console.log("Tryb --sucho: bez wywołań claude -p i bez zapisu do bazy.\n");
  if (tylkoRadny) console.log(`Tryb --tylko-radny: krok wyłącznie dla "${tylkoRadny}", reszta puli pomijana.\n`);

  const ranking = pobierzRankingAktywnosci(NAZWA_RADY);
  const promptJednorazowy = bazowyPrompt("Prompt_Profil_Radnego_Jednorazowy_v7.md");
  const promptIteracyjny = bazowyPrompt("Prompt_Profil_Radnego_Iteracyjny_v7.md");

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
    if (krok.method === "seed-jednorazowa") {
      const corpus = [];
      for (let idx = krok.odIdx; idx <= krok.doIdxWlacznie; idx++) corpus.push(trescSesji(dane, idx).tresc);
      meetingIdRewizji = dane.meetings[krok.doIdxWlacznie].id;
      wejscie = `${promptJednorazowy}\n\n---\n\nRadny: ${dane.councilor.full_name}\nKadencja: ${dane.termRow.label}\n\nDane pierwszych ${krok.doIdxWlacznie + 1} sesji tej kadencji (wypowiedzi, spory, sprawy, interpelacje, po kolei sesja po sesji):\n\n${corpus.join("\n\n===\n\n")}`;
    } else {
      const { tresc } = trescSesji(dane, krok.idx);
      meetingIdRewizji = dane.meetings[krok.idx].id;
      wejscie = `${promptIteracyjny}\n\n---\n\nRadny: ${dane.councilor.full_name}\nKadencja: ${dane.termRow.label}\n\nPoprzedni stan:\n\n${JSON.stringify(ostatnia.stan, null, 2)}\n\nNowa sesja (dane pełne — wypowiedzi, spory, sprawy, interpelacje, jeśli występują):\n\n${tresc}`;
    }

    if (sucho) {
      console.log(`  wejście: ${Math.round(wejscie.length / 1000)} tys. znaków, meeting_id rewizji: ${meetingIdRewizji}`);
      continue;
    }

    const start = Date.now();
    const odpowiedz = wywolajClaude(wejscie, scratchCwd);
    const czas = Math.round((Date.now() - start) / 1000);
    console.log(`  gotowe w ${czas}s, koszt: $${(odpowiedz.total_cost_usd ?? 0).toFixed(3)}`);
    const stan = wyciagnijJson(odpowiedz.result);
    dograjCzasySegmentow(stan, dane);

    // Dollar-quoting zamiast ręcznego escapowania cudzysłowów/backslashy —
    // JSON od modelu jest zbyt zmienny, by bezpiecznie polegać na sqlEscape.
    supabaseExec(`
      insert into councilor_profile_revision (councilor_id, term_id, seq, meeting_id, method, stan, prompt_version)
      values ('${radny.councilor_id}', '${radny.term_id}', ${krok.seq}, '${meetingIdRewizji}', '${krok.method}', $cpr_json$${JSON.stringify(stan)}$cpr_json$::jsonb, ${PROMPT_VERSION})
    `);
    console.log(`  zapisano rewizję seq=${krok.seq} do councilor_profile_revision`);
  }

  if (wPuli === 0) console.log("Nikt w puli — wszyscy w zakresie --szerokosc-puli już dogonili bieżącą sesję.");
}

main();
