#!/usr/bin/env node
// Rozpoznaje sesje rady nadające na transmisjaobrad.info i dopisuje je do
// tabeli `meeting`. Odpowiednik discover-new-sessions.mjs dla rad, których nie
// ma na esesja.pl — dziś Rada Powiatu Grójeckiego.
//
// Sam nie transkrybuje. Sesje z napisami przejmuje scripts/import-powiat-vtt.mjs
// (pobiera gotowy WebVTT), a te bez napisów — groq/pipeline-groq.mjs.
//
// W przeciwieństwie do skryptu gminnego parametry rady NIE są zaszyte: ta sama
// mechanika ma obsłużyć kolejny powiat bez kopiowania pliku.
//
// Użycie:
//   node scripts/discover-powiat-sessions.mjs --term <uuid> --channel <id/slug> --since <YYYY-MM-DD>
//   node scripts/discover-powiat-sessions.mjs ... --dry-run   (nic nie zapisuje)
//
// Domyślne wartości dotyczą Rady Powiatu Grójeckiego, VII kadencja.

import { supabaseQuery, supabaseExec, sqlText } from "./lib/db.mjs";
import { parsePolishDate, fetchDecoded, sleep } from "./lib/pl.mjs";

const BASE = "https://transmisjaobrad.info";
const SOURCE = "transmisjaobrad";

const DEFAULTS = {
  term: "",
  channel: "172/powiat-grojecki",
  // Granica kadencji: paginujemy wstecz aż do pierwszego nagrania starszego niż
  // ta data i wtedy przestajemy. Dzięki temu nie trzeba znać liczby stron.
  since: "2024-05-01",
  maxPages: 20,
};

function log(msg) {
  console.log(`[powiat-discover] ${msg}`);
}

function parseArgs(argv) {
  const args = { ...DEFAULTS, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--term") args.term = argv[++i];
    else if (a === "--channel") args.channel = argv[++i];
    else if (a === "--since") args.since = argv[++i];
    else if (a === "--max-pages") args.maxPages = Number(argv[++i]);
    else {
      console.error(`Nieznany argument: ${a}`);
      process.exit(1);
    }
  }
  args.term ||= process.env.POWIAT_TERM_ID ?? "";
  if (!args.term) {
    console.error("Brak --term <uuid> (albo POWIAT_TERM_ID). Bez kadencji nie ma do czego przypiąć sesji.");
    process.exit(1);
  }
  return args;
}

/**
 * Kafelek na liście kanału: id nagrania, tytuł, data i plakietka „napisy”.
 * Dzielimy stronę na bloki `post thumb-border`, bo data i link leżą w różnych
 * gałęziach tego samego kafelka — regex po całej stronie skleiłby sąsiadów.
 */
function parseListing(html) {
  const tiles = html.split('class="post thumb-border"').slice(1);
  const out = [];
  for (const tile of tiles) {
    const link = tile.match(/\/videos\/(\d+)\/([a-z0-9-]+)/i);
    if (!link) continue;
    const title = tile.match(/class="video-title"[^>]*>\s*([^<]+?)\s*</);
    const dateBlock = tile.match(/fa-calendar"><\/i>\s*<span>\s*([^<]+?)\s*<\/span>/);
    const date = dateBlock ? parsePolishDate(dateBlock[1]) : null;
    out.push({
      sourceId: link[1],
      slug: link[2],
      title: title ? title[1] : null,
      date,
      hasSubtitles: tile.includes("icon-closed-captioning"),
    });
  }
  return out;
}

/** Sesja nadzwyczajna ma to w tytule; CHECK na meeting_type dopuszcza tylko te dwie wartości. */
function meetingType(title) {
  return /nadzwyczajn/i.test(title ?? "") ? "nadzwyczajna" : "zwyczajna";
}

/**
 * Master HLS ze strony nagrania. Zapisujemy go jako video_url, żeby ścieżka
 * zapasowa (Groq) działała bez zmian — ffmpeg czyta HLS natywnie.
 *
 * URL napisów CELOWO nie trafia do bazy: ma w sobie podpis, który może wygasnąć.
 * Import pobiera go ze strony w momencie, w którym jest potrzebny.
 */
async function resolveVideoUrl(sourceId, slug) {
  const page = await fetchDecoded(`${BASE}/videos/${sourceId}/${slug}`);
  const m = page.match(/"src":"([^"]*?\.m3u8)"/);
  return m ? m[1].replace(/\\\//g, "/") : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  log(`Kanał ${args.channel}, kadencja ${args.term}, granica ${args.since}${args.dryRun ? " (dry-run)" : ""}.`);

  const found = [];
  let reachedBoundary = false;
  for (let page = 1; page <= args.maxPages && !reachedBoundary; page++) {
    const url = `${BASE}/channels/${args.channel}${page > 1 ? `?page=${page}` : ""}`;
    const items = parseListing(await fetchDecoded(url));
    if (items.length === 0) {
      log(`Strona ${page}: pusta — koniec kanału.`);
      break;
    }
    for (const it of items) {
      if (!it.date) {
        log(`POMIJAM ${it.sourceId}: nie rozpoznano daty.`);
        continue;
      }
      if (it.date < args.since) {
        reachedBoundary = true;
        continue;
      }
      found.push(it);
    }
    log(`Strona ${page}: ${items.length} nagrań, w zakresie kadencji ${found.length} łącznie.`);
    await sleep(400); // uprzejmie wobec transmisjaobrad.info
  }

  if (!reachedBoundary) {
    log(`UWAGA: nie napotkano nagrania starszego niż ${args.since} — lista może być niekompletna.`);
  }

  const existing = supabaseQuery(
    `select source_id from meeting where source = '${SOURCE}';`
  );
  const known = new Set(existing.map((m) => m.source_id));
  const newOnes = found.filter((f) => !known.has(f.sourceId));

  log(`W kadencji: ${found.length} nagrań, z napisami ${found.filter((f) => f.hasSubtitles).length}. Nowych do dodania: ${newOnes.length}.`);
  if (newOnes.length === 0) return;

  let added = 0;
  for (const it of newOnes) {
    const videoUrl = await resolveVideoUrl(it.sourceId, it.slug);
    const sql =
      `insert into meeting (term_id, meeting_type, source, source_id, date, title, video_url, subtitles_available) values ` +
      `(${sqlText(args.term)}, ${sqlText(meetingType(it.title))}, ${sqlText(SOURCE)}, ${sqlText(it.sourceId)}, ` +
      `${sqlText(it.date)}, ${sqlText(it.title)}, ${sqlText(videoUrl)}, ${it.hasSubtitles}) ` +
      `on conflict (source, source_id) where source_id is not null do nothing;`;
    if (args.dryRun) {
      log(`[dry-run] ${it.date} | ${it.sourceId} | ${it.title} | napisy=${it.hasSubtitles ? "tak" : "NIE"} | ${videoUrl ? "m3u8 ok" : "BRAK m3u8"}`);
    } else {
      supabaseExec(sql);
      log(`DODANO ${it.date} | ${it.sourceId} | ${it.title}${it.hasSubtitles ? "" : " | BEZ NAPISÓW → ścieżka Groq"}`);
      added++;
    }
    await sleep(400);
  }

  log(`Podsumowanie: dodano ${added}/${newOnes.length}.`);
}

main().catch((e) => {
  console.error("[powiat-discover] BŁĄD KRYTYCZNY:", e);
  process.exit(1);
});
