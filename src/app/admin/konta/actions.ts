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

// Shared by approveAccessRequest and grantAccess — a user can hold at most
// one user_role row per scope in practice today (nothing else writes this
// table), so this unions permissions on re-grant rather than clobbering an
// earlier one. Crucially, a target's global (scope=null) row is also where
// their auto-granted "browse" permission lives (see grant_browse_permission
// in /auth/callback) — merging into it rather than replacing preserves
// browse instead of silently taking away basic access while adding a
// contribution tier.
async function mergeUserRoleGrant(
  supabase: SupabaseClient<Database>,
  targetAppUserId: string,
  levelDef: { permissions: readonly string[] },
  councilId: string | null
) {
  let existingQuery = supabase
    .from("user_role")
    .select("id, permissions")
    .eq("app_user_id", targetAppUserId);
  existingQuery = councilId
    ? existingQuery.eq("scope_council_id", councilId)
    : existingQuery.is("scope_council_id", null);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  // A UNIQUE index now guarantees at most one row per (app_user_id, scope)
  // (see migration 2026-08-09), so this should never fire in normal
  // operation — but .maybeSingle() still errors if it somehow does, and
  // that error used to be silently dropped here (only `data` was
  // destructured), which masked a real duplicate-row bug in production.
  if (existingError) return { error: existingError, count: null };

  const mergedPermissions = Array.from(
    new Set([...(existing?.permissions ?? []), ...levelDef.permissions])
  );

  // user_role.role has a DB check constraint allowing only 'manager' — it
  // doesn't track the actual tier, that's what permissions[] is for.
  return existing
    ? supabase
        .from("user_role")
        .update(
          { permissions: mergedPermissions, role: "manager" },
          { count: "exact" }
        )
        .eq("id", existing.id)
    : supabase.from("user_role").insert(
        {
          app_user_id: targetAppUserId,
          role: "manager",
          permissions: mergedPermissions,
          scope_council_id: councilId,
        },
        { count: "exact" }
      );
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

  const roleWrite = await mergeUserRoleGrant(
    supabase,
    request.app_user_id,
    levelDef,
    overrideCouncilId
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

  revalidatePath("/admin/konta");
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

  revalidatePath("/admin/konta");
  return { error: null };
}

/**
 * Ustawia poziom dostępu osoby w JEDNYM zakresie — tworzy wpis, jeśli go tam
 * jeszcze nie ma, a jeśli jest, zastępuje dotychczasowy poziom.
 *
 * Jedna operacja zamiast dawnej pary „nadaj" (sumowała uprawnienia) i „zmień"
 * (zastępowała je). Panel wyglądał tak samo w obu przypadkach, więc obniżenie
 * poziomu przez „nadaj" po cichu nic nie robiło — suma uprawnień Moderatora
 * i Redaktora to nadal Moderator — a w logu zdarzeń lądował wpis o nadaniu,
 * które się nie odbyło.
 *
 * Sumowanie zostaje tam, gdzie jest na miejscu: przy zatwierdzaniu próśb
 * o dostęp (`approveAccessRequest`), gdzie nikt niczego nie obniża.
 *
 * @param level Poziom docelowy; `browse` (nadawane automatycznie przy
 *   pierwszym logowaniu) przetrwa niezależnie od wyboru — zmieniamy szczebel
 *   współtworzenia, nie odbieramy podstawowego dostępu.
 */
export async function setAccessLevel(
  targetAppUserId: string,
  level: AdminLevel,
  councilId: string | null
) {
  const { error: permError, supabase, userId } = await requireManager();
  if (permError) return { error: permError };
  if (!userId) return { error: "Musisz być zalogowany" };

  const levelDef = ADMIN_LEVELS[level];
  if (!levelDef) return { error: "Nieznany poziom dostępu" };

  // Ta sama blokada co dawniej w updateUserRole: gdyby jedyny manager obniżył
  // sobie poziom, zamknąłby się w /admin/konta bez drogi powrotnej poza
  // bezpośrednim dostępem do bazy. Panel i tak nie pokazuje przycisku przy
  // własnym koncie — to zabezpieczenie na wypadek wywołania z pominięciem UI.
  if (targetAppUserId === userId) {
    return { error: "Nie możesz zmieniać własnych uprawnień z tego panelu." };
  }

  let existingQuery = supabase
    .from("user_role")
    .select("id, permissions")
    .eq("app_user_id", targetAppUserId);
  existingQuery = councilId
    ? existingQuery.eq("scope_council_id", councilId)
    : existingQuery.is("scope_council_id", null);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) return { error: existingError.message };

  const preserved = (existing?.permissions ?? []).filter((p) => p === "browse");
  const nextPermissions = Array.from(
    new Set([...preserved, ...levelDef.permissions])
  );

  // role zostaje 'manager' — kolumna ma check constraint dopuszczający tylko
  // tę wartość i nie opisuje szczebla; od tego jest permissions[].
  const { error, count } = existing
    ? await supabase
        .from("user_role")
        .update(
          { role: "manager", permissions: nextPermissions },
          { count: "exact" }
        )
        .eq("id", existing.id)
    : await supabase.from("user_role").insert(
        {
          app_user_id: targetAppUserId,
          role: "manager",
          permissions: nextPermissions,
          scope_council_id: councilId,
        },
        { count: "exact" }
      );

  if (error) return { error: error.message };
  // Brak błędu przy zerze zapisanych wierszy znaczy, że RLS po cichu odrzuciło
  // zapis — bez tej kontroli panel pokazałby sukces (feedback_rls_silent_denial).
  if (count === 0) return { error: "Nie udało się zapisać uprawnień" };

  await logAudit(
    supabase,
    userId,
    targetAppUserId,
    "role_updated",
    councilId,
    `${existing ? "Zmieniono poziom na" : "Nadano"}: ${levelDef.label}`
  );

  revalidatePath("/admin/konta");
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
  if (existing.app_user_id === userId) {
    return { error: "Nie możesz cofnąć własnego uprawnienia z tego panelu." };
  }

  // If "browse" (the auto-granted baseline) is bundled into this row, only
  // strip the granted tier and leave the row with just browse — a full
  // DELETE here would also take away the ability to view the site, not
  // just the contribution tier being revoked. A row without browse (the
  // usual case: a council-scoped tier grant) has nothing to preserve, so a
  // plain delete is correct as-is.
  const hasBrowse = (existing.permissions ?? []).includes("browse");

  const { error, count } = hasBrowse
    ? await supabase
        .from("user_role")
        .update({ permissions: ["browse"] }, { count: "exact" })
        .eq("id", roleId)
    : await supabase
        .from("user_role")
        .delete({ count: "exact" })
        .eq("id", roleId);

  if (error) return { error: error.message };
  if (count === 0) return { error: "Nie udało się cofnąć uprawnienia" };

  await logAudit(
    supabase,
    userId,
    existing.app_user_id,
    "role_revoked",
    existing.scope_council_id,
    "Cofnięto dostęp"
  );

  revalidatePath("/admin/konta");
  return { error: null };
}
