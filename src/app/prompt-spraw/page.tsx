import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { readMattersPrompt } from "@/lib/matters-prompt";

export const metadata: Metadata = {
  title: "Prompt: sprawy — Rada",
};

// Widok publiczny pokazuje wariant gminny; powiatowy różni się filtrem
// terytorialnym i jest pobierany z /prompt-spraw/pobierz?councilId=.
export default function PromptSprawPage() {
  return <LegalDocument content={readMattersPrompt("gmina")} />;
}
