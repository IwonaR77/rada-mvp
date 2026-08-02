"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Moderators only — moves a proposed matter to approved. RLS silently
// no-ops the UPDATE if the caller lacks finalize_vote for this matter's
// council, so we must check `count` rather than trust `error === null`
// (see feedback_rls_silent_denial).
export async function approveMatter(matterId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Musisz być zalogowana" };

  const { data: matter } = await supabase
    .from("matter")
    .select("council_id")
    .eq("id", matterId)
    .maybeSingle();
  if (!matter) return { error: "Nie znaleziono sprawy" };

  const { data: canFinalize } = await supabase.rpc("user_has_permission", {
    uid: user.id,
    perm: "finalize_vote",
    target_council_id: matter.council_id,
  });
  if (!canFinalize) return { error: "Brak uprawnień do zatwierdzania spraw" };

  const { error, count } = await supabase
    .from("matter")
    .update({ status: "approved" }, { count: "exact" })
    .eq("id", matterId)
    .eq("status", "proposed");

  if (error) return { error: error.message };
  if (count === 0) return { error: "Sprawa nie czeka już na akceptację" };

  revalidatePath("/sprawy");
  return { error: null };
}

async function requireMatterTagPermission(matterId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Musisz być zalogowana" as const, supabase, matter: null };

  const { data: matter } = await supabase
    .from("matter")
    .select("council_id")
    .eq("id", matterId)
    .maybeSingle();
  if (!matter) return { error: "Nie znaleziono sprawy" as const, supabase, matter: null };

  const { data: canManage } = await supabase.rpc("user_has_permission", {
    uid: user.id,
    perm: "finalize_vote",
    target_council_id: matter.council_id,
  });
  if (!canManage) {
    return { error: "Brak uprawnień do tagowania spraw" as const, supabase, matter };
  }

  return { error: null, supabase, matter };
}

export async function addMatterTag(matterId: string, tag: string) {
  const trimmed = tag.trim();
  if (!trimmed) return { error: "Pusty tag" };

  const { error: permError, supabase, matter } =
    await requireMatterTagPermission(matterId);
  if (permError) return { error: permError };

  const { error, count } = await supabase
    .from("matter_tag")
    .upsert({ matter_id: matterId, tag: trimmed }, { onConflict: "matter_id,tag", count: "exact" });

  if (error) return { error: error.message };
  if (count === 0) return { error: "Nie udało się dodać tagu" };

  revalidatePath("/sprawy");
  if (matter) revalidatePath(`/rada/${matter.council_id}`);
  return { error: null };
}

export async function removeMatterTag(matterId: string, tag: string) {
  const { error: permError, supabase, matter } =
    await requireMatterTagPermission(matterId);
  if (permError) return { error: permError };

  const { error } = await supabase
    .from("matter_tag")
    .delete()
    .eq("matter_id", matterId)
    .eq("tag", tag);

  if (error) return { error: error.message };

  revalidatePath("/sprawy");
  if (matter) revalidatePath(`/rada/${matter.council_id}`);
  return { error: null };
}
