// Zakładki przy blokach wypowiedzi na profilu radnego — rzeczy wspólne dla
// serwera (akcje, zapytania) i klienta (przyciski, pasek).

/**
 * Ile zakładek mieści się przy jednym radnym.
 *
 * Zakładki są od zaznaczania najważniejszych wypowiedzi, więc limit jest
 * częścią funkcji, a nie ograniczeniem technicznym: przy dziesiątej trzeba
 * wybrać, która wypada. Numer slotu jest jednocześnie skrótem klawiszowym
 * (1–9), więc limit ma sens także nawigacyjny.
 */
export const MAX_BOOKMARKS = 10;

/** Opis zakładki to jedna linijka pod blokiem, nie notatka — stąd twardy limit. */
export const NOTE_MAX_LENGTH = 200;

export type Bookmark = {
  id: string;
  segmentId: string;
  meetingId: string;
  anchorSeconds: number;
  note: string | null;
  /**
   * Zakładka bez swojego bloku w panelu — segment przestał być przypisany do
   * tego radnego (cofnięte przypisanie, zmiana statusu). Zostaje jako slot,
   * ale prowadzi wprost do miejsca w nagraniu, a nie do wiersza na stronie.
   */
  orphaned: boolean;
};

/** Id elementu bloku w DOM — po nim pasek zakładek skacze do wypowiedzi. */
export function blockDomId(segmentId: string) {
  return `blok-${segmentId}`;
}

/**
 * Cytat do wklejenia gdzie indziej: treść, kto i kiedy to powiedział, oraz
 * odnośnik do tego miejsca w nagraniu.
 *
 * Sam goły tekst po wklejeniu na Facebooka przestaje być weryfikowalny —
 * atrybucja i link są tu po to, żeby dało się wrócić do źródła.
 */
export function formatBlockQuote({
  text,
  councilorName,
  sessionDate,
  url,
}: {
  text: string;
  councilorName: string;
  sessionDate: string;
  url: string;
}) {
  return `„${text}”\n— ${councilorName}, sesja ${sessionDate}\n${url}`;
}
