#!/usr/bin/env node
// Import wyników wyborów samorządowych 2024 z otwartych danych PKW.
//
// Skąd adres: portal samorzad2024.pkw.gov.pl renderuje się po stronie
// klienta, więc scrapowanie HTML-a nic nie da. Listę zbiorów i wzór adresu
// (`BASE/data/csv/<zbiór>_csv.zip`) ma w sobie bundle JS portalu, w funkcji
// `csv_links`. Pliki są statyczne i wersjonowane datą ostatniej aktualizacji.
//
// Dlaczego zbiór "powyżej 20k": gminy powyżej 20 tys. mieszkańców wybierają
// radę w systemie proporcjonalnym, z listami i podziałem mandatów metodą
// D'Hondta. Grójec (21 mandatów w 3 okręgach po 8/5/8) jest właśnie taki.
// Gminy do 20 tys. mają zupełnie inny zbiór i inną ordynację (JOW).
//
// Na końcu importu leci weryfikacja: przeliczamy podział mandatów z samych
// głosów i porównujemy z tym, co PKW zapisało w kolumnie "Czy uzyskał
// mandat". Rozjazd jest błędem, nie ostrzeżeniem — jeśli nie umiemy odtworzyć
// oficjalnego wyniku, to symulacje innych ordynacji zbudowane na tym samym
// silniku też są nic niewarte.
//
// Użycie:
//   node scripts/import-wybory-pkw.mjs --teryt 140605 --term <uuid>
//   node scripts/import-wybory-pkw.mjs --teryt 140605 --term <uuid> --dry-run
//   node scripts/import-wybory-pkw.mjs ... --force    (nadpisz istniejący import)

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { supabaseQuery, supabaseExec, sqlText } from "./lib/db.mjs";
// Silnik przeliczników jest jeden i wspólny ze stroną — Node 24 zdejmuje typy
// z .ts sam, więc nie ma tu drugiej kopii arytmetyki, która mogłaby się
// rozjechać z tą, którą widzi użytkownik.
import { allocateSeats } from "../src/lib/electoral-systems.ts";

const DATASET = "kandydaci_rady_gmin_powyzej_20k";
const CSV_URL = `https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/${DATASET}_csv.zip`;
const ELECTION_DATE = "2024-04-07";
// Art. 415 §2 kodeksu wyborczego: próg liczy się w skali GMINY, nie okręgu.
const THRESHOLD = 0.05;

function log(msg) {
  console.log(`[wybory] ${msg}`);
}

function parseArgs(argv) {
  const args = { teryt: null, term: null, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--teryt") args.teryt = argv[++i];
    else if (argv[i] === "--term") args.term = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--force") args.force = true;
    else throw new Error(`Nieznany argument: ${argv[i]}`);
  }
  if (!args.teryt) throw new Error("Wymagane --teryt (np. 140605 dla gminy Grójec)");
  if (!args.term) throw new Error("Wymagane --term <uuid kadencji>");
  return args;
}

/**
 * Parser CSV-a PKW: separator `;`, pola w cudzysłowach, cudzysłów w polu
 * podwojony. Bez biblioteki, bo to jedyne miejsce w projekcie, które czyta
 * CSV, a format jest w pełni regularny.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ";") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.replace(/^﻿/, ""));
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function download(url) {
  const dir = mkdtempSync(path.join(tmpdir(), "pkw-"));
  const zip = path.join(dir, "data.zip");
  log(`pobieram ${url}`);
  execFileSync("curl", ["-sfL", url, "-o", zip]);
  execFileSync("unzip", ["-oq", zip, "-d", dir]);
  const csv = execFileSync("sh", ["-c", `ls ${dir}/*.csv`], { encoding: "utf8" }).trim();
  const text = readFileSync(csv, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return text;
}

/**
 * Krótki kod komitetu do gęstych widoków. Kuratorowany, bo automat na polskich
 * nazwach daje albo bełkot, albo przypadkiem trafiony skrót — a ten sam kod
 * pojawia się w macierzy korelacji obok nazwiska i musi być czytelny.
 * Nieznany komitet dostaje kod z inicjałów i wypada w logu do ręcznej decyzji.
 */
