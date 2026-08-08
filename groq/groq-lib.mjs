// Reużywalna logika transkrypcji przez Groq — dzielenie audio z zakładką,
// wywołanie API, deduplikacja na granicach kawałków, korekta przez tokens.txt.
// Wyodrębnione i zweryfikowane na 3 rzeczywistych sesjach (Faza 1 planu
// migracji, patrz /home/blady/.claude/plans/crispy-questing-otter.md) w
// jednorazowym skrypcie testowym, od tamtej pory usuniętym jako zdublowany.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, createReadStream } from "node:fs";
import path from "node:path";
import Groq from "groq-sdk";

// 2700s @ 64kbps mono CBR ≈ 20.6MiB — bezpieczny margines pod limit 25MB/request.
const CHUNK_SECONDS = 2700;
// Zakładka między sąsiednimi kawałkami — Whisper dostaje pełny kontekst wokół
// cięcia zamiast urwanego w pół słowa audio na krawędzi. Przy scalaniu każdy
// kawałek "oddaje" tylko segmenty ze swojego właściwego (bez zakładki) okna
// czasowego, więc treść z zakładki nigdy nie trafia do wyniku podwójnie.
const OVERLAP_SECONDS = 20;

export function loadGroqApiKey(envPath) {
  const content = readFileSync(envPath, "utf8");
  const m = content.match(/^GROQ_API_KEY=(.+)$/m);
  if (!m) throw new Error(`Brak GROQ_API_KEY w ${envPath}`);
  return m[1].trim();
}

// Dwa różne miejsca na sekret (Faza 0/4 planu): w GitHub Actions GROQ_API_KEY
// przychodzi jako zmienna środowiskowa (repo secret); lokalnie na agatka —
// z groq/.env.groq. Zmienna środowiskowa ma pierwszeństwo.
export function resolveGroqApiKey(envPath) {
  return process.env.GROQ_API_KEY || loadGroqApiKey(envPath);
}

function sh(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

export function ffprobeDuration(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" }
  );
  return parseFloat(out.trim());
}

// Dzieli [0, totalDuration) na kawałki po CHUNK_SECONDS ("nominalne" okno —
// to ono, bez zakładki, "posiada" dany fragment czasu przy scalaniu), a
// każdy kawałek fizycznie wycina z dodatkowym OVERLAP_SECONDS z obu stron
// (przycięte do granic całego nagrania).
export function planChunks(totalDuration) {
  const chunks = [];
  let nominalStart = 0;
  while (nominalStart < totalDuration) {
    const nominalEnd = Math.min(nominalStart + CHUNK_SECONDS, totalDuration);
    const extractStart = Math.max(0, nominalStart - OVERLAP_SECONDS);
    const extractEnd = Math.min(totalDuration, nominalEnd + OVERLAP_SECONDS);
    chunks.push({ nominalStart, nominalEnd, extractStart, extractEnd });
    nominalStart = nominalEnd;
  }
  return chunks;
}

// Tnie mp4/mp3 źródłowe na kawałki mono 64kbps wg planChunks(), zapisując je
// w chunkDir. Zwraca listę planChunks() wzbogaconą o `file`.
export function cutChunks(sourceFile, chunkDir, namePrefix) {
  mkdirSync(chunkDir, { recursive: true });
  const totalDuration = ffprobeDuration(sourceFile);
  const plan = planChunks(totalDuration);
  const result = [];
  for (let i = 0; i < plan.length; i++) {
    const c = plan[i];
    const file = path.join(chunkDir, `${namePrefix}_${String(i).padStart(3, "0")}.mp3`);
    sh(
      "ffmpeg",
      [
        "-y",
        "-ss",
        String(c.extractStart),
        "-i",
        sourceFile,
        "-t",
        String(c.extractEnd - c.extractStart),
        "-vn",
        "-ac",
        "1",
        "-b:a",
        "64k",
        file,
      ],
      { timeout: 10 * 60 * 1000 }
    );
    result.push({ ...c, file });
  }
  return result;
}

