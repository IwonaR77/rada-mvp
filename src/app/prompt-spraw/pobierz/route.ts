import { createClient } from "@/lib/supabase/server";
import {
  MATTERS_PROMPTS,
  mattersPromptKind,
  readMattersPrompt,
} from "@/lib/matters-prompt";
import { buildFeedbackSection } from "@/lib/feedback-section";

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
  const feedback = council
    ? await buildFeedbackSection(supabase, councilId)
    : "";

  return markdown(readMattersPrompt(kind) + feedback, MATTERS_PROMPTS[kind]);
}

function markdown(body: string, filename: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
