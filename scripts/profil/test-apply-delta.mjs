#!/usr/bin/env node
// Fixtury weryfikacyjne dla applyDelta/validateDelta/nextId (Wariant 2 —
// krok iteracyjny profilu radnego zwraca deltę, kod stosuje ją
// deterministycznie). Bez bazy, bez LLM — te same stuby `generujWspolnaTeze`/
// `generujWspolnySpor` co realny driver dostałby z `claude -p`, tylko
// deterministyczne, żeby test nic nie kosztował i dawał się uruchamiać
// bez sieci. Ta sama konwencja co scripts/poc-embeddingi-smoke-test.mjs i
// scripts/profil/zapisz-baseline-biedrzycki.mjs: zwykłe asercje, twardy exit.
//
// Użycie: node scripts/profil/test-apply-delta.mjs

import { applyDelta, validateDelta, nextId, scalDoLimitu, LIMIT_TEMATOW, LIMIT_SPOROW } from "../../src/lib/councilor-profile-delta.ts";
import { buildShortIndex } from "../../src/lib/councilor-profile-index.ts";

let liczbaBledow = 0;

function sprawdz(opis, warunek) {
  if (warunek) {
    console.log(`  ✓ ${opis}`);
  } else {
    console.error(`  ✗ ${opis}`);
    liczbaBledow++;
  }
}

function pustyStan() {
  return {
    wersja_stanu: 8,
    radny: "Test Testowy",
    kadencja: "2024–2029",
    sesje_przetworzone: 0,
    sesje_z_wypowiedziami: 0,
    ostatnia_sesja: null,
    kategorie_znane: [],
    grupy_kategorii: {},
    tematy: [],
    udzial_forma: {
      odczytanie: { wystapil: false, wystapien: 0, przyklady: [] },
      formalna: { wystapil: false, wystapien: 0, przyklady: [] },
      prowadzenie: { wystapil: false, wystapien: 0, przyklady: [] },
      dyskusja: { wystapil: false, wystapien: 0, przyklady: [] },
    },
    mieszkancy: [],
    interpelacje_powiazane: [],
    spory: [],
    odrzucone: [],
  };
}

// Stuby deterministyczne — w produkcji te dwie funkcje wołają `claude -p`
// (mikro-zapytanie tylko o parę scalanych tematów/sporów), tu wystarczy
// dowolna deterministyczna kombinacja, testujemy mechanikę scalania, nie
// jakość prozy.
const ctxBazowy = (sesjaData, meetingId) => ({
  sesjaData,
  meetingId,
  generujWspolnaTeze: async (a, b) => ({ teza: `${a.teza} / ${b.teza}`, zdanie: a.zdanie ?? b.zdanie }),
  generujWspolnySpor: async (a, b) => ({ temat: `${a.temat} / ${b.temat}`, stanowiska: `${a.stanowiska}; ${b.stanowiska}` }),
});

async function testNowyTemat() {
  console.log("\n[1] NOWY temat");
  const stan = pustyStan();
  const delta = {
    sesja_ma_wypowiedzi: true,
    tematy: [
      { decyzja: "NOWY", dane: { teza: "oświetlenie uliczne", zdanie: "pytał o oświetlenie", kategoria_obszaru: "infrastruktura", zasieg: "wypowiedz", kotwica: { sesja: "2025-01-01", cytat: "..." }, sprawa: null, rola_w_sprawie: null } },
    ],
    spory_nowe: [], udzial_forma_zdarzenia: [], mieszkancy_nowi: [], interpelacje_nowe: [], odrzucone_nowe: [],
  };
  const nowy = await applyDelta(stan, delta, ctxBazowy("2025-01-01", "m1"));
  sprawdz("dokładnie jeden temat", nowy.tematy.length === 1);
  sprawdz("id = t1", nowy.tematy[0]?.id === "t1");
  sprawdz("wystapien = 1", nowy.tematy[0]?.wystapien === 1);
  sprawdz("sesje_przetworzone = 1", nowy.sesje_przetworzone === 1);
  sprawdz("stan wejściowy niezmutowany (structuredClone)", stan.tematy.length === 0);
}

