import type { createClient } from "@/lib/supabase/server";
import type { FeedbackSection } from "@/lib/feedback-section";

/**
 * Zapisuje, co dokładnie poszło w pobranym pliku promptu.
 *
 * Etykieta w nagłówku (`prompt v7.12`) mówi tylko, do którego numeru sięgały
 * uwagi. Nie mówi, których w paczce zabrakło — a zabraknąć może, bo uwagi da
 * się wycofać. Dopiero ten wiersz czyni zbiór odtwarzalnym po fakcie.
 *
 * Zapis nie może przewrócić pobrania: kto nie ma uprawnień do tej rady,
 * dostaje prompt bez uwag i nie ma czego zapisywać, a błąd zapisu (RLS,
 * chwilowa awaria) jest mniej istotny niż plik, po który człowiek przyszedł.
 */
export async function recordPromptDownload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    councilId: string;
    meetingId?: string | null;
    kind: "podsumowanie" | "sprawy";
    promptVersion: number;
    feedback: FeedbackSection;
  }
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("prompt_download").insert({
    council_id: args.councilId,
    meeting_id: args.meetingId ?? null,
    kind: args.kind,
    prompt_version: args.promptVersion,
    feedback_minor: args.feedback.minor,
    feedback_seqs: args.feedback.seqs,
    downloaded_by: user.id,
  });
}
