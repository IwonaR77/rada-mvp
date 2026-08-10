import fs from "fs";
import path from "path";

// Prompt podsumowań sesji. Jedno miejsce dla wszystkich, którzy go potrzebują:
// strony /prompt-podsumowania, pobierania pliku .md przez managera i odczytu
// numeru wersji.
//
// Podbicie wersji = nowy plik w prompty/ (tak działa wersjonowanie promptów w
// tym projekcie) i podmiana tej nazwy.
export const SUMMARY_PROMPT_FILENAME = "Prompt_Podsumowania_Sesji_v7.md";

const SUMMARY_PROMPT_PATH = path.join(
  process.cwd(),
  "prompty",
  SUMMARY_PROMPT_FILENAME
);

export function readSummaryPrompt(): string {
  return fs.readFileSync(SUMMARY_PROMPT_PATH, "utf-8");
}

/**
 * Numer wersji czytany z nagłówka „Wersja promptu: N" samego pliku promptu.
 *
 * Wcześniej była to ręcznie utrzymywana stała i rozjechała się z plikiem
 * (stała mówiła 4, plik był już v6), przez co oś czasu przestała oznaczać
 * nieaktualne podsumowania. Jeden podbity plik nie może wymagać pamiętania
 * o drugim miejscu.
 */
export function currentSummaryPromptVersion(): number {
  const m = readSummaryPrompt().match(/Wersja promptu:\s*(\d+)/);
  if (!m) {
    throw new Error(
      `Brak nagłówka "Wersja promptu: N" w ${SUMMARY_PROMPT_FILENAME} — bez niego nie da się oznaczać nieaktualnych podsumowań.`
    );
  }
  return Number(m[1]);
}

/**
 * Wersja promptu wyczytana z treści gotowego podsumowania (linia
 * „**Wygenerowano:** … · prompt v6"), czyli z tego, co realnie ten tekst
 * wyprodukowało. Starsze podsumowania tej linii nie mają — wtedy null.
 */
export function promptVersionFromSummary(markdown: string): number | null {
  const m = markdown.match(/prompt\s+v(\d+)/i);
  return m ? Number(m[1]) : null;
}

/**
 * Rozkłada gotowy plik .md na to, co trzyma baza: linia „TAGI: a, b, c" idzie
 * do meeting.topics jako osobna kolumna, a nie zostaje na końcu tekstu —
 * dokładnie tak, jak wyglądają podsumowania wgrane dotąd ręcznie.
 */
export function parseSummaryFile(markdown: string): {
  summary: string;
  topics: string[] | null;
  promptVersion: number | null;
} {
  const tagLine = markdown.match(/^\s*TAGI:\s*(.+)$/im);
  const topics = tagLine
    ? tagLine[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : null;

  const summary = (tagLine ? markdown.replace(tagLine[0], "") : markdown).trim();

  return { summary, topics, promptVersion: promptVersionFromSummary(markdown) };
}
