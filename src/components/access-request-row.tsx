"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveAccessRequest,
  denyAccessRequest,
} from "@/app/admin/dostep/actions";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/access-levels";

export function AccessRequestRow({
  request,
  councils,
}: {
  request: {
    id: string;
    requested_level: string;
    scope_council_id: string | null;
    message: string | null;
    created_at: string;
    requesterName: string;
    councilName: string | null;
  };
  councils: { id: string; name: string }[];
}) {
  const [level, setLevel] = useState<AccessLevel>(
    request.requested_level in ACCESS_LEVELS
      ? (request.requested_level as AccessLevel)
      : "editor"
  );
  const [councilId, setCouncilId] = useState(request.scope_council_id ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const changedFromRequest =
    level !== request.requested_level ||
    (councilId || null) !== request.scope_council_id;

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
      {request.message && (
        <p className="rounded-lg bg-zinc-50 p-2 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {request.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as AccessLevel)}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        >
          {Object.entries(ACCESS_LEVELS).map(([key, def]) => (
            <option key={key} value={key}>
              {def.label}
            </option>
          ))}
        </select>
        <select
          value={councilId}
          onChange={(e) => setCouncilId(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">Cała platforma</option>
          {councils.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {changedFromRequest && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            zmieniono z pierwotnej prośby (
            {ACCESS_LEVELS[request.requested_level as AccessLevel]?.label ??
              request.requested_level}
            {request.councilName && ` — ${request.councilName}`}
            )
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await approveAccessRequest(
                request.id,
                level,
                councilId || null
              );
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
