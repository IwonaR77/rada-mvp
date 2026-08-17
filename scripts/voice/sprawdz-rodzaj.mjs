#!/usr/bin/env node
// Kontrola przypisań mówców kanałem NIEZALEŻNYM od dźwięku: polskie końcówki
// pierwszej osoby zdradzają płeć mówiącego („chciałbym" vs „chciałabym"), więc
// jeśli rozpoznawanie głosem przypisało wypowiedź osobie niewłaściwej płci,
// widać to w samym tekście.
//
// To nie jest test skuteczności — rozstrzygającą końcówkę ma kilka procent
// segmentów, a pomyłka między dwiema osobami tej samej płci przejdzie tędy bez
// echa. To tania siatka na najgrubsze błędy, do przejrzenia przed zatwierdzeniem
// partii propozycji.
//
// Przy okazji zapisuje podgląd całej sesji (czas, mówca, początek wypowiedzi)
// do przejrzenia okiem — jednym plikiem, bez klikania po interfejsie.
//
// Użycie:
//   node scripts/voice/sprawdz-rodzaj.mjs --esesja 56686
//   node scripts/voice/sprawdz-rodzaj.mjs --esesja 56686 --status proposed

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { supabaseQuery, REPO_ROOT } from "../lib/db.mjs";

// Czas przeszły 1. os. to rdzeń zakończony SAMOGŁOSKĄ + „ł" + „em/am"
// (zrobiłam, wziąłem, czułem). Sama końcówka „łem/łam" nie wystarcza: łapie
// czas przyszły („ja pana wywołam") i rzeczowniki w narzędniku („protokołem"),
// gdzie przed „ł" stoi spółgłoska albo „o". Flaga `u` jest konieczna — bez niej
// `\w` nie obejmuje polskich liter i formy typu „wzięłam" cicho wypadają.
const ZENSKIE = /[aiyeęąóu]ł(am|abym)\b/iu;
const MESKIE = /[aiyeęąóu]ł(em|bym)\b/iu;

/**
 * Odsiewa rzeczowniki w narzędniku, zanim zadziała reguła morfologiczna.
 *
 * Dwa sita, bo samo wyliczanie rdzeni okazało się studnią bez dna („działem",
 * „udziałem", „materiałem", „ogółem"…). Ogólna zasada: narzędnik rzeczownika
 * prawie zawsze stoi PO przyimku („z udziałem") albo po przymiotniku
 * w narzędniku („kwalifikowanym materiałem"), a forma czasownika w 1. osobie
 * nie ma przed sobą ani jednego, ani drugiego.
 */
function bezNarzednika(tekst) {
  return tekst
    .replace(RZECZOWNIKI, "")
    .replace(
      /\b(z|ze|nad|pod|przed|za|między|pomiędzy|wraz|z\s+\p{L}+)\s+\p{L}+ł(em|am)\b/giu,
      ""
    )
    .replace(/\p{L}+(ym|im|om)\s+\p{L}+ł(em|am)\b/giu, "");
}

// Rdzenie, których narzędnik ma dokładnie tę samą postać co czasownik
// („działem", „ciałem", „ogółem"). Reguła morfologiczna ich nie odsieje, bo
// przed „ł" stoi tam ta sama samogłoska co w „czytałem".
//
// `\b` na początku jest konieczne: bez niego rdzeń „dział" trafiał w ŚRODEK
// czasowników („powiedziałem", „widziałem", „siedziałem") i test po cichu
// wycinał właśnie te formy, których miał szukać.
const RZECZOWNIKI =
  /\b(protokoł|wydział|podział|udział|oddział|przedział|źródł|dział|koł|czoł|ciał|dzieł|tł|stoł|okoł|zespoł|osiedl|ogół|mysł|węzł|hasł|krzesł|artykuł|tytuł|rozdział|paragraf)em\b/giu;

function parseArgs(argv) {
  const args = { status: "all" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--esesja") args.esesja = argv[++i];
    else if (argv[i] === "--status") args.status = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else {
      console.error(`Nieznana flaga: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!args.esesja) {
    console.error("Wymagane: --esesja <id> [--status proposed|finalized|all] [--out <plik>]");
    process.exit(1);
  }
  args.out ??= `groq/work/glos/podglad-${args.esesja}.txt`;
  return args;
}

/**
 * Płeć po imieniu: polskie imiona żeńskie kończą się na „a”.
 *
 * Wyjątków (Kuba, Barnaba) w składach obu rad nie ma, a gdyby się pojawiły,
 * kosztem jest fałszywy alarm do ręcznego odrzucenia — nie cicha pomyłka.
 */
function plecPoImieniu(fullName) {
  return fullName.split(" ")[0].toLowerCase().endsWith("a") ? "k" : "m";
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const segmenty = supabaseQuery(`
    select s.start_time, s.status, s.text,
           coalesce(c.full_name, o.full_name) as mowca
      from segment s
      join meeting m on m.id = s.meeting_id
      left join councilor c on c.id = s.confirmed_councilor_id
      left join official o on o.id = s.confirmed_official_id
     where m.esesja_id = '${args.esesja}'
     order by s.start_time
     limit 20000
  `);

  const linie = segmenty.map((s) => {
    const t = Number(s.start_time);
    const czas = `${String(Math.floor(t / 60)).padStart(3)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    return `${czas}  ${(s.mowca ?? "—").padEnd(24)} ${(s.text ?? "").slice(0, 95)}`;
  });
  const outPath = path.isAbsolute(args.out) ? args.out : path.join(REPO_ROOT, args.out);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, linie.join("\n") + "\n", "utf8");

  let sprawdzone = 0;
  let sprzeczne = 0;
  for (const s of segmenty) {
    if (!s.mowca) continue;
    if (args.status !== "all" && s.status !== args.status) continue;

    const tekst = bezNarzednika(s.text ?? "");
    const z = ZENSKIE.test(tekst);
    const m = MESKIE.test(tekst);
    if (!z && !m) continue;

    // Segment z OBIEMA formami naraz nic nie rozstrzyga: albo rozpoznawanie
    // mowy przekręciło końcówkę (tak jest w wypowiedzi burmistrza, gdzie po
    // „spotkałam" idzie „powiedziałem" i „nie wyraziłbym"), albo w jednym
    // segmencie siedzą dwie osoby. Zgłaszanie takich to pewny fałszywy alarm.
    if (z && m) continue;

    sprawdzone++;
    const plec = plecPoImieniu(s.mowca);
    if ((z && plec === "m") || (m && plec === "k")) {
      sprzeczne++;
      const t = Number(s.start_time);
      console.log(
        `  SPRZECZNOŚĆ ${String(Math.floor(t / 60))}:${String(Math.floor(t % 60)).padStart(2, "0")} ` +
          `${s.mowca} (${plec}): ${(s.text ?? "").slice(0, 110)}`
      );
    }
  }

  console.log(
    `\nSesja ${args.esesja}: ${segmenty.length} segmentów, ` +
      `${sprawdzone} z rozstrzygającą końcówką, sprzecznych z płcią mówcy: ${sprzeczne}`
  );
  console.log(`Podgląd: ${path.relative(REPO_ROOT, outPath)}`);
}

main();
