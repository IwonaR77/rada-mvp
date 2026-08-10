// Budowanie plików do pobrania z transkrypcji sesji (.txt, .txt z mówcami, .srt).
//
// Osobno od komponentu, bo to czyste funkcje na danych — dzięki temu dają się
// uruchomić i sprawdzić bez renderowania odtwarzacza, a nagłówek, od którego
// zależy prompt podsumowań, przestaje być schowany w środku 900-linijkowego
// komponentu klienckiego.

export type Segment = {
  id: string;
  start_time: number;
  end_time: number;
  text: string;
  confirmed_councilor_id: string | null;
  confirmed_official_id: string | null;
  status: string;
};

export type Person = { id: string; name: string; role?: string };

function toSrtTimestamp(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function buildSrt(segments: Segment[]) {
  return segments
    .map(
      (s, i) =>
        `${i + 1}\n${toSrtTimestamp(s.start_time)} --> ${toSrtTimestamp(s.end_time)}\n${s.text}\n`
    )
    .join("\n");
}

export type TranscriptMeta = {
  /** esesja_id albo source_id — identyfikator nagrania u dostawcy transmisji. */
  sessionKey: string | null;
  /** Pozycja sesji w kadencji; dla gminy tytuł nie zawiera numeru w ogóle. */
  sessionNumber: number | null;
  councilName: string | null;
  date: string;
  title: string;
  existingTopics: string[];
};

const ROMAN = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
  [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
] as const;

function toRoman(n: number) {
  let rest = n;
  let out = "";
  for (const [value, sign] of ROMAN) {
    while (rest >= value) {
      out += sign;
      rest -= value;
    }
  }
  return out;
}

// Nagłówek, od którego zaczyna się każdy pobrany plik transkrypcji. Prompt
// podsumowań czyta z niego wszystko, czego inaczej musiałby się domyślać albo
// dopytywać — a przy dwóch radach domyślanie się przestało być niegroźne:
// nazwa rady była dotąd zaszyta w samym prompcie ("Rady Miejskiej w Grójcu"),
// więc sesja powiatu dostałaby podsumowanie podpisane nazwą rady gminy.
//
// identyfikator zastępuje samo esesja_id, bo rady spoza esesja.pl go nie mają,
// a to od niego prompt wyprowadza nazwę pliku wynikowego.
export function buildHeader(meta: TranscriptMeta) {
  return [
    meta.councilName ? `rada: ${meta.councilName}` : null,
    meta.sessionNumber
      ? `numer sesji: ${toRoman(meta.sessionNumber)} (${meta.sessionNumber} w tej kadencji)`
      : null,
    meta.sessionKey ? `identyfikator: sesja_${meta.sessionKey}_${meta.date}` : null,
    `data: ${meta.date}`,
    `tytuł: ${meta.title}`,
    meta.existingTopics.length > 0
      ? `tagi: ${meta.existingTopics.join(", ")}`
      : "tagi: (brak — to pierwsze tagowane podsumowanie tej rady)",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildPlainText(segments: Segment[], meta: TranscriptMeta) {
  return `${buildHeader(meta)}\n\n${segments.map((s) => s.text).join("\n\n")}`;
}

// Wariant z mówcami dokłada do nagłówka skład rady i urzędników z funkcjami
// oraz to, jaka część segmentów jest w ogóle otagowana. Bez tego ostatniego
// model nie wie, czy "Nieustalone" to margines, czy większość sesji — a
// prompt wymaga imion i nazwisk w sekcji o sporach, więc musi je mieć skąd
// wziąć w poprawnym brzmieniu, zamiast zgadywać ze słuchu transkrypcji.
export function buildPlainTextWithSpeakers(
  segments: Segment[],
  peopleById: Map<string, string>,
  councilors: Person[],
  officials: { id: string; full_name: string; role: string }[],
  meta: TranscriptMeta
) {
  const named = (name: string, role?: string) => (role ? `${name} (${role})` : name);
  const assigned = segments.filter(
    (s) => s.confirmed_councilor_id ?? s.confirmed_official_id
  ).length;

  const header = [
    buildHeader(meta),
    councilors.length > 0
      ? `skład rady: ${councilors.map((c) => named(c.name, c.role)).join(", ")}`
      : null,
    officials.length > 0
      ? `urzędnicy: ${officials.map((o) => named(o.full_name, o.role)).join(", ")}`
      : null,
    `otagowani mówcy: ${assigned} z ${segments.length} wypowiedzi` +
      (segments.length > 0
        ? ` (${Math.round((100 * assigned) / segments.length)}%)`
        : ""),
  ]
    .filter(Boolean)
    .join("\n");

  const blocks: { label: string; texts: string[] }[] = [];
  for (const s of segments) {
    const assignedId = s.confirmed_councilor_id ?? s.confirmed_official_id;
    const label = assignedId ? (peopleById.get(assignedId) ?? "?") : "Nieustalone";
    const last = blocks[blocks.length - 1];
    if (last && last.label === label) {
      last.texts.push(s.text);
    } else {
      blocks.push({ label, texts: [s.text] });
    }
  }

  const body = blocks.map((b) => `${b.label}:\n${b.texts.join("\n")}`).join("\n\n");

  return `${header}\n\n${body}`;
}
