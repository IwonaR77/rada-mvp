import { readSummaryPrompt, SUMMARY_PROMPT_FILENAME } from "@/lib/summary-prompt";

// Ten sam prompt co na /prompt-podsumowania, ale jako plik do pobrania —
// żeby dało się go wprost wrzucić do czatu zamiast zaznaczać i kopiować
// kilkaset linii ze strony.
//
// Dostęp: trasa jest za bramką logowania w src/proxy.ts (nie ma jej na liście
// PUBLIC_PATHS), tak samo jak strony z promptami.
export async function GET() {
  return new Response(readSummaryPrompt(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${SUMMARY_PROMPT_FILENAME}"`,
    },
  });
}
