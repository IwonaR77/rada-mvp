"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setAccessLevel,
  revokeUserRole,
  approveAccessRequest,
  denyAccessRequest,
} from "@/app/admin/konta/actions";
import { ADMIN_LEVELS, type AdminLevel } from "@/lib/access-levels";

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

function LevelSelect({
  level,
  setLevel,
}: {
  level: AdminLevel;
  setLevel: (v: AdminLevel) => void;
}) {
  return (
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
  const [open, setOpen] = useState(false);
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
        setOpen(false);
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
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Zarządzaj dostępem
        </button>
      ) : (
        <AccessEditor
          appUserId={appUserId}
          councils={councils}
          grants={grants}
          isPending={isPending}
          onClose={() => setOpen(false)}
          onSave={run}
        />
      )}

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
}

/**
 * Edytor dostępu jednej osoby: po wierszu na każdy zakres, w którym coś ma,
 * plus wiersz na dołożenie kolejnego zakresu.
 *
 * Zakres jest tożsamością wiersza i nie da się go tu zmienić — przeniesienie
 * uprawnienia to cofnięcie w jednym zakresie i nadanie w drugim. Dzięki temu
 * zapis ma zawsze jedno znaczenie: „w tym zakresie ma być ten poziom".
 */
function AccessEditor({
  appUserId,
  councils,
  grants,
  isPending,
  onClose,
  onSave,
}: {
  appUserId: string;
  councils: Council[];
  grants: Grant[];
  isPending: boolean;
  onClose: () => void;
  onSave: (fn: () => Promise<{ error: string | null }>) => void;
}) {
  const takenScopes = new Set(grants.map((g) => g.scopeCouncilId ?? ""));

  return (
    <div className="flex w-full min-w-64 flex-col gap-3 rounded-lg bg-zinc-50 p-3 text-left dark:bg-zinc-900">
      {grants.length === 0 && (
        <p className="text-xs text-zinc-500">
          Ta osoba ma dziś tylko podstawowy dostęp do przeglądania.
        </p>
      )}

      {grants.map((g) => (
        <GrantRow
          key={g.id}
          appUserId={appUserId}
          grant={g}
          isPending={isPending}
          onSave={onSave}
        />
      ))}

      <AddScopeRow
        appUserId={appUserId}
        councils={councils}
        takenScopes={takenScopes}
        isPending={isPending}
        onSave={onSave}
      />

      <button
        type="button"
        onClick={onClose}
        className="self-start rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
      >
        Zamknij
      </button>
    </div>
  );
}

function GrantRow({
  appUserId,
  grant,
  isPending,
  onSave,
}: {
  appUserId: string;
  grant: Grant;
  isPending: boolean;
  onSave: (fn: () => Promise<{ error: string | null }>) => void;
}) {
  const current = levelFromPermissions(grant.permissions);
  const [level, setLevel] = useState<AdminLevel>(current);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const changed = level !== current;

  return (
    <div className="flex flex-col gap-1 border-t border-zinc-200 pt-2 first:border-0 first:pt-0 dark:border-zinc-800">
      <span className="text-xs font-medium text-zinc-500">
        {grant.councilName ?? "Cała platforma"}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <LevelSelect level={level} setLevel={setLevel} />
        {/* Zapisz pojawia się dopiero po zmianie — bez tego kliknięcie
            „Zapisz" bez ruszania listy wyglądałoby jak operacja, a byłoby
            zapisem tego samego poziomu. */}
        {changed && (
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              onSave(() =>
                setAccessLevel(appUserId, level, grant.scopeCouncilId)
              )
            }
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
            Cofnij
          </button>
        )}
      </div>
      <p className="text-xs text-zinc-500">{ADMIN_LEVELS[level].description}</p>
    </div>
  );
}

function AddScopeRow({
  appUserId,
  councils,
  takenScopes,
  isPending,
  onSave,
}: {
  appUserId: string;
  councils: Council[];
  takenScopes: Set<string>;
  isPending: boolean;
  onSave: (fn: () => Promise<{ error: string | null }>) => void;
}) {
  // Zakresy już zajęte znikają z listy: mają własny wiersz wyżej, więc
  // dokładanie ich tutaj drugi raz nie miałoby innego znaczenia niż zmiana
  // poziomu w tamtym wierszu.
  const available = [
    ...(takenScopes.has("") ? [] : [{ id: "", name: "Cała platforma" }]),
    ...councils.filter((c) => !takenScopes.has(c.id)),
  ];
  const [level, setLevel] = useState<AdminLevel>("editor");
  const [councilId, setCouncilId] = useState(available[0]?.id ?? "");

  if (available.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
      <span className="text-xs font-medium text-zinc-500">Dodaj zakres</span>
      <div className="flex flex-wrap items-center gap-2">
        <LevelSelect level={level} setLevel={setLevel} />
        <select
          value={councilId}
          onChange={(e) => setCouncilId(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        >
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            onSave(() => setAccessLevel(appUserId, level, councilId || null))
          }
          className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Dodaj
        </button>
      </div>
      <p className="text-xs text-zinc-500">{ADMIN_LEVELS[level].description}</p>
    </div>
  );
}
