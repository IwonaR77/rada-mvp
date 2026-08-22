#!/usr/bin/env node
// Eksport wsadu do przyrostowego budowania profilu radnego
// (prompty/Prompt_Profil_Radnego_Iteracyjny_v1.md i .../Jednorazowy_v1.md).
//
// Dla jednego radnego: jeden plik markdown na sesję jego kadencji (wypowiedzi
// sklejone w bloki jak na /radny/[id], kontekst przed/po ≤300 znaków, fragment
// "Spory i dyskusje" gdy radny wymieniony z nazwiska, powiązane sprawy),
// 00-meta.json (lista sesji + interpelacje + otagowanie) i calosc.md
// (konkatenacja wszystkich sesji — wsad promptu jednorazowego/baseline).
//
// Sklejanie bloków importuje wprost src/lib/speech-blocks.ts (Node 24 stripuje
// typy natywnie) — ten sam próg co na profilu radnego w aplikacji, żadnej
// drugiej kopii tej logiki.
//
// Użycie:
//   node scripts/profil/eksport-wsadu.mjs --radny "Karol Biedrzycki"

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { supabaseQuery, sqlEscape, REPO_ROOT } from "../lib/db.mjs";
import { mergeIntoBlocks } from "../../src/lib/speech-blocks.ts";
import { slugifyRadny } from "../../src/lib/profil-slug.ts";

const KONTEKST_MAX_ZNAKOW = 300;
const NAZWA_RADY = "Rada Miejska w Grójcu";

function parseArgs(argv) {
  const args = { radny: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--radny") args.radny = argv[++i];
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!args.radny) {
    console.error('Wymagane: --radny "Imię Nazwisko"');
    process.exit(1);
  }
  return args;
}

