// Budowanie danych wsadowych do promptów przyrostowego profilu radnego
// (prompty/Prompt_Profil_Radnego_{Iteracyjny,Jednorazowy}_v7.md).
//
// Wydzielone z scripts/profil/eksport-wsadu.mjs (2026-08-23), żeby
// scripts/profil/wdroz-produkcyjnie.mjs (runner produkcyjny, działający
// wprost na bazie, bez plików pośrednich w groq/work/profil/) nie duplikował
// tej samej logiki sklejania treści jednej sesji. eksport-wsadu.mjs (zostaje
// jako narzędzie diagnostyczne do plików na dysku) woła te same funkcje.

import { supabaseQuery, sqlEscape } from "./db.mjs";
import { mergeIntoBlocks } from "../../src/lib/speech-blocks.ts";

const KONTEKST_MAX_ZNAKOW = 300;

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

/**
 * Pobiera z bazy wszystko, czego potrzeba do zbudowania wsadu dla jednego
 * radnego jednej kadencji: dane radnego, sesje (zwyczajna/nadzwyczajna) po
 * kolei, wszystkie segmenty tych sesji, mapę mówców, sprawy i interpelacje.
 * Jedno miejsce zapytań, niezależnie od tego, czy wywołujący zapisuje wynik
 * do plików (eksport-wsadu.mjs) czy woła `claude -p` wprost (wdroz-
 * produkcyjnie.mjs).
 */
export function zbudujDaneRadnego(nazwaRady, wzorzecRadnego) {
  const [councilor] = supabaseQuery(`
    select c.id, c.full_name
    from councilor c
    join councilor_term ct on ct.councilor_id = c.id
    join term t on t.id = ct.term_id
    join council co on co.id = t.council_id
    where co.name = '${sqlEscape(nazwaRady)}'
      and c.full_name ilike '${sqlEscape(wzorzecRadnego)}'
    limit 1
  `);
  if (!councilor) {
    throw new Error(`Nie znaleziono radnego pasującego do "${wzorzecRadnego}" w ${nazwaRady}.`);
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
    throw new Error(`Brak sesji (zwyczajna/nadzwyczajna) dla kadencji ${termRow.label}.`);
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

  return { nazwaRady, councilor, termRow, meetings, allSegments, nazwaOsoby, matterRows, interpelacje };
}

/**
 * Buduje treść (markdown) jednej sesji z kadencji `dane` — nagłówek, bloki
 * wypowiedzi radnego z kontekstem przed/po, fragment "Spory i dyskusje"
 * dotyczący go, powiązane sprawy i interpelacje złożone w okolicy tej sesji.
 * Zwraca też `liczbaBlokowRadnego` i `procentOtagowania` (do 00-meta.json /
 * do decyzji rangowania w runnerze produkcyjnym).
 */
export function trescSesji(dane, idx) {
  const { nazwaRady, councilor, meetings, allSegments, nazwaOsoby, matterRows, interpelacje } = dane;
  const meeting = meetings[idx];
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

  // Heurystyka pierwszego cięcia: interpelacja trafia do treści sesji, po
  // której (a przed kolejną) została złożona — to wtedy prompt ma szansę
  // zestawić ją z dyskusją na tej sesji.
  const poprzedniaData = idx > 0 ? meetings[idx - 1].date : null;
  const interpelacjeDlaSesji = interpelacje.filter(
    (i) => i.submitted_date > (poprzedniaData ?? "0000-00-00") && i.submitted_date <= meeting.date
  );

  const naglowek = [
    `rada: ${nazwaRady}`,
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
              linie.push(`[kontekst po] ${po.mowca}: ${trimStart(po.tekst, KONTEKST_MAX_ZNAKOW)}`);
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

  return { tresc, liczbaBlokowRadnego: bloki.length, procentOtagowania };
}

/**
 * Ranking radnych danej rady wg liczby sesji z ich wypowiedziami (malejąco),
 * do kolejności wejścia do puli aktywnych w scripts/profil/wdroz-produkcyjnie.mjs.
 * Liczone z bieżącej (najnowszej wg `start_date`) kadencji każdego radnego.
 */
export function pobierzRankingAktywnosci(nazwaRady) {
  return supabaseQuery(`
    with kadencje as (
      select distinct on (ct.councilor_id)
        ct.councilor_id, t.id as term_id, t.label as term_label
      from councilor_term ct
      join term t on t.id = ct.term_id
      join council co on co.id = t.council_id
      where co.name = '${sqlEscape(nazwaRady)}'
      order by ct.councilor_id, t.start_date desc
    )
    select
      c.id as councilor_id,
      c.full_name,
      k.term_id,
      k.term_label,
      count(distinct s.meeting_id) as sesje_z_wypowiedziami
    from kadencje k
    join councilor c on c.id = k.councilor_id
    left join meeting m on m.term_id = k.term_id and m.meeting_type in ('zwyczajna', 'nadzwyczajna')
    left join segment s on s.meeting_id = m.id and s.status = 'finalized' and s.confirmed_councilor_id = c.id
    group by c.id, c.full_name, k.term_id, k.term_label
    order by sesje_z_wypowiedziami desc, c.full_name asc
  `);
}