async function testDopasowanie() {
  console.log("\n[2] DOPASOWANIE temat — licznik rośnie, zasieg nigdy nie maleje, teza/zdanie/kategoria niezmienione");
  const stan = pustyStan();
  stan.tematy.push({
    id: "t1", teza: "oświetlenie uliczne", zdanie: "pytał o oświetlenie", kategoria_obszaru: "infrastruktura",
    zasieg: "dyskusja", sesje: ["2025-01-01"], wystapien: 3, pierwsza: "2025-01-01", ostatnia: "2025-01-01",
    kotwica: { sesja: "2025-01-01", cytat: "stary cytat" }, sprawa: null, rola_w_sprawie: null,
  });
  const delta = {
    sesja_ma_wypowiedzi: true,
    tematy: [
      { decyzja: "DOPASOWANIE", id: "t1", obserwacja: { wystapien_w_tej_sesji: 2, zasieg_w_tej_sesji: "wzmianka", kotwica: { sesja: "2025-02-01", cytat: "nowy cytat" } } },
    ],
    spory_nowe: [], udzial_forma_zdarzenia: [], mieszkancy_nowi: [], interpelacje_nowe: [], odrzucone_nowe: [],
  };
  const nowy = await applyDelta(stan, delta, ctxBazowy("2025-02-01", "m2"));
  const t = nowy.tematy[0];
  sprawdz("wystapien = 3 + 2 = 5", t.wystapien === 5);
  sprawdz("zasieg zostaje 'dyskusja' (nowe wzmianka < istniejące dyskusja)", t.zasieg === "dyskusja");
  sprawdz("ostatnia = 2025-02-01", t.ostatnia === "2025-02-01");
  sprawdz("kotwica nadpisana najnowszą", t.kotwica.cytat === "nowy cytat");
  sprawdz("teza niezmieniona", t.teza === "oświetlenie uliczne");
  sprawdz("zdanie niezmienione", t.zdanie === "pytał o oświetlenie");
  sprawdz("kategoria_obszaru niezmieniona", t.kategoria_obszaru === "infrastruktura");
  sprawdz("sesje zawiera obie daty", t.sesje.includes("2025-01-01") && t.sesje.includes("2025-02-01"));
}

async function testLimitTematow() {
  console.log("\n[3] Limit 40 tematów — scalanie przy przekroczeniu, suma wystapien zachowana");
  const stan = pustyStan();
  for (let i = 0; i < LIMIT_TEMATOW; i++) {
    stan.tematy.push({
      id: `t${i + 1}`, teza: `temat numer ${i + 1}`, zdanie: null, kategoria_obszaru: "ogólne",
      zasieg: "wzmianka", sesje: ["2025-01-01"], wystapien: 1, pierwsza: "2025-01-01", ostatnia: "2025-01-01",
      kotwica: null, sprawa: null, rola_w_sprawie: null,
    });
  }
  const sumaPrzed = stan.tematy.reduce((s, t) => s + t.wystapien, 0);
  const delta = {
    sesja_ma_wypowiedzi: true,
    tematy: [{ decyzja: "NOWY", dane: { teza: "temat numer 41", zdanie: null, kategoria_obszaru: "ogólne", zasieg: "wzmianka", kotwica: null, sprawa: null, rola_w_sprawie: null } }],
    spory_nowe: [], udzial_forma_zdarzenia: [], mieszkancy_nowi: [], interpelacje_nowe: [], odrzucone_nowe: [],
  };
  const nowy = await applyDelta(stan, delta, ctxBazowy("2025-03-01", "m3"));
  const sumaPo = nowy.tematy.reduce((s, t) => s + t.wystapien, 0);
  sprawdz(`dokładnie ${LIMIT_TEMATOW} tematów zostaje`, nowy.tematy.length === LIMIT_TEMATOW);
  sprawdz("suma wystapien zachowana (nic nie zgubione przy scalaniu)", sumaPo === sumaPrzed + 1);
}

