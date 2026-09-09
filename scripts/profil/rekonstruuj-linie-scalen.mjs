#!/usr/bin/env node
// Odtwarza pełną historię scaleń tematów danego radnego z całej historii
// `councilor_profile_revision` (bez LLM, bez zgadywania) — do naprawy
// "kosza-na-wszystko" (zob. src/lib/councilor-profile-delta.ts, scalDoLimitu,
// i .claude/plans/purrfect-riding-valiant.md).
//
// Kluczowa obserwacja: `applyDelta` NIGDY nie usuwa istniejącego `id` z
// `tematy` poza kompakcją (`scalDoLimitu`). Więc dla dwóch kolejnych rewizji
// (seq-1 → seq) tego samego radnego, każdy `id` obecny w seq-1 a nieobecny w
// seq zniknął WYŁĄCZNIE przez scalenie w tym kroku — deterministycznie
// odtwarzalne z samych zapisanych `stan`.
//
// Zasięg celowo ograniczony do ery v8 (prompt_version=8, `stan` = delta+kod,
// nie cały LLM-owy stan): przed v8 kompakcja NIE przechodziła przez kod
// (`scalDoLimitu` nie istniał) — model sam, swobodnie, wg tekstu promptu,
// decydował co scalić przy każdym pełnym zwrocie stanu (v7). Ta wewnętrzna
// struktura NIE jest odtwarzalna (żadnej deterministycznej reguły do
// odwrócenia) i celowo NIE wchodzi w zakres tej naprawy — dokładnie to
// znaczy "przelicz od momentu zmiany algorytmu" (decyzja użytkowniczki,
// 2026-09-09): stan z OSTATNIEJ rewizji v7 (`prompt_version` < 8) tego
// radnego jest granicą/bazą, dalej idzie tylko czysta rekonstrukcja.
//
// Rozstrzygnięcie przypadku brzegowego (temat, który po scaleniu dostał
// kolejne DOPASOWANIE — przyrost niemożliwy do jednoznacznego przypisania
// żadnemu z oryginalnych składników): przyrost POSCALENIOWY jest odrzucany
// z odtworzonego liścia. Dla każdego id bierzemy jego stan TUŻ PRZED
// pierwszym kiedykolwiek zaangażowaniem w scalenie (czy to jako strona
// wchłaniana, czy jako survivor, który sam zaczął wchłaniać) — to jedyna
// wersja, o której mamy pewność, że reprezentuje JEDEN, nietknięty temat.
// Wszystko po tym momencie (dalszy wzrost `wystapien`/`sesje` na już
// scalonej etykiecie, kolejne scalenia) jest z definicji niejednoznaczne i
// nie trafia do żadnego odtworzonego liścia.
//
// Użycie (CLI, tylko odczyt, zero zapisu do bazy):
//   node scripts/profil/rekonstruuj-linie-scalen.mjs --radny "Imię Nazwisko" [--sucho]
//
// Jako moduł (używane przez napraw-kosze-tematow.mjs):
//   import { rekonstruujTematy } from "./rekonstruuj-linie-scalen.mjs";

import { supabaseQuery } from "../lib/db.mjs";

const NAZWA_RADY = "Rada Miejska w Grójcu";

function znajdzRadnego(pelnaNazwa) {
  const [wiersz] = supabaseQuery(`
    select c.id as councilor_id, ct.term_id, c.full_name
    from councilor c
    join councilor_term ct on ct.councilor_id = c.id
    join term t on t.id = ct.term_id
    join council co on co.id = t.council_id
    where co.name = '${NAZWA_RADY.replace(/'/g, "''")}' and c.full_name ilike '${pelnaNazwa.replace(/'/g, "''")}'
    order by t.start_date desc
    limit 1
  `);
  if (!wiersz) throw new Error(`Nie znaleziono radnego "${pelnaNazwa}".`);
  return wiersz;
}

function pobierzRewizje(councilorId, termId) {
  return supabaseQuery(`
    select seq, prompt_version, stan
    from councilor_profile_revision
    where councilor_id = '${councilorId}' and term_id = '${termId}'
    order by seq asc
  `);
}

/**
 * Dopasowuje "znikające" id (obecne w `before`, nieobecne w `after`) do
 * survivora, który je wchłonął — po arytmetyce `scalTematy` (wystapien =
 * suma, sesje = unia). Jednoznaczne przy nierozłącznym doborze par, który
 * `scalDoLimitu` już gwarantuje (każdy indeks bierze udział najwyżej raz w
 * JEDNYM wywołaniu/kroku).
 */
