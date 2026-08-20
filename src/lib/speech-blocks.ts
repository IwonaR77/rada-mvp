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
 *
 * Podniesione z 20 s po obejrzeniu realnych bloków: przy 20 s końcowe
 * „Dziękuję" po odpowiedzi z sali odrywało się jako osobna wypowiedź.
 */
export const BLOCK_MERGE_GAP_SECONDS = 30;

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
  /**
   * Id pierwszego segmentu bloku — jedyna trwała kotwica, jaką blok ma.
   *
   * Bloki nie istnieją w bazie, więc zakładka użytkownika wskazuje właśnie ten
   * segment: przeżywa zmianę progu sklejania (wskaże wtedy blok, w którym ten
   * segment wylądował) i podział segmentu (`splitSegment` zostawia stary
   * wiersz, dopisując tylko drugą połowę).
   */
  segmentId: string;
};

export function mergeIntoBlocks(
  segments: {
    id: string;
    start_time: number;
    end_time: number;
    text: string;
  }[],
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
      segmentId: s.id,
    });
  }

  return blocks;
}

/**
 * Pozycja na osi nagrania: 05:11, a przy dłuższych sesjach 1:02:03.
 *
 * Minuty z wiodącym zerem, żeby znaczniki w kolumnie miały tę samą szerokość —
 * bez tego „5:11" i „12:34" rozjeżdżały początek tekstu obok.
 */
export function formatClock(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

/**
 * Przerwa, po której blok się kończy przy LICZENIU czasu mówienia.
 *
 * Osobna od `BLOCK_MERGE_GAP_SECONDS` (30 s), bo służy do czego innego: tamta
 * decyduje, co się czyta jako jedną wypowiedź, ta — co się liczy jako jeden
 * blok. Wartość musi zostać zgodna z domyślnym `p_max_gap` funkcji
 * `term_speaking_blocks` (`scripts/migrate-speaking-blocks.sql`), inaczej ta
 * sama osoba dostanie inną liczbę sekund na stronie sesji niż na heatmapie
 * rady. Zmierzony wpływ progu: bez progu 13,48 h, 120 s → 12,76 h, 60 s →
 * 12,72 h, 30 s → 12,54 h — między 30 a 120 s różnica mieści się w 2%, więc
 * to nie jest pokrętło do strojenia liczb, tylko odcięcie patologii (jeden
 * błąd tagowania potrafi skleić „blok" dwugodzinny).
 */
export const SPEAKING_BLOCK_MAX_GAP_SECONDS = 60;

/**
 * Sumuje czas mówienia każdej osoby PER BLOK — od początku pierwszego
 * segmentu bloku do końca ostatniego — zamiast sumować długości pojedynczych
 * segmentów.
 *
 * Pauza w środku jednej ciągłej wypowiedzi to nadal czas, w którym mówca
 * trzymał głos; sumowanie segmentów ją gubiło i zaniżało wynik o ~17% na
 * całej bazie (pomiar 2026-08-11).
 *
 * Odpowiednik `term_speaking_blocks` w SQL — ta sama definicja bloku i ten
 * sam próg. Tutaj liczymy w przeglądarce, bo strona sesji i tak ma wczytane
 * WSZYSTKIE segmenty tej sesji; dla całej kadencji liczy baza, bo tam
 * aplikacja pobiera wyłącznie wypowiedzi zatwierdzone i nie widziałaby, że
 * blok przerywa segment nieotagowany.
 *
 * @param segments Segmenty jednej sesji — **wszystkie**, także bez mówcy
 *   (`speakerId: null`). To one przerywają blok: bez nich dwie wypowiedzi
 *   przedzielone cudzą, jeszcze nieprzypisaną, skleiłyby się w jedną i
 *   dopisały tej osobie nie jej czas. Kolejność dowolna — sortujemy tutaj.
 * @param maxGapSeconds Przerwa, po której blok się urywa mimo tego samego
 *   mówcy.
 * @returns Sekundy per `speakerId`; brak klucza znaczy „ani jednej
 *   przypisanej wypowiedzi", nigdy „milczał".
 */
export function speakingSecondsByBlock(
  segments: {
    start_time: number;
    end_time: number;
    speakerId: string | null;
  }[],
  maxGapSeconds = SPEAKING_BLOCK_MAX_GAP_SECONDS
): Map<string, number> {
  const sorted = [...segments].sort(
    (a, b) => Number(a.start_time) - Number(b.start_time)
  );

  const totals = new Map<string, number>();
  let open: { speakerId: string; start: number; end: number } | null = null;

  const close = () => {
    if (!open) return;
    totals.set(
      open.speakerId,
      (totals.get(open.speakerId) ?? 0) + (open.end - open.start)
    );
    open = null;
  };

  for (const seg of sorted) {
    const start = Number(seg.start_time);
    const end = Number(seg.end_time);
    // Segment bez mówcy przerywa blok, zamiast być pomijanym: to właśnie on
    // rozstrzyga, że dwie sąsiednie wypowiedzi tej samej osoby nie są ciągłe.
    if (!seg.speakerId) {
      close();
      continue;
    }
    if (
      open &&
      open.speakerId === seg.speakerId &&
      start - open.end <= maxGapSeconds
    ) {
      open.end = Math.max(open.end, end);
      continue;
    }
    close();
    open = { speakerId: seg.speakerId, start, end };
  }
  close();

  return totals;
}
