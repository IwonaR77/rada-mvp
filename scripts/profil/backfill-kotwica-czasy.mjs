#!/usr/bin/env node
// Jednorazowy backfill: dogrywa segment.start_time do kotwic (dosłowne
// cytaty) w już zapisanych rewizjach `councilor_profile_revision`, sprzed
// wprowadzenia `dograjCzasySegmentow()` do `wdroz-produkcyjnie.mjs` (ten
// runner dogrywa czasy tylko dla sesji przetwarzanej w danym kroku — starsze
// kotwice w już istniejących rewizjach zostały bez tego pola). Bez tego
// backfillu linki do sesji dla całej historii sprzed tej zmiany zostałyby
// generyczne (początek sesji), a nie do konkretnego fragmentu nagrania.
//
// Grupuje wiersze po (councilor_id, term_id), żeby sesje/segmenty dla danej
// osoby ściągnąć z bazy raz, nie osobno dla każdej rewizji w jej łańcuchu.
//
// Użycie: node scripts/profil/backfill-kotwica-czasy.mjs [--sucho]

import { supabaseQuery, supabaseExec } from "../lib/db.mjs";
import { dograjCzasySegmentow } from "../lib/profil-eksport.mjs";

const sucho = process.argv.includes("--sucho");

function* iterujKotwice(stan) {
  for (const t of stan.tematy ?? []) if (t.kotwica?.cytat) yield t.kotwica;
  for (const m of stan.mieszkancy ?? []) if (m.kotwica) yield m;
  for (const s of stan.spory ?? []) if (s.kotwica) yield s;
  for (const forma of Object.values(stan.udzial_forma ?? {})) {
    for (const p of forma?.przyklady ?? []) if (p.kotwica) yield p;
  }
}

function policzRozstrzygniete(stan) {
  let total = 0;
  let done = 0;
  for (const k of iterujKotwice(stan)) {
    total++;
    const czas = k.segment_start_time ?? k.kotwica_segment_start_time;
    if (czas != null) done++;
  }
  return { total, done };
}

function main() {
  const wiersze = supabaseQuery(`
    select cpr.id, cpr.councilor_id, cpr.term_id, cpr.seq, cpr.stan, c.full_name
    from councilor_profile_revision cpr
    join councilor c on c.id = cpr.councilor_id
    order by c.full_name, cpr.seq
  `);
  console.log(`${wiersze.length} rewizji do przejrzenia.\n`);

  const grupy = new Map();
  for (const w of wiersze) {
    const klucz = `${w.councilor_id}|${w.term_id}`;
    if (!grupy.has(klucz)) grupy.set(klucz, []);
    grupy.get(klucz).push(w);
  }

  let zaktualizowaneWiersze = 0;
  let laczneCytaty = 0;
  let rozstrzygnieteCytaty = 0;

  for (const wierszeOsoby of grupy.values()) {
    const { term_id: termId, full_name: pelneNazwisko } = wierszeOsoby[0];

    const wszystkieDaty = new Set();
    for (const w of wierszeOsoby) {
      for (const k of iterujKotwice(w.stan)) wszystkieDaty.add(k.sesja);
    }
    if (wszystkieDaty.size === 0) continue;

    const meetings = supabaseQuery(`select id, date from meeting where term_id = '${termId}'`);
    const meetingIdByDate = new Map(meetings.map((m) => [m.date, m.id]));
    const meetingIdsPotrzebne = [...wszystkieDaty].map((d) => meetingIdByDate.get(d)).filter(Boolean);
    if (meetingIdsPotrzebne.length === 0) continue;

    const idsSql = meetingIdsPotrzebne.map((id) => `'${id}'`).join(",");
    const allSegments = supabaseQuery(`
      select meeting_id, start_time, text from segment
      where meeting_id in (${idsSql}) and status = 'finalized'
    `);
    const dane = { meetings, allSegments };

    for (const w of wierszeOsoby) {
      const przed = policzRozstrzygniete(w.stan);
      dograjCzasySegmentow(w.stan, dane);
      const po = policzRozstrzygniete(w.stan);
      laczneCytaty += po.total;
      rozstrzygnieteCytaty += po.done;
      if (po.done > przed.done) {
        zaktualizowaneWiersze++;
        console.log(
          `${pelneNazwisko} seq=${w.seq}: +${po.done - przed.done} kotwic (${po.done}/${po.total} rozstrzygniętych)`
        );
        if (!sucho) {
          supabaseExec(`
            update councilor_profile_revision
            set stan = $cpr_json$${JSON.stringify(w.stan)}$cpr_json$::jsonb
            where id = '${w.id}'
          `);
        }
      }
    }
  }

  console.log(
    `\nRazem: ${rozstrzygnieteCytaty}/${laczneCytaty} kotwic z rozstrzygniętym czasem, ` +
      `${zaktualizowaneWiersze} wierszy ${sucho ? "do aktualizacji (--sucho, nic nie zapisano)" : "zaktualizowanych"}.`
  );
}

main();
