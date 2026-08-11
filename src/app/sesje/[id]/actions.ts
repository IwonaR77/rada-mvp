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

// Wgrywanie podsumowań to praca redakcyjna nad tym, co serwis mówi o realnych
// ludziach — dlatego pełny dostęp (manager). Uwagi do promptu są od niej
// oddzielone: zgłasza je ten, kto siedzi w transkrypcie i widzi, czego
// podsumowanie nie wyłapało, czyli moderator. Zakres liczy się per rada:
// manager ani moderator Grójca nie redagują powiatu.
/**
 * Uprawnienie do operacji na podsumowaniu tej sesji.
 *
 * `full_access` to wgrywanie podsumowań (manager), `finalize_vote` to same
 * uwagi (moderator). Nie trzeba sprawdzać obu naraz: `user_has_permission`
 * traktuje `full_access` jak wildcard, więc pytanie o `finalize_vote`
 * przepuszcza managera automatycznie.
 */
async function requireSummaryAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meetingId: string,
  perm: "full_access" | "finalize_vote"
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

  const { data: allowed } = await supabase.rpc("user_has_permission", {
    uid: user.id,
    perm,
    target_council_id: meeting.term?.council_id ?? undefined,
  });
  if (!allowed) return { ok: false, error: "Brak uprawnień" };

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
  const auth = await requireSummaryAccess(supabase, meetingId, "full_access");
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

/** Uwaga moderatora lub managera: czego prompt nie wyłapał w tej sesji. */
export async function addSummaryFeedback(meetingId: string, body: string) {
  const supabase = await createClient();
  const auth = await requireSummaryAccess(supabase, meetingId, "finalize_vote");
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
  const auth = await requireSummaryAccess(supabase, meetingId, "finalize_vote");
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

/**
 * Stan segmentu sprzed zmiany — tyle, ile trzeba, żeby go przywrócić.
 * `assignSegments` zwraca to wołającemu, a `undoAssignment` przyjmuje z powrotem.
 */
export type SegmentSnapshot = {
  id: string;
  confirmed_councilor_id: string | null;
  confirmed_official_id: string | null;
  status: string;
};

const SEGMENT_STATUSES = ["open", "proposed", "finalized"];

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

  // Stan sprzed zapisu, czytany PRZED UPDATE — to jedyny moment, w którym
  // jeszcze istnieje. Idzie do klienta jako materiał na jedno cofnięcie
  // (patrz `undoAssignment`); nie zapisujemy go nigdzie po stronie serwera,
  // bo historia zmian to osobna, większa funkcja.
  const { data: previous } = await supabase
    .from("segment")
    .select("id, confirmed_councilor_id, confirmed_official_id, status")
    .in("id", segmentIds);

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
  return { error: null, previous: previous ?? [] };
}

/**
 * Cofa JEDNO ostatnie przypisanie mówcy — przywraca segmentom stan z migawki,
 * którą zwrócił `assignSegments`.
 *
 * Migawka przychodzi od klienta i nie jest zaufana, ale też nie musi być:
 * zapis idzie tą samą drogą co każdy inny, więc RLS przepuści dokładnie to,
 * co wołający i tak mógłby ustawić ręcznie z panelu. Podrobiona migawka nie
 * daje więc nic ponad to, co użytkownik ma i tak. Zakres sesji i dozwolone
 * statusy sprawdzamy mimo to, żeby błędne dane kończyły się komunikatem,
 * a nie naruszeniem CHECK-a albo zapisem do cudzej sesji.
 *
 * Świadome uproszczenie: przywrócony segment dostaje `finalized_by`
 * cofającego, a nie osoby, która go pierwotnie zatwierdziła. Za bieżący stan
 * odpowiada ten, kto zrobił ostatni ruch — a pełne odtworzenie autorstwa
 * wymagałoby historii zmian, której świadomie tu nie budujemy.
 */
