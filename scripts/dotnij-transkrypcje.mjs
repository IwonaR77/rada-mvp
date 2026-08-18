#!/usr/bin/env node
// Dopisuje brakującą KOŃCÓWKĘ transkrypcji sesji, nie ruszając reszty.
//
// Zdarza się, że pobieranie nagrania urwie się przed końcem i sesja zostaje
// z transkrypcją krótszą niż obrady (sesja 21 w sierpniu 2026, sesja 22
// w październiku 2025 — po 17–38 minut). Ponowna transkrypcja całości jest
// wtedy podwójnie kosztowna: płacimy za cały materiał jeszcze raz i tracimy
// przypisania mówców, bo nowe segmenty mają inne granice i inne identyfikatory.
//
// Ten skrypt bierze wyłącznie fragment od ostatniego istniejącego segmentu do
// końca nagrania, przepuszcza go przez ten sam pipeline co zwykłą transkrypcję
// (te same poprawki tokenów, to samo przeczasowanie po słowach) i dopisuje
// wynik jako nowe segmenty ze statusem `open`.
//
// Użycie:
//   node scripts/dotnij-transkrypcje.mjs --esesja 74061 [--zapisz]

import { mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { supabaseQuery, supabaseExec, REPO_ROOT } from "./lib/db.mjs";
import {
  resolveGroqApiKey,
  planChunks,
  cutChunks,
  transcribeChunks,
  applyTokenCorrections,
} from "../groq/groq-lib.mjs";

const args = process.argv.slice(2);
const esesja = args[args.indexOf("--esesja") + 1];
const zapisz = args.includes("--zapisz");
if (!esesja || esesja.startsWith("--")) {
  console.error("Wymagane: --esesja <id> [--zapisz]");
  process.exit(1);
}

const [meeting] = supabaseQuery(`
  select m.id, m.date, max(s.end_time) as ostatni, count(s.id) as segmentow
    from meeting m left join segment s on s.meeting_id = m.id
   where m.esesja_id = '${esesja}' group by m.id, m.date`);
if (!meeting) throw new Error(`Nie ma sesji ${esesja}`);

const od = Math.floor(Number(meeting.ostatni));
const czas = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Długość nagrania z playlisty HLS — ten sam sposób, którym rozpoznawanie
// głosem sięga po dźwięk (scripts/voice/hls.py).
const listing = await fetch("https://grojec.esesja.pl/transmisje_z_obrad_rady").then((r) => r.text());
const link = listing.match(new RegExp(`/transmisja/${esesja}/[^"']+\\.htm`));
if (!link) throw new Error("Nie znalazłem transmisji na stronie rady");
const strona = await fetch(encodeURI(`https://grojec.esesja.pl${link[0]}`)).then((r) => r.text());
const playlist = strona.match(/videourl='([^']+)'/)[1];

const workDir = path.join(REPO_ROOT, "groq/work/dotniecie");
mkdirSync(workDir, { recursive: true });
const koncowka = path.join(workDir, `${esesja}_koncowka.mp3`);

// Pobieramy od ostatniego segmentu do końca — kawałkami transmisji, równolegle.
// ffmpeg z `-ss` na playliście HLS ciągnie strumień jednym połączeniem i 17
// minut końcówki schodziło ponad kwadrans.
if (!existsSync(koncowka)) {
  console.log(`Pobieram fragment od ${czas(od)} do końca nagrania...`);
  execFileSync("/home/blady/.venv-rada-voice/bin/python",
    [path.join(REPO_ROOT, "scripts/voice/wytnij-fragment.py"),
     "--esesja", esesja, "--od", String(od), "--out", koncowka],
    { stdio: "inherit", timeout: 60 * 60 * 1000 });
}
const dlugosc = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration",
  "-of", "default=nw=1:nk=1", koncowka]).toString().trim());
console.log(`Pobrany fragment: ${Math.round(dlugosc / 60)} min (od ${czas(od)} do ${czas(od + dlugosc)})`);
console.log(`Sesja ma dziś ${meeting.segmentow} segmentów, ostatni kończy się o ${czas(od)}.`);

if (!zapisz) {
  console.log("\nPrzebieg na sucho — transkrypcji NIE zamawiam. Powtórz z --zapisz.");
  process.exit(0);
}

const chunkDir = path.join(workDir, `${esesja}_chunks`);
rmSync(chunkDir, { recursive: true, force: true });
const chunks = cutChunks(koncowka, chunkDir, `${esesja}_koncowka`);
console.log(`Kawałków do wysłania: ${chunks.length} (plan: ${planChunks(dlugosc).length})`);

const segments = await transcribeChunks(resolveGroqApiKey(path.join(REPO_ROOT, "groq/.env.groq")), chunks);
console.log(`Groq zwrócił ${segments.length} segmentów.`);

const tokens = path.join(REPO_ROOT, "groq/tokens.txt");
const wiersze = segments
  .map((s) => ({
    start: Number(s.start) + od,
    end: Number(s.end) + od,
    text: applyTokenCorrections(s.text, tokens).trim(),
  }))
  .filter((s) => s.text && s.end > s.start);

console.log(`Do dopisania: ${wiersze.length} segmentów, od ${czas(wiersze[0].start)} do ${czas(wiersze.at(-1).end)}`);

const wartosci = wiersze
  .map((s) => `('${meeting.id}', ${s.start.toFixed(3)}, ${s.end.toFixed(3)}, '${s.text.replace(/'/g, "''")}', 'open')`)
  .join(",\n");
supabaseExec(`insert into segment (meeting_id, start_time, end_time, text, status) values\n${wartosci};`);
console.log("Dopisane.");
rmSync(chunkDir, { recursive: true, force: true });
