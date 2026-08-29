import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { readCouncilorProfilePrompt } from "@/lib/councilor-profile-prompt";

export const metadata: Metadata = {
  title: "Prompt: profil radnego — Rada",
};

export default function PromptOcenyRadnychPage() {
  return <LegalDocument content={readCouncilorProfilePrompt()} />;
}
