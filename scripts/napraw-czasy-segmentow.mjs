#!/usr/bin/env node
// Poprawia oś czasu pojedynczych segmentów oznaczonych flagą „przesunięty
// względem nagrania" (`flag.reason = 'desync'`).
//
// Po co osobne narzędzie, skoro istnieje ponowna transkrypcja sesji: bo to
// uszkodzenie jest LOKALNE. Whisperx wyrównywał całą sesję poprawnie, a
// pojedyncze segmenty zgniótł do zera („Punkt 2." w 0,22 s, 36 znaków/s) albo
// rozciągnął przez ciszę („Czy macie państwo radni pytania?" przez 8 s).
// Tekst jest dobry, zły jest wyłącznie czas — a ponowna transkrypcja
// kasowałaby przy okazji podsumowanie sesji, tematy i propozycje mówców.
//
// Metoda: wycinamy z transmisji wąskie okno wokół segmentu (domyślnie ±15 s),
// wysyłamy do Groqa ze znacznikami SŁÓW i szukamy w nich tekstu segmentu.
// Znaczniki słów są tu jedynym wiarygodnym źródłem — czasy segmentów zwracane
// przez Whispera potrafią być rozjechane wokół pauz dokładnie tak samo jak te,
// które naprawiamy (dlatego `retimeSegmentsFromWords` w groq/groq-lib.mjs
// istnieje w ogóle).
//
// Zapisujemy WYŁĄCZNIE `start_time` i `end_time`. Tekstu, mówcy ani statusu
// nie ruszamy.
//
// Użycie:
//   node scripts/napraw-czasy-segmentow.mjs --esesja 67570            (na sucho)
//   node scripts/napraw-czasy-segmentow.mjs --esesja 67570 --zapisz
//   ... [--margines 15] [--min-pokrycie 0.7]

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, createReadStream, rmSync } from "node:fs";
import path from "node:path";
import Groq from "groq-sdk";
import { supabaseQuery, REPO_ROOT } from "./lib/db.mjs";
import { resolveGroqApiKey } from "../groq/groq-lib.mjs";

const PYTHON = "/home/blady/.venv-rada-voice/bin/python";
const KATALOG = path.join(REPO_ROOT, "groq/work/przesuniecia");
const GROQ_ENV = path.join(REPO_ROOT, "groq/.env.groq");

function parseArgs(argv) {
  const args = {
    esesja: null,
    margines: 15,
    minPokrycie: 0.7,
    zapisz: false,
    tylko: null,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--esesja") args.esesja = argv[++i];
    else if (argv[i] === "--margines") args.margines = Number(argv[++i]);
    else if (argv[i] === "--min-pokrycie") args.minPokrycie = Number(argv[++i]);
    else if (argv[i] === "--tylko") args.tylko = argv[++i].split(",");
    else if (argv[i] === "--zapisz") args.zapisz = true;
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!args.esesja) {
    console.error("Wymagane: --esesja <id>");
    process.exit(1);
  }
  return args;
}

