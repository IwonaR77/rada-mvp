"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatClock } from "@/lib/speech-blocks";
import {
  blockDomId,
  formatBlockQuote,
  MAX_BOOKMARKS,
  NOTE_MAX_LENGTH,
} from "@/lib/bookmarks";
import { useBookmarks } from "@/components/bookmarks-context";
import { saveBookmark, deleteBookmark } from "@/app/radny/[id]/actions";

/**
 * Wiersz bloku wypowiedzi: znacznik czasu, tekst i przyciski.
 *
 * Cały wiersz był dotąd jednym `<Link>`, ale przycisk wewnątrz odnośnika to
 * nieprawidłowy HTML — stąd podział na odnośnik na samym tekście (i na
 * znaczniku czasu) oraz osobne przyciski obok. To jedyny powód, dla którego
 * ten wiersz jest komponentem klienckim; schowek i zakładki i tak wymagają
 * klienta, więc robimy to raz dla wszystkich trzech przycisków.
 */
export function SpeechBlockRow({
  segmentId,
  meetingId,
  start,
  end,
  text,
  sessionDate,
}: {
  segmentId: string;
  meetingId: string;
  start: number;
  /** Koniec bloku — granica wycinka audio, nie ma go w żadnym id. */
  end: number;
  text: string;
  /** Data sesji słownie — trafia do atrybucji kopiowanego cytatu. */
  sessionDate: string;
}) {
  const {
    councilorId,
    councilorName,
    bookmarks,
    canBookmark,
    canDownloadAudio,
  } = useBookmarks();
  const href = `/sesje/${meetingId}?t=${Math.floor(start)}`;

  const slot = bookmarks.findIndex((b) => b.segmentId === segmentId);
  const bookmark = slot >= 0 ? bookmarks[slot] : null;

  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  // Krojenie idzie ze zdalnego HLS-a i trwa kilkadziesiąt sekund (mniej
  // więcej pół długości fragmentu), a przeglądarka pokazuje pobieranie
  // dopiero, gdy polecą pierwsze bajty — bez tej informacji klik wygląda na
  // nieudany.
  const [preparingAudio, setPreparingAudio] = useState(false);

  function handleBookmarkClick() {
    setError(null);
    if (bookmark) {
      setDraft(bookmark.note ?? "");
      setEditing((open) => !open);
      return;
    }
    // Zakładamy od razu, bez opisu — opis dopisuje się w polu, które zaraz
    // pod blokiem się otwiera. Inaczej kliknięcie ikonki nie robiłoby nic
    // widocznego do czasu zatwierdzenia tekstu.
    startTransition(async () => {
      const result = await saveBookmark({ segmentId, councilorId, note: "" });
      if (result.error === "limit") {
        setReplacing(true);
        return;
      }
      if (result.error) {
        setError(result.error);
        return;
      }
      setDraft("");
      setEditing(true);
    });
  }

  function handleReplace(replaceBookmarkId: string) {
    setError(null);
    startTransition(async () => {
      const result = await saveBookmark({
        segmentId,
        councilorId,
        note: "",
        replaceBookmarkId,
      });
      if (result.error && result.error !== "limit") {
        setError(result.error);
        return;
      }
      setReplacing(false);
      setDraft("");
      setEditing(true);
    });
  }

  function handleSaveNote() {
    setError(null);
    startTransition(async () => {
      const result = await saveBookmark({
        segmentId,
        councilorId,
        note: draft,
      });
      if (result.error && result.error !== "limit") {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  function handleDelete() {
    if (!bookmark) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteBookmark(bookmark.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  async function handleCopy() {
    const quote = formatBlockQuote({
      text,
      councilorName,
      sessionDate,
      url: `${window.location.origin}${href}`,
    });
    try {
      await navigator.clipboard.writeText(quote);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Przeglądarka nie pozwoliła na dostęp do schowka");
    }
  }

  return (
    <div
      id={blockDomId(segmentId)}
      className="group flex gap-3 rounded-lg px-1 py-1 transition-colors hover:bg-zinc-50 data-[highlight]:bg-amber-50 dark:hover:bg-zinc-900 dark:data-[highlight]:bg-amber-950/30"
    >
      {/* Stała szerokość kolumny: znacznik z godziną jest dłuższy niż sam
          minutowy, a bez tego tekst obok zaczynałby się w innym miejscu w
          każdym bloku. Przyciski siedzą pod znacznikiem w tej samej
          kolumnie, więc ich pojawienie się niczego nie przesuwa. */}
      <div className="flex w-14 shrink-0 flex-col items-end">
        <Link
          href={href}
          className="font-mono text-xs leading-6 tabular-nums text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          {formatClock(start)}
        </Link>
        <div
          className={`flex items-center gap-0.5 transition-opacity focus-within:opacity-100 group-hover:opacity-100 ${
            bookmark || editing || replacing ? "opacity-100" : "opacity-0"
          }`}
        >
          {canBookmark && (
            <button
              type="button"
              onClick={handleBookmarkClick}
              disabled={isPending}
              aria-expanded={editing}
              title={
                bookmark
                  ? `Zakładka ${slot + 1} — kliknij, by zmienić opis`
                  : "Dodaj zakładkę"
              }
              aria-label={
                bookmark
                  ? `Zakładka ${slot + 1} przy wypowiedzi o ${formatClock(start)} — zmień opis`
                  : `Dodaj zakładkę przy wypowiedzi o ${formatClock(start)}`
              }
              className={`rounded p-0.5 disabled:opacity-40 ${
                bookmark
                  ? "text-amber-500 hover:text-amber-600"
                  : "text-zinc-300 hover:text-amber-500 dark:text-zinc-600"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
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
          )}
          <button
            type="button"
            onClick={handleCopy}
            title="Kopiuj cytat z atrybucją i odnośnikiem"
            aria-label={`Kopiuj wypowiedź o ${formatClock(start)} jako cytat`}
            className="rounded p-0.5 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300"
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 9h9v11H9V9Zm-3 6H4V4h9v2"
              />
            </svg>
          </button>
          {/* Zwykły odnośnik z `download`, nie przycisk: pobieranie robi
              przeglądarka, a serwer i tak tnie strumieniowo. */}
          {canDownloadAudio && (
            <a
              href={`/sesje/${meetingId}/fragment?segment=${segmentId}&do=${Math.ceil(end)}`}
              download
              onClick={() => {
                setPreparingAudio(true);
                window.setTimeout(() => setPreparingAudio(false), 30_000);
              }}
              title="Pobierz ten fragment nagrania (mp3)"
              aria-label={`Pobierz mp3 z wypowiedzią o ${formatClock(start)}`}
              className="rounded p-0.5 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300"
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"
                />
              </svg>
            </a>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="block text-sm leading-6 text-zinc-700 dark:text-zinc-300"
        >
          {text}
        </Link>

        {/* Zapisany opis czyta się jak podpis mówcy w transkrypcie — jedna
            przygaszona linijka pod tekstem, nie osobny panel. */}
        {bookmark?.note && !editing && (
          <p className="mt-0.5 text-xs italic text-amber-700/80 dark:text-amber-500/80">
            {bookmark.note}
          </p>
        )}

        {editing && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={draft}
              maxLength={NOTE_MAX_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveNote();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder="Po co ta zakładka?"
              aria-label="Opis zakładki"
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={handleSaveNote}
              disabled={isPending}
              className="rounded-lg bg-zinc-900 px-2 py-1 text-xs text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Zapisz
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:text-red-600 disabled:opacity-40"
            >
              Usuń zakładkę
            </button>
          </div>
        )}

        {/* Limit slotów jest częścią funkcji, więc przy przekroczeniu pytamy,
            co wymienić — ciche „nie da się" zostawiałoby użytkownika z
            przyciskiem, który nic nie robi. */}
        {replacing && (
          <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/30">
            <p className="mb-1 text-amber-800 dark:text-amber-300">
              Masz już {MAX_BOOKMARKS} zakładek przy tym radnym. Którą zastąpić?
            </p>
            <div className="flex flex-wrap gap-1">
              {bookmarks.map((b, i) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => handleReplace(b.id)}
                  disabled={isPending}
                  className="rounded-full border border-amber-300 px-2 py-0.5 text-amber-800 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/40"
                >
                  {i + 1}. {b.note || formatClock(b.anchorSeconds)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setReplacing(false)}
                className="rounded-full px-2 py-0.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Anuluj
              </button>
            </div>
          </div>
        )}

        <p aria-live="polite" className="sr-only">
          {copied ? "Skopiowano cytat do schowka" : ""}
        </p>
        {preparingAudio && (
          <p className="mt-0.5 text-xs text-zinc-500">
            Przygotowuję mp3 — pobieranie ruszy za kilkadziesiąt sekund…
          </p>
        )}
        {copied && (
          <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-500">
            Skopiowano do schowka
          </p>
        )}
        {error && (
          <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