const CODES = {
  "KWW NAM ZALEŻY": "NZ",
  "KW PRAWO I SPRAWIEDLIWOŚĆ": "PiS",
  "KKW KOALICJA OBYWATELSKA": "KO",
  "KWW RODZINY DLA GMINY GRÓJEC": "RdG",
  "KWW KAROLA BIEDRZYCKIEGO": "KB",
  "KWW DZIEŃ DOBRY GRÓJEC": "DDG",
  "KWW PRZYJAZNY SAMORZĄD": "PSam",
  "KKW LEWICA": "Lew",
};

function codeFor(shortName, used) {
  let code = CODES[shortName];
  if (!code) {
    const stripped = shortName.replace(/^(KKW|KWW|KW)\s+/, "");
    code = stripped.split(/\s+/).map((w) => w[0]).join("").slice(0, 6).toUpperCase();
    log(`UWAGA: brak kuratorowanego kodu dla "${shortName}", użyto "${code}" — sprawdź ręcznie`);
  }
  let candidate = code;
  let n = 2;
  while (used.has(candidate)) candidate = `${code.slice(0, 5)}${n++}`;
  used.add(candidate);
  return candidate;
}

/** "KOWALSKI-NOWAK Jan Maria" -> { last: "kowalski-nowak", first: "jan" } */
function splitPkwName(name) {
  const parts = name.trim().split(/\s+/);
  const lastParts = [];
  while (parts.length && parts[0] === parts[0].toUpperCase()) lastParts.push(parts.shift());
  return {
    last: normalize(lastParts.join(" ")),
    first: normalize(parts[0] ?? ""),
  };
}

/** "Jan Kowalski-Nowak" -> { last: "kowalski-nowak", first: "jan" } */
function splitDbName(name) {
  const parts = name.trim().split(/\s+/);
  return { first: normalize(parts[0] ?? ""), last: normalize(parts.slice(1).join(" ")) };
}

function normalize(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [term] = supabaseQuery(
    `select t.id, t.label, c.name as council from term t join council c on c.id = t.council_id where t.id = '${args.term}'`
  );
  if (!term) throw new Error(`Nie ma kadencji ${args.term}`);
  log(`kadencja: ${term.council} — ${term.label}`);

  const existing = supabaseQuery(`select id from election where term_id = '${args.term}'`);
  if (existing.length && !args.force) {
    throw new Error("Ta kadencja ma już zaimportowane wybory. Użyj --force, by nadpisać.");
  }

  const all = parseCsv(download(CSV_URL));
  const rows = all.filter((r) => r["TERYT Gminy"] === args.teryt);
  if (!rows.length) throw new Error(`Brak wierszy dla TERYT ${args.teryt}`);
  log(`${rows.length} kandydatów, rada: ${[...new Set(rows.map((r) => r.Rada))].join(", ")}`);

  // Okręgi i komitety wyprowadzamy z wierszy kandydatów — PKW nie daje tu
  // osobnego zbioru per gmina, a wszystkie potrzebne liczby są w każdym wierszu.
  const districts = new Map();
  for (const r of rows) {
    const n = Number(r["Nr okręgu"]);
    if (!districts.has(n)) {
      districts.set(n, {
        number: n,
        validVotes: Number(r["Liczba głosów ważnych oddanych w okręgu"]),
        seats: 0,
      });
    }
    if (r["Czy uzyskał mandat"] === "Tak") districts.get(n).seats++;
  }

  const committees = new Map();
  const usedCodes = new Set();
  for (const r of rows) {
    const list = Number(r["Nr listy"]);
    if (!committees.has(list)) {
      committees.set(list, {
        listNumber: list,
        name: r["Nazwa komitetu"],
        shortName: r["Skrót nazwy komitetu"],
        code: codeFor(r["Skrót nazwy komitetu"], usedCodes),
      });
    }
  }

  const seats = [...districts.values()].reduce((a, d) => a + d.seats, 0);
  log(
    `${districts.size} okręgi (mandaty: ${[...districts.values()].map((d) => d.seats).join("+")} = ${seats}), ` +
      `${committees.size} komitetów`
  );

  verify(rows, districts);

  if (args.dryRun) {
    log("--dry-run: nic nie zapisuję.");
    for (const c of [...committees.values()].sort((a, b) => a.listNumber - b.listNumber)) {
      log(`  lista ${String(c.listNumber).padStart(2)} [${c.code.padEnd(5)}] ${c.shortName}`);
    }
    return;
  }

  const councilors = supabaseQuery(
    `select c.id, c.full_name from councilor_term ct join councilor c on c.id = ct.councilor_id
     where ct.term_id = '${args.term}'`
  );
  const byName = new Map(
    councilors.map((c) => {
      const { first, last } = splitDbName(c.full_name);
      return [`${last}|${first}`, c.id];
    })
  );

  const sql = buildInsertSql({ args, rows, districts, committees, seats, byName });
  const file = path.join(tmpdir(), `wybory-${args.teryt}.sql`);
  writeFileSync(file, sql);
  execFileSync("psql", [process.env.SUPABASE_DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], {
    encoding: "utf8",
  });
  rmSync(file, { force: true });

  const [check] = supabaseQuery(
    `select count(*) filter (where councilor_id is not null) as dopasowani,
            count(*) filter (where won_mandate) as mandaty, count(*) as kandydaci
     from election_candidate ec join election e on e.id = ec.election_id
     where e.term_id = '${args.term}'`
  );
  log(
    `zapisano: ${check.kandydaci} kandydatów, ${check.mandaty} mandatów, ` +
      `${check.dopasowani} dopasowanych do radnych w bazie`
  );
  if (Number(check.dopasowani) < Number(check.mandaty)) {
    log(
      `UWAGA: ${check.mandaty - check.dopasowani} zwycięzców bez dopasowania do councilor — ` +
        `sprawdź pisownię nazwisk`
    );
  }

  crossCheckCommittees(args.term);
}

