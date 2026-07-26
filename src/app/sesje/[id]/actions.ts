"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseVtt } from "@/lib/vtt";

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

export async function importTranscript(
  meetingId: string,
  vttContent: string,
  force = false
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Musisz być zalogowana" };

  const { data: appUser } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (appUser?.role !== "admin" && appUser?.role !== "moderator") {
    return { error: "Brak uprawnień" };
  }

  const { data: existing } = await supabase
    .from("segment")
    .select("id, status")
    .eq("meeting_id", meetingId);

  const finalizedCount = (existing ?? []).filter(
    (s) => s.status === "finalized"
  ).length;
  if (finalizedCount > 0) {
    return {
      error: `Ta sesja ma już ${finalizedCount} oznaczonych segmentów — import odrzucony, żeby nic nie skasować.`,
    };
  }
  if ((existing ?? []).length > 0 && !force) {
    return {
      error: `Ta sesja ma już ${existing!.length} segmentów. Zaznacz "force", by je zastąpić.`,
    };
  }
  if ((existing ?? []).length > 0 && force) {
    const { error: deleteError } = await supabase
      .from("segment")
      .delete()
      .eq("meeting_id", meetingId);
    if (deleteError) return { error: deleteError.message };
  }

  const segments = parseVtt(vttContent);
  if (segments.length === 0) {
    return { error: "Nie znaleziono żadnych segmentów w tym pliku." };
  }

  const { error: insertError } = await supabase.from("segment").insert(
    segments.map((s) => ({
      meeting_id: meetingId,
      start_time: s.start,
      end_time: s.end,
      text: s.text,
    }))
  );
  if (insertError) return { error: insertError.message };

  const { error: updateError } = await supabase
    .from("meeting")
    .update({ transcript_status: "rozpisana" })
    .eq("id", meetingId);
  if (updateError) return { error: updateError.message };

  revalidatePath(`/sesje/${meetingId}`);
  revalidatePath("/rada/[councilId]", "page");
  return { error: null, count: segments.length };
}