async function testLimitSporow() {
  console.log("\n[4] Limit 30 sporów — scalanie przy przekroczeniu");
  const stan = pustyStan();
  for (let i = 0; i < LIMIT_SPOROW; i++) {
    stan.spory.push({ id: `s${i + 1}`, sesja: "2025-01-01", temat: `spór numer ${i + 1}`, stanowiska: "...", kotwica: "..." });
  }
  const delta = {
    sesja_ma_wypowiedzi: true, tematy: [],
    spory_nowe: [{ temat: "spór numer 31", stanowiska: "...", kotwica: "..." }],
    udzial_forma_zdarzenia: [], mieszkancy_nowi: [], interpelacje_nowe: [], odrzucone_nowe: [],
  };
  const nowy = await applyDelta(stan, delta, ctxBazowy("2025-03-01", "m4"));
  sprawdz(`dokładnie ${LIMIT_SPOROW} sporów zostaje`, nowy.spory.length === LIMIT_SPOROW);
}

async function testBrakLancuchowegoScalania() {
  console.log("\n[3b] Duży nadmiar tematów — każdy wpis scala się najwyżej raz na wywołanie (regresja: bug z Kozłowskiej 2026-09-06)");
  const stan = pustyStan();
  // 50 tematów, wymaga 10 scaleń (50 → 40) w jednym applyDelta.
  for (let i = 0; i < 50; i++) {
    stan.tematy.push({
      id: `t${i + 1}`, teza: `temat numer ${i + 1}`, zdanie: null, kategoria_obszaru: "ogólne",
      zasieg: "wzmianka", sesje: ["2025-01-01"], wystapien: 1, pierwsza: "2025-01-01", ostatnia: "2025-01-01",
      kotwica: null, sprawa: null, rola_w_sprawie: null,
    });
  }
  const delta = { sesja_ma_wypowiedzi: false, tematy: [], spory_nowe: [], udzial_forma_zdarzenia: [], mieszkancy_nowi: [], interpelacje_nowe: [], odrzucone_nowe: [] };
  const nowy = await applyDelta(stan, delta, ctxBazowy("2025-03-01", "m3b"));
  sprawdz("dokładnie 40 tematów zostaje", nowy.tematy.length === 40);
  // Stub `generujWspolnaTeze` łączy tezy przez " / " — łańcuchowe scalanie
  // (ten sam wpis scalony więcej niż raz w JEDNYM wywołaniu) dałoby tezę z
  // więcej niż jednym " / ". Przy poprawnym, nierozłącznym doborze par każdy
  // scalony wpis ma dokładnie jedno " / ".
  const scalone = nowy.tematy.filter((t) => t.teza.includes(" / "));
  sprawdz("dokładnie 10 scalonych wpisów", scalone.length === 10);
  sprawdz(
    "żaden scalony wpis nie ma więcej niż jednego ' / ' (brak łańcuchowego scalania)",
    scalone.every((t) => t.teza.split(" / ").length === 2)
  );
}

async function testKategoriaBlokujeScalanie() {
  console.log("\n[3c] scalDoLimitu: różna kategoria blokuje scalanie, nawet przy identycznym tekście (naprawa kosza-na-wszystko)");
  const lista = [
    { id: "a", v: "ten sam tekst", kat: "X" },
    { id: "b", v: "zupełnie inny tekst", kat: "Y" },
    { id: "c", v: "ten sam tekst", kat: "X" },
  ];
  const wynik = await scalDoLimitu(
    lista,
    2,
    (x) => x.v,
    async () => 1, // podobieństwo zawsze maksymalne — bez bloku kategorii scaliłoby się cokolwiek
    async (x, y) => ({ id: x.id, v: `${x.v}+${y.v}`, kat: x.kat, scalony: true }),
    (x, y) => x.kat === y.kat
  );
  sprawdz("dokładnie 2 wpisy (limit osiągnięty)", wynik.length === 2);
  sprawdz("b (kategoria Y, jedyny w swojej kategorii) zostaje nietknięty", wynik.some((w) => w.id === "b"));
  sprawdz("a i c (ta sama kategoria X) scaliły się ze sobą, nie z b", wynik.some((w) => w.v === "ten sam tekst+ten sam tekst"));
}

