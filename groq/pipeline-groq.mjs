#!/usr/bin/env node
// Docelowy orkiestrator transkrypcji przez Groq (Faza 4 planu migracji, patrz
// /home/blady/.claude/plans/crispy-questing-otter.md) — następca
// whisper/pipeline-advance.mjs dla NOWYCH sesji. Bezstanowy: każde
// uruchomienie samo ustala co robić na podstawie DB
// (meeting.transcript_status/video_url), przetwarza NAJWYŻEJ jedną sesję na
// wywołanie — ta sama zasada bezpieczeństwa co pipeline-advance.mjs, a każdy
// przebieg workflow GitHub Actions jest krótki i tak.
//
// Ścieżka whisperx (192.168.90.57, whisper/pipeline-advance.mjs) zostaje
// osobna, nietknięta, jako fallback "w wyjątkowych sytuacjach" (decyzja
// użytkownika) — ten skrypt jej nie dotyka i nie zastępuje. Working pliki tego
// pipeline'u (mp4/mp3/kawałki/vtt) mają własny katalog (groq/work/), żeby
// nigdy nie kolidować nazwami z whisper/videos/ używanym przez starą ścieżkę.
// Backfill historycznych sesji świadomie poza zakresem (decyzja z Fazy 1) —
// ten orkiestrator obsługuje tylko sesje jeszcze nietranskrybowane.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cutChunks,
  transcribeChunks,
  applyTokenCorrections,
  writeVttFile,
  resolveGroqApiKey,
  ffprobeDuration,
} from "./groq-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_DIR = path.join(REPO_ROOT, "groq/work");
// groq/ jest samowystarczalny — nic nie czyta ani nie zapisuje w whisper/
// (własna kopia tokens.txt, własny mp3-stats.json). Dwie kopie tokens.txt
// mogą się z czasem rozjechać (np. korekty specyficzne dla Groq dopisane
// tylko tu) — to świadomy kompromis, nie przeoczenie.
const TOKENS_FILE = path.join(REPO_ROOT, "groq/tokens.txt");
const MP3_STATS_FILE = path.join(REPO_ROOT, "groq/mp3-stats.json");
const GROQ_ENV_FILE = path.join(REPO_ROOT, "groq/.env.groq");

function log(msg) {
  console.log(`[pipeline-groq] ${msg}`);
}

// Ten sam wzorzec co scripts/import-transcript.mjs (patrz tamten komentarz):
// SUPABASE_DB_URL (repo secret w CI) → bezpośrednie psql, omija auth CLI
// Supabase, który wymaga keyringu/D-Bus sesji desktopowej niedostępnej
// headless. Lokalnie (agatka) bez SUPABASE_DB_URL — zachowanie bez zmian.
function supabaseQuery(sql) {
  if (process.env.SUPABASE_DB_URL) {
    const wrapped = `select coalesce(json_agg(row_to_json(sub)), '[]'::json) from (${sql.replace(/;\s*$/, "")}) sub;`;
    const out = execFileSync(
      "psql",
      [process.env.SUPABASE_DB_URL, "-t", "-A", "-c", wrapped],
      { encoding: "utf8" }
    );
    return JSON.parse(out.trim() || "[]");
  }
  // Telemetria ("PostHog") Supabase CLI czasem kończy się niezerowym kodem
  // mimo że zapytanie już się powiodło i JSON jest w stdout — nie traktować
  // tego jak realną porażkę (ten sam fallback co pipeline-advance.mjs).
  try {
    const out = execFileSync(
      "npx",
      ["supabase", "db", "query", "--linked", "--output", "json", sql],
      { encoding: "utf8", cwd: REPO_ROOT, timeout: 30000 }
    );
    return JSON.parse(out).rows ?? [];
  } catch (e) {
    const stdout = e.stdout?.toString() ?? "";
    try {
      return JSON.parse(stdout).rows ?? [];
    } catch {
      throw e;
    }
  }
}

