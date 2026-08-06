"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_LEVELS, type AdminLevel } from "@/lib/access-levels";
import type { Database } from "@/lib/supabase/database.types";

async function requireManager() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Musisz być zalogowany" as const, supabase, userId: null };
  }

  const { data: manager } = await supabase.rpc("is_manager", { uid: user.id });
  if (!manager) {
    return { error: "Brak uprawnień managera" as const, supabase, userId: null };
  }

  return { error: null, supabase, userId: user.id };
}

async function logAudit(
  supabase: SupabaseClient<Database>,
  actorId: string,
  targetAppUserId: string,
  action: string,
  scopeCouncilId: string | null,
  details: string
) {
  await supabase.from("access_audit_log").insert({
    actor_id: actorId,
    target_app_user_id: targetAppUserId,
    action,
    scope_council_id: scopeCouncilId,
    details,
  });
}

export async function approveAccessRequest(
  requestId: string,
  overrideLevel: AdminLevel,
  overrideCouncilId: string | null
) {
  const { error: permError, supabase, userId } = await requireManager();
  if (permError) return { error: permError };
  if (!userId) return { error: "Musisz być zalogowany" };

  const { data: request } = await supabase
    .from("access_request")
    .select("app_user_id, requested_level, scope_council_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { error: "Nie znaleziono prośby" };
  if (request.status !== "pending")
    return { error: "Ta prośba została już rozpatrzona" };

  const levelDef = ADMIN_LEVELS[overrideLevel];
  if (!levelDef) return { error: "Nieznany poziom dostępu" };

  // A user can hold at most one user_role row per scope in practice today
  // (nothing else writes this table) — union permissions on re-request so
  // escalating editor→moderator adds rather than clobbers an earlier grant.
  let existingQuery = supabase
    .from("user_role")
    .select("id, permissions")
    .eq("app_user_id", request.app_user_id);
  existingQuery = overrideCouncilId
    ? existingQuery.eq("scope_council_id", overrideCouncilId)
    : existingQuery.is("scope_council_id", null);
  const { data: existing } = await existingQuery.maybeSingle();

  const mergedPermissions = Array.from(
    new Set([...(existing?.permissions ?? []), ...levelDef.permissions])
  );

  // user_role.role has a DB check constraint allowing only 'manager' —
  // it doesn't track the actual tier, that's what permissions[] is for.
  const roleWrite = existing
    ? await supabase
        .from("user_role")
        .update(
          { permissions: mergedPermissions, role: "manager" },
          { count: "exact" }
        )
        .eq("id", existing.id)
    : await supabase.from("user_role").insert(
        {
          app_user_id: request.app_user_id,
          role: "manager",
          permissions: mergedPermissions,
          scope_council_id: overrideCouncilId,
        },
        { count: "exact" }
      );

  if (roleWrite.error) return { error: roleWrite.error.message };
  if (roleWrite.count === 0)
    return { error: "Nie udało się zapisać uprawnień" };

  const wasOverridden =
    overrideLevel !== request.requested_level ||
    overrideCouncilId !== request.scope_council_id;

  const { error, count } = await supabase
    .from("access_request")
    .update(
      {
        status: "approved",
        decided_by: userId,
        decided_at: new Date().toISOString(),
        ...(wasOverridden
          ? {
              requested_level: overrideLevel,
              scope_council_id: overrideCouncilId,
              decision_note: `Pierwotnie proszono o: ${
                ADMIN_LEVELS[request.requested_level as AdminLevel]?.label ??
                request.requested_level
              }`,
            }
          : {}),
      },
      { count: "exact" }
    )
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { error: error.message };
  if (count === 0)
    return { error: "Prośba została już rozpatrzona przez kogoś innego" };

  await logAudit(
    supabase,
    userId,
    request.app_user_id,
    "request_approved",
    overrideCouncilId,
    `Zatwierdzono: ${levelDef.label}${wasOverridden ? " (zmieniono zakres/poziom)" : ""}`
  );

  revalidatePath("/admin/dostep");
  return { error: null };
}

export async function denyAccessRequest(requestId: string, note: string) {
  const { error: permError, supabase, userId } = await requireManager();
  if (permError) return { error: permError };
  if (!userId) return { error: "Musisz być zalogowany" };

  const { data: request } = await supabase
    .from("access_request")
    .select("app_user_id")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { error: "Nie znaleziono prośby" };

  const { error, count } = await supabase
    .from("access_request")
    .update(
      {
        status: "denied",
        decided_by: userId,
        decided_at: new Date().toISOString(),
        decision_note: note.trim() || null,
      },
      { count: "exact" }
    )
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { error: error.message };
  if (count === 0) return { error: "Prośba została już rozpatrzona" };

  await logAudit(
    supabase,
    userId,
    request.app_user_id,
    "request_denied",
    null,
    note.trim() || "Odrzucono bez podania powodu"
  );

  revalidatePath("/admin/dostep");
  return { error: null };
}

export async function updateUserRole(
  roleId: string,
  level: AdminLevel,
  councilId: string | null
) {
  const { error: permError, supabase, userId } = await requireManager();
  if (permError) return { error: permError };
  if (!userId) return { error: "Musisz być zalogowany" };

  const levelDef = ADMIN_LEVELS[level];
  if (!levelDef) return { error: "Nieznany poziom dostępu" };

  const { data: existing } = await supabase
    .from("user_role")
    .select("app_user_id")
    .eq("id", roleId)
    .maybeSingle();
  if (!existing) return { error: "Nie znaleziono uprawnienia" };

  const { error } = await supabase
    .from("user_role")
    // role stays 'manager' — see approveAccessRequest for why.
    .update({
      role: "manager",
      permissions: [...levelDef.permissions],
      scope_council_id: councilId,
    })
    .eq("id", roleId);

  if (error) return { error: error.message };

  await logAudit(
    supabase,
    userId,
    existing.app_user_id,
    "role_updated",
    councilId,
    `Zmieniono na: ${levelDef.label}`
  );

  revalidatePath("/admin/dostep");
  return { error: null };
}

export async function revokeUserRole(roleId: string) {
  const { error: permError, supabase, userId } = await requireManager();
  if (permError) return { error: permError };
  if (!userId) return { error: "Musisz być zalogowany" };

  const { data: existing } = await supabase
    .from("user_role")
    .select("app_user_id, permissions, scope_council_id")
    .eq("id", roleId)
    .maybeSingle();
  if (!existing) return { error: "Nie znaleziono uprawnienia" };

  const { error } = await supabase.from("user_role").delete().eq("id", roleId);
  if (error) return { error: error.message };

  await logAudit(
    supabase,
    userId,
    existing.app_user_id,
    "role_revoked",
    existing.scope_council_id,
    "Cofnięto dostęp"
  );

  revalidatePath("/admin/dostep");
  return { error: null };
}