function trimEnd(text, max) {
  return text.length <= max ? text : "…" + text.slice(text.length - max);
}
function trimStart(text, max) {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

// Sekcja "Spory i dyskusje" jest opcjonalna (dodawana tylko przy realnym
// sporze, Prompt_Podsumowania_Sesji_v7) i kończy się na kolejnym nagłówku
// **...**: albo na końcu dokumentu. Punkty listy zaczynają się od "- " na
// początku linii; wielolinijkowy punkt ciągnie się do następnego "- ".
function wyciagnijSporyDlaRadnego(summary, pelneNazwisko) {
  if (!summary) return null;
  const naglowek = "**Spory i dyskusje:**";
  const start = summary.indexOf(naglowek);
  if (start === -1) return null;
  const reszta = summary.slice(start + naglowek.length);
  const kolejnyNaglowek = reszta.search(/\n\*\*[^*\n]+:\*\*/);
  const sekcja = kolejnyNaglowek === -1 ? reszta : reszta.slice(0, kolejnyNaglowek);

  const punkty = sekcja
    .split(/\n(?=- )/)
    .map((p) => p.trim())
    .filter(Boolean);
  const dotyczace = punkty.filter((p) => p.includes(pelneNazwisko));
  return dotyczace.length > 0 ? dotyczace.join("\n\n") : null;
}

function main() {
  const { radny } = parseArgs(process.argv.slice(2));

  const [councilor] = supabaseQuery(`
    select c.id, c.full_name
    from councilor c
    join councilor_term ct on ct.councilor_id = c.id
    join term t on t.id = ct.term_id
    join council co on co.id = t.council_id
    where co.name = '${sqlEscape(NAZWA_RADY)}'
      and c.full_name ilike '${sqlEscape(radny)}'
    limit 1
  `);
  if (!councilor) {
    console.error(`Nie znaleziono radnego pasującego do "${radny}" w ${NAZWA_RADY}.`);
    process.exit(1);
  }

  const [termRow] = supabaseQuery(`
    select t.id as term_id, t.label
    from councilor_term ct
    join term t on t.id = ct.term_id
    where ct.councilor_id = '${councilor.id}'
    order by t.start_date desc
    limit 1
  `);

  const meetings = supabaseQuery(`
    select id, date, title, esesja_id, source_id, summary
    from meeting
    where term_id = '${termRow.term_id}'
      and meeting_type in ('zwyczajna', 'nadzwyczajna')
    order by date asc
  `);
  if (meetings.length === 0) {
    console.error(`Brak sesji (zwyczajna/nadzwyczajna) dla kadencji ${termRow.label}.`);
    process.exit(1);
  }

  const meetingIds = meetings.map((m) => `'${m.id}'`).join(",");
  const allSegments = supabaseQuery(`
    select id, meeting_id, start_time, end_time, text,
           confirmed_councilor_id, confirmed_official_id
    from segment
    where meeting_id in (${meetingIds})
      and status = 'finalized'
    order by meeting_id, start_time
  `);

  const councilors = supabaseQuery(`
    select c.id, c.full_name
    from councilor c
    join councilor_term ct on ct.councilor_id = c.id
    where ct.term_id = '${termRow.term_id}'
  `);
  const officials = supabaseQuery(`select id, full_name from official`);
  const nazwaOsoby = new Map([
    ...councilors.map((c) => [c.id, c.full_name]),
    ...officials.map((o) => [o.id, o.full_name]),
  ]);

  const matterRows = supabaseQuery(`
    select m.title, mp.role, mr.meeting_id
    from matter_participant mp
    join matter m on m.id = mp.matter_id
    left join matter_reference mr on mr.matter_id = m.id
    where mp.councilor_id = '${councilor.id}'
  `);

  const interpelacje = supabaseQuery(`
    select submitted_date, title, summary
    from interpellation
    where author_councilor_id = '${councilor.id}'
    order by submitted_date asc
  `);

  const dirName = slugifyRadny(councilor.full_name);
  const outDir = path.join(REPO_ROOT, "groq", "work", "profil", dirName);
  mkdirSync(outDir, { recursive: true });

  const meta = [];
  const sessionFiles = [];

  meetings.forEach((meeting, idx) => {
    const nrPliku = String(idx + 1).padStart(2, "0");
    const wszystkieSegmentySesji = allSegments.filter((s) => s.meeting_id === meeting.id);
    const segmentyRadnego = wszystkieSegmentySesji.filter(
      (s) => s.confirmed_councilor_id === councilor.id
    );
    const otagowane = wszystkieSegmentySesji.filter(
      (s) => s.confirmed_councilor_id || s.confirmed_official_id
    ).length;
    const procentOtagowania = wszystkieSegmentySesji.length
      ? Math.round((100 * otagowane) / wszystkieSegmentySesji.length)
      : null;

    const bloki = mergeIntoBlocks(segmentyRadnego);

    const sortedAll = [...wszystkieSegmentySesji].sort(
      (a, b) => Number(a.start_time) - Number(b.start_time)
    );
    function opisMowcy(segment) {
      const id = segment.confirmed_councilor_id ?? segment.confirmed_official_id;
      return id ? (nazwaOsoby.get(id) ?? "Nieustalone") : "Nieustalone";
    }
    function znajdzKontekstPrzed(startBloku) {
      let kandydat = null;
      for (const s of sortedAll) {
        if (Number(s.end_time) <= startBloku) kandydat = s;
        else break;
      }
      if (!kandydat || kandydat.confirmed_councilor_id === councilor.id) return null;
      return { mowca: opisMowcy(kandydat), tekst: kandydat.text };
    }
    function znajdzKontekstPo(endBloku) {
      const kandydat = sortedAll.find((s) => Number(s.start_time) >= endBloku);
      if (!kandydat || kandydat.confirmed_councilor_id === councilor.id) return null;
      return { mowca: opisMowcy(kandydat), tekst: kandydat.text };
    }

    const sporyFragment = wyciagnijSporyDlaRadnego(meeting.summary, councilor.full_name);
    const sprawyTejSesji = matterRows.filter((m) => m.meeting_id === meeting.id);

    // Heurystyka pierwszego cięcia: interpelacja trafia do pliku sesji, po
    // której (a przed kolejną) została złożona — to wtedy prompt ma szansę
    // zestawić ją z dyskusją na tej sesji. Do doprecyzowania w Etapie 5.
    const poprzedniaData = idx > 0 ? meetings[idx - 1].date : null;
    const interpelacjeDlaSesji = interpelacje.filter(
      (i) => i.submitted_date > (poprzedniaData ?? "0000-00-00") && i.submitted_date <= meeting.date
    );

    const naglowek = [
      `rada: ${NAZWA_RADY}`,
      `sesja: ${meeting.title}`,
      `data: ${meeting.date}`,
      `identyfikator: ${meeting.esesja_id ?? meeting.source_id ?? meeting.id}`,
      `otagowanie mówców: ${procentOtagowania === null ? "brak segmentów" : `${procentOtagowania}%`}`,
    ].join("\n");

    const czescBlokow =
      bloki.length === 0
        ? "Brak wypowiedzi tego radnego na tej sesji."
        : bloki
            .map((b, i) => {
              const przed = znajdzKontekstPrzed(b.start);
              const po = znajdzKontekstPo(b.end);
              const linie = [];
              if (przed)
                linie.push(
                  `[kontekst przed] ${przed.mowca}: ${trimEnd(przed.tekst, KONTEKST_MAX_ZNAKOW)}`
                );
              linie.push(`Radny: ${b.text}`);
              if (po)
                linie.push(
                  `[kontekst po] ${po.mowca}: ${trimStart(po.tekst, KONTEKST_MAX_ZNAKOW)}`
                );
              return `### Wypowiedź ${i + 1}\n\n${linie.join("\n\n")}`;
            })
            .join("\n\n");

    const czescSporow = sporyFragment
      ? `## Spory i dyskusje (fragmenty z udziałem radnego)\n\n${sporyFragment}`
      : null;

    const czescSpraw =
      sprawyTejSesji.length > 0
        ? `## Sprawy powiązane z tą sesją\n\n${sprawyTejSesji
            .map((s) => `- ${s.title} — ${s.role}`)
            .join("\n")}`
        : null;

    const czescInterpelacji =
      interpelacjeDlaSesji.length > 0
        ? `## Interpelacje i zapytania złożone w okolicy tej sesji\n\n${interpelacjeDlaSesji
            .map((i) => `- ${i.submitted_date} — ${i.title}${i.summary ? ` — ${i.summary}` : ""}`)
            .join("\n")}`
        : null;

    const tresc = [naglowek, czescBlokow, czescSporow, czescSpraw, czescInterpelacji]
      .filter(Boolean)
      .join("\n\n---\n\n");

    const nazwaPliku = `s${nrPliku}-${meeting.date}.md`;
    writeFileSync(path.join(outDir, nazwaPliku), tresc + "\n");
    sessionFiles.push(nazwaPliku);

    meta.push({
      plik: nazwaPliku,
      meeting_id: meeting.id,
      data: meeting.date,
      tytul: meeting.title,
      esesja_id: meeting.esesja_id,
      procent_otagowania: procentOtagowania,
      liczba_blokow_radnego: bloki.length,
    });
  });

  writeFileSync(
    path.join(outDir, "00-meta.json"),
    JSON.stringify(
      {
        radny: councilor.full_name,
        councilor_id: councilor.id,
        kadencja: termRow.label,
        term_id: termRow.term_id,
        liczba_sesji: meetings.length,
        liczba_sesji_z_wypowiedziami: meta.filter((m) => m.liczba_blokow_radnego > 0).length,
        interpelacje_wszystkie: interpelacje.map((i) => ({
          data: i.submitted_date,
          tytul: i.title,
          streszczenie: i.summary,
        })),
        sesje: meta,
      },
      null,
      2
    )
  );

  const calosc = sessionFiles
    .map((f) => readFileSync(path.join(outDir, f), "utf8"))
    .join("\n\n===\n\n");
  writeFileSync(path.join(outDir, "calosc.md"), calosc);

  console.log(
    `Zapisano ${sessionFiles.length} plików sesji (${meta.filter((m) => m.liczba_blokow_radnego > 0).length} z wypowiedziami) + 00-meta.json + calosc.md do ${outDir}`
  );
}

main();
