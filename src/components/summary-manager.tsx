"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { odmienUwagi } from "@/lib/odmiana";
import {
  importSummary,
  addSummaryFeedback,
  retireSummaryFeedback,
} from "@/app/sesje/[id]/actions";

export type SummaryFeedbackEntry = {
  id: string;
  /** Numer uwagi w obrębie tej rady — ten sam, który jedzie w wersji promptu. */
  seq: number;
  body: string;
  createdAt: string;
  promptVersion: number | null;
  authorName: string;
  isOwn: boolean;
};

/**
 * Panel przy podsumowaniu sesji. Podsumowania powstają poza serwisem
 * (prompt → czat → gotowy plik .md), więc obsługuje całą pętlę: pobranie
 * promptu, wgranie wyniku i zapisanie uwagi, czego prompt nie wyłapał — żeby
 * nie ginęło to w rozmowie.
 *
 * Dwa poziomy w jednym panelu, bo to jedna pętla pracy: manager (`canImport`)
 * widzi całość, moderator tylko uwagi. Uwagi zgłasza ten, kto siedzi
 * w transkrypcie i widzi, czego podsumowanie nie wyłapało — a to moderator,
 * nie manager.
 */
export function SummaryManager({
  meetingId,
  currentPromptVersion,
  summaryPromptVersion,
  summaryPromptMinor,
  feedbackAfterSummary,
  hasSummary,
  canImport,
  feedback,
}: {
  meetingId: string;
  currentPromptVersion: number;
  summaryPromptVersion: number | null;
  /**
   * Do której uwagi redakcji sięgał plik, którym powstał opis w serwisie.
   * `null` = opis sprzed numeracji albo bez tej informacji w treści.
   */
  summaryPromptMinor: number | null;
  /** Ile uwag tej rady doszło już po opisie; `null`, gdy nie da się policzyć. */
  feedbackAfterSummary: number | null;
  hasSummary: boolean;
  /** Manager: pobranie promptu i wgranie .md. Moderator dostaje same uwagi. */
  canImport: boolean;
  feedback: SummaryFeedbackEntry[];
}) {
  const router = useRouter();
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setIsImporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await importSummary(meetingId, await file.text());
      if (result.error) {
        setError(result.error);
        return;
      }
      setNotice(
        [
          "Podsumowanie wgrane.",
          result.topics
            ? `Tagi: ${result.topics.join(", ")}.`
            : "Bez linii TAGI — tagi zostały bez zmian.",
          result.promptVersion
            ? `Prompt v${result.promptVersion}${result.promptMinor !== null ? `.${result.promptMinor}` : ""}${result.isStale ? " (starszy niż aktualny)" : ""}.`
            : "Plik nie mówi, którą wersją promptu powstał — sesja będzie oznaczona jako nieaktualna.",
        ].join(" ")
      );
      router.refresh();
    } finally {
      setIsImporting(false);
    }
  }

  function handleFeedback() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await addSummaryFeedback(meetingId, draft);
      if (result.error) setError(result.error);
      else {
        setDraft("");
        router.refresh();
      }
    });
  }

  function handleRetire(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await retireSummaryFeedback(meetingId, id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  const isStale =
    hasSummary &&
    (summaryPromptVersion === null || summaryPromptVersion < currentPromptVersion);

  // Druga, łagodniejsza przyczyna nieaktualności niż podbity prompt: opis
  // powstał, zanim spłynęły kolejne uwagi. Nie znaczy „zły", znaczy „nie miał
  // szansy ich uwzględnić" — stąd osobny komunikat, nie to samo „do
  // odświeżenia".
  const nowszeUwagi = hasSummary ? (feedbackAfterSummary ?? 0) : 0;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-xs font-medium uppercase tracking-wide text-zinc-500">
          {canImport ? "Podsumowanie — narzędzia managera" : "Podsumowanie — uwagi"}
        </h3>
        <span className="text-xs text-zinc-400">
          {hasSummary
            ? `w serwisie: prompt v${summaryPromptVersion ?? "?"}${
                summaryPromptMinor !== null ? `.${summaryPromptMinor}` : ""
              }`
            : "brak podsumowania"}
          {isStale && " · do odświeżenia"}
          {nowszeUwagi > 0 &&
            ` · ${nowszeUwagi} ${odmienUwagi(nowszeUwagi)} po tym opisie`}
        </span>
      </div>

      {canImport && (
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/prompt-podsumowania/pobierz?meetingId=${meetingId}`}
          download
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Pobierz prompt (.md) — v{currentPromptVersion}
        </a>
        <label className="cursor-pointer rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          {isImporting ? "Wgrywanie..." : "Wgraj podsumowanie (.md)"}
          <input
            type="file"
            accept=".md,text/markdown"
            onChange={handleFile}
            disabled={isImporting}
            className="hidden"
          />
        </label>
      </div>
      )}

      <div className="flex flex-col gap-2">
        <label
          htmlFor="summary-feedback"
          className="text-xs text-zinc-500"
        >
          Czego prompt nie wyłapał w tej sesji? Uwagi zbierają się jako materiał
          do kolejnej wersji promptu.
        </label>
        <textarea
          id="summary-feedback"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="np. pominięta dyskusja o wycince drzew przy ul. Mogielnickiej — w podsumowaniu został sam wynik głosowania"
          className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />
        <button
          onClick={handleFeedback}
          disabled={isPending || draft.trim().length === 0}
          className="self-start rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 disabled:opacity-40 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Zapisz uwagę
        </button>
      </div>

      {feedback.length > 0 && (
        <ul className="flex flex-col gap-2">
          {feedback.map((f) => (
            <li
              key={f.id}
              className="rounded-xl bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900"
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                <span>{f.authorName}</span>
                <span>{f.createdAt.slice(0, 10)}</span>
                {f.promptVersion && <span>prompt v{f.promptVersion}</span>}
                <span title="Numer uwagi w tej radzie — ten sam, który jedzie w wersji promptu">
                  #{f.seq}
                </span>
                {summaryPromptMinor !== null && f.seq > summaryPromptMinor && (
                  <span className="text-amber-600 dark:text-amber-400">
                    nowsza niż opis
                  </span>
                )}
                {f.isOwn && (
                  <button
                    onClick={() => handleRetire(f.id)}
                    disabled={isPending}
                    title="Uwaga przestanie trafiać do pobieranych promptów, ale jej numer zostaje zajęty — inaczej wcześniejsze pobrania przestałyby być odtwarzalne"
                    className="ml-auto text-zinc-400 hover:text-red-600 disabled:opacity-40"
                  >
                    Wycofaj
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                {f.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {notice && <p className="text-xs text-emerald-600">{notice}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
