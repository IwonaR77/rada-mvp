// PoC pamięci semantycznej spraw — backfill embeddingów dla:
// 1. wszystkich bloków wypowiedzi (segmenty finalized+confirmed, sklejone
//    mergeIntoBlocks) → tabela speech_block_embedding,
// 2. wszystkich `matter` (title+notes) → matter.embedding.
//
// Idempotentny: unique(meeting_id, first_segment_id) + ON CONFLICT DO NOTHING,
// bezpiecznie uruchamiać ponownie po doimportowaniu nowych sesji.
//
// Uruchomienie: set -a && source .env.backup && set +a && node scripts/poc-embeduj-bloki.mjs

import { execFileSync } from "node:child_process";
import { supabaseQuery, sqlText } from "./lib/db.mjs";
import { mergeIntoBlocks } from "../src/lib/speech-blocks.ts";
import { embedPassage } from "./lib/embeddings.mjs";

function vectorLiteral(vec) {
  return `'[${vec.join(",")}]'::vector`;
}

// supabaseExec z db.mjs przekazuje SQL jako argument -c — Linux ogranicza
// pojedynczy argument execve do ~128 KB (MAX_ARG_STRLEN), a jeden batch
// insertów z wektorami 384-wymiarowymi łatwo to przebija. Stdin nie ma tego
// limitu.
function execSqlStdin(sql) {
  execFileSync(
    "psql",
    [process.env.SUPABASE_DB_URL, "-v", "ON_ERROR_STOP=1", "-q"],
    { input: sql, encoding: "utf8" }
  );
}

const limitIdx = process.argv.indexOf("--limit-sesje");
const limitSesji = limitIdx !== -1 ? Number(process.argv[limitIdx + 1]) : null;

// Dwa rodzaje mówców, ta sama logika sklejania i zapisu — różni się tylko
// kolumna, po której grupujemy segmenty, i kolumna, do której piszemy id
// mówcy (speech_block_embedding wymaga dokładnie jednej z dwóch, patrz
// migrate-embeddingi-urzednicy.sql). "official" to nie tylko urzędnicy
// ratusza — obejmuje też role "Mieszkaniec" i "Gość", więc ta gałąź łapie
// też głosy mieszkańców i zaproszonych gości, nie tylko administrację.
const RODZAJE_MOWCOW = [
  { pole: "confirmed_councilor_id", kolumnaWTabeli: "councilor_id", etykieta: "radni" },
  {
    pole: "confirmed_official_id",
    kolumnaWTabeli: "official_id",
    etykieta: "urzędnicy/goście/mieszkańcy",
    // "Błąd rozpoznawania mowy" to placeholder na nieudaną transkrypcję,
    // nie realny mówca — embedowanie tego to czysty szum.
    wyklucz:
      "and confirmed_official_id not in (select id from official where role = 'Błąd rozpoznawania mowy')",
  },
];

async function embedujBloki() {
  let zapisaneWsumie = 0;

  for (const rodzaj of RODZAJE_MOWCOW) {
    console.log(`\n=== ${rodzaj.etykieta} ===`);
    console.log("Pobieram sesje z gotowymi segmentami...");
    let meetings = supabaseQuery(`
      select distinct meeting_id as id
      from segment
      where status = 'finalized' and ${rodzaj.pole} is not null
      ${rodzaj.wyklucz ?? ""}
    `);
    if (limitSesji) meetings = meetings.slice(0, limitSesji);
    console.log(`${meetings.length} sesji do przetworzenia.`);

    let wszystkieBloki = 0;
    let zapisane = 0;

    for (const [i, meeting] of meetings.entries()) {
      const segments = supabaseQuery(`
        select id, start_time, end_time, text, ${rodzaj.pole} as mowca_id
        from segment
        where meeting_id = '${meeting.id}'
          and status = 'finalized'
          and ${rodzaj.pole} is not null
          ${rodzaj.wyklucz ?? ""}
        order by start_time
      `);

      const perMowca = new Map();
      for (const s of segments) {
        const key = s.mowca_id;
        if (!perMowca.has(key)) perMowca.set(key, []);
        perMowca.get(key).push(s);
      }

      const rows = [];
      for (const [mowcaId, segs] of perMowca) {
        const blocks = mergeIntoBlocks(segs);
        for (const b of blocks) {
          if (!b.text) continue;
          wszystkieBloki++;
          const wektor = await embedPassage(b.text);
          rows.push(
            `('${meeting.id}', '${mowcaId}', '${b.segmentId}', ${b.start}, ${b.end}, ${sqlText(
              b.text
            )}, ${vectorLiteral(wektor)})`
          );
        }
      }

      if (rows.length > 0) {
        // Chunki po 20 — nawet przy stdin bez limitu argv, trzymamy pojedyncze
        // zapytania w rozsądnym rozmiarze.
        for (let j = 0; j < rows.length; j += 20) {
          const chunk = rows.slice(j, j + 20);
          execSqlStdin(`
            insert into speech_block_embedding
              (meeting_id, ${rodzaj.kolumnaWTabeli}, first_segment_id, start_time, end_time, text, embedding)
            values ${chunk.join(",")}
            on conflict (meeting_id, first_segment_id) do nothing;
          `);
          zapisane += chunk.length;
        }
      }

      console.log(
        `[${i + 1}/${meetings.length}] sesja ${meeting.id}: ${rows.length} bloków (razem zapisanych: ${zapisane})`
      );
    }

    console.log(`${rodzaj.etykieta}: ${wszystkieBloki} bloków policzonych, ${zapisane} wierszy zapisanych/pominiętych.`);
    zapisaneWsumie += zapisane;
  }

  console.log(`\nGotowe łącznie. ${zapisaneWsumie} wierszy zapisanych/pominiętych (idempotentnie).`);
}

async function embedujSprawy() {
  console.log("\nPobieram sprawy bez embeddingu...");
  const matters = supabaseQuery(`
    select id, title, notes
    from matter
    where embedding is null
  `);
  console.log(`${matters.length} spraw do policzenia.`);

  for (const [i, m] of matters.entries()) {
    const text = [m.title, m.notes].filter(Boolean).join(". ");
    const wektor = await embedPassage(text);
    execSqlStdin(`
      update matter set embedding = ${vectorLiteral(wektor)} where id = '${m.id}';
    `);
    console.log(`[${i + 1}/${matters.length}] ${m.title}`);
  }
}

await embedujBloki();
await embedujSprawy();
