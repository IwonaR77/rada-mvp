"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { grantAccess } from "@/app/admin/dostep/actions";
import { ADMIN_LEVELS, type AdminLevel } from "@/lib/access-levels";

export function GrantAccessRow({
  appUserId,
  holderName,
  councils,
}: {
  appUserId: string;
  holderName: string;
  councils: { id: string; name: string }[];
}) {
  const [level, setLevel] = useState<AdminLevel>("editor");
  const [councilId, setCouncilId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
      <span className="text-zinc-800 dark:text-zinc-200">{holderName}</span>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as AdminLevel)}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        >
          {Object.entries(ADMIN_LEVELS).map(([key, def]) => (
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

        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await grantAccess(appUserId, level, councilId || null);
              if (result.error) setError(result.error);
              else router.refresh();
            });
          }}
          className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Nadaj
        </button>
      </div>
      {error && (
        <p className="w-full text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </li>
  );
}
