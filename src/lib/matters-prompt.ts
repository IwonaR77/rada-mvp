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
 * Który prompt obowiązuje dla danej rady.
 *
 * Rozpoznanie po tym, czy rada jest przypisana do miasta: rady powiatów mają
 * `city_id` puste (patrz scripts/migrate-powiat.sql). To pewniejsze niż
 * dopasowywanie nazwy, która przy kolejnym powiecie i tak by się zmieniła.
 */
export function mattersPromptKind(hasCity: boolean): MattersPromptKind {
  return hasCity ? "gmina" : "powiat";
}
