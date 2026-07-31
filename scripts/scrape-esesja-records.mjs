#!/usr/bin/env node
// Scrapes esesja.pl's public registers (głosowania / rejestr uchwał /
// interpelacje i zapytania) for the current term and links each record to
// a councilor in our own DB, so voting history and interpellations show up
// on a per-radny basis. Idempotent: re-running upserts on esesja's own
// stable identifiers (glosowanie numeric id, interpelacja id_hash) rather
// than re-inserting duplicates.

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

const BASE = "https://grojec.esesja.pl";
const COUNCIL_ID = "846c8bce-7f11-4825-91dd-fe80cedf5289";
const TERM_ID = "c4bc384f-33c3-46bd-b67c-ab569bb399dd";
const TERM_START = new Date("2024-05-07");

function log(msg) {
  console.log(`[scrape] ${msg}`);
}

function getServiceRoleKey() {
  const out = execFileSync(
    "npx",
    ["supabase", "projects", "api-keys", "--project-ref", "nmsictzdvqbzevkolqpu"],
    { encoding: "utf8" }
  );
  const json = JSON.parse(out.trim().split("\n").pop());
  return json.keys.find((k) => k.id === "service_role").api_key;
}

const supabase = createClient(
  "https://nmsictzdvqbzevkolqpu.supabase.co",
  getServiceRoleKey()
);

async function fetchDecoded(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (rada-mvp scraper)" },
  });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  // esesja.pl is inconsistent: pages with a declared <meta charset="utf-8">
  // really are UTF-8; the /glosowanie/[id]/[hash] detail pages declare
  // nothing and are actually windows-1250. Sniff the first bytes (charset
  // declarations are always plain ASCII, so a naive latin1 peek is safe)
  // rather than hardcoding per URL pattern.
  const head = new TextDecoder("latin1").decode(buf.slice(0, 600));
  const isUtf8 = /charset=["']?utf-8/i.test(head);
  return new TextDecoder(isUtf8 ? "utf-8" : "windows-1250").decode(buf);
}

// esesja renders Polish month names in session titles/dates.
const MONTHS = {
  stycznia: "01", lutego: "02", marca: "03", kwietnia: "04",
  maja: "05", czerwca: "06", lipca: "07", sierpnia: "08",
  września: "09", października: "10", listopada: "11", grudnia: "12",
};

function parsePolishDate(text) {
  const m = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!m) return null;
  const [, day, monthName, year] = m;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z\s-]/g, "")
    .trim();
}

function reverseName(lastFirst) {
  // esesja lists vote participants as "Nazwisko Imię[ Imię2]"; ours are
  // stored "Imię Nazwisko". Two-word case is the overwhelming majority;
  // hyphenated surnames (Śliwa-Jóźwik) stay intact as the "last name" token.
  const parts = lastFirst.trim().split(/\s+/);
  if (parts.length < 2) return lastFirst;
  const [surname, ...rest] = parts;
  return `${rest.join(" ")} ${surname}`;
}

async function loadCouncilorMap() {
  const { data, error } = await supabase
    .from("councilor_term")
    .select("councilor:councilor_id(id, full_name)")
    .eq("term_id", TERM_ID);
  if (error) throw error;
  const map = new Map();
  for (const row of data) {
    if (!row.councilor) continue;
    map.set(normalizeName(row.councilor.full_name), row.councilor.id);
  }
  return map;
}

function matchCouncilor(map, esesjaName) {
  const direct = map.get(normalizeName(esesjaName));
  if (direct) return direct;
  const reversed = map.get(normalizeName(reverseName(esesjaName)));
  return reversed ?? null;
}

async function loadMeetingsByDate() {
  const { data, error } = await supabase
    .from("meeting")
    .select("id, date")
    .eq("term_id", TERM_ID);
  if (error) throw error;
  const map = new Map();
  for (const m of data) map.set(m.date, m.id);
  return map;
}

// ---------------------------------------------------------------------------
// Głosowania (votes)
// ---------------------------------------------------------------------------

async function scrapeVotingListPages() {
  const sessionLinks = [];
  for (const page of [1, 2]) {
    const html = await fetchDecoded(`${BASE}/glosowania/${page}`);
    // Session titles aren't a single fixed phrase — "Sesja Rady Miejskiej
    // w dniu...", "...w Grójcu w dniu...", "Sesja nadzwyczajna w dniu...",
    // "...w trybie nadzwyczajnym w dniu..." all occur. Capture the href and
    // whatever the link text says, then pull the date out of that text
    // rather than matching one exact wording.
    const re = /<p><a href="(\/listaglosowan\/[a-z0-9-]+)">([^<]+)<\/a><\/p>/g;
    for (const [, href, title] of html.matchAll(re)) {
      const date = parsePolishDate(title);
      if (date) sessionLinks.push({ url: `${BASE}${href}`, date });
    }
  }
  return sessionLinks;
}

