"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type AssignTarget =
  | { type: "councilor"; id: string }
  | { type: "official"; id: string };

export async function assignSegments(
  meetingId: string,
  segmentIds: string[],
  target: AssignTarget
) {
  if (segmentIds.length === 0) return { error: "Brak zaznaczonych segmentów" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Musisz być zalogowana" };

  const { error } = await supabase
    .from("segment")
    .update({
      confirmed_councilor_id: target.type === "councilor" ? target.id : null,
      confirmed_official_id: target.type === "official" ? target.id : null,
      status: "finalized",
      finalized_by: user.id,
      finalized_at: new Date().toISOString(),
    })
    .in("id", segmentIds);

  if (error) return { error: error.message };

  revalidatePath(`/sesje/${meetingId}`);
  return { error: null };
}