async function testScalonyChroniPrzedPonownymScaleniem() {
  console.log("\n[3d] scalDoLimitu: wpis raz scalony nie jest kandydatem w KOLEJNYM (osobnym) wywołaniu");
  const pierwszeWywolanie = await scalDoLimitu(
    [
      { id: "a", v: "1" },
      { id: "b", v: "2" },
      { id: "c", v: "3" },
    ],
    2,
    (x) => x.v,
    async () => 1,
    async (x, y) => ({ id: `${x.id}${y.id}`, v: `${x.v}+${y.v}` })
  );
  sprawdz("pierwsze wywołanie: 2 wpisy, jeden scalony", pierwszeWywolanie.length === 2);
  const survivor = pierwszeWywolanie.find((w) => w.scalony);
  sprawdz("survivor ma scalony=true", survivor?.scalony === true);

  // Symulacja kolejnego, niezależnego kroku iteracyjnego: do listy dochodzą
  // dwa nowe tematy, znów trzeba scalić do limitu 2 — bez naprawy survivor
  // (już raz scalony, dłuższy tekst) wygrałby "najbardziej podobny" ponownie.
  const drugieWywolanie = await scalDoLimitu(
    [survivor, { id: "d", v: "4" }, { id: "e", v: "5" }],
    2,
    (x) => x.v,
    async () => 1,
    async (x, y) => ({ id: `${x.id}${y.id}`, v: `${x.v}+${y.v}` })
  );
  sprawdz("drugie wywołanie: 2 wpisy", drugieWywolanie.length === 2);
  sprawdz(
    "survivor z pierwszego wywołania zostaje NIETKNIĘTY (nie brał udziału w drugim scaleniu)",
    drugieWywolanie.some((w) => w.id === survivor.id && w.v === survivor.v)
  );
  sprawdz(
    "d i e scaliły się ze sobą (jedyna dostępna, nie-scalona para)",
    drugieWywolanie.some((w) => w.v === "4+5")
  );
}

async function testProgPodobienstwaBlokujeScalanie() {
  console.log("\n[3e] scalDoLimitu: zbyt niskie podobieństwo nie wymusza scalenia — lista zostaje ponad limitem (fail-open)");
  const wynik = await scalDoLimitu(
    [
      { id: "a", v: "1" },
      { id: "b", v: "2" },
    ],
    1,
    (x) => x.v,
    async () => 0.1, // poniżej PROG_PODOBIENSTWA_SCALENIA
    async (x, y) => ({ id: `${x.id}${y.id}`, v: `${x.v}+${y.v}` })
  );
  sprawdz("lista zostaje niezmieniona (2 wpisy, ponad limit 1)", wynik.length === 2);
}

async function testUdzialForma() {
  console.log("\n[5] udzial_forma — limit 3 przykładów, wystapien liczy dalej");
  const stan = pustyStan();
  stan.udzial_forma.dyskusja = {
    wystapil: true, wystapien: 3,
    przyklady: [
      { opis: "a", sesja: "2025-01-01", kotwica: "..." },
      { opis: "b", sesja: "2025-01-01", kotwica: "..." },
      { opis: "c", sesja: "2025-01-01", kotwica: "..." },
    ],
  };
  const delta = {
    sesja_ma_wypowiedzi: true, tematy: [], spory_nowe: [],
    udzial_forma_zdarzenia: [{ forma: "dyskusja", ile: 2, przyklad: { opis: "d", kotwica: "..." } }],
    mieszkancy_nowi: [], interpelacje_nowe: [], odrzucone_nowe: [],
  };
  const nowy = await applyDelta(stan, delta, ctxBazowy("2025-02-01", "m5"));
  sprawdz("wystapien = 3 + 2 = 5", nowy.udzial_forma.dyskusja.wystapien === 5);
  sprawdz("przyklady nadal 3 (4. odrzucony)", nowy.udzial_forma.dyskusja.przyklady.length === 3);
}