function dopasujZdarzeniaScalania(before, after, seq, ostrzezenia) {
  const beforeMap = new Map(before.map((t) => [t.id, t]));
  const afterMap = new Map(after.map((t) => [t.id, t]));
  const znikajace = [...beforeMap.keys()].filter((id) => !afterMap.has(id));
  if (znikajace.length === 0) return [];

  const potencjalniSurvivorzy = [...beforeMap.keys()].filter((id) => afterMap.has(id));
  const uzyci = new Set();
  const zdarzenia = [];

  for (const vId of znikajace) {
    const vBefore = beforeMap.get(vId);
    let znaleziony = null;
    for (const sId of potencjalniSurvivorzy) {
      if (uzyci.has(sId)) continue;
      const sBefore = beforeMap.get(sId);
      const sAfter = afterMap.get(sId);
      const oczekiwaneWystapien = sBefore.wystapien + vBefore.wystapien;
      const oczekiwaneSesje = new Set([...sBefore.sesje, ...vBefore.sesje]);
      const sesjeSieZgadzaja =
        sAfter.sesje.length === oczekiwaneSesje.size && sAfter.sesje.every((s) => oczekiwaneSesje.has(s));
      if (sAfter.wystapien === oczekiwaneWystapien && sesjeSieZgadzaja) {
        znaleziony = sId;
        break;
      }
    }
    if (!znaleziony) {
      ostrzezenia.push(
        `seq=${seq}: nie znaleziono jednoznacznego survivora dla zniknionego tematu "${vId}" ` +
          `(teza: "${vBefore.teza}") — POMINIĘTY, do ręcznego sprawdzenia.`
      );
      continue;
    }
    uzyci.add(znaleziony);
    zdarzenia.push({ seq, vanishedId: vId, vanishedRecord: vBefore, survivorId: znaleziony });
  }
  return zdarzenia;
}

/**
 * Główna funkcja rekonstrukcji. Zwraca:
 * - `bazowySeq`: ostatnia rewizja v7 (granica, od której zaczyna się
 *   rekonstrukcja) — `null`, gdy cały łańcuch tego radnego jest już v8.
 * - `zdarzeniaScalania`: lista wszystkich odtworzonych zdarzeń scalania
 *   w erze v8, do przeglądu.
 * - `ostrzezenia`: przypadki, w których dopasowanie nie było jednoznaczne.
 * - `odtworz(id)`: funkcja zwracająca "czysty" (nietknięty scalaniem) rekord
 *   dla dowolnego id z NAJNOWSZEJ rewizji — albo jego oryginalną treść
 *   (jeśli nigdy nie brał udziału w scaleniu), albo pełną, wyeksplodowaną
 *   listę odtworzonych liści (jeśli id jest survivorem jednego lub więcej
 *   zdarzeń, ewentualnie wielopoziomowo — łańcuch scaleń przez wiele krokow).
 */
