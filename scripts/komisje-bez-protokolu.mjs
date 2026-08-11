#!/usr/bin/env node
// Znajduje posiedzenia komisji, po których nie ma protokołu, i generuje na nie
// wnioski o udostępnienie informacji publicznej.
//
// TEN SKRYPT NICZEGO NIE WYSYŁA. Pisze pliki do `wnioski/` (gitignorowane)
// i wypisuje zestawienie. Wysyłka to osobny krok, świadomie oddzielony —
// pismo do urzędu podpisane nazwiskiem Iwony ma wyjść dopiero wtedy, gdy ona
// je przeczyta.
//
// Skąd wiadomo, że protokołu nie ma:
// - `grojec.esesja.pl/posiedzenia` podaje, KTÓRE posiedzenia się odbyły
//   (nazwa komisji, numer, data) — to jedyne miejsce z tą informacją,
//   bo w naszej bazie komisje prawie nie istnieją.
// - Strony komisji na BIP (`bip.grojecmiasto.pl/organy/1728/komisja/...`)
//   nie mają w ogóle sekcji na protokoły — sprawdzone 2026-08-11 na trzech
//   komisjach. To nie jest opóźnienie w publikacji, tylko jej brak.
// - Strony `/posiedzenie/<id>` na esesji zawierają materiały NA posiedzenie
//   (projekty uchwał, pisma), nie protokół Z posiedzenia.
//
// Dlatego skrypt nie próbuje zgadywać, czy protokół gdzieś jest: zakłada, że
// nie ma go nigdzie publicznie, i pyta o wszystkie posiedzenia starsze niż
// próg. Jeśli urząd kiedyś zacznie publikować, trzeba tu dopisać sprawdzanie.
//
//   node scripts/komisje-bez-protokolu.mjs [--dni 21] [--od 2026-01-01]

import { writeFileSync, mkdirSync } from "node:fs";
import { fetchDecoded, parsePolishDate, MONTHS } from "./lib/pl.mjs";

const BASE = "https://grojec.esesja.pl";
const KATALOG = "wnioski";

// Ustawowy termin odpowiedzi na wniosek to 14 dni, ale protokół powstaje po
// posiedzeniu i musi zostać przyjęty — pytanie o niego po tygodniu byłoby
// pytaniem o dokument, który jeszcze nie istnieje. Trzy tygodnie to margines
// na sporządzenie i przyjęcie, po którym brak publikacji jest już brakiem.
const DOMYSLNY_PROG_DNI = 21;

const ADRESAT = {
  nazwa: "Urząd Gminy i Miasta w Grójcu",
  email: "urzad@grojecmiasto.pl",
  adres: "ul. Józefa Piłsudskiego 47, 05-600 Grójec",
};

