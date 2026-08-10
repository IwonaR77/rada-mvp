#!/usr/bin/env node
// Sprawdza /transmisje_z_obrad_rady na esesja.pl pod kątem sesji, których
// jeszcze nie mamy w tabeli `meeting`, i dopisuje je (term_id, esesja_id,
// date, title, video_url). To wszystko, co ten skrypt robi — CELOWO nie
// pobiera/nie wysyła nagrania na serwer transkrypcji i nie startuje
// transkrypcji: `groq/pipeline-groq.mjs`, uruchamiany cyklicznie, sam
// znajdzie każdy nowy wiersz `meeting` z transcript_status != 'rozpisana'
// i przeprowadzi go przez cały cykl (pobranie, konwersja, transkrypcja przez
// Groq, import gotowego .vtt) automatycznie w kolejnym cyklu — nie trzeba
// tego dublować ani ręcznie "importować" żadnej paczki, żeby nowa sesja
// pojawiła się na osi czasu w /rada/[councilId].
//
// Uruchamiany automatycznie przez .github/workflows/transcribe-groq.yml
// (krok przed pipeline-groq.mjs) — albo ręcznie: node scripts/discover-new-sessions.mjs

import { supabaseQuery, sqlEscape } from "./lib/db.mjs";
import { parsePolishDateFromSlug, fetchDecoded, sleep } from "./lib/pl.mjs";

const BASE = "https://grojec.esesja.pl";
const COUNCIL_ID = "846c8bce-7f11-4825-91dd-fe80cedf5289";
const TERM_ID = "c4bc384f-33c3-46bd-b67c-ab569bb399dd";
const SOURCE = "esesja";

function log(msg) {
  console.log(`[discover] ${msg}`);
}

async function resolveVideoUrlAndTitle(esesjaId, path) {
  const page = await fetchDecoded(`${BASE}${path}`);
  const videoMatch = page.match(/videourl='([^']+)'/);
  const titleMatch = page.match(/<h1[^>]*>([^<]+)<\/h1>/);
  return {
    videoUrl: videoMatch ? videoMatch[1] : null,
    title: titleMatch ? titleMatch[1].trim() : null,
  };
}

/** Sesja nadzwyczajna ma to w tytule; CHECK na meeting_type dopuszcza tylko te dwie wartości. */
function meetingType(title) {
  return /nadzwyczajn/i.test(title ?? "") ? "nadzwyczajna" : "zwyczajna";
}

async function main() {
  const listing = await fetchDecoded(`${BASE}/transmisje_z_obrad_rady`);
  const seenIds = new Set();
  const links = [];
  for (const m of listing.matchAll(/\/transmisja\/(\d+)\/([^"']+)\.htm/g)) {
    if (seenIds.has(m[1])) continue; // each session's link appears twice (thumbnail + title)
    seenIds.add(m[1]);
    links.push({ esesjaId: m[1], path: `/transmisja/${m[1]}/${m[2]}.htm`, slug: m[2] });
  }
  log(`Znaleziono ${links.length} sesji na liście transmisji.`);

  const existing = supabaseQuery(
    `select esesja_id from meeting where term_id = '${TERM_ID}';`
  );
  const knownIds = new Set(existing.map((m) => m.esesja_id));

  const newOnes = links.filter((l) => !knownIds.has(l.esesjaId));
  if (newOnes.length === 0) {
    log("Brak nowych sesji — wszystko, co jest na esesja.pl, już mamy.");
    return;
  }
  log(`Nowych sesji do dodania: ${newOnes.length}`);

  let added = 0;
  for (const l of newOnes) {
    const date = parsePolishDateFromSlug(l.slug);
    if (!date) {
      log(`POMIJAM ${l.esesjaId}: nie udało się rozpoznać daty ze slugu "${l.slug}".`);
      continue;
    }
    const { videoUrl, title } = await resolveVideoUrlAndTitle(l.esesjaId, l.path);
    try {
      // meeting_type musi być jedną z wartości z CHECK-a ('zwyczajna',
      // 'nadzwyczajna', 'komisja') — wcześniej szło tu na sztywno 'sesja',
      // co odrzuciłoby każdą nową sesję przy pierwszym realnym trafieniu.
      // source/source_id to klucz naturalny wspólny z radami spoza esesja.pl.
      supabaseQuery(
        `insert into meeting (term_id, meeting_type, source, source_id, esesja_id, date, title, video_url) values ` +
          `('${TERM_ID}', '${meetingType(title)}', '${SOURCE}', '${sqlEscape(l.esesjaId)}', '${sqlEscape(l.esesjaId)}', '${date}', ` +
          `${title ? `'${sqlEscape(title)}'` : "null"}, ` +
          `${videoUrl ? `'${sqlEscape(videoUrl)}'` : "null"});`
      );
    } catch (e) {
      log(`BŁĄD przy dodawaniu ${l.esesjaId} (${date}): ${e.message}`);
      continue;
    }
    log(`DODANO ${l.esesjaId} (${date}) — ${title ?? "(bez tytułu)"}`);
    added++;
    await sleep(500); // uprzejmie wobec esesja.pl
  }

  log(`Podsumowanie: dodano ${added}/${newOnes.length} nowych sesji do council_id=${COUNCIL_ID}, term_id=${TERM_ID}.`);
  if (added > 0) {
    log(
      "Nic więcej nie trzeba robić ręcznie — groq/pipeline-groq.mjs " +
      "podejmie te sesje w swoim najbliższym cyklu (pobranie, transkrypcja, " +
      "import) i pojawią się na osi czasu /rada/[councilId] automatycznie."
    );
  }
}

main().catch((e) => {
  console.error("[discover] BŁĄD KRYTYCZNY:", e);
  process.exit(1);
});
