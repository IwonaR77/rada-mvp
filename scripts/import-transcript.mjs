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
//   --kopia <plik>     Zdejmuje tę blokadę, ale tylko po okazaniu świeżego
//                       zrzutu przypisań tej sesji (plik z
//                       scripts/save-segment-assignments.mjs). Zatwierdzone
//                       segmenty idą wtedy do skasowania razem z resztą,
//                       a przypisania odtwarza po imporcie
//                       scripts/restore-segment-assignments.mjs. Wymaga --force.
//   --dry-run          Parse and resolve the meeting, print a summary, do
//                       not touch the database.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { supabaseQuery, sqlEscape } from "./lib/db.mjs";

function parseArgs(argv) {
  const args = { file: null, meeting: null, force: false, dryRun: false, kopia: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--meeting") args.meeting = argv[++i];
    else if (a === "--force") args.force = true;
    else if (a === "--kopia") args.kopia = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (!a.startsWith("--")) args.file = a;
    else {
      console.error(`Nieznana flaga: ${a}`);
      process.exit(1);
    }
  }
  if (!args.file) {
    console.error(
      "Użycie: node scripts/import-transcript.mjs <plik.vtt> [--meeting <uuid>] [--force] [--kopia <zrzut.json>] [--dry-run]"
    );
    process.exit(1);
  }
  if (args.kopia && !args.force) {
    console.error("--kopia działa tylko razem z --force.");
    process.exit(1);
  }
  return args;
}

// Blokadę na zatwierdzonych segmentach zdejmuje wyłącznie okazanie zrzutu,
// z którego da się je potem odtworzyć — i to zrzutu TEJ sesji, nie
// przypadkowego pliku pod ręką. Sprawdzamy więc treść, nie samo istnienie.
function sprawdzKopie(kopiaPath, meetingId) {
  if (!existsSync(kopiaPath)) {
    console.error(`Nie ma pliku zrzutu: ${kopiaPath}`);
    process.exit(1);
  }
  let zrzut;
  try {
    zrzut = JSON.parse(readFileSync(kopiaPath, "utf8"));
  } catch {
    console.error(`Zrzut ${kopiaPath} nie jest poprawnym JSON-em.`);
    process.exit(1);
  }
  if (zrzut.meeting_id !== meetingId) {
    console.error(
      `Zrzut ${kopiaPath} dotyczy innej sesji (${zrzut.meeting_id ?? "brak meeting_id"}).`
    );
    process.exit(1);
  }
  const ile = zrzut.przypisania?.length ?? 0;
  console.log(`Zrzut przypisań: ${kopiaPath} (${ile} zatwierdzonych segmentów).`);
  return ile;
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

// Dostęp do bazy jest wspólny (scripts/lib/db.mjs) — tamta wersja przechodzi
// do porządku nad kodem wyjścia ≠ 0 z poprawnym wynikiem na stdout, co
// telemetria CLI Supabase potrafi zrobić. Lokalna kopia tego nie miała
// i przewracała import na losowym uruchomieniu.
function runSqlFile(sqlPath) {
  if (process.env.SUPABASE_DB_URL) {
    execFileSync("psql", [process.env.SUPABASE_DB_URL, "-v", "ON_ERROR_STOP=1", "-f", sqlPath], {
      stdio: "inherit",
    });
    return;
  }
  execFileSync("npx", ["supabase", "db", "query", "--linked", "--file", sqlPath], {
    stdio: "inherit",
  });
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
  const totalCount = existing.reduce((suma, r) => suma + Number(r.n), 0);

  if (finalizedCount > 0 && !args.kopia) {
    console.error(
      `Ta sesja ma już ${finalizedCount} oznaczonych (finalized) segmentów — przerywam, żeby nic nie skasować. ` +
        `Zrób zrzut (scripts/save-segment-assignments.mjs) i podaj go przez --kopia.`
    );
    process.exit(1);
  }
  if (args.kopia) {
    const wZrzucie = sprawdzKopie(args.kopia, meetingId);
    if (wZrzucie < finalizedCount) {
      console.error(
        `Zrzut ma ${wZrzucie} przypisań, a w bazie jest ${finalizedCount} zatwierdzonych segmentów — ` +
          `zrzut jest nieaktualny. Zrób go jeszcze raz.`
      );
      process.exit(1);
    }
  }
  if (totalCount > 0 && !args.force) {
    console.error(
      `Ta sesja ma już ${totalCount} segmentów. Użyj --force, by je zastąpić.`
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
  if (totalCount > 0) {
    // Kasujemy wszystko poza zatwierdzonym — chyba że zatwierdzone jest
    // zabezpieczone zrzutem (--kopia), wtedy też idzie. Wcześniej znikały
    // tylko segmenty `open`, więc reimport sesji z propozycjami zostawiał
    // je obok nowych i transkrypcja dublowała się w połowie.
    const warunek = args.kopia ? "" : " and status <> 'finalized'";
    statements.push(
      `delete from segment where meeting_id = '${meetingId}'${warunek};`
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
    runSqlFile(sqlPath);
    console.log(`Zaimportowano ${segments.length} segmentów.`);
  } finally {
    unlinkSync(sqlPath);
  }
}

main();