export async function undoAssignment(
  meetingId: string,
  previous: SegmentSnapshot[]
) {
  if (previous.length === 0) return { error: "Nie ma czego cofnąć" };
  if (previous.some((s) => !SEGMENT_STATUSES.includes(s.status))) {
    return { error: "Nieznany status segmentu w danych do cofnięcia" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Musisz być zalogowana" };

  // Jeden UPDATE na każdy różny stan docelowy zamiast jednego na segment —
  // zaznaczenie to zwykle jeden mówca i jeden status, więc realnie schodzi
  // to do jednego, dwóch zapytań.
  const groups = new Map<string, { snapshot: SegmentSnapshot; ids: string[] }>();
  for (const snapshot of previous) {
    const key = `${snapshot.confirmed_councilor_id ?? ""}|${snapshot.confirmed_official_id ?? ""}|${snapshot.status}`;
    const group = groups.get(key);
    if (group) group.ids.push(snapshot.id);
    else groups.set(key, { snapshot, ids: [snapshot.id] });
  }

  let restored = 0;
  for (const { snapshot, ids } of groups.values()) {
    const { error, count } = await supabase
      .from("segment")
      .update(
        {
          confirmed_councilor_id: snapshot.confirmed_councilor_id,
          confirmed_official_id: snapshot.confirmed_official_id,
          status: snapshot.status,
          finalized_by: snapshot.status === "open" ? null : user.id,
          finalized_at:
            snapshot.status === "finalized" ? new Date().toISOString() : null,
        },
        { count: "exact" }
      )
      .in("id", ids)
      // Migawka pochodzi z tej strony, więc segmenty muszą należeć do tej sesji.
      .eq("meeting_id", meetingId);

    if (error) return { error: error.message };
    restored += count ?? 0;
  }

  if (restored === 0) return { error: "Brak uprawnień do cofnięcia tej zmiany" };
  if (restored !== previous.length) {
    return {
      error: `Cofnięto tylko ${restored} z ${previous.length} segmentów — reszta wymaga wyższych uprawnień.`,
    };
  }

  revalidatePath(`/sesje/${meetingId}`);
  return { error: null };
}

/**
 * Usuwa wpis z listy mówców — wyłącznie taki, który nigdy nikomu nie posłużył.
 *
 * Lista `official` puchnie przy każdym przeglądzie transkrypcji i łapie przy
 * okazji literówki oraz osoby dodane „na wszelki wypadek". Bez usuwania
 * zostają tam na zawsze i wydłużają listę, po której trzeba szukać przy
 * każdym tagowaniu.
 *
 * Blokada na przypisanych wypowiedziach jest podwójna, celowo:
 * `segment.confirmed_official_id` ma ON DELETE SET NULL, więc usunięcie osoby
 * z otagowanymi wypowiedziami nie rzuciłoby błędu, tylko po cichu odpięło je
 * wszystkie i wrzuciło z powrotem do puli nieprzypisanych — bez śladu, kto
 * tam był. Sprawdzenie tutaj daje czytelny komunikat z liczbą, a polityka RLS
 * (`scripts/migrate-official-cleanup.sql`) pilnuje tego samego niezależnie od
 * tego, czy ktoś kiedyś obejdzie tę funkcję.
 *
 * Radnych ta akcja nie dotyczy — skład rady to nie jest lista do sprzątania
 * przy tagowaniu.
 */
export async function deleteOfficial(meetingId: string, officialId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Musisz być zalogowana" };

  const { count: used } = await supabase
    .from("segment")
    .select("id", { count: "exact", head: true })
    .eq("confirmed_official_id", officialId);

  if (used && used > 0) {
    return {
      error: `Nie usunięto — ta osoba ma ${used} przypisanych wypowiedzi. Najpierw przepisz je na kogoś innego.`,
    };
  }

  const { error, count } = await supabase
    .from("official")
    .delete({ count: "exact" })
    .eq("id", officialId);

  if (error) return { error: error.message };
  if (count === 0) {
    return { error: "Brak uprawnień do usunięcia tej osoby (albo ma już wypowiedzi)." };
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
