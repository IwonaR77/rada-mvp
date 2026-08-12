// Sklejanie segmentów transkryptu w bloki wypowiedzi.
//
// Segment to jednostka transkrypcji (kilka sekund tekstu), nie wypowiedź —
// jedno wystąpienie radnego to zwykle kilkanaście segmentów pod rząd. Do
// czytania na profilu radnego liczy się wypowiedź, więc segmenty tej samej
// osoby idące po sobie łączymy w blok.
//
// Mamy tu wyłącznie segmenty JEDNEJ osoby, więc o tym, czy między nimi ktoś
// się wtrącił, wnioskujemy z samej przerwy w czasie — nie ma potrzeby ciągnąć
// z bazy całej reszty sesji tylko po to, żeby to sprawdzić.

/**
 * Przerwa, do której dwa segmenty tej samej osoby wciąż uchodzą za jedną
 * wypowiedź. Krótkie wtrącenie z sali („tak", „proszę") mieści się poniżej
 * progu i nie rozbija bloku na dwa.
 */
export const BLOCK_MERGE_GAP_SECONDS = 20;

/**
 * Od tej przerwy dwa bloki uznajemy za odległe — czyli za osobne wejścia do
 * dyskusji, a nie za tę samą wypowiedź z oddechem w środku.
 *
 * Obie wartości są orientacyjne i dobrane na oko. Do policzenia na realnym
 * rozkładzie przerw między blokami, gdy będzie po co — patrz pozycja o
 * oknach dyskusyjnych w backlogu.
 */
export const DISTANT_BLOCK_GAP_SECONDS = 60;

export type SpeechBlock = {
  start: number;
  end: number;
  text: string;
  /** Przerwa od końca poprzedniego bloku w tej sesji; null dla pierwszego. */
  gapBefore: number | null;
};

export function mergeIntoBlocks(
  segments: { start_time: number; end_time: number; text: string }[],
  mergeGapSeconds = BLOCK_MERGE_GAP_SECONDS
): SpeechBlock[] {
  const sorted = [...segments].sort(
    (a, b) => Number(a.start_time) - Number(b.start_time)
  );

  const blocks: SpeechBlock[] = [];
  for (const s of sorted) {
    const start = Number(s.start_time);
    const end = Number(s.end_time);
    const text = s.text.trim();
    const last = blocks[blocks.length - 1];

    if (last && start - last.end <= mergeGapSeconds) {
      last.end = Math.max(last.end, end);
      last.text = text ? `${last.text} ${text}`.trim() : last.text;
      continue;
    }

    blocks.push({
      start,
      end,
      text,
      gapBefore: last ? start - last.end : null,
    });
  }

  return blocks;
}

/** Pozycja na osi nagrania: 12:34, a przy dłuższych sesjach 1:02:03. */
export function formatClock(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** Długość przerwy słownie — podpis separatora, nie pozycja na osi. */
export function formatGap(seconds: number) {
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} godz. ${rest} min` : `${hours} godz.`;
}