async function scrapeGlosowanieDetail(url) {
  const html = await fetchDecoded(url);
  const result = {};
  const wimBlocks = [...html.matchAll(/<h3>([^<]+)<span[^>]*>[^<]*<\/span>[\s\S]*?<\/h3>([\s\S]*?)(?=<div class='wim'|<\/div>\s*<\/div>\s*<\/div>\s*$|$)/g)];
  const CHOICE_MAP = {
    ZA: "za",
    PRZECIW: "przeciw",
    "WSTRZYMUJĘ SIĘ": "wstrzymal_sie",
    "BRAK GŁOSU": "brak_glosu",
    NIEOBECNI: "nieobecny",
  };
  for (const [, label, body] of wimBlocks) {
    const choice = CHOICE_MAP[label.trim()];
    if (!choice) continue;
    const names = [...body.matchAll(/class='osobaa'>([^<]+)</g)].map(
      (m) => m[1].trim()
    );
    result[choice] = names;
  }
  return result;
}

async function scrapeVotes(councilorMap, meetingsByDate) {
  const sessions = await scrapeVotingListPages();
  log(`znaleziono ${sessions.length} sesji z głosowaniami`);

  let resolutionCount = 0;
  let voteCount = 0;
  let unmatchedNames = new Set();

  for (const session of sessions) {
    if (new Date(session.date) < TERM_START) continue;
    const meetingId = meetingsByDate.get(session.date) ?? null;

    const listHtml = await fetchDecoded(session.url);
    const glosowaniaRe =
      /<div class='glosowanie'><a class='wiecej' href='(\/glosowanie\/\d+\/[a-z0-9]+)'[^>]*>[^<]*<\/a><span class='sprawa'>([^<]*)<\/span>/g;
    const items = [...listHtml.matchAll(glosowaniaRe)];

    for (const [, href, sprawaRaw] of items) {
      const sprawa = sprawaRaw.trim();
      const glosowanieUrl = `${BASE}${href}`;
      const esesjaGlosowanieId = href.split("/")[2];

      const { data: existing } = await supabase
        .from("resolution")
        .select("id")
        .eq("esesja_glosowanie_id", esesjaGlosowanieId)
        .maybeSingle();
      if (existing) continue; // already scraped, idempotent skip

      const { data: resolutionRow, error: resErr } = await supabase
        .from("resolution")
        .insert({
          meeting_id: meetingId,
          esesja_number: null,
          title: sprawa,
          esesja_glosowanie_id: esesjaGlosowanieId,
        })
        .select("id")
        .single();
      if (resErr) {
        log(`błąd zapisu resolution ${esesjaGlosowanieId}: ${resErr.message}`);
        continue;
      }
      resolutionCount++;

      const detail = await scrapeGlosowanieDetail(glosowanieUrl);
      const rows = [];
      for (const [choice, names] of Object.entries(detail)) {
        for (const name of names) {
          const councilorId = matchCouncilor(councilorMap, name);
          if (!councilorId) {
            unmatchedNames.add(name);
            continue;
          }
          rows.push({
            resolution_id: resolutionRow.id,
            councilor_id: councilorId,
            choice,
          });
        }
      }
      if (rows.length > 0) {
        const { error: voteErr } = await supabase
          .from("resolution_vote")
          .insert(rows);
        if (voteErr) log(`błąd zapisu głosów ${esesjaGlosowanieId}: ${voteErr.message}`);
        else voteCount += rows.length;
      }
    }
    log(`sesja ${session.date}: przetworzono ${items.length} głosowań`);
  }

  if (unmatchedNames.size > 0) {
    log(`niedopasowane nazwiska (${unmatchedNames.size}): ${[...unmatchedNames].join(", ")}`);
  }
  log(`łącznie: ${resolutionCount} nowych głosowań, ${voteCount} głosów radnych`);
}

// ---------------------------------------------------------------------------
// Rejestr uchwał (enrichment: official number + PDF onto existing resolutions)
// ---------------------------------------------------------------------------

function normalizeTitle(t) {
  return normalizeName(t).replace(/\s+/g, " ");
}

async function scrapeRegistryEnrichment() {
  const html = await fetchDecoded(`${BASE}/rejestr_uchwal`);
  const entries = [];
  let currentSessionTitle = null;
  const itemRe =
    /<li class='sesja'>([^<]*)<\/li>|<li file='([^']*)' class='u'><div class='n'>([^<]*)<\/div><div class='unazwa'>([^<]*)<\/div><\/li>/g;
  for (const m of html.matchAll(itemRe)) {
    if (m[1] !== undefined) {
      currentSessionTitle = m[1];
    } else {
      entries.push({
        session: currentSessionTitle,
        file: m[2],
        number: m[3].trim(),
        title: m[4].trim(),
      });
    }
  }
  log(`rejestr uchwał: ${entries.length} pozycji do dopasowania`);

  const { data: resolutions, error } = await supabase
    .from("resolution")
    .select("id, title, esesja_number")
    .is("esesja_number", null);
  if (error) throw error;

  let matched = 0;
  for (const entry of entries) {
    const entryNorm = normalizeTitle(entry.title);
    const candidate = resolutions.find((r) => {
      const rNorm = normalizeTitle(r.title.replace(/^w sprawie\s*/i, ""));
      return rNorm.includes(entryNorm) || entryNorm.includes(rNorm);
    });
    if (!candidate) continue;
    // The register's PDF is only reachable through client-side JS on
    // esesja's own page (no plain <a href>, and every /pobierz/... URL
    // pattern tried 404s) — don't guess a link that might be wrong.
    // pdf_url stays null; only the official number is reliable here.
    const { error: updErr } = await supabase
      .from("resolution")
      .update({ esesja_number: entry.number })
      .eq("id", candidate.id);
    if (!updErr) matched++;
  }
  log(`dopasowano ${matched}/${entries.length} uchwał z rejestru`);
}