function sqlEscape(s) {
  return s.replace(/'/g, "''");
}

/**
 * Polecenie nie zwracające wierszy (update). Osobno od supabaseQuery, bo tamta
 * opakowuje SQL w `select ... from (<sql>) sub` — co dla SELECT-a jest sposobem
 * na JSON, ale UPDATE w podzapytaniu jest błędem składni.
 *
 * Błąd spał tu od początku: lokalnie (agatka) idzie ścieżka `supabase db query`,
 * która nic nie opakowuje, a w GitHub Actions pipeline nigdy dotąd nie trafił
 * na sesję do przetworzenia — wszystkie przebiegi kończyły się na "brak sesji
 * oczekujących" i nie dochodziły do żadnego zapisu.
 */
function supabaseExec(sql) {
  if (process.env.SUPABASE_DB_URL) {
    execFileSync(
      "psql",
      [process.env.SUPABASE_DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
      { encoding: "utf8" }
    );
    return;
  }
  execFileSync("npx", ["supabase", "db", "query", "--linked", sql], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    timeout: 30000,
  });
}

// Identyfikator posiedzenia u dostawcy transmisji. Rady spoza esesja.pl nie
// mają esesja_id — bez tego wychodziła nazwa "sesja_null_<data>", a dwie takie
// sesje nadpisywałyby sobie wpis w mp3-stats.json.
function sessionKey(m) {
  return m.esesja_id ?? m.source_id ?? m.id;
}

// Tylko etykieta plików roboczych; wiązanie z posiedzeniem idzie osobno,
// przez --meeting przy imporcie.
function sessionName(m) {
  return `sesja_${sessionKey(m)}_${m.date}`;
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

// Archiwalna, wysokiej jakości kopia mp3 (-q:a 0) — niezależna od niskobitowej
// kopii pod Groq (patrz groq-lib.mjs cutChunks). Zasila groq/mp3-stats.json
// (własny, niezależny od whisper/mp3-stats.json starego pipeline'u), który
// realnie karmi też przyszły temat identyfikacji mówcy głosem (backlog).
/** Odkłada ostatni znany stan darmowego limitu Groqa (patrz usage_snapshot). */
function zapiszLimityGroq(limity) {
  const wiersze = [
    ["audio_pozostalo_s", limity.zostaloAudioSekund, "s"],
    ["audio_limit_s", limity.limitAudioSekund, "s"],
    ["zapytania_pozostalo", limity.zostaloZapytan, "szt."],
    ["zapytania_limit", limity.limitZapytan, "szt."],
  ].filter(([, v]) => Number.isFinite(v));
  if (wiersze.length === 0) return;
  try {
    supabaseExec(`
      insert into usage_snapshot (source, metric, value, unit, recorded_at) values
      ${wiersze.map(([m, v, u]) => `('groq', '${m}', ${v}, '${u}', now())`).join(",")}
      on conflict (source, metric) do update
        set value = excluded.value, unit = excluded.unit, recorded_at = excluded.recorded_at;`);
  } catch (e) {
    // Zapis statystyki nigdy nie może przewrócić opłaconej transkrypcji.
    log(`Nie udało się zapisać stanu limitu Groqa: ${e.message}`);
  }
}

function recordMp3Stats(sessionId, date, sizeBytes, durationSeconds) {
  let statsFile = { bytes_per_second_estimate: null, sessions: [] };
  if (existsSync(MP3_STATS_FILE)) {
    try {
      statsFile = JSON.parse(readFileSync(MP3_STATS_FILE, "utf8"));
    } catch {
      // Uszkodzony/brakujący plik — zacznij od nowa zamiast wywalać pipeline.
    }
  }
  const entry = {
    esesja_id: sessionId,
    date,
    duration_seconds: durationSeconds,
    mp3_size_bytes: sizeBytes,
    source: "real",
  };
  const idx = statsFile.sessions.findIndex((s) => s.esesja_id === sessionId);
  if (idx >= 0) statsFile.sessions[idx] = entry;
  else statsFile.sessions.push(entry);
  statsFile.sessions.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  writeFileSync(MP3_STATS_FILE, JSON.stringify(statsFile, null, 2));
}

function downloadAndConvert(name, videoUrl, sessionId, date) {
  const mp4 = path.join(WORK_DIR, `${name}.mp4`);
  const mp3 = path.join(WORK_DIR, `${name}.mp3`);
  mkdirSync(WORK_DIR, { recursive: true });
  if (!existsSync(mp4)) {
    log(`Pobieram ${name}...`);
    execFileSync("ffmpeg", ["-y", "-i", videoUrl, "-c", "copy", mp4], {
      stdio: "inherit",
      // Łącze do stream1.esesja.tv bywa wolne (obserwowane ~150KB/s) —
      // szeroki margines na dłuższe sesje.
      timeout: 3 * 60 * 60 * 1000,
    });
  }
  if (!existsSync(mp3)) {
    log(`Konwertuję ${name} do mp3 (archiwalna jakość)...`);
    execFileSync("ffmpeg", ["-y", "-i", mp4, "-q:a", "0", "-map", "a", mp3], {
      stdio: "inherit",
      timeout: 15 * 60 * 1000,
    });
  }
  try {
    const sizeBytes = statSync(mp3).size;
    const durationSeconds = ffprobeDuration(mp3);
    recordMp3Stats(sessionId, date, sizeBytes, durationSeconds);
  } catch (e) {
    log(`Nie udało się zapisać statystyk mp3: ${e.message}`);
  }
  return { mp4, mp3 };
}

/**
 * @param m wiersz z `meeting` (id, esesja_id, source_id, date, video_url)
 * @param importArgs dodatkowe flagi dla scripts/import-transcript.mjs.
 *   Domyślnie puste — normalny bieg to sesja bez segmentów. Potrzebne przy
 *   RĘCZNYM powtórzeniu transkrypcji sesji, która segmenty już ma
 *   (`--force`, `--kopia <zrzut>`): bez nich import słusznie odmawia, ale
 *   dowiadujemy się o tym dopiero po opłaconej transkrypcji.
 */
export async function processMeeting(m, importArgs = []) {
  const name = sessionName(m);
  log(`Przetwarzam ${name}...`);

  let videoUrl = m.video_url;
  if (!videoUrl) {
    log(`Rozwiązuję video_url dla ${name}...`);
    videoUrl = await resolveVideoUrl(m.esesja_id);
    if (!videoUrl) {
      log(`UWAGA: nie znaleziono video_url dla ${name} — pomijam.`);
      return false;
    }
    supabaseExec(
      `update meeting set video_url = '${sqlEscape(videoUrl)}' where id = '${m.id}';`
    );
  }

  const { mp3 } = downloadAndConvert(name, videoUrl, sessionKey(m), m.date);
  supabaseExec(`update meeting set video_downloaded = true where id = '${m.id}';`);

  const chunkDir = path.join(WORK_DIR, `${name}-chunks`);
  const chunks = cutChunks(mp3, chunkDir, name);
  log(`${chunks.length} kawałek(-ów) do wysłania.`);

  const apiKey = resolveGroqApiKey(GROQ_ENV_FILE);
  const segments = await transcribeChunks(apiKey, chunks, {
    log,
    // Ostatni odczyt limitu ląduje w bazie: to jedyny moment, w którym Groq
    // go pokazuje, a panel managera musi mieć co wyświetlić między biegami.
    onLimity: (l) => zapiszLimityGroq(l),
  });

  const correctedSegments = segments.map((s) => ({
    ...s,
    text: applyTokenCorrections(s.text, TOKENS_FILE),
  }));

  const vttPath = path.join(WORK_DIR, `${name}.vtt`);
  writeVttFile(vttPath, correctedSegments);
  log(`Zapisano ${correctedSegments.length} segmentów do ${vttPath}`);

  log(`Importuję do bazy...`);
  // --meeting jawnie, zamiast pozwalać importowi wyłuskać esesja_id z nazwy
  // pliku. To sprzężenie przez konwencję nazw działało, dopóki każda sesja
  // miała esesja_id; dla rady spoza esesja.pl import przerywał pracę
  // dokładnie tutaj — po pobraniu nagrania i opłaconej transkrypcji, czyli
  // w najgorszym możliwym momencie.
  execFileSync("node", ["scripts/import-transcript.mjs", vttPath, "--meeting", m.id, ...importArgs], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    timeout: 5 * 60 * 1000,
  });

  // Sprzątanie — bez znaczenia na efemerycznym runnerze GH Actions (znika i
  // tak), ale istotne przy ręcznym odpaleniu na agatka (dysk nie jest z gumy).
  rmSync(chunkDir, { recursive: true, force: true });
  // Przy ręcznym powtórzeniu (importArgs) zostawiamy .vtt — transkrypcja jest
  // płatna, a to jedyna kopia poza bazą, gdyby coś w odtwarzaniu przypisań
  // wymagało powrotu do surowego wyniku.
  if (importArgs.length === 0) rmSync(vttPath, { force: true });
  rmSync(path.join(WORK_DIR, `${name}.mp4`), { force: true });
  rmSync(mp3, { force: true });

  return true;
}

async function main() {
  // subtitles_available: część rad (transmisjaobrad.info) publikuje gotowe
  // napisy WebVTT — takie sesje bierze scripts/import-powiat-vtt.mjs i nie ma
  // po co pobierać dla nich 1,5 h wideo. NULL (wszystkie sesje esesja.pl)
  // znaczy „napisów nie ma”, więc zachowanie dla gminy się nie zmienia.
  // Filtr musi być tutaj, a nie w kolejności kroków workflow: awaria importu
  // napisów i tak oddałaby sesję temu skryptowi.
  const pending = await supabaseQuery(
    `select id, esesja_id, source_id, date, video_url from meeting where transcript_status != 'rozpisana' and meeting_type != 'komisja' and coalesce(subtitles_available, false) = false order by date asc limit 1;`
  );

  if (pending.length === 0) {
    log("Brak sesji oczekujących na transkrypcję. Koniec.");
    return;
  }

  const ok = await processMeeting(pending[0]);
  if (!ok) process.exitCode = 1;
}

// Uruchom main() tylko gdy plik jest wywołany bezpośrednio (node
// groq/pipeline-groq.mjs), nie przy imporcie processMeeting/innych
// eksportów gdzie indziej (np. w testach) — inaczej sam import miałby
// efekt uboczny w postaci prawdziwego zapytania do DB i próby przetworzenia
// sesji.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("[pipeline-groq] BŁĄD:", e);
    process.exit(1);
  });
}
