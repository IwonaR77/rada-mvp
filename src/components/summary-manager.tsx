"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  importSummary,
  addSummaryFeedback,
  deleteSummaryFeedback,
} from "@/app/sesje/[id]/actions";

export type SummaryFeedbackEntry = {
  id: string;
  body: string;
  createdAt: string;
  promptVersion: number | null;
  authorName: string;
  isOwn: boolean;
};

/**
 * Narzędzia managera przy podsumowaniu sesji. Podsumowania powstają poza
 * serwisem (prompt → czat → gotowy plik .md), więc ten panel obsługuje całą
 * pętlę: pobranie promptu, wgranie wyniku i zapisanie uwagi, czego prompt nie
 * wyłapał — żeby nie ginęło to w rozmowie.
 */
export function SummaryManager({
  meetingId,
  currentPromptVersion,
  summaryPromptVersion,
  hasSummary,
  feedback,
}: {
  meetingId: string;
  currentPromptVersion: number;
  summaryPromptVersion: number | null;
  hasSummary: boolean;
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
            ? `Prompt v${result.promptVersion}${result.isStale ? " (starszy niż aktualny)" : ""}.`
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

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteSummaryFeedback(meetingId, id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  const isStale =
    hasSummary &&
    (summaryPromptVersion === null || summaryPromptVersion < currentPromptVersion);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-xs font-medium uppercase tracking-wide text-zinc-500">
          Podsumowanie — narzędzia managera
        </h3>
        <span className="text-xs text-zinc-400">
          {hasSummary
            ? `w serwisie: prompt v${summaryPromptVersion ?? "?"}`
            : "brak podsumowania"}
          {isStale && " · do odświeżenia"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href="/prompt-podsumowania/pobierz"
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
                {f.isOwn && (
                  <button
                    onClick={() => handleDelete(f.id)}
                    disabled={isPending}
                    className="ml-auto text-zinc-400 hover:text-red-600 disabled:opacity-40"
                  >
                    Usuń
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
