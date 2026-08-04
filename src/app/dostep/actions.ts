"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAccessLevel, type AccessLevel } from "@/lib/access-levels";

export async function submitAccessRequest(
  level: AccessLevel,
  councilId: string | null,
  message: string
) {
  if (!isAccessLevel(level)) return { error: "Nieznany poziom dostępu" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Musisz być zalogowany" };

  const { error } = await supabase.from("access_request").insert({
    app_user_id: user.id,
    requested_level: level,
    scope_council_id: councilId,
    message: message.trim() || null,
  });

  if (error) {
    // Unique violation on access_request_one_pending — see feedback_rls_-
    // silent_denial-adjacent principle: check the actual DB error, don't
    // guess from a generic failure.
    if (error.code === "23505") {
      return { error: "Masz już oczekującą prośbę o dostęp dla tej rady." };
    }
    return { error: error.message };
  }

  revalidatePath("/dostep");
  return { error: null };
}