export function rekonstruujTematy(radnyRow) {
  const rewizje = pobierzRewizje(radnyRow.councilor_id, radnyRow.term_id);
  if (rewizje.length === 0) throw new Error(`Brak rewizji dla "${radnyRow.full_name}".`);

  const rewByseq = new Map(rewizje.map((r) => [r.seq, r]));
  const maxSeq = Math.max(...rewByseq.keys());
  const v7Seqs = rewizje.filter((r) => r.prompt_version < 8).map((r) => r.seq);
  const bazowySeq = v7Seqs.length > 0 ? Math.max(...v7Seqs) : null;

  const ostrzezenia = [];
  const zdarzeniaScalania = [];
  // Pełna historia każdego id → (seq → rekord), do odczytu "stan tuż przed X".
  const historiaId = new Map();
  const startSeq = bazowySeq ?? 1;
  for (let seq = startSeq; seq <= maxSeq; seq++) {
    const rew = rewByseq.get(seq);
    if (!rew) continue;
    for (const t of rew.stan.tematy) {
      if (!historiaId.has(t.id)) historiaId.set(t.id, new Map());
      historiaId.get(t.id).set(seq, t);
    }
  }

  const pierwszySeqOdKtorego = Math.max(startSeq + 1, 2);
  for (let seq = pierwszySeqOdKtorego; seq <= maxSeq; seq++) {
    const rewPrzed = rewByseq.get(seq - 1);
    const rewPo = rewByseq.get(seq);
    if (!rewPrzed || !rewPo) continue;
    const zdarzenia = dopasujZdarzeniaScalania(rewPrzed.stan.tematy, rewPo.stan.tematy, seq, ostrzezenia);
    zdarzeniaScalania.push(...zdarzenia);
  }

  // Pierwszy seq, w którym dany id JAKKOLWIEK brał udział w scaleniu (jako
  // wchłonięty LUB jako survivor, który sam zaczyna wchłaniać) — to jego
  // "granica czystości": stan tuż przed tym seq jest ostatnią pewną,
  // jednotematyczną wersją.
  const pierwszaKorupcja = new Map();
  for (const m of zdarzeniaScalania) {
    if (!pierwszaKorupcja.has(m.vanishedId) || m.seq < pierwszaKorupcja.get(m.vanishedId)) {
      pierwszaKorupcja.set(m.vanishedId, m.seq);
    }
    if (!pierwszaKorupcja.has(m.survivorId) || m.seq < pierwszaKorupcja.get(m.survivorId)) {
      pierwszaKorupcja.set(m.survivorId, m.seq);
    }
  }

  function czystyRekord(id) {
    const korupcjaSeq = pierwszaKorupcja.get(id);
    const historia = historiaId.get(id);
    if (!historia) throw new Error(`Brak historii dla id "${id}" — błąd wewnętrzny rekonstrukcji.`);
    if (korupcjaSeq === undefined) {
      const ostatniSeq = Math.max(...historia.keys());
      return historia.get(ostatniSeq);
    }
    const rekord = historia.get(korupcjaSeq - 1);
    if (!rekord) throw new Error(`Brak zapisanego stanu dla id "${id}" w seq=${korupcjaSeq - 1}.`);
    return rekord;
  }

  // Rekurencyjnie zbiera WSZYSTKIE id kiedykolwiek bezpośrednio lub pośrednio
  // wchłonięte przez `id` (obsługuje wielopoziomowe łańcuchy: X wchłonęło Y,
  // Y wcześniej wchłonęło Z — Z jest "wnukiem" X).
  function zbierzWchloniete(id, odwiedzone = new Set()) {
    if (odwiedzone.has(id)) return [];
    odwiedzone.add(id);
    const bezposrednie = zdarzeniaScalania.filter((m) => m.survivorId === id);
    const wynik = [...bezposrednie];
    for (const m of bezposrednie) wynik.push(...zbierzWchloniete(m.vanishedId, odwiedzone));
    return wynik;
  }

  /** Dla id z NAJNOWSZEJ rewizji: lista odtworzonych, czystych rekordów, które
   * mają go zastąpić (1 element, jeśli id nigdy nie brało udziału w scaleniu). */
  function odtworz(id) {
    const wchloniete = zbierzWchloniete(id);
    if (wchloniete.length === 0) return [czystyRekord(id)];
    return [czystyRekord(id), ...wchloniete.map((m) => czystyRekord(m.vanishedId))];
  }

  return { bazowySeq, maxSeq, zdarzeniaScalania, ostrzezenia, odtworz, historiaId };
}

async function main() {
  const argv = process.argv.slice(2);
  const radnyIdx = argv.indexOf("--radny");
  if (radnyIdx === -1 || !argv[radnyIdx + 1]) {
    console.error('Użycie: node scripts/profil/rekonstruuj-linie-scalen.mjs --radny "Imię Nazwisko" [--sucho]');
    process.exit(1);
  }
  const radny = argv[radnyIdx + 1];

  const radnyRow = znajdzRadnego(radny);
  const { bazowySeq, maxSeq, zdarzeniaScalania, ostrzezenia, odtworz } = rekonstruujTematy(radnyRow);

  console.log(`Radny: ${radnyRow.full_name}`);
  console.log(
    bazowySeq
      ? `Granica v7/v8: ostatnia rewizja v7 to seq=${bazowySeq}, rekonstrukcja obejmuje seq ${bazowySeq + 1}..${maxSeq}.`
      : `Cały łańcuch jest już v8 — rekonstrukcja obejmuje seq 1..${maxSeq}.`
  );
  console.log(`Odtworzonych zdarzeń scalania: ${zdarzeniaScalania.length}`);
  if (ostrzezenia.length > 0) {
    console.log(`\nOstrzeżenia (${ostrzezenia.length}):`);
    for (const o of ostrzezenia) console.log(`  - ${o}`);
  }

  const rewizje = pobierzRewizje(radnyRow.councilor_id, radnyRow.term_id);
  const ostatnia = rewizje[rewizje.length - 1];
  const dotknieteIdy = ostatnia.stan.tematy.filter((t) => odtworz(t.id).length > 1);

  console.log(`\nTematy w najnowszej rewizji z historią scalania: ${dotknieteIdy.length}/${ostatnia.stan.tematy.length}`);
  for (const t of dotknieteIdy) {
    const czesci = odtworz(t.id);
    console.log(`\n  ${t.id} (obecnie: "${t.teza}", ${t.wystapien} wystąpień) → ${czesci.length} odtworzonych liści:`);
    for (const c of czesci) console.log(`    - "${c.teza}" (${c.wystapien} wyst., sesje: ${c.sesje.join(", ")})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
