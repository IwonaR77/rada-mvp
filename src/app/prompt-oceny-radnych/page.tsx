import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";

export const metadata: Metadata = {
  title: "Prompt: aktywność radnych — Rada",
};

// Bump this filename when a new version is published to prompty/
// (keep in sync with src/lib/councilor-evaluation-prompt-version.ts).
const DOC_PATH = path.join(
  process.cwd(),
  "prompty",
  "Prompt_Ocena_Radnych_v3.md"
);

export default function PromptOcenyRadnychPage() {
  const content = fs.readFileSync(DOC_PATH, "utf-8");
  return <LegalDocument content={content} />;
}