function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/[.,!?;:„”"'()…]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

// Filtr po czasie (w transcribeChunks) usuwa większość duplikatów z zakładki,
// ale zdarza się, że Whisper inaczej dzieli tę samą wypowiedź w dwóch
// sąsiednich kawałkach, więc granica segmentu nie pokrywa się z granicą
// duplikatu (zaobserwowane realnie: "A poza tym" na końcu jednego kawałka i
// na początku następnego). Ten przebieg dogląda tylko okolicy szwu (ostatnie
// 2 segmenty poprzedniego kawałka vs. pierwsze 2 następnego) i przycina
// dosłownie powtórzony fragment z początku następnego kawałka.
function trimBoundaryEcho(prevKept, nextKept) {
  if (prevKept.length === 0 || nextKept.length === 0) return 0;
  const tailSegs = prevKept.slice(-2);
  const headSegs = nextKept.slice(0, 2);
  const tailWords = tailSegs.flatMap((s) => normalizeWords(s.text));
  const headWords = headSegs.flatMap((s) => normalizeWords(s.text));

  let overlap = 0;
  const maxCheck = Math.min(tailWords.length, headWords.length, 10);
  for (let k = maxCheck; k >= 2; k--) {
    if (tailWords.slice(-k).join(" ") === headWords.slice(0, k).join(" ")) {
      overlap = k;
      break;
    }
  }
  if (overlap === 0) return 0;

  let toRemove = overlap;
  for (const seg of headSegs) {
    if (toRemove <= 0) break;
    const words = seg.text.split(/\s+/).filter(Boolean);
    if (words.length <= toRemove) {
      toRemove -= words.length;
      seg.text = "";
    } else {
      seg.text = words.slice(toRemove).join(" ");
      toRemove = 0;
    }
  }
  return overlap;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Wysyła kawałki (z cutChunks) do Groq i scala wynik w jedną, zdeduplikowaną
// listę segmentów {start, end, text} (czasy globalne, względem całego audio).
export async function transcribeChunks(apiKey, chunks, { log = console.log } = {}) {
  const groq = new Groq({ apiKey });
  const perChunkKept = [];
  let droppedOverlap = 0;
  for (const c of chunks) {
    log(`Wysyłam ${path.basename(c.file)} do Groq...`);
    const { data, response } = await groq.audio.transcriptions
      .create({
        file: createReadStream(c.file),
        model: "whisper-large-v3",
        language: "pl",
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      })
      .withResponse();

    const segments = data.segments ?? [];
    const kept = [];
    for (const seg of segments) {
      // Czasy w odpowiedzi Groq są względne do wysłanego pliku (który zaczyna
      // się w extractStart, nie nominalStart) — stąd offset = extractStart.
      const globalStart = seg.start + c.extractStart;
      const globalEnd = seg.end + c.extractStart;
      const midpoint = (globalStart + globalEnd) / 2;
      if (midpoint < c.nominalStart || midpoint >= c.nominalEnd) {
        droppedOverlap++;
        continue;
      }
      kept.push({ start: globalStart, end: globalEnd, text: seg.text.trim() });
    }
    log(`  ${segments.length} segmentów (${kept.length} po odfiltrowaniu zakładki).`);
    perChunkKept.push(kept);

    // Bramka bezpieczeństwa pod rate-limit (Faza 5 planu) — backstop, nie
    // system kolejkowania; realny wolumen produkcyjny go raczej nie dotyka.
    const remaining = Number(response.headers.get("x-ratelimit-remaining-requests"));
    if (Number.isFinite(remaining) && remaining <= 1) {
      const resetSeconds = Number(response.headers.get("x-ratelimit-reset-requests")) || 10;
      log(`Blisko limitu RPM, czekam ${resetSeconds}s...`);
      await sleep(resetSeconds * 1000);
    }
  }

  let echoTrimmed = 0;
  for (let i = 0; i < perChunkKept.length - 1; i++) {
    if (trimBoundaryEcho(perChunkKept[i], perChunkKept[i + 1]) > 0) echoTrimmed++;
  }

  const allSegments = perChunkKept.flat().filter((s) => s.text.length > 0);
  allSegments.sort((a, b) => a.start - b.start);
  log(`Odrzucono ${droppedOverlap} segment(ów) z zakładek, przycięto echo na ${echoTrimmed} granic(y/ach).`);
  return allSegments;
}

// tokens.txt: linie `token=>zamiana`, stosowane jako dosłowne podstawienia
// (jak scripts/postprocess.py / whisper/post-process.sh dla whisperx) —
// zweryfikowane w Fazie 1, że działają wprost na wyjściu Groq bez zmian.
export function applyTokenCorrections(text, tokensFilePath) {
  const lines = readFileSync(tokensFilePath, "utf8").split("\n");
  let corrected = text;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [token, replacement] = trimmed.split("=>").map((s) => s.trim());
    if (!token || replacement === undefined) continue;
    corrected = corrected.split(token).join(replacement);
  }
  return corrected;
}

function pad(n, w = 2) {
  return String(n).padStart(w, "0");
}

function formatCueTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const ms = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

export function segmentsToVtt(segments) {
  const body = segments
    .map((s) => `${formatCueTime(s.start)} --> ${formatCueTime(s.end)}\n${s.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

export function writeVttFile(outPath, segments) {
  writeFileSync(outPath, segmentsToVtt(segments), "utf8");
}
