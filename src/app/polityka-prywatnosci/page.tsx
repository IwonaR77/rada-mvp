import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";

export const metadata: Metadata = { title: "Polityka Prywatności — Rada" };

// Bump this filename when a new version is published to regulaminy/.
const DOC_PATH = path.join(
  process.cwd(),
  "regulaminy",
  "Polityka_Prywatnosci_Rada_v1.4.md"
);

export default function PolitykaPrywatnosciPage() {
  const content = fs.readFileSync(DOC_PATH, "utf-8");
  return <LegalDocument content={content} />;
}
