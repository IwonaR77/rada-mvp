#!/usr/bin/env node
// Zaciąga harmonogram posiedzeń komisji z esesja.pl do tabel `committee`
// i `committee_meeting`. Idempotentny — puszczany codziennie dopisze tylko to,
// czego jeszcze nie ma, i nigdy nie nadpisze statusu protokołu.
//
// Idzie po stronach POSZCZEGÓLNYCH komisji (/grupa/<id>/...), a nie po
// zbiorczej liście /posiedzenia: ta druga pokazuje ~20 ostatnich pozycji
// z 125 w archiwum, więc starsze posiedzenia po prostu z niej wypadają.
//
//   node scripts/sync-komisje.mjs

import { supabaseQuery, sqlText } from "./lib/db.mjs";
import { fetchDecoded, parsePolishDate, sleep } from "./lib/pl.mjs";

const BASE = "https://grojec.esesja.pl";
const COUNCIL_ID = "846c8bce-7f11-4825-91dd-fe80cedf5289";

function log(msg) {
  console.log(`[komisje] ${msg}`);
}

/** Usuwa znaczniki ze środka etykiety — na stronie grupy link ma <strong> i <span>. */
function tekst(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Komisje z listy na stronie głównej: nazwa + identyfikator grupy.
 * Sesje rady też mają swoją „grupę" (Radni), więc odsiewamy po nazwie —
 * tu akurat nazwa jest wiarygodna, bo pochodzi z nagłówka sekcji „Komisje Rady".
 */
async function pobierzKomisje() {
  const html = await fetchDecoded(`${BASE}/posiedzenia`);
  const sekcja = html.split("Komisje Rady")[1] ?? "";
  const komisje = new Map();
  // Nazwa siedzi w <strong> wewnątrz <a>, a obok jest bliźniaczy link „Więcej »"
  // do tej samej grupy — stąd zdejmowanie znaczników i filtr po słowie
  // „komisja" zamiast po pozycji w znaczniku.
  for (const m of sekcja.matchAll(/href="\/grupa\/(\d+)\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    const nazwa = tekst(m[2]);
    if (!/komisja/i.test(nazwa)) continue;
    if (!komisje.has(nazwa)) komisje.set(nazwa, m[1]);
  }
  return [...komisje].map(([name, groupId]) => ({ name, groupId }));
}

/** Wszystkie posiedzenia z archiwum jednej komisji. */
async function pobierzPosiedzenia(groupId) {
  const html = await fetchDecoded(`${BASE}/grupa/${groupId}/x.htm`);
  const wynik = [];
  for (const m of html.matchAll(
    /<a href="(\/posiedzenie\/[^"]+)">([\s\S]*?)<\/a>/g
  )) {
    const etykieta = tekst(m[2]);
    // Bez filtra po słowie „Posiedzenie": Doraźna Komisja Statutowa podpisuje
    // swoje wpisy „Komisja Statutowa nr III w dniu…" i taki filtr wycinał je
    // w całości. Sam adres /posiedzenie/ wystarczy za dowód, czym jest link,
    // a data odsiewa resztę.
    const data = parsePolishDate(etykieta);
    if (!data) continue;
    wynik.push({
      data,
      numer: etykieta.match(/nr\s+([IVXLC]+)/i)?.[1] ?? null,
      url: `${BASE}${m[1]}`,
    });
  }
  return wynik;
}

async function main() {
  const komisje = await pobierzKomisje();
  log(`komisji na esesji: ${komisje.length}`);

  let nowePosiedzenia = 0;
  for (const k of komisje) {
    await supabaseQuery(`
      insert into committee (council_id, name, esesja_group_id)
      values ('${COUNCIL_ID}', ${sqlText(k.name)}, ${sqlText(k.groupId)})
      on conflict (council_id, name)
        do update set esesja_group_id = excluded.esesja_group_id
      returning id
    `);
    const [{ id: committeeId }] = await supabaseQuery(`
      select id from committee
      where council_id = '${COUNCIL_ID}' and name = ${sqlText(k.name)}
    `);

    const posiedzenia = await pobierzPosiedzenia(k.groupId);
    if (posiedzenia.length > 0) {
      // Jeden INSERT na całą komisję, nie jeden na posiedzenie: `supabaseQuery`
      // odpala osobny proces psql z nowym połączeniem do Supabase, więc 130
      // pojedynczych wstawień to kilkanaście minut zamiast kilku sekund.
      //
      // DO NOTHING, nie DO UPDATE: `protocol_status` prowadzi automat FOI
      // i ręczne ustalenia człowieka. Ponowna synchronizacja nie ma prawa
      // cofnąć „otrzymany" z powrotem na „brak".
      const wartosci = posiedzenia
        .map(
          (p) =>
            `('${committeeId}', '${p.data}', ${sqlText(p.numer)}, ${sqlText(p.url)})`
        )
        .join(",\n        ");
      const wynik = await supabaseQuery(`
        insert into committee_meeting (committee_id, date, number, esesja_url)
        values ${wartosci}
        on conflict (committee_id, date) do nothing
        returning id
      `);
      nowePosiedzenia += wynik.length;
    }
    log(`${k.name}: ${posiedzenia.length} posiedzeń w archiwum`);
    await sleep(300);
  }

  log(`nowych posiedzeń dopisanych: ${nowePosiedzenia}`);
  const [podsumowanie] = await supabaseQuery(`
    select count(*) as wszystkie,
           count(*) filter (where protocol_status = 'brak') as bez_protokolu
    from committee_meeting
  `);
  log(
    `w bazie: ${podsumowanie.wszystkie} posiedzeń, bez protokołu: ${podsumowanie.bez_protokolu}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