/**
 * Odtwarza oficjalny podział mandatów z samych głosów i porównuje z PKW.
 *
 * To nie jest kontrola importu, tylko kontrola SILNIKA: ta sama funkcja
 * `allocateSeats` liczy potem symulacje innych ordynacji. Jeśli nie odtwarza
 * rzeczywistości, symulacje są bezwartościowe i lepiej się o tym dowiedzieć
 * przy imporcie niż z gotowej strony.
 */
function verify(rows, districts) {
  const gmina = new Map();
  for (const r of rows) {
    const k = r["Skrót nazwy komitetu"];
    gmina.set(k, (gmina.get(k) ?? 0) + Number(r["Liczba głosów"]));
  }
  const total = [...gmina.values()].reduce((a, b) => a + b, 0);
  const passed = new Set([...gmina].filter(([, v]) => v / total >= THRESHOLD).map(([k]) => k));
  log(
    `próg ${THRESHOLD * 100}% w skali gminy: przechodzi ${passed.size}/${gmina.size} komitetów ` +
      `(łącznie ${total} głosów ważnych na listy)`
  );

  let mismatches = 0;
  for (const d of districts.values()) {
    const inDistrict = rows.filter((r) => Number(r["Nr okręgu"]) === d.number);
    const votes = new Map();
    const real = new Map();
    for (const r of inDistrict) {
      const k = r["Skrót nazwy komitetu"];
      votes.set(k, (votes.get(k) ?? 0) + Number(r["Liczba głosów"]));
      if (r["Czy uzyskał mandat"] === "Tak") real.set(k, (real.get(k) ?? 0) + 1);
    }
    const eligible = new Map([...votes].filter(([k]) => passed.has(k)));
    const sim = allocateSeats(eligible, d.seats, "dhondt");
    for (const k of votes.keys()) {
      if ((sim.get(k) ?? 0) !== (real.get(k) ?? 0)) {
        mismatches++;
        log(`ROZJAZD okręg ${d.number} ${k}: symulacja ${sim.get(k) ?? 0}, PKW ${real.get(k) ?? 0}`);
      }
    }

    // Podział wewnątrz listy (art. 233 kw): głosy malejąco, remis — wyższa
    // pozycja na liście. Sprawdzamy imiennie, bo symulator ma pokazywać
    // nazwiska, nie tylko słupki.
    for (const [k, n] of sim) {
      if (!n) continue;
      const cands = inDistrict
        .filter((r) => r["Skrót nazwy komitetu"] === k)
        .sort(
          (a, b) =>
            Number(b["Liczba głosów"]) - Number(a["Liczba głosów"]) ||
            Number(a["Pozycja na liście"]) - Number(b["Pozycja na liście"])
        );
      const predicted = new Set(cands.slice(0, n).map((r) => r["Nazwisko i imiona"]));
      for (const r of cands) {
        if ((r["Czy uzyskał mandat"] === "Tak") !== predicted.has(r["Nazwisko i imiona"])) {
          mismatches++;
          log(`ROZJAZD nazwisko okręg ${d.number} ${k}: ${r["Nazwisko i imiona"]}`);
        }
      }
    }
  }
  if (mismatches) {
    throw new Error(
      `Silnik nie odtwarza oficjalnego wyniku (${mismatches} rozjazdów) — przerywam import.`
    );
  }
  log("weryfikacja: D'Hondt + próg gminny + art. 232 §3 i 233 odtwarzają wynik PKW co do nazwiska");
}

