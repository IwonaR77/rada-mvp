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
import { ADMIN_LEVELS, type AdminLevel } from "@/lib/access-levels";

// Deliberately reuses the server actions from /admin/dostep rather than
// getting its own copies — the permission rules there (browse preservation,
// count checks, self-edit lock) are the hard-won part and must not fork.
// Only the presentation differs between the two panels.

type Grant = {
  id: string;
  permissions: string[];
  scopeCouncilId: string | null;
  councilName: string | null;
};

type Council = { id: string; name: string };

function levelFromPermissions(permissions: string[]): AdminLevel {
  // Highest tier first — moderator's permissions are a superset of
  // editor's, so checking editor first would match a moderator grant.
  return (Object.entries(ADMIN_LEVELS)
    .reverse()
    .find(([, def]) => def.permissions.every((p) => permissions.includes(p)))?.[0] ??
    "editor") as AdminLevel;
}

function LevelScopePicker({
  level,
  setLevel,
  councilId,
  setCouncilId,
  councils,
}: {
  level: AdminLevel;
  setLevel: (v: AdminLevel) => void;
  councilId: string;
  setCouncilId: (v: string) => void;
  councils: Council[];
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
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
      </div>
      {/* The old panel showed only the level's name, leaving the manager to
          guess what it actually permits. These descriptions already exist in
          ADMIN_LEVELS and were only used on the request-facing /dostep page. */}
      <p className="text-xs text-zinc-500">{ADMIN_LEVELS[level].description}</p>
    </>
  );
}

export function AccountActions(props: {
  mode: "grants" | "request";
  appUserId: string;
  councils: Council[];
  grants?: Grant[];
  request?: {
    id: string;
    requestedLevel: string;
    scopeCouncilId: string | null;
  };
}) {
  const { mode, appUserId, councils, grants = [], request } = props;
  const [open, setOpen] = useState<string | "new" | null>(null);
  const [denyNote, setDenyNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else {
        setOpen(null);
        router.refresh();
      }
    });
  }

  if (mode === "request" && request) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              run(() =>
                approveAccessRequest(
                  request.id,
                  request.requestedLevel as AdminLevel,
                  request.scopeCouncilId
                )
              )
            }
            className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Zatwierdź
          </button>
          <input
            type="text"
            value={denyNote}
            onChange={(e) => setDenyNote(e.target.value)}
            placeholder="Powód odrzucenia (opcjonalnie)"
            className="min-w-0 flex-1 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => denyAccessRequest(request.id, denyNote))}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Odrzuć
          </button>
        </div>
        {error && (
          <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {open === null && (
        <div className="flex flex-wrap justify-end gap-2">
          {grants.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setOpen(g.id)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Zmień{grants.length > 1 && ` (${g.councilName ?? "platforma"})`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen("new")}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            + Nadaj
          </button>
        </div>
      )}

      {open !== null && (
        <GrantForm
          key={open}
          appUserId={appUserId}
          councils={councils}
          grant={open === "new" ? null : (grants.find((g) => g.id === open) ?? null)}
          isPending={isPending}
          onCancel={() => setOpen(null)}
          onSave={run}
        />
      )}

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
}

function GrantForm({
  appUserId,
  councils,
  grant,
  isPending,
  onCancel,
  onSave,
}: {
  appUserId: string;
  councils: Council[];
  grant: Grant | null;
  isPending: boolean;
  onCancel: () => void;
  onSave: (fn: () => Promise<{ error: string | null }>) => void;
}) {
  const [level, setLevel] = useState<AdminLevel>(
    grant ? levelFromPermissions(grant.permissions) : "editor"
  );
  const [councilId, setCouncilId] = useState(grant?.scopeCouncilId ?? "");
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg bg-zinc-50 p-3 text-left dark:bg-zinc-900">
      <LevelScopePicker
        level={level}
        setLevel={setLevel}
        councilId={councilId}
        setCouncilId={setCouncilId}
        councils={councils}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            onSave(() =>
              grant
                ? updateUserRole(grant.id, level, councilId || null)
                : grantAccess(appUserId, level, councilId || null)
            )
          }
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
                onClick={() => onSave(() => revokeUserRole(grant.id))}
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
          onClick={onCancel}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
        >
          Zamknij
        </button>
      </div>
    </div>
  );
}
