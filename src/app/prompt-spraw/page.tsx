import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";

export const metadata: Metadata = {
  title: "Prompt: sprawy — Rada",
};

// Bump this filename when a new version is published to prompty/.
const DOC_PATH = path.join(process.cwd(), "prompty", "Prompt_Sprawy_v3.md");

export default function PromptSprawPage() {
  const content = fs.readFileSync(DOC_PATH, "utf-8");
  return <LegalDocument content={content} />;
}
