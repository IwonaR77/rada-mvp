"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserRole, revokeUserRole } from "@/app/admin/dostep/actions";
import { ADMIN_LEVELS, type AdminLevel } from "@/lib/access-levels";

export function UserRoleRow({
  grant,
  councils,
  isSelf,
}: {
  grant: {
    id: string;
    holderName: string;
    scope_council_id: string | null;
    permissions: string[];
    created_at: string;
  };
  councils: { id: string; name: string }[];
  isSelf: boolean;
}) {
  // Check from the most-permission-heavy tier down — moderator's
  // permissions are a superset of editor's, so checking editor first would
  // wrongly match a moderator grant (every editor permission is present).
  const currentLevel = (Object.entries(ADMIN_LEVELS)
    .reverse()
    .find(([, def]) => def.permissions.every((p) => grant.permissions.includes(p)))
    ?.[0] ?? "editor") as AdminLevel;

  const [level, setLevel] = useState<AdminLevel>(currentLevel);
  const [councilId, setCouncilId] = useState(grant.scope_council_id ?? "");
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const dirty =
    level !== currentLevel || (councilId || null) !== grant.scope_council_id;

  if (isSelf) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <span className="text-zinc-800 dark:text-zinc-200">
          {grant.holderName} <span className="text-zinc-400">(Ty)</span>
        </span>
        <span className="text-xs text-zinc-500">
          {ADMIN_LEVELS[currentLevel].label} — edycja własnego uprawnienia
          niedostępna w tym panelu (chroni przed przypadkową utratą dostępu;
          poproś innego Managera).
        </span>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
      <span className="text-zinc-800 dark:text-zinc-200">
        {grant.holderName}
      </span>

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

        {dirty && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await updateUserRole(
                  grant.id,
                  level,
                  councilId || null
                );
                if (result.error) setError(result.error);
                else router.refresh();
              });
            }}
            className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Zapisz
          </button>
        )}

        {confirmingRevoke ? (
          <span className="flex items-center gap-1">
            <span className="text-xs text-zinc-500">Na pewno?</span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await revokeUserRole(grant.id);
                  if (result.error) setError(result.error);
                  else router.refresh();
                });
              }}
              className="rounded-full bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Tak, cofnij
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRevoke(false)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
            >
              Anuluj
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingRevoke(true)}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Cofnij dostęp
          </button>
        )}
      </div>
      {error && (
        <p className="w-full text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </li>
  );
}
