#!/usr/bin/env node
// Pobiera ścieżkę dźwiękową sesji z esesja.tv do groq/work/audio/ — materiał
// pod wzorce głosu i testy rozpoznawania.
//
// Osobno od `groq/pipeline-groq.mjs`, mimo podobnego kroku: tam pobranie jest
// częścią transkrypcji jednej nowej sesji (mp4 + archiwalne mp3 + wpis do
// mp3-stats), tutaj ściągamy hurtem stare sesje, których transkrypcję dawno
// mamy, i interesuje nas wyłącznie dźwięk.
//
// Kopiujemy strumień audio bez przekodowania (`-vn -c:a copy`): przekodowanie
// zmieniłoby artefakty stratnej kompresji, a wzorce i materiał testowy muszą
// pochodzić z tak samo brzmiących plików — inaczej część „różnicy głosów"
// w ocenie to w rzeczywistości różnica kodeków.
//
// Plik oznaczamy `.gotowe` dopiero po udanym pobraniu. Bez tego przerwane
// pobranie (a łącze do stream1.esesja.tv potrafi zerwać) zostawia obcięty
// plik, który wygląda jak kompletny i po cichu psuje embeddingi końcówki.
//
// Użycie:
//   node scripts/voice/pobierz-audio.mjs 78623,80283,82474
//   node scripts/voice/pobierz-audio.mjs --wszystkie-z groq/work/glos/groundtruth.json

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const AUDIO_DIR = path.join(REPO_ROOT, "groq/work/audio");

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function resolveVideoUrl(esesjaId) {
  const listing = await fetch(
    "https://grojec.esesja.pl/transmisje_z_obrad_rady"
  ).then((r) => r.text());
  const linkMatch = listing.match(
    new RegExp(`/transmisja/${esesjaId}/[^"']+\\.htm`)
  );
  if (!linkMatch) return null;
  const pageUrl = `https://grojec.esesja.pl${linkMatch[0]}`;
  const page = await fetch(pageUrl).then((r) => r.text());
  const videoMatch = page.match(/videourl='([^']+)'/);
  return videoMatch ? videoMatch[1] : null;
}

function wolneMB() {
  const out = execFileSync("df", ["-Pm", AUDIO_DIR]).toString().trim().split("\n").pop();
  return Number(out.split(/\s+/)[3]);
}

async function pobierz(esesjaId, data) {
  mkdirSync(AUDIO_DIR, { recursive: true });
  const baza = path.join(AUDIO_DIR, `${esesjaId}_${data}`);
  const gotoweMp3 = `${baza}.mp3.gotowe`;
  const cel = `${baza}.m4a`;
  const gotowe = `${cel}.gotowe`;

  if (existsSync(gotowe) || existsSync(gotoweMp3)) {
    log(`${esesjaId}: już mam, pomijam`);
    return true;
  }
  // Plik bez znacznika `.gotowe` to pozostałość po zerwanym pobraniu.
  // Kasujemy, zamiast liczyć z niego embeddingi końcówki, której tam nie ma.
  for (const stary of [`${baza}.mp3`, cel]) {
    if (existsSync(stary)) {
      log(`${esesjaId}: kasuję niedokończone ${path.basename(stary)}`);
      unlinkSync(stary);
    }
  }
  // Zapas na wypadek, gdyby sesja okazała się długa — 2,5 h dźwięku to ~150 MB.
  if (wolneMB() < 400) {
    log(`${esesjaId}: mniej niż 400 MB wolnego, przerywam`);
    return false;
  }

  const videoUrl = await resolveVideoUrl(esesjaId);
  if (!videoUrl) {
    log(`${esesjaId}: nie znalazłem transmisji na stronie rady`);
    return false;
  }

  log(`${esesjaId}: pobieram ${videoUrl}`);
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-nostats", "-loglevel", "error", "-i", videoUrl,
       "-vn", "-c:a", "copy", "-f", "mp4", cel],
      { stdio: ["ignore", "ignore", "inherit"], timeout: 3 * 60 * 60 * 1000 }
    );
  } catch (e) {
    log(`${esesjaId}: pobieranie nie wyszło (${e.message.split("\n")[0]})`);
    if (existsSync(cel)) unlinkSync(cel);
    return false;
  }

  const mb = (statSync(cel).size / 1024 / 1024).toFixed(0);
  writeFileSync(gotowe, "");
  log(`${esesjaId}: gotowe, ${mb} MB`);
  return true;
}

async function main() {
  const argv = process.argv.slice(2);
  let sesje = [];
  const idx = argv.indexOf("--wszystkie-z");
  if (idx >= 0) {
    const gt = JSON.parse(readFileSync(argv[idx + 1], "utf8")).segmenty;
    sesje = [...new Set(gt.map((s) => s.esesja_id))];
  } else if (argv[0]) {
    sesje = argv[0].split(",");
  } else {
    console.error("Podaj sesje po przecinku albo --wszystkie-z <groundtruth.json>");
    process.exit(1);
  }

  const gtPlik = path.join(REPO_ROOT, "groq/work/glos/groundtruth.json");
  const daty = {};
  if (existsSync(gtPlik)) {
    for (const s of JSON.parse(readFileSync(gtPlik, "utf8")).segmenty) {
      daty[s.esesja_id] = s.date;
    }
  }

  for (const s of sesje) {
    if (!daty[s]) {
      log(`${s}: nie znam daty sesji (brak w groundtruth), pomijam`);
      continue;
    }
    await pobierz(s, daty[s]);
  }
}

main();
