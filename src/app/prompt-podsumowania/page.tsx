import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { readSummaryPrompt } from "@/lib/summary-prompt";

export const metadata: Metadata = {
  title: "Prompt: podsumowania sesji — Rada",
};

export default function PromptPodsumowaniaPage() {
  return <LegalDocument content={readSummaryPrompt()} />;
}
