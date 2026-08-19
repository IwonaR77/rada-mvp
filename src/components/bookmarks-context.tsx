"use client";

import { createContext, useContext } from "react";
import type { Bookmark } from "@/lib/bookmarks";

type BookmarksValue = {
  councilorId: string;
  councilorName: string;
  /** Wszystkie zakładki tego użytkownika przy tym radnym, chronologicznie. */
  bookmarks: Bookmark[];
  /** Niezalogowany widzi bloki, ale nie ma czym oznaczać — zostaje kopiowanie. */
  canBookmark: boolean;
  /** Czy to wdrożenie ma ffmpeg — patrz AUDIO_CUT_ENABLED. */
  canDownloadAudio: boolean;
};

const BookmarksContext = createContext<BookmarksValue | null>(null);

/**
 * Jedna kopia listy zakładek dla całego panelu wypowiedzi.
 *
 * Bez tego pasek i każdy z kilkuset wierszy dostawałby tę samą listę
 * propsami — a przy zmianie i tak wszystko odświeża `refresh()` z akcji
 * serwerowej, więc nie ma tu stanu do trzymania po stronie klienta.
 * Dzieci są renderowane na serwerze i przechodzą przez provider bez zmian.
 */
export function BookmarksProvider({
  children,
  ...value
}: BookmarksValue & { children: React.ReactNode }) {
  return (
    <BookmarksContext.Provider value={value}>
      {children}
    </BookmarksContext.Provider>
  );
}

export function useBookmarks() {
  const value = useContext(BookmarksContext);
  if (!value) {
    throw new Error("useBookmarks poza BookmarksProvider");
  }
  return value;
}

/**
 * Przewinięcie do bloku, który może siedzieć w zwiniętej sesji.
 *
 * Zawartość zamkniętego `<details>` jest w DOM-ie (tylko nie jest rysowana),
 * więc element znajdziemy zawsze — trzeba tylko najpierw rozwinąć sesję,
 * a przewijać dopiero po przerysowaniu.
 */
export function scrollToBlock(domId: string) {
  const el = document.getElementById(domId);
  if (!el) return;

  const details = el.closest("details");
  if (details && !details.open) details.open = true;

  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.dataset.highlight = "true";
    window.setTimeout(() => delete el.dataset.highlight, 1600);
  });
}