function arg(nazwa, domyslna) {
  const i = process.argv.indexOf(`--${nazwa}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : domyslna;
}

/**
 * Wyciąga posiedzenia z listy na esesji.
 *
 * Sesje rady mają na kontenerze dodatkową klasę `sesja` — to jedyny pewny
 * sposób odróżnienia ich od komisji, bo sama nazwa („Radni") bywa myląca.
 */
function parsujPosiedzenia(html) {
  const wynik = [];
  const bloki = html.split('<div class="session-item');
  for (const blok of bloki.slice(1)) {
    const jestSesja = /^[^>]*\bsesja\b/.test(blok);
    if (jestSesja) continue;

    const komisja = blok.match(
      /<p class="subtitle"><a[^>]*>([^<]+)<\/a>/
    )?.[1]?.trim();
    const link = blok.match(
      /<a href="(\/posiedzenie\/[^"]+)">([^<]+)<\/a>/
    );
    if (!komisja || !link) continue;

    const etykieta = link[2].trim();
    const data = parsePolishDate(etykieta);
    if (!data) continue;

    wynik.push({
      komisja,
      etykieta,
      numer: etykieta.match(/nr\s+([IVXLC]+)/)?.[1] ?? null,
      data,
      url: `${BASE}${link[1]}`,
    });
  }
  // Ta sama pozycja bywa i w „Nadchodzące", i w „Archiwum".
  const widziane = new Set();
  return wynik.filter((p) => {
    const klucz = `${p.komisja}|${p.data}`;
    if (widziane.has(klucz)) return false;
    widziane.add(klucz);
    return true;
  });
}

/** "2026-03-25" → "25 marca 2026 r." — pismo do urzędu, nie log. */
function dataSlownie(iso) {
  const [rok, mies, dzien] = iso.split("-");
  const nazwa = Object.entries(MONTHS).find(([, n]) => n === mies)?.[0];
  return `${Number(dzien)} ${nazwa ?? mies} ${rok} r.`;
}

function wniosek(posiedzenia) {
  const lista = posiedzenia
    .map(
      (p) =>
        `- ${p.komisja}, posiedzenie${p.numer ? ` nr ${p.numer}` : ""} z dnia ${dataSlownie(p.data)}`
    )
    .join("\n");

  return `Do: ${ADRESAT.nazwa}
${ADRESAT.adres}
${ADRESAT.email}

Wniosek o udostępnienie informacji publicznej

Na podstawie art. 61 Konstytucji Rzeczypospolitej Polskiej oraz art. 2 ust. 1
i art. 10 ust. 1 ustawy z dnia 6 września 2001 r. o dostępie do informacji
publicznej (Dz.U. 2022 poz. 902 z późn. zm.) wnoszę o udostępnienie
następujących informacji publicznych:

Protokoły (lub sprawozdania, jeżeli protokołów nie sporządzono) z posiedzeń
komisji Rady Miejskiej w Grójcu:

${lista}

Wnoszę o udostępnienie informacji w formie elektronicznej, na adres e-mail,
z którego wysłano niniejszy wniosek.

Jednocześnie wnoszę o wskazanie, czy protokoły z posiedzeń komisji Rady
Miejskiej w Grójcu są publikowane w Biuletynie Informacji Publicznej, a jeżeli
tak — o podanie adresu strony, pod którym są dostępne. Na dzień złożenia
wniosku podstrony poszczególnych komisji w BIP nie zawierają protokołów
z posiedzeń.

Zgodnie z art. 13 ust. 1 ustawy udostępnienie informacji publicznej następuje
bez zbędnej zwłoki, nie później niż w terminie 14 dni od dnia złożenia wniosku.

Z poważaniem,
[podpis]
`;
}

async function main() {
  const progDni = Number(arg("dni", DOMYSLNY_PROG_DNI));
  const od = arg("od", null);
  const dzis = new Date();
  const granica = new Date(dzis.getTime() - progDni * 86400_000)
    .toISOString()
    .slice(0, 10);

  const html = await fetchDecoded(`${BASE}/posiedzenia`);
  const wszystkie = parsujPosiedzenia(html);
  const zalegle = wszystkie
    .filter((p) => p.data <= granica)
    .filter((p) => (od ? p.data >= od : true))
    .sort((a, b) => a.data.localeCompare(b.data));

  console.log(
    `Posiedzenia komisji na esesji: ${wszystkie.length}, starsze niż ${progDni} dni: ${zalegle.length}\n`
  );
  for (const p of zalegle) {
    console.log(`  ${p.data}  ${p.komisja} ${p.numer ? `(nr ${p.numer})` : ""}`);
  }

  if (zalegle.length === 0) return;

  mkdirSync(KATALOG, { recursive: true });
  const plik = `${KATALOG}/wniosek-komisje-${dzis.toISOString().slice(0, 10)}.txt`;
  writeFileSync(plik, wniosek(zalegle), "utf-8");
  console.log(`\nWniosek zbiorczy na ${zalegle.length} posiedzeń: ${plik}`);
  console.log("Nic nie zostało wysłane.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
