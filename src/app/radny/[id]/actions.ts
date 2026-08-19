"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MAX_BOOKMARKS, NOTE_MAX_LENGTH } from "@/lib/bookmarks";

/**
 * Zakładki są prywatne i nigdzie nie są cache'owane, więc po zmianie nie ma
 * czego unieważniać — wystarczy przeładować RSC bieżącej trasy. Profil radnego
 * wisi pod dwoma adresami (/radny/[id] i /rada/[councilId]/radni/[...]), a
 * refresh() nie musi wiedzieć, pod którym akurat jesteśmy.
 */
function refreshProfile() {
  refresh();
}

/**
 * Zakładka na bloku wypowiedzi. Z klienta przychodzi tylko `segmentId` —
 * resztę (sesja, pozycja na osi, przynależność do radnego) czytamy z bazy,
 * żeby nikt nie zapisał sobie zakładki wskazującej cudzy segment z podpisem
 * innego radnego.
 */
export async function saveBookmark({
  segmentId,
  councilorId,
  note,
  replaceBookmarkId,
}: {
  segmentId: string;
  councilorId: string;
  note: string;
  replaceBookmarkId?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Musisz być zalogowana" };

  const trimmed = note.trim();
  if (trimmed.length > NOTE_MAX_LENGTH) {
    return { error: `Opis może mieć najwyżej ${NOTE_MAX_LENGTH} znaków` };
  }

  const { data: segment, error: segmentError } = await supabase
    .from("segment")
    .select("id, meeting_id, start_time, confirmed_councilor_id")
    .eq("id", segmentId)
    .maybeSingle();
  if (segmentError) return { error: segmentError.message };
  if (!segment) return { error: "Nie znaleziono wypowiedzi" };
  if (segment.confirmed_councilor_id !== councilorId) {
    return { error: "Ta wypowiedź nie należy do tego radnego" };
  }

  // Limit slotów pilnowany też tutaj, nie tylko w pasku: pasek pokazuje stan
  // sprzed akcji, a dwie karty otwarte obok siebie widzą różne stany.
  const { count, error: countError } = await supabase
    .from("bookmark")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("councilor_id", councilorId);
  if (countError) return { error: countError.message };

  const { data: existing } = await supabase
    .from("bookmark")
    .select("id")
    .eq("user_id", user.id)
    .eq("segment_id", segmentId)
    .maybeSingle();

  if (!existing && (count ?? 0) >= MAX_BOOKMARKS) {
    if (!replaceBookmarkId) {
      return { error: "limit" as const, limitReached: true };
    }
    const { error: replaceError } = await supabase
      .from("bookmark")
      .delete()
      .eq("id", replaceBookmarkId)
      .eq("user_id", user.id);
    if (replaceError) return { error: replaceError.message };
  }

  const { error } = await supabase.from("bookmark").upsert(
    {
      user_id: user.id,
      segment_id: segmentId,
      meeting_id: segment.meeting_id,
      councilor_id: councilorId,
      anchor_seconds: segment.start_time,
      note: trimmed || null,
    },
    { onConflict: "user_id,segment_id" }
  );
  if (error) return { error: error.message };

  refreshProfile();
  return { error: null };
}

export async function deleteBookmark(bookmarkId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Musisz być zalogowana" };

  const { error } = await supabase
    .from("bookmark")
    .delete()
    .eq("id", bookmarkId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  refreshProfile();
  return { error: null };
}
