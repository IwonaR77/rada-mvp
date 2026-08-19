import { createClient } from "@/lib/supabase/server";
import {
  currentSummaryPromptVersion,
  readSummaryPrompt,
  stampPromptMinor,
  SUMMARY_PROMPT_FILENAME,
} from "@/lib/summary-prompt";
import { buildFeedbackSection } from "@/lib/feedback-section";
import { recordPromptDownload } from "@/lib/prompt-download";

// Prompt podsumowań jako plik do pobrania — żeby dało się go wprost wrzucić
// do czatu zamiast zaznaczać i kopiować kilkaset linii ze strony.
//
// Z parametrem ?meetingId= dokleja uwagi redakcji dla tej rady (patrz
// buildFeedbackSection). Bez parametru oddaje sam prompt — tak działa
// odsyłacz ze stopki, który nie wie nic o żadnej sesji.
//
// Doklejone uwagi zmieniają treść opisu, więc plik dostaje wersję z minorem
// (`7.12` = prompt v7 + uwagi tej rady do #12), a serwis zapisuje wiersz z
// listą numerów, które w nim poszły. Bez tego z czatu wracało samo v7 i po
// fakcie nie dało się powiedzieć, które uwagi ten opis widział.
//
// Dostęp: trasa jest za bramką logowania w src/proxy.ts, a same uwagi chroni
// dodatkowo RLS — kto nie jest managerem tej rady, pobierze prompt bez nich.
export async function GET(request: Request) {
  const meetingId = new URL(request.url).searchParams.get("meetingId");
  const prompt = readSummaryPrompt();

  if (!meetingId) {
    return markdown(prompt, SUMMARY_PROMPT_FILENAME);
  }

  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meeting")
    .select("date, esesja_id, source_id, term:term_id(council_id)")
    .eq("id", meetingId)
    .maybeSingle();

  const councilId = meeting?.term?.council_id;
  if (!councilId) return markdown(prompt, SUMMARY_PROMPT_FILENAME);

  const promptVersion = currentSummaryPromptVersion();
  const feedback = await buildFeedbackSection(supabase, {
    councilId,
    promptMajor: promptVersion,
    currentMeetingId: meetingId,
    echoVersion: true,
  });

  // Nazwa mówi, że to prompt przygotowany pod konkretną sesję — inaczej dwa
  // pobrania leżące obok siebie w folderze są nie do odróżnienia, mimo że
  // różnią się doklejonymi uwagami.
  const key = meeting.esesja_id ?? meeting.source_id ?? meetingId;
  const name = feedback.text
    ? `${SUMMARY_PROMPT_FILENAME.replace(/\.md$/, "")}_sesja_${key}_${meeting.date}.md`
    : SUMMARY_PROMPT_FILENAME;

  await recordPromptDownload(supabase, {
    councilId,
    meetingId,
    kind: "podsumowanie",
    promptVersion,
    feedback,
  });

  return markdown(stampPromptMinor(prompt, feedback.minor) + feedback.text, name);
}

function markdown(body: string, filename: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
