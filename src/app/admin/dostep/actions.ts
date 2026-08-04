"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/access-levels";

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

export async function approveAccessRequest(requestId: string) {
  const { error: permError, supabase, userId } = await requireManager();
  if (permError) return { error: permError };

  const { data: request } = await supabase
    .from("access_request")
    .select("app_user_id, requested_level, scope_council_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { error: "Nie znaleziono prośby" };
  if (request.status !== "pending")
    return { error: "Ta prośba została już rozpatrzona" };

  const newPermissions =
    ACCESS_LEVELS[request.requested_level as AccessLevel]?.permissions ?? [];

  // A user can hold at most one user_role row per scope in practice today
  // (nothing else writes this table) — union permissions on re-request so
  // escalating editor→moderator adds rather than clobbers an earlier grant.
  let existingQuery = supabase
    .from("user_role")
    .select("id, permissions")
    .eq("app_user_id", request.app_user_id);
  existingQuery = request.scope_council_id
    ? existingQuery.eq("scope_council_id", request.scope_council_id)
    : existingQuery.is("scope_council_id", null);
  const { data: existing } = await existingQuery.maybeSingle();

  const mergedPermissions = Array.from(
    new Set([...(existing?.permissions ?? []), ...newPermissions])
  );

  const roleWrite = existing
    ? await supabase
        .from("user_role")
        .update({ permissions: mergedPermissions }, { count: "exact" })
        .eq("id", existing.id)
    : await supabase.from("user_role").insert(
        {
          app_user_id: request.app_user_id,
          role: "manager",
          permissions: mergedPermissions,
          scope_council_id: request.scope_council_id,
        },
        { count: "exact" }
      );

  if (roleWrite.error) return { error: roleWrite.error.message };
  if (roleWrite.count === 0)
    return { error: "Nie udało się zapisać uprawnień" };

  const { error, count } = await supabase
    .from("access_request")
    .update(
      {
        status: "approved",
        decided_by: userId,
        decided_at: new Date().toISOString(),
      },
      { count: "exact" }
    )
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { error: error.message };
  if (count === 0)
    return { error: "Prośba została już rozpatrzona przez kogoś innego" };

  revalidatePath("/admin/dostep");
  return { error: null };
}

export async function denyAccessRequest(requestId: string, note: string) {
  const { error: permError, supabase, userId } = await requireManager();
  if (permError) return { error: permError };

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

  revalidatePath("/admin/dostep");
  return { error: null };
}
