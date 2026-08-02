"use client";

import { useState, useTransition } from "react";
import { addMatterTag, removeMatterTag } from "@/app/sprawy/actions";

export function MatterTagEditor({
  matterId,
  tags,
  editable,
}: {
  matterId: string;
  tags: string[];
  editable: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (!editable && tags.length === 0) return null;

  function handleAdd() {
    const tag = draft.trim();
    if (!tag) return;
    setError(null);
    startTransition(async () => {
      const result = await addMatterTag(matterId, tag);
      if (result.error) setError(result.error);
      else setDraft("");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-400"
        >
          {tag}
          {editable && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await removeMatterTag(matterId, tag);
                  if (result.error) setError(result.error);
                });
              }}
              className="opacity-60 hover:opacity-100"
              aria-label={`Usuń tag ${tag}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {editable && (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="+ tag"
            disabled={isPending}
            className="w-20 rounded-full border border-dashed border-zinc-300 px-2.5 py-0.5 text-xs text-zinc-600 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:text-zinc-400"
          />
        </div>
      )}
      {error && <p className="w-full text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
