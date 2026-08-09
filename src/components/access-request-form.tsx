"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitAccessRequest } from "@/app/dostep/actions";
import {
  ACCESS_LEVELS,
  MESSAGE_MAX_LENGTH,
  tierChipClass,
  type AccessLevel,
} from "@/lib/access-levels";

export function AccessRequestForm({
  councils,
  availableLevels,
}: {
  councils: { id: string; name: string }[];
  availableLevels: AccessLevel[];
}) {
  const [level, setLevel] = useState<AccessLevel>(availableLevels[0]);
  const [councilId, setCouncilId] = useState(councils[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (availableLevels.length === 0) return null;

  // No outer border on the form: the level options are themselves bordered
  // cards, and wrapping them in another panel doubled the outline.
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await submitAccessRequest(
            level,
            councilId || null,
            message
          );
          if (result.error) setError(result.error);
          else router.refresh();
        });
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        {availableLevels.map((key) => {
          const def = ACCESS_LEVELS[key];
          return (
            <label
              key={key}
              className={`flex cursor-pointer flex-col gap-1.5 rounded-2xl border p-4 text-sm transition-colors ${
                level === key
                  ? "border-zinc-900 dark:border-zinc-100"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="level"
                  checked={level === key}
                  onChange={() => setLevel(key)}
                />
                <span className={tierChipClass(def.label)}>{def.label}</span>
              </span>
              <span className="pl-6 text-zinc-500">{def.description}</span>
            </label>
          );
        })}
      </div>

      {councils.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Rada</span>
          <select
            value={councilId}
            onChange={(e) => setCouncilId(e.target.value)}
            className="rounded-xl border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {councils.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">
          Wiadomość (opcjonalnie)
        </span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={MESSAGE_MAX_LENGTH}
          rows={3}
          placeholder="Np. dlaczego chcesz pomóc, czy masz już doświadczenie..."
          className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Wysyłanie…" : "Wyślij prośbę"}
      </button>
    </form>
  );
}
