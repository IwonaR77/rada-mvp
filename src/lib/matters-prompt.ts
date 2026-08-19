import fs from "fs";
import path from "path";

// Prompty ekstrakcji spraw. Rada gminy i rada powiatu mają osobne, bo różnią
// się nie stylem, tylko zadaniem: gminny opisuje całą pracę rady, powiatowy
// wyławia z obrad nad dziesięcioma gminami tę część, która dotyczy Grójca.
//
// Podbicie wersji = nowy plik w prompty/ i podmiana nazwy tutaj.
export const MATTERS_PROMPTS = {
  gmina: "Prompt_Sprawy_v5.md",
  powiat: "Prompt_Sprawy_Powiat_v1.md",
} as const;

export type MattersPromptKind = keyof typeof MATTERS_PROMPTS;

export function readMattersPrompt(kind: MattersPromptKind): string {
  return fs.readFileSync(
    path.join(process.cwd(), "prompty", MATTERS_PROMPTS[kind]),
    "utf-8"
  );
}

/**
 * Wersja z nagłówka „Wersja promptu: N" pliku promptu spraw.
 *
 * Czytana z pliku, nie z osobnej stałej — z tego samego powodu, dla którego
 * robi to `currentSummaryPromptVersion`: jeden podbity plik nie może wymagać
 * pamiętania o drugim miejscu.
 */
export function mattersPromptVersion(kind: MattersPromptKind): number {
  const m = readMattersPrompt(kind).match(/Wersja promptu:\s*(\d+)/);
  if (!m) {
    throw new Error(
      `Brak nagłówka "Wersja promptu: N" w ${MATTERS_PROMPTS[kind]}.`
    );
  }
  return Number(m[1]);
}

/**
 * Który prompt obowiązuje dla danej rady.
 *
 * Rozpoznanie po tym, czy rada jest przypisana do miasta: rady powiatów mają
 * `city_id` puste (patrz scripts/migrate-powiat.sql). To pewniejsze niż
 * dopasowywanie nazwy, która przy kolejnym powiecie i tak by się zmieniła.
 */
export function mattersPromptKind(hasCity: boolean): MattersPromptKind {
  return hasCity ? "gmina" : "powiat";
}
