#!/usr/bin/env node
// Imports a WebVTT transcript (as produced by the offline transcription
// pipeline — see whisper/transcribe.py, out of this repo's scope) into the
// `segment` table for one `meeting`. Shells out to `supabase db query
// --linked --file` for the actual write, the same trusted path already
// used for every other schema/data change on this project this session —
// no new database credentials needed.
//
// Usage:
//   node scripts/import-transcript.mjs <path/to/sesja_ESESJAID_DATE.vtt> [options]
//
// Options:
//   --meeting <uuid>   Explicit meeting id (skips filename-based lookup).
//   --force            Reimport: delete existing *open* segments for this
//                       meeting first. Refuses unconditionally if any
//                       existing segment is already finalized (tagged) —
//                       that's real admin work, never silently discarded.
//   --dry-run          Parse and resolve the meeting, print a summary, do
//                       not touch the database.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

function parseArgs(argv) {
  const args = { file: null, meeting: null, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--meeting") args.meeting = argv[++i];
    else if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (!a.startsWith("--")) args.file = a;
    else {
      console.error(`Nieznana flaga: ${a}`);
      process.exit(1);
    }
  }
  if (!args.file) {
    console.error(
      "Użycie: node scripts/import-transcript.mjs <plik.vtt> [--meeting <uuid>] [--force] [--dry-run]"
    );
    process.exit(1);
  }
  return args;
}

function timeToSeconds(h, m, s, ms) {
  return Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

const CUE_TIME_RE =
  /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})/;

// Some pipeline runs still tag cues with a diarization speaker label
// ("[SPEAKER_05_1]: ...") — strip it so it never lands in segment.text.
const SPEAKER_LABEL_RE = /^\[speaker[\w]*\]:?\s*/i;

function parseVtt(content) {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  const segments = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim());
    const timeLineIndex = lines.findIndex((l) => CUE_TIME_RE.test(l));
    if (timeLineIndex === -1) continue; // WEBVTT header, NOTE blocks, etc.

    const match = lines[timeLineIndex].match(CUE_TIME_RE);
    const [, sh, sm, ss, sms, eh, em, es, ems] = match;
    const start = timeToSeconds(sh, sm, ss, sms);
    const end = timeToSeconds(eh, em, es, ems);

    const text = lines
      .slice(timeLineIndex + 1)
      .filter(Boolean)
      .join(" ")
      .trim()
      .replace(SPEAKER_LABEL_RE, "");

    if (text) segments.push({ start, end, text });
  }

  return segments;
}

function sqlEscape(text) {
  return text.replace(/'/g, "''");
}

function supabaseQuery(sqlOrArgs) {
  const args = Array.isArray(sqlOrArgs)
    ? ["supabase", "db", "query", "--linked", "--output", "json", ...sqlOrArgs]
    : ["supabase", "db", "query", "--linked", "--output", "json", sqlOrArgs];
  const out = execFileSync("npx", args, { encoding: "utf8" });
  const parsed = JSON.parse(out);
  return parsed.rows ?? [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const vttContent = readFileSync(args.file, "utf8");
  const segments = parseVtt(vttContent);

  if (segments.length === 0) {
    console.error("Nie znaleziono żadnych segmentów w tym pliku.");
    process.exit(1);
  }

  let meetingId = args.meeting;
  if (!meetingId) {
    const base = path.basename(args.file);
    const m = base.match(/sesja_(\d+)_/);
    if (!m) {
      console.error(
        "Nie udało się wywnioskować esesja_id z nazwy pliku — podaj --meeting <uuid> ręcznie."
      );
      process.exit(1);
    }
    const esesjaId = m[1];
    const rows = supabaseQuery(
      `select id, title, date from meeting where esesja_id = '${esesjaId}';`
    );
    if (rows.length === 0) {
      console.error(`Brak sesji z esesja_id = ${esesjaId} w tabeli meeting.`);
      process.exit(1);
    }
    meetingId = rows[0].id;
    console.log(`Rozpoznano sesję: ${rows[0].title ?? rows[0].date} (${meetingId})`);
  }

  const existing = supabaseQuery(
    `select status, count(*) as n from segment where meeting_id = '${meetingId}' group by status;`
  );
  const finalizedCount = Number(
    existing.find((r) => r.status === "finalized")?.n ?? 0
  );
  const openCount = Number(existing.find((r) => r.status === "open")?.n ?? 0);

  if (finalizedCount > 0) {
    console.error(
      `Ta sesja ma już ${finalizedCount} oznaczonych (finalized) segmentów — przerywam, żeby nic nie skasować. Obsłuż ręcznie.`
    );
    process.exit(1);
  }
  if (openCount > 0 && !args.force) {
    console.error(
      `Ta sesja ma już ${openCount} segmentów (status open). Użyj --force, by je zastąpić.`
    );
    process.exit(1);
  }

  console.log(`Sparsowano ${segments.length} segmentów z ${args.file}.`);
  console.log(
    `Pierwszy: [${segments[0].start.toFixed(1)}s] ${segments[0].text.slice(0, 60)}`
  );
  console.log(
    `Ostatni:  [${segments.at(-1).start.toFixed(1)}s] ${segments.at(-1).text.slice(0, 60)}`
  );

  if (args.dryRun) {
    console.log("--dry-run: nic nie zapisano.");
    return;
  }

  const statements = [];
  if (openCount > 0) {
    statements.push(
      `delete from segment where meeting_id = '${meetingId}' and status = 'open';`
    );
  }
  const values = segments
    .map(
      (s) =>
        `('${meetingId}', ${s.start}, ${s.end}, '${sqlEscape(s.text)}')`
    )
    .join(",\n");
  statements.push(
    `insert into segment (meeting_id, start_time, end_time, text) values\n${values};`
  );
  statements.push(
    `update meeting set transcript_status = 'rozpisana' where id = '${meetingId}';`
  );

  const sqlPath = path.join(
    path.dirname(args.file),
    `.import-${Date.now()}.sql`
  );
  writeFileSync(sqlPath, statements.join("\n\n"), "utf8");

  try {
    execFileSync("npx", ["supabase", "db", "query", "--linked", "--file", sqlPath], {
      stdio: "inherit",
    });
    console.log(`Zaimportowano ${segments.length} segmentów.`);
  } finally {
    unlinkSync(sqlPath);
  }
}

main();
