#!/usr/bin/env node
// Sprawdza /transmisje_z_obrad_rady na esesja.pl pod kątem sesji, których
// jeszcze nie mamy w tabeli `meeting`, i dopisuje je (term_id, esesja_id,
// date, title, video_url). To wszystko, co ten skrypt robi — CELOWO nie
// pobiera/nie wysyła nagrania na serwer transkrypcji i nie startuje
// transkrypcji: `whisper/pipeline-advance.mjs`, uruchamiany cyklicznie,
// sam znajdzie każdy nowy wiersz `meeting` z transcript_status != 'rozpisana'
// i przeprowadzi go przez cały cykl (pobranie, konwersja, wysyłka, start
// transkrypcji, import gotowego .vtt) automatycznie w kolejnym cyklu — nie
// trzeba tego dublować ani ręcznie "importować" żadnej paczki, żeby nowa
// sesja pojawiła się na osi czasu w /rada/[councilId].
//
// Uruchom ręcznie, np. raz na tydzień: node scripts/discover-new-sessions.mjs

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

const BASE = "https://grojec.esesja.pl";
const COUNCIL_ID = "846c8bce-7f11-4825-91dd-fe80cedf5289";
const TERM_ID = "c4bc384f-33c3-46bd-b67c-ab569bb399dd";

const MONTHS = {
  stycznia: "01", lutego: "02", marca: "03", kwietnia: "04",
  maja: "05", czerwca: "06", lipca: "07", sierpnia: "08",
  września: "09", października: "10", listopada: "11", grudnia: "12",
};

function log(msg) {
  console.log(`[discover] ${msg}`);
}

function getServiceRoleKey() {
  const out = execFileSync(
    "npx",
    ["supabase", "projects", "api-keys", "--project-ref", "nmsictzdvqbzevkolqpu"],
    { encoding: "utf8", cwd: "/home/blady/Projects/rada-mvp" }
  );
  const json = JSON.parse(out.trim().split("\n").pop());
  return json.keys.find((k) => k.id === "service_role").api_key;
}

const supabase = createClient(
  "https://nmsictzdvqbzevkolqpu.supabase.co",
  getServiceRoleKey()
);

function parsePolishDateFromSlug(slug) {
  // Slugi wyglądają jak "sesjaaradyawadniuaśrodaa26aczerwcaa2024" — spacje
  // zamienione na "a". Wyłuskujemy "<dzień>a<miesiąc słownie>a<rok>" z końca.
  const m = slug.match(/(\d{1,2})a([a-ząćęłńóśźż]+)a(\d{4})/i);
  if (!m) return null;
  const [, day, monthName, year] = m;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

async function fetchDecoded(url) {
  // Te same dwie strony bywają UTF-8 albo windows-1250 bez deklaracji —
  // patrz gotcha #1 w scrape-esesja-records.mjs. Sniffujemy zamiast zgadywać.
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 600).toString("latin1");
  const isUtf8 = /charset=["']?utf-?8/i.test(head);
  return isUtf8 ? buf.toString("utf8") : buf.toString("latin1");
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

  const { data: existing, error: existingError } = await supabase
    .from("meeting")
    .select("esesja_id")
    .eq("term_id", TERM_ID);
  if (existingError) throw new Error(`select meeting: ${existingError.message}`);
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
    const { error } = await supabase.from("meeting").insert({
      term_id: TERM_ID,
      meeting_type: "sesja",
      esesja_id: l.esesjaId,
      date,
      title,
      video_url: videoUrl,
    });
    if (error) {
      log(`BŁĄD przy dodawaniu ${l.esesjaId} (${date}): ${error.message}`);
      continue;
    }
    log(`DODANO ${l.esesjaId} (${date}) — ${title ?? "(bez tytułu)"}`);
    added++;
    await sleep(500); // uprzejmie wobec esesja.pl
  }

  log(`Podsumowanie: dodano ${added}/${newOnes.length} nowych sesji do council_id=${COUNCIL_ID}, term_id=${TERM_ID}.`);
  if (added > 0) {
    log(
      "Nic więcej nie trzeba robić ręcznie — whisper/pipeline-advance.mjs " +
      "podejmie te sesje w swoim najbliższym cyklu (pobranie, transkrypcja, " +
      "import) i pojawią się na osi czasu /rada/[councilId] automatycznie."
    );
  }
}

main().catch((e) => {
  console.error("[discover] BŁĄD KRYTYCZNY:", e);
  process.exit(1);
});