// ---------------------------------------------------------------------------
// Interpelacje i zapytania
// ---------------------------------------------------------------------------

async function scrapeInterpellations(councilorMap) {
  let allLinks = [];
  for (const page of [1, 2]) {
    const html = await fetchDecoded(`${BASE}/interpelacje_i_zapytania/${page}`);
    const links = [
      ...new Set(
        [...html.matchAll(/href="(\/interpelacja\/\d+_[a-z0-9]+\/[^"]*)"/g)].map(
          (m) => m[1]
        )
      ),
    ];
    allLinks.push(...links);
  }
  allLinks = [...new Set(allLinks)];
  log(`interpelacje: ${allLinks.length} pozycji znalezionych`);

  let inserted = 0;
  for (const link of allLinks) {
    const esesjaId = link.split("/")[2];
    const { data: existing } = await supabase
      .from("interpellation")
      .select("id")
      .eq("esesja_id", esesjaId)
      .maybeSingle();
    if (existing) continue;

    const html = await fetchDecoded(`${BASE}${link}`);
    const titleMatch = html.match(/<h1>([^<]+)<\/h1>/);
    // Autorzy: <strong>...</strong> can hold more than one councilor
    // (co-signed interpellations) — grab the whole block and pull every
    // /radny/ link out of it, rather than assuming exactly one <a>.
    const authorBlockMatch = html.match(
      /Autorzy: <strong>([\s\S]*?)<\/strong>\s*,\s*dodano:\s*<strong>([^<]+)<\/strong>/
    );
    if (!titleMatch || !authorBlockMatch) {
      log(`pominięto ${esesjaId}: nie rozpoznano struktury`);
      continue;
    }
    const title = titleMatch[1].trim();
    const authorNames = [
      ...authorBlockMatch[1].matchAll(/<a href='\/radny\/\d+\/[^']*'>([^<]+)<\/a>/g),
    ].map((m) => m[1].trim());
    if (authorNames.length === 0) {
      log(`pominięto ${esesjaId}: brak autora w bloku Autorzy`);
      continue;
    }
    if (authorNames.length > 1) {
      log(`${esesjaId}: współautorzy (${authorNames.join(", ")}) — zapisuję pierwszego jako głównego`);
    }
    const authorName = authorNames[0];
    const submittedDate = parsePolishDate(authorBlockMatch[2]);

    const bodyMatch = html.match(/<div class='wpis'><p>([^<]*)<\/p><\/div>/);
    const bodyText = bodyMatch ? bodyMatch[1].trim() : null;

    const attachmentMatch = html.match(
      /href='(\/interpelacje\/798\/[^']+\.pdf)' target='_blank'/
    );
    const pdfUrl = attachmentMatch ? `${BASE}${attachmentMatch[1]}` : null;

    const responseMatch = html.match(
      /Odpowiedź[^<]*<\/p><\/div><div class='iinfo'>([^<]+) - <b>([^<]+)<\/b><a class='wiecej' href='(\/interpelacje\/798\/[^']+\.pdf)'/
    );
    const responseDate = responseMatch ? parsePolishDate(responseMatch[1]) : null;
    const responseAuthorName = responseMatch ? responseMatch[2].trim() : null;
    const responsePdfUrl = responseMatch ? `${BASE}${responseMatch[3]}` : null;

    const authorCouncilorId = matchCouncilor(councilorMap, authorName);

    const { error } = await supabase.from("interpellation").insert({
      council_id: COUNCIL_ID,
      esesja_id: esesjaId,
      title,
      author_councilor_id: authorCouncilorId,
      author_name_raw: authorName,
      submitted_date: submittedDate,
      body_text: bodyText,
      pdf_url: pdfUrl,
      response_author_name: responseAuthorName,
      response_date: responseDate,
      response_pdf_url: responsePdfUrl,
    });
    if (error) log(`błąd zapisu interpelacji ${esesjaId}: ${error.message}`);
    else inserted++;
  }
  log(`zaimportowano ${inserted} nowych interpelacji`);
}

// ---------------------------------------------------------------------------

async function main() {
  const [councilorMap, meetingsByDate] = await Promise.all([
    loadCouncilorMap(),
    loadMeetingsByDate(),
  ]);
  log(`załadowano ${councilorMap.size} radnych, ${meetingsByDate.size} sesji`);

  await scrapeVotes(councilorMap, meetingsByDate);
  await scrapeRegistryEnrichment();
  await scrapeInterpellations(councilorMap);

  log("gotowe.");
}

main().catch((e) => {
  console.error("[scrape] BŁĄD:", e);
  process.exit(1);
});
