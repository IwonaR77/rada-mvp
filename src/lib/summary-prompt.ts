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
 * „**Wygenerowano:** … · prompt v7.12"), czyli z tego, co realnie ten tekst
 * wyprodukowało. Starsze podsumowania tej linii nie mają — wtedy null.
 *
 * Człon po kropce to `minor`: numer ostatniej uwagi redakcji, która była w
 * pobranym pliku (patrz `stampPromptMinor`). Nie ma go w pobraniach bez uwag
 * i w opisach sprzed wprowadzenia numeracji — wtedy null, co znaczy „nie
 * wiadomo", a nie „żadnych uwag".
 */
export function promptVersionFromSummary(markdown: string): {
  major: number | null;
  minor: number | null;
} {
  const m = markdown.match(/prompt\s+v(\d+)(?:\.(\d+))?/i);
  if (!m) return { major: null, minor: null };
  return {
    major: Number(m[1]),
    minor: m[2] === undefined ? null : Number(m[2]),
  };
}

/**
 * Wpisuje minor do nagłówka „Wersja promptu: N" pobieranego pliku, czyli do
 * jedynego miejsca, z którego prompt każe modelowi przepisać wersję.
 *
 * Dzięki temu etykieta wraca z czatu razem z tekstem i po fakcie wiadomo, z
 * jakim zestawem uwag redakcji ten opis powstał. Bez stempla wracało samo
 * „prompt v7", identyczne dla pobrania sprzed trzech uwag i po nich.
 *
 * Minor należy do uwag, nie do promptu — jest liczony w obrębie jednej rady,
 * więc `7.12` u Grójca i `7.12` u powiatu to dwa różne zbiory uwag. Nigdy
 * ich nie porównywać między radami.
 */
export function stampPromptMinor(prompt: string, minor: number): string {
  if (minor <= 0) return prompt;
  return prompt.replace(
    /^(\s*Wersja promptu:\s*\d+)/m,
    (_full, head: string) => `${head}.${minor}`
  );
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
  promptMinor: number | null;
} {
  const tagLine = markdown.match(/^\s*TAGI:\s*(.+)$/im);
  const topics = tagLine
    ? tagLine[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : null;

  const summary = (tagLine ? markdown.replace(tagLine[0], "") : markdown).trim();

  const { major, minor } = promptVersionFromSummary(markdown);
  return { summary, topics, promptVersion: major, promptMinor: minor };
}
