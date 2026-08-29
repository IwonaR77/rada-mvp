import fs from "fs";
import path from "path";

// Prompt profilu radnego (widoczna na górze /rada/[id]/radni/[id] sekcja
// "profil iteracyjny"). Dwie fazy, dwa pliki, ta sama wersja: seed buduje
// stan jednym przebiegiem z pierwszych ~3 sesji, krok iteracyjny dokłada po
// jednej kolejnej sesji naraz. Realnie uruchamiane w
// scripts/profil/wdroz-produkcyjnie.mjs.
//
// Podbicie wersji = nowa para plików w prompty/ i podmiana obu nazw tutaj.
export const SEED_PROMPT_FILENAME = "Prompt_Profil_Radnego_Jednorazowy_v7.md";
export const ITERATIVE_PROMPT_FILENAME = "Prompt_Profil_Radnego_Iteracyjny_v7.md";

function readPromptFile(filename: string): string {
  return fs.readFileSync(path.join(process.cwd(), "prompty", filename), "utf-8");
}

export function readCouncilorProfilePrompt(): string {
  return [
    "# Faza 1 — ustawienie startowe (pierwsze sesje kadencji, jednorazowo)",
    "",
    readPromptFile(SEED_PROMPT_FILENAME),
    "",
    "---",
    "",
    "# Faza 2 — aktualizacja po każdej kolejnej sesji (iteracyjnie)",
    "",
    readPromptFile(ITERATIVE_PROMPT_FILENAME),
  ].join("\n");
}
