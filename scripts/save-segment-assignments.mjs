#!/usr/bin/env node
// Zrzuca przypisania mówców jednej sesji PRZED ponowną transkrypcją.
//
// Powód: nowa transkrypcja to inne granice segmentów, więc `segment.id` nie
// przeżyje reimportu i przypisania trzeba odtworzyć po czasie, nie po kluczu.
// Ten skrypt zapisuje dwa pliki w backups/:
//
//   segmenty-<sesja>-<data>.sql       pełny zrzut WSZYSTKICH segmentów sesji
//                                     jako `insert ... values` — koło ratunkowe
//                                     na wypadek, gdyby cała operacja poszła
//                                     źle (ten sam format co przy retimingu
//                                     sesji 77320, 13.08.2026)
//   przypisania-<sesja>-<data>.json   tylko segmenty ZATWIERDZONE
//                                     (status = 'finalized') z mówcą — materiał
//                                     wejściowy dla restore-segment-assignments
//
// Propozycje (status = 'proposed', np. z dopasowania po protokole) świadomie
// NIE trafiają do pliku przypisań: to praca maszynowa, odtwarzalna przez
// scripts/match-protokol-speakers.py, a mieszanie jej z ręcznymi decyzjami
// zacierałoby granicę „redaktor proponuje / moderator zatwierdza". W zrzucie
// .sql są, bo tam chodzi o wierną kopię stanu.
//
// Użycie:
//   node scripts/save-segment-assignments.mjs --meeting <uuid>
//   node scripts/save-segment-assignments.mjs --esesja 72888

import { writeFileSync } from "node:fs";
import path from "node:path";
import { supabaseQuery, sqlText, REPO_ROOT } from "./lib/db.mjs";

const PACZKA = 500; // stronicowanie: nie ufamy, że CLI odda dowolnie dużo wierszy naraz

function parseArgs(argv) {
  const args = { meeting: null, esesja: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--meeting") args.meeting = argv[++i];
    else if (argv[i] === "--esesja") args.esesja = argv[++i];
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!args.meeting && !args.esesja) {
    console.error(
      "Użycie: node scripts/save-segment-assignments.mjs (--meeting <uuid> | --esesja <id>)"
    );
    process.exit(1);
  }
  return args;
}

function pobierzSesje({ meeting, esesja }) {
  const warunek = meeting ? `id = ${sqlText(meeting)}` : `esesja_id = ${sqlText(esesja)}`;
  const rows = supabaseQuery(
    `select id, title, date, esesja_id from meeting where ${warunek};`
  );
  if (rows.length === 0) {
    console.error("Nie znaleziono takiej sesji w tabeli meeting.");
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(`Warunek pasuje do ${rows.length} sesji — doprecyzuj --meeting <uuid>.`);
    process.exit(1);
  }
  return rows[0];
}

function pobierzSegmenty(meetingId) {
  const wszystkie = [];
  for (let offset = 0; ; offset += PACZKA) {
    const paczka = supabaseQuery(
      `select id, start_time, end_time, text, status,
              confirmed_councilor_id, confirmed_official_id,
              finalized_by, finalized_at, created_at
         from segment
        where meeting_id = ${sqlText(meetingId)}
        order by start_time, id
        limit ${PACZKA} offset ${offset};`
    );
    wszystkie.push(...paczka);
    if (paczka.length < PACZKA) break;
  }
  return wszystkie;
}

function zrzutSql(meetingId, segmenty) {
  const kolumny =
    "id, meeting_id, start_time, end_time, text, status, " +
    "confirmed_councilor_id, confirmed_official_id, finalized_by, finalized_at, created_at";
  return segmenty
    .map(
      (s) =>
        `insert into segment (${kolumny}) values (` +
        [
          sqlText(s.id),
          sqlText(meetingId),
          Number(s.start_time),
          Number(s.end_time),
          sqlText(s.text),
          sqlText(s.status),
          sqlText(s.confirmed_councilor_id),
          sqlText(s.confirmed_official_id),
          sqlText(s.finalized_by),
          sqlText(s.finalized_at),
          sqlText(s.created_at),
        ].join(",") +
        ");"
    )
    .join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sesja = pobierzSesje(args);
  const segmenty = pobierzSegmenty(sesja.id);

  if (segmenty.length === 0) {
    console.error("Ta sesja nie ma segmentów — nie ma czego zapisywać.");
    process.exit(1);
  }

  const przypisane = segmenty.filter(
    (s) =>
      s.status === "finalized" &&
      (s.confirmed_councilor_id || s.confirmed_official_id)
  );

  const stempel = new Date().toISOString().slice(0, 10);
  const nazwa = sesja.esesja_id ?? sesja.id.slice(0, 8);
  const sqlPath = path.join(REPO_ROOT, "backups", `segmenty-${nazwa}-${stempel}.sql`);
  const jsonPath = path.join(REPO_ROOT, "backups", `przypisania-${nazwa}-${stempel}.json`);

  writeFileSync(sqlPath, zrzutSql(sesja.id, segmenty) + "\n", "utf8");

  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        meeting_id: sesja.id,
        esesja_id: sesja.esesja_id,
        title: sesja.title,
        date: sesja.date,
        zapisano: new Date().toISOString(),
        zrzut_sql: path.relative(REPO_ROOT, sqlPath),
        segmentow_lacznie: segmenty.length,
        przypisania: przypisane.map((s) => ({
          start_time: Number(s.start_time),
          end_time: Number(s.end_time),
          text: s.text,
          confirmed_councilor_id: s.confirmed_councilor_id,
          confirmed_official_id: s.confirmed_official_id,
          finalized_by: s.finalized_by,
          finalized_at: s.finalized_at,
        })),
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const czas = przypisane.reduce(
    (suma, s) => suma + (Number(s.end_time) - Number(s.start_time)),
    0
  );
  console.log(`Sesja: ${sesja.title ?? sesja.date} (${sesja.id})`);
  console.log(`Segmentów w bazie: ${segmenty.length}`);
  console.log(
    `Zatwierdzonych z mówcą: ${przypisane.length} (${(czas / 60).toFixed(1)} min mowy, ` +
      `zakres ${Number(przypisane[0]?.start_time ?? 0).toFixed(0)}–` +
      `${Number(przypisane.at(-1)?.end_time ?? 0).toFixed(0)} s)`
  );
  console.log(`Zrzut pełny:   ${path.relative(REPO_ROOT, sqlPath)}`);
  console.log(`Przypisania:   ${path.relative(REPO_ROOT, jsonPath)}`);
}

main();