async function testValidateOdrzucaHalucynacje() {
  console.log("\n[6] validateDelta odrzuca zmyślony DOPASOWANIE.id, nie traktuje cicho jako NOWY");
  const stan = pustyStan();
  stan.tematy.push({
    id: "t1", teza: "istniejący temat", zdanie: null, kategoria_obszaru: "ogólne", zasieg: "wzmianka",
    sesje: ["2025-01-01"], wystapien: 1, pierwsza: "2025-01-01", ostatnia: "2025-01-01", kotwica: null, sprawa: null, rola_w_sprawie: null,
  });
  const index = buildShortIndex(stan);
  const surowa = {
    sesja_ma_wypowiedzi: true,
    tematy: [{ decyzja: "DOPASOWANIE", id: "t999-nieistnieje", obserwacja: { wystapien_w_tej_sesji: 1, zasieg_w_tej_sesji: "wzmianka", kotwica: null } }],
    spory_nowe: [], udzial_forma_zdarzenia: [], mieszkancy_nowi: [], interpelacje_nowe: [], odrzucone_nowe: [],
  };
  const wynik = validateDelta(surowa, index);
  sprawdz("odrzucony wpis nie trafia do delta.tematy", wynik.delta.tematy.length === 0);
  sprawdz("ostrzeżenie wygenerowane", wynik.ostrzezenia.length === 1);
}

async function testValidateNiejednoznaczne() {
  console.log("\n[7] validateDelta zbiera NIEJEDNOZNACZNE osobno, nie stosuje automatycznie");
  const stan = pustyStan();
  const index = buildShortIndex(stan);
  const surowa = {
    sesja_ma_wypowiedzi: true,
    tematy: [{ decyzja: "NIEJEDNOZNACZNE", kandydaci: ["t1", "t2"], uzasadnienie: "podobne tezy", dane: { teza: "nowy?", zdanie: null, kategoria_obszaru: "ogólne", zasieg: "wzmianka", kotwica: null, sprawa: null, rola_w_sprawie: null } }],
    spory_nowe: [], udzial_forma_zdarzenia: [], mieszkancy_nowi: [], interpelacje_nowe: [], odrzucone_nowe: [],
  };
  const wynik = validateDelta(surowa, index);
  sprawdz("1 pozycja w niejednoznaczne", wynik.niejednoznaczne.length === 1);
  sprawdz("nic nie trafia do delta.tematy", wynik.delta.tematy.length === 0);
}

function testNextId() {
  console.log("\n[8] nextId nie koliduje przy nieciągłych/dziurawych id");
  sprawdz("pusta lista → t1", nextId("t", []) === "t1");
  sprawdz("dziury w numeracji → kolejny po max", nextId("t", [{ id: "t1" }, { id: "t5" }, { id: "t3" }]) === "t6");
  sprawdz("obce prefiksy ignorowane", nextId("s", [{ id: "t1" }, { id: "s2" }]) === "s3");
}

async function main() {
  await testNowyTemat();
  await testDopasowanie();
  await testLimitTematow();
  await testBrakLancuchowegoScalania();
  await testKategoriaBlokujeScalanie();
  await testScalonyChroniPrzedPonownymScaleniem();
  await testProgPodobienstwaBlokujeScalanie();
  await testLimitSporow();
  await testUdzialForma();
  await testValidateOdrzucaHalucynacje();
  await testValidateNiejednoznaczne();
  testNextId();

  console.log(`\n${liczbaBledow === 0 ? "WSZYSTKIE TESTY PRZESZŁY" : `${liczbaBledow} BŁĘDÓW`}`);
  if (liczbaBledow > 0) process.exit(1);
}

main();
