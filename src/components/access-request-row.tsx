"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveAccessRequest,
  denyAccessRequest,
} from "@/app/admin/dostep/actions";
import { ACCESS_LEVELS } from "@/lib/access-levels";

export function AccessRequestRow({
  request,
}: {
  request: {
    id: string;
    requested_level: string;
    message: string | null;
    created_at: string;
    requesterName: string;
    councilName: string | null;
  };
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const levelLabel =
    ACCESS_LEVELS[request.requested_level as keyof typeof ACCESS_LEVELS]
      ?.label ?? request.requested_level;

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {request.requesterName}
        </p>
        <p className="text-xs text-zinc-400">
          {new Date(request.created_at).toLocaleDateString("pl-PL", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Poziom: <strong>{levelLabel}</strong>
        {request.councilName && ` — ${request.councilName}`}
      </p>
      {request.message && (
        <p className="rounded-lg bg-zinc-50 p-2 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {request.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await approveAccessRequest(request.id);
              if (result.error) setError(result.error);
              else router.refresh();
            });
          }}
          className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Zatwierdź
        </button>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Powód odrzucenia (opcjonalnie)"
          className="min-w-0 flex-1 rounded-full border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await denyAccessRequest(request.id, note);
              if (result.error) setError(result.error);
              else router.refresh();
            });
          }}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Odrzuć
        </button>
      </div>
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </li>
  );
}
