"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseVtt } from "@/lib/vtt";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { parseSummaryFile } from "@/lib/summary-prompt";
import { CURRENT_SUMMARY_PROMPT_VERSION } from "@/lib/summary-prompt-version";

type AssignTarget =
  | { type: "councilor"; id: string }
  | { type: "official"; id: string };

// Uwagi do promptu i wgrywanie podsumowań to praca redakcyjna nad tym, co
// serwis mówi o realnych ludziach — dlatego pełny dostęp (manager), a nie
// moderator. Zakres liczy się per rada: manager Grójca nie redaguje powiatu.
async function requireSummaryManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meetingId: string
): Promise<{ ok: false; error: string } | { ok: true; userId: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Musisz być zalogowana" };

  const { data: meeting } = await supabase
    .from("meeting")
    .select("term:term_id(council_id)")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "Nie ma takiej sesji" };

  const { data: isManager } = await supabase.rpc("user_has_permission", {
    uid: user.id,
    perm: "full_access",
    target_council_id: meeting.term?.council_id ?? undefined,
  });
  if (!isManager) return { ok: false, error: "Brak uprawnień" };

  return { ok: true, userId: user.id };
}

const SUMMARY_MAX_LENGTH = 100_000;
const FEEDBACK_MAX_LENGTH = 5_000;

/**
 * Wgrywa gotowy plik .md z podsumowaniem sesji (prompt → czat → plik).
 *
 * Linia „TAGI:" trafia do meeting.topics jako osobna kolumna, a wersję
 * promptu bierzemy z treści pliku, nie z bieżącej wersji promptu: wgranie
 * dziś podsumowania zrobionego starszym promptem ma dalej być widoczne jako
 * nieaktualne, a nie udawać świeże.
 */
export async function importSummary(meetingId: string, markdown: string) {
  const supabase = await createClient();
  const auth = await requireSummaryManager(supabase, meetingId);
  if (!auth.ok) return { error: auth.error };

  if (markdown.length > SUMMARY_MAX_LENGTH) {
    return { error: "Plik jest podejrzanie duży — to na pewno podsumowanie?" };
  }

  const { summary, topics, promptVersion } = parseSummaryFile(markdown);
  if (summary.length === 0) return { error: "Plik jest pusty." };

  const { error } = await supabase
    .from("meeting")
    .update({
      summary,
      summary_prompt_version: promptVersion,
      // Brak linii TAGI: (starsze prompty) nie może wyczyścić tagów, które
      // ktoś już ustawił — wtedy kolumny po prostu nie ruszamy.
      ...(topics ? { topics } : {}),
    })
    .eq("id", meetingId);
  if (error) return { error: error.message };

  revalidatePath(`/sesje/${meetingId}`);
  revalidatePath("/rada/[councilId]/sesje", "page");
  return {
    error: null,
    topics,
    promptVersion,
    isStale:
      promptVersion === null || promptVersion < CURRENT_SUMMARY_PROMPT_VERSION,
  };
}

/** Uwaga managera: czego prompt nie wyłapał w tej konkretnej sesji. */
export async function addSummaryFeedback(meetingId: string, body: string) {
  const supabase = await createClient();
  const auth = await requireSummaryManager(supabase, meetingId);
  if (!auth.ok) return { error: auth.error };

  const trimmed = body.trim();
  if (trimmed.length === 0) return { error: "Uwaga jest pusta." };
  if (trimmed.length > FEEDBACK_MAX_LENGTH) {
    return { error: `Uwaga może mieć najwyżej ${FEEDBACK_MAX_LENGTH} znaków.` };
  }

  // Wersja, którą wygenerowano krytykowany tekst — po dwóch podbiciach
  // promptu inaczej nie wiadomo, czy uwaga jest jeszcze aktualna.
  const { data: meeting } = await supabase
    .from("meeting")
    .select("summary_prompt_version")
    .eq("id", meetingId)
    .maybeSingle();

  const { error } = await supabase.from("summary_feedback").insert({
    meeting_id: meetingId,
    author_id: auth.userId,
    prompt_version:
      meeting?.summary_prompt_version ?? CURRENT_SUMMARY_PROMPT_VERSION,
    body: trimmed,
  });
  if (error) return { error: error.message };

  revalidatePath(`/sesje/${meetingId}`);
  return { error: null };
}

export async function deleteSummaryFeedback(
  meetingId: string,
  feedbackId: string
) {
  const supabase = await createClient();
  const auth = await requireSummaryManager(supabase, meetingId);
  if (!auth.ok) return { error: auth.error };

  // Polityka RLS przepuszcza kasowanie tylko autorowi — filtr po author_id
  // jest tu po to, żeby cudza uwaga dawała jawny komunikat zamiast cichego
  // „usunięto 0 wierszy" (patrz feedback_rls_silent_denial).
  const { error, count } = await supabase
    .from("summary_feedback")
    .delete({ count: "exact" })
    .eq("id", feedbackId)
    .eq("meeting_id", meetingId)
    .eq("author_id", auth.userId);
  if (error) return { error: error.message };
  if (count === 0) return { error: "Można usuwać tylko własne uwagi." };

  revalidatePath(`/sesje/${meetingId}`);
  return { error: null };
}

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
  if (count !== segmentIds.length) {
    return {
      error: `Zapisano tylko ${count} z ${segmentIds.length} zaznaczonych segmentów — reszta wymaga wyższych uprawnień.`,
    };
  }

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

// Moderators only — splits a segment that captured two speakers back-to-back
// (whisperx segments on pause detection, not speaker changes, so this
// happens whenever two people talk without a gap between them). splitOffset
// is a character offset into the segment's text; the split time is
// interpolated proportionally to text length on each side since we don't
// have word-level timestamps, only per-segment start/end. Resets both
// halves to unassigned/open since the original assignment (if any) can't
// be safely assumed to belong to either speaker.
export async function splitSegment(
  meetingId: string,
  segmentId: string,
  splitOffset: number
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

  const { data: segment, error: fetchError } = await supabase
    .from("segment")
    .select("start_time, end_time, text")
    .eq("id", segmentId)
    .eq("meeting_id", meetingId)
    .maybeSingle();
  if (fetchError) return { error: fetchError.message };
  if (!segment) return { error: "Nie znaleziono segmentu" };

  const textA = segment.text.slice(0, splitOffset).trim();
  const textB = segment.text.slice(splitOffset).trim();
  if (!textA || !textB) {
    return { error: "Podział musi zostawić tekst po obu stronach" };
  }

  const duration = segment.end_time - segment.start_time;
  const ratio = splitOffset / segment.text.length;
  const splitTime = segment.start_time + duration * ratio;

  const { error: updateError } = await supabase
    .from("segment")
    .update({
      end_time: splitTime,
      text: textA,
      status: "open",
      confirmed_councilor_id: null,
      confirmed_official_id: null,
      finalized_by: null,
      finalized_at: null,
    })
    .eq("id", segmentId);
  if (updateError) return { error: updateError.message };

  const { error: insertError } = await supabase.from("segment").insert({
    meeting_id: meetingId,
    start_time: splitTime,
    end_time: segment.end_time,
    text: textB,
  });
  if (insertError) return { error: insertError.message };

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