/**
 * Porównuje komitety zwycięzców z PKW z tym, co siedzi w councilor_term.
 *
 * Tamte dane pochodzą z odczytu na I sesji, a dwa przypisania (Dobrzyński,
 * D. Woźniak — wejście na wakaty) były wnioskiem z kodeksu wyborczego, nie
 * cytatem. PKW jest tu niezależnym źródłem, więc to darmowa kontrola.
 */
function crossCheckCommittees(termId) {
  const rows = supabaseQuery(
    `select c.full_name, ct.election_committee_code as z_sesji, ecom.code as z_pkw
     from election_candidate ec
     join election e on e.id = ec.election_id
     join election_committee ecom on ecom.id = ec.committee_id
     join councilor c on c.id = ec.councilor_id
     join councilor_term ct on ct.councilor_id = c.id and ct.term_id = e.term_id
     where e.term_id = '${termId}' and ec.won_mandate
       and ct.election_committee_code is distinct from ecom.code`
  );
  if (!rows.length) {
    log("kontrola krzyżowa: komitety zwycięzców zgodne z tym, co odczytano na I sesji");
    return;
  }
  for (const r of rows) {
    log(`ROZBIEŻNOŚĆ komitetu: ${r.full_name} — z sesji "${r.z_sesji}", z PKW "${r.z_pkw}"`);
  }
  log(
    "Zwycięzcy niedopasowani po nazwisku nie są tu widoczni — to tylko kontrola tych dopasowanych."
  );
}

function buildInsertSql({ args, rows, districts, committees, seats, byName }) {
  const parts = [
    "begin;",
    `delete from election where term_id = '${args.term}';`,
    `insert into election (term_id, held_on, seats, teryt, source_dataset)
     values ('${args.term}', '${ELECTION_DATE}', ${seats}, ${sqlText(args.teryt)}, ${sqlText(DATASET)});`,
    `create temp table _el on commit drop as select id from election where term_id = '${args.term}';`,
  ];

  for (const d of districts.values()) {
    parts.push(
      `insert into election_district (election_id, number, seats, valid_votes)
       select id, ${d.number}, ${d.seats}, ${d.validVotes} from _el;`
    );
  }
  for (const c of committees.values()) {
    parts.push(
      `insert into election_committee (election_id, list_number, name, short_name, code)
       select id, ${c.listNumber}, ${sqlText(c.name)}, ${sqlText(c.shortName)}, ${sqlText(c.code)} from _el;`
    );
  }

  let matched = 0;
  const values = rows.map((r) => {
    const { first, last } = splitPkwName(r["Nazwisko i imiona"]);
    const councilorId = byName.get(`${last}|${first}`) ?? null;
    if (councilorId) matched++;
    const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? "null" : Number(v));
    return `(
      (select id from _el),
      (select id from election_district where election_id = (select id from _el) and number = ${Number(r["Nr okręgu"])}),
      (select id from election_committee where election_id = (select id from _el) and list_number = ${Number(r["Nr listy"])}),
      ${Number(r["Pozycja na liście"])},
      ${sqlText(r["Nazwisko i imiona"])},
      ${Number(r["Liczba głosów"])},
      ${r["Czy uzyskał mandat"] === "Tak"},
      ${num(r["Wiek"])},
      ${sqlText(r["Płeć"] || null)},
      ${sqlText(r["Miejsce zamieszkania"] || null)},
      ${sqlText(r["Poparcie"] || null)},
      ${councilorId ? `'${councilorId}'` : "null"}
    )`;
  });
  parts.push(
    `insert into election_candidate
       (election_id, district_id, committee_id, list_position, full_name, votes,
        won_mandate, age, gender, residence, support, councilor_id)
     values ${values.join(",\n")};`
  );
  parts.push("commit;");
  log(`dopasowano ${matched}/${rows.length} kandydatów do radnych w bazie`);
  return parts.join("\n");
}

main().catch((e) => {
  console.error(`[wybory] BŁĄD: ${e.message}`);
  process.exit(1);
});
