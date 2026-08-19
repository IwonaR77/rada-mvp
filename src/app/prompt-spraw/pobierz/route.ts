import { createClient } from "@/lib/supabase/server";
import {
  MATTERS_PROMPTS,
  mattersPromptKind,
  mattersPromptVersion,
  readMattersPrompt,
} from "@/lib/matters-prompt";
import { buildFeedbackSection } from "@/lib/feedback-section";
import { stampPromptMinor } from "@/lib/summary-prompt";
import { recordPromptDownload } from "@/lib/prompt-download";

// Prompt ekstrakcji spraw jako plik do pobrania, z uwagami redakcji doklejonymi
// na końcu.
//
// Uwagi zbierają się przy podsumowaniach sesji („tego zabrakło"), ale nazwany
// w nich temat jest jednocześnie tropem brakującej sprawy — ta sama treść ma
// więc trafiać do obu ekstrakcji, nie tylko do podsumowań.
//
// ?councilId= wybiera wariant promptu (gmina/powiat) i zakres uwag. Bez
// parametru oddaje wariant gminny bez uwag — tak działa odsyłacz ze stopki,
// który nie wie nic o radzie.
export async function GET(request: Request) {
  const councilId = new URL(request.url).searchParams.get("councilId");

  if (!councilId) {
    return markdown(readMattersPrompt("gmina"), MATTERS_PROMPTS.gmina);
  }

  const supabase = await createClient();
  const { data: council } = await supabase
    .from("council")
    .select("city_id")
    .eq("id", councilId)
    .maybeSingle();

  const kind = mattersPromptKind(Boolean(council?.city_id));
  const promptVersion = mattersPromptVersion(kind);
  if (!council) {
    return markdown(readMattersPrompt(kind), MATTERS_PROMPTS[kind]);
  }

  // Ta sama pula uwag co przy podsumowaniach, więc i ta sama numeracja —
  // ale majory są różne (inny plik promptu), więc `5.12` po stronie spraw i
  // `7.12` po stronie podsumowań to ten sam zbiór uwag przy innym prompcie.
  // Bez `echoVersion`: prompt spraw nie ma linii, którą wersja mogłaby wrócić —
  // ślad zostaje w `prompt_download`.
  const feedback = await buildFeedbackSection(supabase, {
    councilId,
    promptMajor: promptVersion,
    echoVersion: false,
  });

  await recordPromptDownload(supabase, {
    councilId,
    kind: "sprawy",
    promptVersion,
    feedback,
  });

  return markdown(
    stampPromptMinor(readMattersPrompt(kind), feedback.minor) + feedback.text,
    MATTERS_PROMPTS[kind]
  );
}

function markdown(body: string, filename: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
