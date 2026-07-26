"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function toggleFavoriteCouncil(councilId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Musisz być zalogowana" };

  const { data: appUser } = await supabase
    .from("app_user")
    .select("favorite_council_id")
    .eq("id", user.id)
    .maybeSingle();

  const nextFavoriteId =
    appUser?.favorite_council_id === councilId ? null : councilId;

  const { error } = await supabase
    .from("app_user")
    .update({ favorite_council_id: nextFavoriteId })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath(`/rada/${councilId}`);
  revalidatePath("/", "layout");
  return { error: null, isFavorite: nextFavoriteId !== null };
}
