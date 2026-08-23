#!/usr/bin/env node
// Jednorazowy zapis pełnego baseline'u x=33 (Karol Biedrzycki, prompt
// jednorazowy v7) do councilor.session_activity_synthesis — to jest
// współczesny odpowiednik "opisu standardowego" sprzed pomysłu na
// budowanie iteracyjne, NIE wiersz w councilor_profile_revision (ta
// tabela to wyłącznie łańcuch iteracyjny, zob. wdroz-produkcyjnie.mjs).
//
// Zastępuje dotychczasową zawartość pola — stary zapis z 2026-08-20 był
// prowizorycznym zestawieniem porównawczym (baseline do sesji 9 + fragment
// iteracyjny do sesji 9) używanym do ręcznego strojenia promptu; ten cel
// spełnia dziś realna sekcja "profil iteracyjny" na stronie radnego,
// więc tu zostaje tylko czysty, pełny opis standardowy.

import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, supabaseExec } from "../lib/db.mjs";

const COUNCILOR_ID = "8971a9e8-ad6d-489f-8f1d-e263b8d809f9";

const notatka = readFileSync(
  path.join(REPO_ROOT, "groq/work/profil/karol-biedrzycki/wyniki/jednorazowy-notatka.md"),
  "utf8"
).trim();

const stan = JSON.parse(
  readFileSync(
    path.join(REPO_ROOT, "groq/work/profil/karol-biedrzycki/wyniki/jednorazowy-stan.json"),
    "utf8"
  )
);
if (stan.wersja_stanu !== 7 || stan.sesje_przetworzone !== 33) {
  console.error(`Nieoczekiwany stan wejściowy: wersja_stanu=${stan.wersja_stanu}, sesje_przetworzone=${stan.sesje_przetworzone}`);
  process.exit(1);
}

// Dollar-quoting, nie ręczne escapowanie — notatka to swobodna proza modelu.
supabaseExec(`
  update councilor
  set session_activity_synthesis = $synteza$${notatka}$synteza$,
      session_activity_synthesis_prompt_version = 4,
      session_activity_synthesis_updated_at = now()
  where id = '${COUNCILOR_ID}'
`);

console.log("Zapisano pełny baseline x=33 do councilor.session_activity_synthesis dla Biedrzyckiego.");
