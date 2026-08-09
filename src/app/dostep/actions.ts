"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  alreadyHeldLevels,
  isAccessLevel,
  MESSAGE_MAX_LENGTH,
  type AccessLevel,
} from "@/lib/access-levels";

export async function submitAccessRequest(
  level: AccessLevel,
  councilId: string | null,
  message: string
) {
  if (!isAccessLevel(level)) return { error: "Nieznany poziom dostępu" };

  const trimmedMessage = message.trim();
  if (trimmedMessage.length > MESSAGE_MAX_LENGTH) {
    return { error: `Wiadomość jest za długa (maksymalnie ${MESSAGE_MAX_LENGTH} znaków).` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Musisz być zalogowany" };

  // Defense in depth — the /dostep UI already hides levels the user holds,
  // but this is the actual authorization boundary for the server action.
  const { data: roles } = await supabase
    .from("user_role")
    .select("permissions")
    .eq("app_user_id", user.id);
  const held = alreadyHeldLevels((roles ?? []).flatMap((r) => r.permissions ?? []));
  if (held.includes(level)) {
    return { error: "Masz już to uprawnienie — nie trzeba wnioskować ponownie." };
  }

  const { error } = await supabase.from("access_request").insert({
    app_user_id: user.id,
    requested_level: level,
    scope_council_id: councilId,
    message: trimmedMessage || null,
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
  revalidatePath("/admin/dostep");
  revalidatePath("/admin/konta");
  return { error: null };
}
