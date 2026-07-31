"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseVtt } from "@/lib/vtt";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

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

  const { data: meeting } = await supabase
    .from("meeting")
    .select("term:term_id(council_id)")
    .eq("id", meetingId)
    .maybeSingle();
  const councilId = meeting?.term?.council_id ?? null;

  // Editors can only propose (segment stays reviewable); moderators finalize
  // it outright. The action must pick the status itself — RLS silently
  // no-ops an UPDATE whose target status doesn't match what the caller's
  // permission allows, so sending the wrong one looks like success but
  // changes nothing (see feedback_rls_silent_denial).
  const { data: canFinalize } = await supabase.rpc("user_has_permission", {
    uid: user.id,
    perm: "finalize_vote",
    target_council_id: councilId ?? undefined,
  });
  const targetStatus = canFinalize ? "finalized" : "proposed";

  const { error, count } = await supabase
    .from("segment")
    .update(
      {
        confirmed_councilor_id: target.type === "councilor" ? target.id : null,
        confirmed_official_id: target.type === "official" ? target.id : null,
        status: targetStatus,
        finalized_by: user.id,
        finalized_at: targetStatus === "finalized" ? new Date().toISOString() : null,
      },
      { count: "exact" }
    )
    .in("id", segmentIds);

  if (error) return { error: error.message };
  if (count === 0) return { error: "Brak uprawnień do tej zmiany" };

  revalidatePath(`/sesje/${meetingId}`);
  return { error: null };
}

// Moderators only — promotes already-proposed segments (editor-suggested or
// LLM-suggested, see [[project_transcription_pipeline]] voice-embedding
// work) to finalized. Never touches confirmed_councilor_id/confirmed_official_id
// — it only accepts an assignment someone/something else already proposed.
export async function acceptProposedSegments(
  meetingId: string,
  segmentIds: string[]
) {
  if (segmentIds.length === 0) return { error: "Brak zaznaczonych segmentów" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Musisz być zalogowana" };

  const { data: meeting } = await supabase
    .from("meeting")
    .select("term:term_id(council_id)")
    .eq("id", meetingId)
    .maybeSingle();
  const councilId = meeting?.term?.council_id ?? null;

  const { data: canFinalize } = await supabase.rpc("user_has_permission", {
    uid: user.id,
    perm: "finalize_vote",
    target_council_id: councilId ?? undefined,
  });
  if (!canFinalize) return { error: "Brak uprawnień do zatwierdzania propozycji" };

  const { error, count } = await supabase
    .from("segment")
    .update(
      {
        status: "finalized",
        finalized_by: user.id,
        finalized_at: new Date().toISOString(),
      },
      { count: "exact" }
    )
    .in("id", segmentIds)
    .eq("status", "proposed");

  if (error) return { error: error.message };
  if (count === 0) {
    return { error: "Brak propozycji do zatwierdzenia wśród zaznaczonych." };
  }

  revalidatePath(`/sesje/${meetingId}`);
  return { error: null, count };
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

  // A single .range() request can't exceed PostgREST's server-side
  // max-rows cap — for a large session (1000+ segments) an unranged
  // select would silently undercount, potentially missing finalized
  // segments and letting an import through that should have been
  // blocked. Paginate to get the true count.
  const existing = await fetchAllRows<{ id: string; status: string }>(
    (from, to) =>
      supabase
        .from("segment")
        .select("id, status")
        .eq("meeting_id", meetingId)
        .range(from, to)
  );

  const finalizedCount = existing.filter((s) => s.status === "finalized").length;
  if (finalizedCount > 0) {
    return {
      error: `Ta sesja ma już ${finalizedCount} oznaczonych segmentów — import odrzucony, żeby nic nie skasować.`,
    };
  }
  if (existing.length > 0 && !force) {
    return {
      error: `Ta sesja ma już ${existing.length} segmentów. Zaznacz "force", by je zastąpić.`,
    };
  }
  if (existing.length > 0 && force) {
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
