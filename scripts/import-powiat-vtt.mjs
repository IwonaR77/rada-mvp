#!/usr/bin/env node
// Importuje transkrypty sesji, dla których transmisjaobrad.info udostępnia
// gotowe napisy WebVTT — czyli 31 z 32 sesji VII kadencji Rady Powiatu
// Grójeckiego. Zamiast pobierać 1,5 h wideo i przepuszczać je przez Groq,
// bierzemy plik napisów zwykłym GET-em.
//
// Parsowanie i zapis segmentów robi scripts/import-transcript.mjs — ten skrypt
// tylko dostarcza mu plik i pilnuje, żeby trafił do właściwego posiedzenia.
// Ochrona sfinalizowanych segmentów i obsługa --force są już tam zrobione.
//
// URL napisów zawiera podpis, który może wygasnąć, więc wyciągamy go ze strony
// nagrania w momencie importu, a nie z bazy.
//
// Użycie:
//   node scripts/import-powiat-vtt.mjs                 (wszystkie zaległe)
//   node scripts/import-powiat-vtt.mjs --limit 1       (jedna sesja)
//   node scripts/import-powiat-vtt.mjs --meeting <uuid>
//   node scripts/import-powiat-vtt.mjs --dry-run

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseQuery, supabaseExec, sqlText } from "./lib/db.mjs";
import { fetchDecoded, sleep } from "./lib/pl.mjs";

const BASE = "https://transmisjaobrad.info";
const SOURCE = "transmisjaobrad";
const TRANSCRIPT_SOURCE = "transmisjaobrad-vtt";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function log(msg) {
  console.log(`[powiat-vtt] ${msg}`);
}

function parseArgs(argv) {
  const args = { limit: null, meeting: null, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--meeting") args.meeting = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else {
      console.error(`Nieznany argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

/** URL napisów ze strony nagrania. Encje HTML trzeba rozkodować — inaczej `&amp;` trafia do zapytania. */
function subtitleUrl(page) {
  const m = page.match(/<track[^>]+src="([^"]+)"/);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

async function fetchVtt(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} przy pobieraniu napisów`);
  const text = await res.text();
  if (!/^﻿?WEBVTT/.test(text)) {
    throw new Error("Pobrany plik nie zaczyna się od WEBVTT — to nie są napisy");
  }
  return text;
}

async function importOne(meeting, args) {
  // Trasa /videos/<id>/<slug> ignoruje slug, ale wymaga niepustego segmentu
  // (samo /videos/<id> daje 404). Slugu nie trzymamy w bazie — nie jest
  // identyfikatorem, tylko ozdobą URL-a.
  const page = await fetchDecoded(`${BASE}/videos/${meeting.source_id}/sesja`);
  const url = subtitleUrl(page);
  if (!url) {
    log(`POMIJAM ${meeting.date} (${meeting.source_id}): na stronie nagrania nie ma napisów.`);
    return false;
  }

  const vtt = await fetchVtt(url);
  const cues = (vtt.match(/-->/g) ?? []).length;
  if (args.dryRun) {
    log(`[dry-run] ${meeting.date} (${meeting.source_id}): ${cues} bloków, ${(vtt.length / 1024).toFixed(0)} kB.`);
    return false;
  }

  const dir = mkdtempSync(path.join(tmpdir(), "powiat-vtt-"));
  const file = path.join(dir, `sesja_${meeting.source_id}_${meeting.date}.vtt`);
  try {
    writeFileSync(file, vtt, "utf8");
    // --meeting jest tu obowiązkowe: import-transcript.mjs bez niego szuka
    // sesji po esesja_id z nazwy pliku, a powiat esesja_id nie ma.
    const cmd = ["import-transcript.mjs", file, "--meeting", meeting.id];
    if (args.force) cmd.push("--force");
    execFileSync("node", [path.join(SCRIPT_DIR, cmd[0]), ...cmd.slice(1)], { stdio: "inherit" });
    supabaseExec(
      `update meeting set transcript_source = ${sqlText(TRANSCRIPT_SOURCE)} where id = ${sqlText(meeting.id)};`
    );
    log(`ZAIMPORTOWANO ${meeting.date} (${meeting.source_id}): ${cues} bloków.`);
    return true;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const where = args.meeting
    ? `id = ${sqlText(args.meeting)}`
    : `source = '${SOURCE}' and subtitles_available and transcript_status <> 'rozpisana'`;
  const pending = supabaseQuery(
    `select id, source_id, date, title from meeting where ${where} order by date asc${args.limit ? ` limit ${args.limit}` : ""};`
  );

  if (pending.length === 0) {
    log("Brak sesji z napisami czekających na import.");
    return;
  }
  log(`Do zaimportowania: ${pending.length}.`);

  let done = 0;
  let failed = 0;
  for (const m of pending) {
    try {
      if (await importOne(m, args)) done++;
    } catch (e) {
      // Jedna zepsuta sesja nie może zatrzymać pozostałych — leci dalej,
      // a przy następnym uruchomieniu ta sesja znów będzie zaległa.
      failed++;
      log(`BŁĄD ${m.date} (${m.source_id}): ${e.message}`);
    }
    await sleep(400);
  }

  log(`Podsumowanie: zaimportowano ${done}/${pending.length}${failed ? `, błędów: ${failed}` : ""}.`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[powiat-vtt] BŁĄD KRYTYCZNY:", e);
  process.exit(1);
});
