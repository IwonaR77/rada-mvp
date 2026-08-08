import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccessRequestRow } from "@/components/access-request-row";
import { UserRoleRow } from "@/components/user-role-row";
import { GrantAccessRow } from "@/components/grant-access-row";
import { ACCESS_LEVELS, describeGrant } from "@/lib/access-levels";

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(date: string) {
  return new Date(date).toLocaleString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  request_approved: "Zatwierdzono prośbę",
  request_denied: "Odrzucono prośbę",
  role_updated: "Zmieniono uprawnienie",
  role_revoked: "Cofnięto uprawnienie",
};

export default async function AdminDostepPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: isManager } = await supabase.rpc("is_manager", {
    uid: user.id,
  });
  if (!isManager) notFound();

  const [{ data: councils }, { data: requests }, { data: grants }, { data: audit }] =
    await Promise.all([
      supabase.from("council").select("id, name").order("name"),
      supabase
        .from("access_request")
        .select(
          "id, app_user_id, requested_level, scope_council_id, message, status, created_at, decided_at, decision_note, app_user:app_user_id(display_name), council:scope_council_id(name)"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("user_role")
        .select(
          "id, app_user_id, permissions, scope_council_id, created_at, app_user:app_user_id(display_name), council:scope_council_id(name)"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("access_audit_log")
        .select(
          "id, action, details, created_at, actor:actor_id(display_name), target:target_app_user_id(display_name), council:scope_council_id(name)"
        )
        .order("created_at", { ascending: false })
        .range(0, 49),
    ]);

  const councilList = councils ?? [];

  // Every account auto-holds a "browse"-only row from first login (see
  // grant_browse_permission()) — that's not an editable contribution tier
  // (ADMIN_LEVELS doesn't even have an entry for it, so UserRoleRow's
  // "current level" dropdown would mismatch it against Redaktor by
  // accident). Keep those out of the editable list; a manager cares about
  // who has real Redaktor/Moderator/Manager access, not who's logged in.
  const allGrantRows = (grants ?? []).map((g) => ({
    ...g,
    holderName: g.app_user?.display_name ?? "Nieznany użytkownik",
    councilName: g.council?.name ?? null,
  }));
  const grantRows = allGrantRows.filter(
    (g) => !(g.permissions.length === 1 && g.permissions[0] === "browse")
  );
  // A person (not just a row) belongs in "no contribution access" only if
  // NONE of their rows carry a real tier — Barbara e.g. has two rows (a
  // scoped Moderator grant + her own global browse-only auto-grant) and
  // must not show up here just because one of her rows happens to be
  // browse-only.
  const rows = (requests ?? []).map((r) => ({
    ...r,
    requesterName: r.app_user?.display_name ?? "Nieznany użytkownik",
    councilName: r.council?.name ?? null,
  }));

  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");

  const contributorIds = new Set(grantRows.map((g) => g.app_user_id));
  // A browse-only account with an actual pending request must show up
  // *only* in "Oczekujące" below, never also as a generic quick-grant
  // shortcut here — the shortcut's Redaktor/cała platforma defaults have
  // nothing to do with what was actually requested, and a manager acting
  // on the wrong one of two look-alike rows for the same person is exactly
  // how a request for Moderator/Grójec ends up granted as Redaktor/global.
  const pendingRequesterIds = new Set(pending.map((r) => r.app_user_id));
  const browseOnlyRows = allGrantRows.filter(
    (g) =>
      g.permissions.length === 1 &&
      g.permissions[0] === "browse" &&
      !contributorIds.has(g.app_user_id) &&
      !pendingRequesterIds.has(g.app_user_id)
  );

  const ownGrants = grantRows.filter((g) => g.app_user_id === user.id);
  const ownGrantLabel = describeGrant(
    ownGrants.flatMap((g) => g.permissions)
  );
  const ownScopes = ownGrants.map((g) => g.councilName ?? "cała platforma");

  const auditRows = (audit ?? []).map((a) => ({
    ...a,
    actorName: a.actor?.display_name ?? "Nieznany użytkownik",
    targetName: a.target?.display_name ?? "Nieznany użytkownik",
    councilName: a.council?.name ?? null,
  }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Uprawnienia
      </h1>

      {ownGrantLabel && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          Twój poziom dostępu: <strong>{ownGrantLabel}</strong>
          {" — "}
          {ownScopes.join(", ")}
        </p>
      )}

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Uprawnienia ({grantRows.length})
        </h2>
        {grantRows.length === 0 ? (
          <p className="text-sm text-zinc-500">Nikt nie ma jeszcze nadanego dostępu.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {grantRows.map((g) => (
              <UserRoleRow
                key={g.id}
                grant={g}
                councils={councilList}
                isSelf={g.app_user_id === user.id}
              />
            ))}
          </ul>
        )}
      </section>

      {browseOnlyRows.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Konta bez uprawnień współtworzenia ({browseOnlyRows.length})
          </h2>
          <p className="mb-3 text-xs text-zinc-500">
            Mają tylko automatycznie nadane uprawnienie przeglądania — możesz
            nadać im dostęp do współtworzenia bez czekania na ich wniosek.
          </p>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {browseOnlyRows.map((g) => (
              <GrantAccessRow
                key={g.id}
                appUserId={g.app_user_id}
                holderName={g.holderName}
                councils={councilList}
              />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Oczekujące ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-zinc-500">Brak oczekujących próśb.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((r) => (
              <AccessRequestRow key={r.id} request={r} councils={councilList} />
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Historia próśb
          </h2>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-zinc-800 dark:text-zinc-200">
                    {r.requesterName} —{" "}
                    {ACCESS_LEVELS[
                      r.requested_level as keyof typeof ACCESS_LEVELS
                    ]?.label ?? r.requested_level}
                    {r.councilName && ` — ${r.councilName}`}
                  </span>
                  <span
                    className={
                      r.status === "approved"
                        ? "text-xs font-medium text-emerald-600 dark:text-emerald-400"
                        : "text-xs font-medium text-zinc-500"
                    }
                  >
                    {r.status === "approved" ? "Zatwierdzona" : "Odrzucona"}
                    {r.decided_at && ` — ${formatDate(r.decided_at)}`}
                  </span>
                </div>
                {r.decision_note && (
                  <p className="text-xs text-zinc-500">{r.decision_note}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Log zdarzeń
        </h2>
        {auditRows.length === 0 ? (
          <p className="text-sm text-zinc-500">Brak zdarzeń.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {auditRows.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-zinc-800 dark:text-zinc-200">
                    <strong>{AUDIT_ACTION_LABELS[a.action] ?? a.action}</strong>
                    {" — "}
                    {a.targetName}
                    {a.councilName && ` — ${a.councilName}`}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {formatDateTime(a.created_at)}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  {a.details} · przez {a.actorName}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
