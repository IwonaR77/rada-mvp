"use client";

import { useEffect, useState } from "react";
import { blockDomId, MAX_BOOKMARKS, type Bookmark } from "@/lib/bookmarks";
import { formatClock } from "@/lib/speech-blocks";
import { scrollToBlock, useBookmarks } from "@/components/bookmarks-context";

/**
 * Zakładka z blokiem na stronie prowadzi do wiersza, osierocona — wprost do
 * nagrania. Bez tego jej slot byłby przyciskiem, który nic nie robi.
 */
function goToBookmark(bookmark: Bookmark) {
  if (bookmark.orphaned) {
    window.location.href = `/sesje/${bookmark.meetingId}?t=${Math.floor(
      bookmark.anchorSeconds
    )}`;
    return;
  }
  scrollToBlock(blockDomId(bookmark.segmentId));
}

/**
 * Pasek zakładek nad panelem wypowiedzi — nawigacja, nie zakładanie.
 *
 * Sloty idą w kolejności chronologicznej bloków, a nie zakładania: pasek ma
 * się czytać jak oś kadencji tego radnego, a nie jak stos ostatnich klików.
 * Numer slotu jest jednocześnie skrótem klawiszowym, więc limit z
 * MAX_BOOKMARKS daje coś w zamian, zamiast tylko ograniczać.
 */
export function BookmarkBar() {
  const { bookmarks, canBookmark } = useBookmarks();
  // Podpowiedź spod kursora nie istnieje na dotyku, więc ten sam opis
  // pokazujemy w linijce obok paska — po najechaniu i po kliknięciu.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      const digit = Number(e.key);
      if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;
      const bookmark = bookmarks[digit - 1];
      if (!bookmark) return;
      e.preventDefault();
      setActiveIndex(digit - 1);
      goToBookmark(bookmark);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bookmarks]);

  if (!canBookmark) return null;

  const active = activeIndex !== null ? bookmarks[activeIndex] : null;
  const label = active
    ? `${activeIndex! + 1}. ${active.note || formatClock(active.anchorSeconds)}`
    : bookmarks.length === 0
      ? "Zakładki: ikonka przy wypowiedzi"
      : `Zakładki (${bookmarks.length}/${MAX_BOOKMARKS}) — klawisze 1–9`;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: MAX_BOOKMARKS }, (_, i) => {
          const bookmark = bookmarks[i];
          const description = bookmark
            ? `${i + 1}. ${bookmark.note || formatClock(bookmark.anchorSeconds)}${
                bookmark.orphaned ? " (wypowiedź już nieprzypisana)" : ""
              }`
            : `Slot ${i + 1} — wolny`;
          return (
            <button
              key={bookmark?.id ?? `pusty-${i}`}
              type="button"
              disabled={!bookmark}
              title={description}
              aria-label={
                bookmark
                  ? `Przejdź do zakładki ${description}`
                  : `Zakładka ${i + 1} — wolna`
              }
              onMouseEnter={() => bookmark && setActiveIndex(i)}
              onFocus={() => bookmark && setActiveIndex(i)}
              onClick={() => {
                if (!bookmark) return;
                setActiveIndex(i);
                goToBookmark(bookmark);
              }}
              className={
                bookmark
                  ? `rounded p-0.5 hover:text-amber-600 ${
                      bookmark.orphaned ? "text-amber-500/40" : "text-amber-500"
                    }`
                  : "rounded p-0.5 text-zinc-200 dark:text-zinc-700"
              }
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill={bookmark ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 4h12v16l-6-4-6 4V4Z"
                />
              </svg>
            </button>
          );
        })}
      </div>
      <span className="truncate text-xs font-normal normal-case tracking-normal text-zinc-500">
        {label}
      </span>
    </div>
  );
}