/** Do porównywania liczy się sam ciąg liter i cyfr — reszta to interpunkcja. */
function normalizuj(tekst) {
  return tekst
    .toLocaleLowerCase("pl-PL")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Szuka słów segmentu w strumieniu słów ze świeżej transkrypcji.
 *
 * Okno przesuwane, nie wyszukiwanie dosłowne: rozpoznawanie mowy zapisuje
 * liczby raz cyframi, raz słownie, myli końcówki i gubi pojedyncze wyrazy, więc
 * dopasowanie musi znosić różnice. Liczymy odsetek słów segmentu, które
 * pojawiają się na swoim miejscu (±1 pozycja) w kandydacie.
 */
function znajdzDopasowanie(slowaSegmentu, slowaZNagrania) {
  if (slowaSegmentu.length === 0 || slowaZNagrania.length === 0) return null;
  const n = slowaSegmentu.length;
  const kandydaci = [];

  for (let i = 0; i + 1 <= slowaZNagrania.length; i++) {
    const okno = slowaZNagrania.slice(i, i + n).map((w) => w.slowo);
    let trafienia = 0;
    for (let j = 0; j < n; j++) {
      const cel = slowaSegmentu[j];
      if (okno[j] === cel || okno[j - 1] === cel || okno[j + 1] === cel) trafienia++;
    }
    kandydaci.push({ i, pokrycie: trafienia / n });
  }

  kandydaci.sort((a, b) => b.pokrycie - a.pokrycie);
  const najlepszy = kandydaci[0];
  // Przewaga nad najlepszym kandydatem z INNEGO miejsca okna: bez tego krótkie
  // teksty („Punkt 2.", „Dziękuję.") dopasowałyby się w kilku miejscach naraz
  // i wybór byłby rzutem monetą.
  const inny = kandydaci.find((k) => Math.abs(k.i - najlepszy.i) > n);
  const przewaga = najlepszy.pokrycie - (inny?.pokrycie ?? 0);

  const od = slowaZNagrania[najlepszy.i];
  const do_ = slowaZNagrania[Math.min(najlepszy.i + n - 1, slowaZNagrania.length - 1)];
  return {
    pokrycie: najlepszy.pokrycie,
    przewaga,
    indeks: najlepszy.i,
    start: od.start,
    end: do_.end,
  };
}

/** Próg, poniżej którego tekst sam z siebie nie identyfikuje miejsca w nagraniu. */
const KROTKI_TEKST_SLOW = 5;

/**
 * Dopasowanie krótkiego segmentu przez kontekst sąsiadów.
 *
 * „Punkt 2." czy „Tak." pada w trzydziestosekundowym oknie po kilka razy i
 * każde trafienie wygląda tak samo dobrze. Ciąg poprzedni + ten + następny jest
 * już unikatowy, więc szukamy całego ciągu, a potem wycinamy z niego słowa
 * należące do naszego segmentu — po ich pozycji, nie po treści.
 */
function dopasujZKontekstem(seg, slowaZNagrania) {
  const poprz = normalizuj(seg.poprz_tekst ?? "").slice(-8);
  const ten = normalizuj(seg.text);
  const nast = normalizuj(seg.nast_tekst ?? "").slice(0, 8);
  if (poprz.length + nast.length === 0) return null;

  const caly = [...poprz, ...ten, ...nast];
  const trafienie = znajdzDopasowanie(caly, slowaZNagrania);
  if (!trafienie) return null;

  // znajdzDopasowanie zwraca czasy skrajnych słów CAŁEGO ciągu; nas interesuje
  // wyłącznie środek. Pozycję środka liczymy od początku trafienia.
  const i = trafienie.indeks + poprz.length;
  const od = slowaZNagrania[i];
  const do_ = slowaZNagrania[Math.min(i + ten.length - 1, slowaZNagrania.length - 1)];
  if (!od || !do_) return null;
  return {
    pokrycie: trafienie.pokrycie,
    przewaga: trafienie.przewaga,
    start: od.start,
    end: do_.end,
    zKontekstu: true,
  };
}

/** Okna wokół segmentów, scalone tam, gdzie się nachodzą. */
function zbudujOkna(segmenty, margines) {
  const surowe = segmenty
    .map((s) => ({
      od: Math.max(0, Number(s.start_time) - margines),
      do: Number(s.end_time) + margines,
      segmenty: [s],
    }))
    .sort((a, b) => a.od - b.od);

  const scalone = [];
  for (const okno of surowe) {
    const ostatnie = scalone[scalone.length - 1];
    if (ostatnie && okno.od <= ostatnie.do) {
      ostatnie.do = Math.max(ostatnie.do, okno.do);
      ostatnie.segmenty.push(...okno.segmenty);
      continue;
    }
    scalone.push(okno);
  }
  return scalone;
}

async function transkrybujSlowa(groq, plik, offset) {
  const { data } = await groq.audio.transcriptions
    .create({
      file: createReadStream(plik),
      model: "whisper-large-v3",
      language: "pl",
      response_format: "verbose_json",
      timestamp_granularities: ["segment", "word"],
    })
    .withResponse();

  // Czasy w odpowiedzi są względne do wysłanego pliku, a plik zaczyna się
  // w `offset` sekundzie nagrania.
  return (data.words ?? []).map((w) => ({
    slowo: normalizuj(w.word)[0] ?? "",
    start: w.start + offset,
    end: w.end + offset,
  })).filter((w) => w.slowo);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Sąsiedzi wjeżdżają razem z segmentem: przy tekstach dwuwyrazowych
  // („Punkt 2.", „Tak.") samo dopasowanie nie ma czego zaczepić, bo takie
  // słowa padają w oknie po kilka razy. Dopiero ciąg poprzedni+ten+następny
  // jest w nagraniu unikatowy — patrz `dopasujZKontekstem`.
  const segmenty = supabaseQuery(`
    with s as (
      select s.id, s.start_time, s.end_time, s.text, m.esesja_id,
             lag(s.text) over w poprz_tekst,
             lead(s.text) over w nast_tekst
        from segment s join meeting m on m.id = s.meeting_id
       window w as (partition by s.meeting_id order by s.start_time)
    )
    select s.id, s.start_time, s.end_time, s.text, s.poprz_tekst, s.nast_tekst
      from s join flag f on f.segment_id = s.id
      left join official o on o.id = s.confirmed_official_id
     where s.esesja_id = '${args.esesja}' and f.reason = 'desync'
       -- Tekst oznaczony jako halucynacja nie ma prawdziwego miejsca w nagraniu:
       -- nikt go nie wypowiedział. Dopasowanie i tak coś znajdzie (samo
       -- „Dziękuję." pada na sesji dziesiątki razy) i przestawi segment na
       -- cudzą wypowiedź. Zdarzyło się raz, 21.08.2026 na sesji 66396.
       and coalesce(o.full_name, '') <> 'Halucynacja transkrypcji'
       ${args.tylko ? `and s.id in (${args.tylko.map((x) => `'${x}'`).join(",")})` : ""}
     order by s.start_time
  `);
  if (segmenty.length === 0) {
    console.log(`Sesja ${args.esesja}: brak segmentów z flagą desync.`);
    return;
  }

  const okna = zbudujOkna(segmenty, args.margines);
  const sekundy = okna.reduce((s, o) => s + (o.do - o.od), 0);
  console.log(
    `Sesja ${args.esesja}: ${segmenty.length} oflagowanych segmentów, ` +
      `${okna.length} okien, razem ${Math.round(sekundy)} s dźwięku do pobrania.\n`
  );

  mkdirSync(KATALOG, { recursive: true });
  const groq = new Groq({ apiKey: resolveGroqApiKey(GROQ_ENV) });
  const wyniki = [];

  for (const [nr, okno] of okna.entries()) {
    const plik = path.join(KATALOG, `${args.esesja}-${Math.round(okno.od)}.mp3`);
    console.log(
      `[${nr + 1}/${okna.length}] ${Math.round(okno.od)}–${Math.round(okno.do)} s ` +
        `(${okno.segmenty.length} segm.)`
    );
    execFileSync(
      PYTHON,
      [
        path.join(REPO_ROOT, "scripts/voice/wytnij-fragment.py"),
        "--esesja", args.esesja,
        "--od", String(okno.od),
        "--do", String(okno.do),
        "--out", plik,
      ],
      { stdio: ["ignore", "ignore", "inherit"], cwd: REPO_ROOT }
    );

    const slowa = await transkrybujSlowa(groq, plik, okno.od);
    console.log(`      ${slowa.length} słów ze znacznikami`);

    for (const s of okno.segmenty) {
      const slowaSegmentu = normalizuj(s.text);
      const dopasowanie =
        slowaSegmentu.length < KROTKI_TEKST_SLOW
          ? dopasujZKontekstem(s, slowa) ?? znajdzDopasowanie(slowaSegmentu, slowa)
          : znajdzDopasowanie(slowaSegmentu, slowa);
      wyniki.push({
        id: s.id,
        tekst: s.text,
        stary_start: Number(s.start_time),
        stary_end: Number(s.end_time),
        ...(dopasowanie ?? { pokrycie: 0, przewaga: 0, start: null, end: null }),
      });
    }
  }

  console.log(
    `\n${"czas w bazie".padEnd(18)}${"zmierzony".padEnd(18)}${"delta".padEnd(9)}` +
      `${"pokr.".padEnd(7)}${"przew.".padEnd(8)}tekst`
  );
  const doZapisu = [];
  for (const w of wyniki) {
    const ok =
      w.start !== null &&
      w.pokrycie >= args.minPokrycie &&
      w.przewaga >= 0.2;
    const delta = w.start === null ? null : w.start - w.stary_start;
    console.log(
      `${`${w.stary_start.toFixed(1)}–${w.stary_end.toFixed(1)}`.padEnd(18)}` +
        `${(w.start === null ? "—" : `${w.start.toFixed(1)}–${w.end.toFixed(1)}`).padEnd(18)}` +
        `${(delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}s`).padEnd(9)}` +
        `${w.pokrycie.toFixed(2).padEnd(7)}${w.przewaga.toFixed(2).padEnd(8)}` +
        `${ok ? "" : "POMIJAM "}${w.tekst.slice(0, 50)}`
    );
    if (ok) doZapisu.push(w);
  }

  const raport = path.join(KATALOG, `raport-${args.esesja}.json`);
  writeFileSync(raport, JSON.stringify(wyniki, null, 1) + "\n", "utf8");
  console.log(`\nRaport: ${path.relative(REPO_ROOT, raport)}`);
  console.log(`Do poprawienia: ${doZapisu.length} z ${wyniki.length}.`);

  if (!args.zapisz) {
    console.log("To był przebieg na sucho. Zapis: --zapisz");
    return;
  }
  if (doZapisu.length === 0) return;

  // Kopia przed zmianą — te same wiersze, w tej samej postaci co zrzuty
  // z save-segment-assignments.mjs, żeby cofnięcie było jednym plikiem.
  //
  // W nazwie jest godzina i minuta, nie sama data: drugi bieg tego samego dnia
  // (np. po poszerzeniu okna dla segmentów, których nie udało się dopasować za
  // pierwszym razem) nadpisywał kopię z pierwszego i kasował jedyny zapis
  // poprzednich czasów. Zdarzyło się 21.08.2026 na sesji 67570.
  const znacznik = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "");
  const kopia = path.join(
    REPO_ROOT,
    `backups/segment-czasy-${args.esesja}-przed-naprawa-${znacznik}.sql`
  );
  writeFileSync(
    kopia,
    [
      `-- Czasy segmentów sesji ${args.esesja} przed naprawą osi czasu.`,
      ...doZapisu.map(
        (w) =>
          `update segment set start_time = ${w.stary_start}, end_time = ${w.stary_end} ` +
          `where id = '${w.id}';`
      ),
    ].join("\n") + "\n",
    "utf8"
  );
  console.log(`Kopia przed zmianą: ${path.relative(REPO_ROOT, kopia)}`);

  const plikSql = path.join(KATALOG, `zapis-${args.esesja}.sql`);
  writeFileSync(
    plikSql,
    doZapisu
      .map(
        (w) =>
          `update segment set start_time = ${w.start.toFixed(2)}, end_time = ${w.end.toFixed(2)} ` +
          `where id = '${w.id}';`
      )
      .join("\n") + "\n",
    "utf8"
  );
  // Jedna transakcja: albo wszystkie czasy tej sesji, albo żaden. Połowicznie
  // poprawiona oś jest gorsza od nietkniętej — nie wiadomo wtedy, co odsłuchać.
  execFileSync(
    "psql",
    [process.env.SUPABASE_DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-1", "-f", plikSql],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
  console.log(`Zapisano ${doZapisu.length} poprawionych czasów.`);

  // Kontrola po zapisie: przesunięty segment nie może wejść w sąsiada ani
  // wyprzedzić następnego — kolejność na ekranie idzie po `start_time`.
  const kolizje = supabaseQuery(`
    with s as (
      select s.id, s.start_time, s.end_time,
             lag(s.end_time) over w poprz_koniec,
             lead(s.start_time) over w nast_start
        from segment s join meeting m on m.id = s.meeting_id
       where m.esesja_id = '${args.esesja}'
      window w as (partition by s.meeting_id order by s.start_time)
    )
    select id, round(start_time::numeric, 2) start_time,
           round(poprz_koniec::numeric, 2) poprz_koniec,
           round(nast_start::numeric, 2) nast_start
      from s
     where id in (${doZapisu.map((w) => `'${w.id}'`).join(",")})
       and (start_time < poprz_koniec - 0.05 or end_time > nast_start + 0.05)
  `);
  if (kolizje.length > 0) {
    console.log(`\nUWAGA: ${kolizje.length} segment(ów) nachodzi na sąsiada:`);
    for (const k of kolizje) console.log(`  ${k.id} ${k.start_time} s`);
    console.log(`Cofnięcie: psql "$SUPABASE_DB_URL" -f ${path.relative(REPO_ROOT, kopia)}`);
  } else {
    console.log("Kontrola kolejności: bez nachodzenia na sąsiadów.");
  }
}

main();
