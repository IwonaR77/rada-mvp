"use client";

import { useState, useTransition } from "react";
import { approveMatter } from "@/app/sprawy/actions";

export function ApproveMatterButton({ matterId }: { matterId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await approveMatter(matterId);
            if (result.error) setError(result.error);
          });
        }}
        className="shrink-0 rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? "Zatwierdzanie…" : "Zatwierdź"}
      </button>
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
