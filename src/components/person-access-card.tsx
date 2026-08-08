"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateUserRole,
  revokeUserRole,
  grantAccess,
  approveAccessRequest,
  denyAccessRequest,
} from "@/app/admin/dostep/actions";
import { ADMIN_LEVELS, describeGrant, type AdminLevel } from "@/lib/access-levels";

type Grant = {
  id: string;
  scope_council_id: string | null;
  permissions: string[];
  councilName: string | null;
};

type PendingRequest = {
  id: string;
  requested_level: string;
  scope_council_id: string | null;
  councilName: string | null;
  message: string | null;
  created_at: string;
};

function levelFromPermissions(permissions: string[]): AdminLevel {
  // Check from the most-permission-heavy tier down — moderator's
  // permissions are a superset of editor's, so checking editor first would
  // wrongly match a moderator grant (every editor permission is present).
  return (Object.entries(ADMIN_LEVELS)
    .reverse()
    .find(([, def]) => def.permissions.every((p) => permissions.includes(p)))
    ?.[0] ?? "editor") as AdminLevel;
}

// Inline edit form for one grant (or a fresh one, when grant is null) —
// only ever mounted behind the pencil toggle in PersonAccessCard, never
// shown by default, so the common case (nothing to change) stays quiet.
function GrantEditor({
  appUserId,
  grant,
  councils,
  onDone,
}: {
  appUserId: string;
  grant: Grant | null;
  councils: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [level, setLevel] = useState<AdminLevel>(
    grant ? levelFromPermissions(grant.permissions) : "editor"
  );
  const [councilId, setCouncilId] = useState(grant?.scope_council_id ?? "");
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as AdminLevel)}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
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
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
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
              const result = grant
                ? await updateUserRole(grant.id, level, councilId || null)
                : await grantAccess(appUserId, level, councilId || null);
              if (result.error) setError(result.error);
              else {
                onDone();
                router.refresh();
              }
            });
          }}
          className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Zapisz
        </button>
        {grant &&
          (confirmingRevoke ? (
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
                    else {
                      onDone();
                      router.refresh();
                    }
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
          ))}
        <button
          type="button"
          onClick={onDone}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
        >
          Zamknij
        </button>
      </div>
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
}

export function PersonAccessCard({
  appUserId,
  holderName,
  isSelf,
  grants,
  requests,
  councils,
}: {
  appUserId: string;
  holderName: string;
  isSelf: boolean;
  grants: Grant[];
  requests: PendingRequest[];
  councils: { id: string; name: string }[];
}) {
  // Which grant is currently open for editing — a grant id, "new" for
  // adding a fresh one, or null for none. Only one at a time per card.
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [denyNoteById, setDenyNoteById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <li className="flex flex-col gap-3 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">
          {holderName}
          {isSelf && <span className="ml-1 font-normal text-zinc-400">(Ty)</span>}
        </span>
        {!isSelf && grants.length === 0 && editing !== "new" && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            title="Nadaj uprawnienie ręcznie"
          >
            ✎ Nadaj
          </button>
        )}
      </div>

      {grants.length === 0 && editing !== "new" && (
        <p className="text-xs text-zinc-500">Brak uprawnień współtworzenia.</p>
      )}

      {grants.map((g) =>
        editing === g.id ? (
          <GrantEditor
            key={g.id}
            appUserId={appUserId}
            grant={g}
            councils={councils}
            onDone={() => setEditing(null)}
          />
        ) : (
          <div key={g.id} className="flex items-center justify-between gap-2">
            <span className="text-zinc-700 dark:text-zinc-300">
              {describeGrant(g.permissions)} — {g.councilName ?? "cała platforma"}
            </span>
            {!isSelf && (
              <button
                type="button"
                onClick={() => setEditing(g.id)}
                className="shrink-0 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                title="Edytuj ręcznie"
              >
                ✎
              </button>
            )}
          </div>
        )
      )}

      {editing === "new" && (
        <GrantEditor
          appUserId={appUserId}
          grant={null}
          councils={councils}
          onDone={() => setEditing(null)}
        />
      )}

      {isSelf && (
        <p className="text-xs text-zinc-400">
          Edycja własnego uprawnienia niedostępna w tym panelu (chroni przed
          przypadkową utratą dostępu; poproś innego Managera).
        </p>
      )}

      {requests.map((r) => (
        <div
          key={r.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2 dark:border-blue-900 dark:bg-blue-950/30"
        >
          <span className="text-blue-900 dark:text-blue-200">
            Wniosek:{" "}
            <strong>
              {ADMIN_LEVELS[r.requested_level as AdminLevel]?.label ??
                r.requested_level}
            </strong>{" "}
            — {r.councilName ?? "cała platforma"}
          </span>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await approveAccessRequest(
                  r.id,
                  r.requested_level as AdminLevel,
                  r.scope_council_id
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
            value={denyNoteById[r.id] ?? ""}
            onChange={(e) =>
              setDenyNoteById((prev) => ({ ...prev, [r.id]: e.target.value }))
            }
            placeholder="Powód odrzucenia (opcjonalnie)"
            className="min-w-0 flex-1 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await denyAccessRequest(
                  r.id,
                  denyNoteById[r.id] ?? ""
                );
                if (result.error) setError(result.error);
                else router.refresh();
              });
            }}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Odrzuć
          </button>
        </div>
      ))}

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </li>
  );
}
