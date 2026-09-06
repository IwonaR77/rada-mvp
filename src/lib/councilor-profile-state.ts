// Renderowanie notatki o radnym z jego strukturalnego stanu (Etap 2/3 planu
// przyrostowego budowania profilu — zob. prompty/Prompt_Profil_Radnego_*_v2.md).
//
// Model (przez `claude -p`) utrzymuje wyłącznie listę tez i faktów w JSON;
// prozę składa ten plik, deterministycznie, sekcja po sekcji — dzięki temu
// proporcje (która sesja waży ile) i "temat wracający"/"główne obszary" nie
// zależą od tego, którą sesję model widział jako ostatnią podczas iteracji.
//
// Sekcje renderują się jako listy punktowane (jedna teza/forma = jeden
// punkt), nie jako pojedynczy akapit — wersja bez punktorów (do 2026-08-23)
// sklejała 20+ tez jedną spacją w nieczytelny blok tekstu. `teza` (mianownik,
// etykieta) nigdy nie trafia bezpośrednio po czasowniku wymagającym innego
// przypadka — stąd osobne pole `zdanie`: model pisze cały fragment zdania
// (czasownik dobrany do tego, co radny faktycznie zrobił — pytał/sprzeciwił
// się/poparł, nie tylko "mówił o" — razem z poprawnie odmienionym
// dopełnieniem), więc kod nigdy nie syntetyzuje polskiej gramatyki ani nie
// wymusza jednego czasownika na wszystko (to drugie było usterką
// wcześniejszego pola `po_mowil_o`, zawężonego wyłącznie pod "Mówił o ___").

/**
 * `segment_start_time` (sekundy, dogrywane po fakcie w `scripts/lib/profil-
 * eksport.mjs:dograjCzasySegmentow`, nie przez model) — gdy obecne, render
 * linkuje wprost do fragmentu nagrania (`/sesje/[id]?t=...`) zamiast do
 * początku sesji. Może brakować (starsze rewizje sprzed tej funkcji, albo
 * sesje spoza aktualnie wczytanego zakresu) — wtedy link i tak działa,
 * tylko bez doskoku do konkretnego miejsca.
 */
export type Kotwica = { sesja: string; cytat: string | null; segment_start_time?: number | null } | null;

/**
 * Opcje renderu, wszystkie opcjonalne (dane zewnętrzne wobec `ProfileState`,
 * dostarczane przez wywołującego — z bazy w produkcji, z `00-meta.json`
 * w skryptach eksperymentu).
 */
export type RenderOpts = {
  /** Daty ostatnich ~3 przetworzonych sesji — do warstwy świeżości w priorytecie tematów. */
  ostatnieSesje?: string[];
  /** Data sesji (ISO) → `meeting.id`, do zamiany gołych dat w tekście na linki `/sesje/[id]`. */
  datyDoSesji?: Record<string, string>;
  /**
   * `teza.id` → `seq` ostatniej rewizji w historii tego radnego, w której ten
   * temat był jeszcze w warstwie pełnej (top 10). Gdy temat spada do warstwy
   * skróconej, dopisujemy link do tamtej rewizji zamiast po prostu tracić
   * dostęp do jego pełnego opisu.
   */
  historiaPelnychTematow?: Map<string, number>;
  /** `teza.id` tematów całkowicie NOWYCH w ostatnim kroku łańcucha — pogrubione wyróżnienie w renderze. */
  noweTematyIds?: Set<string>;
  /** `teza.id` tematów ZAKTUALIZOWANYCH (nie nowych) w ostatnim kroku łańcucha — wyróżniane w renderze. */
  zmienioneTematyIds?: Set<string>;
};

/**
 * Niewidoczny znacznik na początku wypunktowania zmienionego tematu (Private
 * Use Area, nie pojawi się w realnej treści). `li` w UI wykrywa go, ucina i
 * koloruje cały punkt — bez tego markdown nie ma sposobu przenieść "ten
 * punkt jest nowy" do renderu inaczej niż przez osobny, drobniejszy parser.
 */
export const ZNACZNIK_ZMIANY = "";

/**
 * Jak `ZNACZNIK_ZMIANY`, ale dla tematów całkowicie NOWYCH w ostatnim
 * kroku łańcucha (nie zaktualizowanych) — osobny znacznik PUA, żeby render
 * mógł odróżnić "nowy" (pogrubienie + kolor) od "zaktualizowany" (sam
 * kolor).
 */
export const ZNACZNIK_NOWY = "";

function linkujDate(data: string, mapa?: Record<string, string>, startTime?: number | null): string {
  const id = mapa?.[data];
  if (!id) return data;
  const kotwicaCzasowa = startTime != null ? `?t=${Math.floor(startTime)}` : "";
  return `[${data}](/sesje/${id}${kotwicaCzasowa})`;
}

// `kotwicaSesja`/`kotwicaStart`: gdy jedna z dat na liście odpowiada sesji,
// dla której mamy rozstrzygnięty `segment_start_time` (dosłowny cytat), tylko
// TA data dostaje doskok do konkretnego miejsca w nagraniu — pozostałe
// (radny wracał do tematu bez zapisanego cytatu z tamtej sesji) linkują jak
// dotąd do początku sesji.
function linkujListeDat(
  daty: string[],
  mapa?: Record<string, string>,
  kotwicaSesja?: string,
  kotwicaStart?: number | null
): string {
  return daty.map((d) => linkujDate(d, mapa, d === kotwicaSesja ? kotwicaStart : undefined)).join(", ");
}

export type Zasieg = "wzmianka" | "wypowiedz" | "dyskusja";

export type Temat = {
  id: string;
  teza: string;
  zdanie: string | null;
  kategoria_obszaru: string;
  zasieg: Zasieg | null;
  sesje: string[];
  wystapien: number;
  pierwsza: string;
  ostatnia: string;
  kotwica: Kotwica;
  sprawa: string | null;
  rola_w_sprawie: string | null;
};

export type PrzykladUdzialu = {
  opis: string;
  sesja: string;
  kotwica: string | null;
  kotwica_segment_start_time?: number | null;
};

export type UdzialForma = {
  wystapil: boolean;
  wystapien: number | null;
  przyklady: PrzykladUdzialu[];
};

// Model nie zawsze trzyma się dokładnie schematu (obserwowane: zwykły string
// zamiast obiektu, brakujące klucze) — zamiast liczyć na "undefined" w
// interpolacji, wycinamy wpisy, których nie da się bezpiecznie odczytać.
function bezpiecznyOpisPrzykladu(p: unknown, datyDoSesji?: Record<string, string>): string | null {
  if (p && typeof p === "object" && "opis" in p && "sesja" in p) {
    const { opis, sesja, kotwica_segment_start_time } = p as {
      opis: unknown;
      sesja: unknown;
      kotwica_segment_start_time?: unknown;
    };
    if (typeof opis === "string" && typeof sesja === "string") {
      const czas = typeof kotwica_segment_start_time === "number" ? kotwica_segment_start_time : undefined;
      return `${opis} (${linkujDate(sesja, datyDoSesji, czas)})`;
    }
  }
  if (typeof p === "string") return p;
  return null;
}

export type Mieszkaniec = {
  id: string;
  sesja: string;
  temat: string;
  zrodlo: string;
  kotwica: string;
  kotwica_segment_start_time?: number | null;
};

export type InterpelacjaPowiazana = {
  id: string;
  sesja: string;
  interpelacja: string;
  temat: string;
  kolejnosc: string;
};

export type Spor = {
  id: string;
  sesja: string;
  temat: string;
  stanowiska: string;
  kotwica: string;
  kotwica_segment_start_time?: number | null;
};

export type ProfileState = {
  wersja_stanu: number;
  radny: string;
  kadencja: string;
  sesje_przetworzone: number;
  sesje_z_wypowiedziami: number;
  ostatnia_sesja: { data: string; id: string } | null;
  kategorie_znane: string[];
  grupy_kategorii: Record<string, string[]>;
  tematy: Temat[];
  udzial_forma: {
    odczytanie: UdzialForma;
    formalna: UdzialForma;
    prowadzenie: UdzialForma;
    dyskusja: UdzialForma;
  };
  mieszkancy: Mieszkaniec[];
  interpelacje_powiazane: InterpelacjaPowiazana[];
  spory: Spor[];
  odrzucone: { kategoria: string; teza: string; powod: string; sesja: string }[];
};

const ROLA: Record<string, string> = {
  inicjator: "inicjator",
  poparcie: "z poparciem",
  sprzeciw: "ze sprzeciwem",
  zaangazowany: "zaangażowany",
  zaangażowany: "zaangażowany",
};

// Nowy ma pierwszeństwo nad zaktualizowanym — temat, który dopiero powstał
// w tym kroku, z definicji nie mógł być wcześniej zaktualizowany.
function znacznikDlaTematu(t: Temat, opts: RenderOpts): string {
  if (opts.noweTematyIds?.has(t.id)) return ZNACZNIK_NOWY;
  if (opts.zmienioneTematyIds?.has(t.id)) return ZNACZNIK_ZMIANY;
  return "";
}

// Bez statusu sprawy: sprawa niezatwierdzona jest niewidoczna dla
// użytkownika, więc każda, którą w ogóle widzi, jest zatwierdzona z definicji
// — dopisywanie tego słowa nic nie mówi, tylko sugeruje istnienie innego,
// niewidocznego stanu, którego czytelnik i tak nie ma jak sprawdzić.
// Bez `zdanie` (starszy stan albo model je pominął) cofamy się do etykiety
// w mianowniku, żeby nigdy nie wymusić błędnego przypadka — czytelniej
// "Temat: X" niż gramatycznie zepsute "Mówił o X" (X w mianowniku po "o").
function zdanieOTemacie(t: Temat, opts: RenderOpts): string {
  const daty = linkujListeDat(t.sesje, opts.datyDoSesji, t.kotwica?.sesja, t.kotwica?.segment_start_time);
  const sprawaCzesc = t.sprawa
    ? ` — sprawa „${t.sprawa}" (${ROLA[t.rola_w_sprawie ?? ""] ?? t.rola_w_sprawie ?? "brak roli"})`
    : "";
  const rdzen = t.zdanie ? t.zdanie.charAt(0).toUpperCase() + t.zdanie.slice(1) : `Temat: „${t.teza}"`;
  const znacznik = znacznikDlaTematu(t, opts);
  return `- ${znacznik}${rdzen} (${daty})${sprawaCzesc}.`;
}

// Dice na bigramach znakowych — scentralizowane w src/lib/text-similarity.ts
// (dawniej lokalna kopia tu i w scripts/profil/porownaj-stan.mjs). Tu służy
// do (miękkiego) dopasowania zgłoszenia mieszkańców do tematu bez nowego pola
// łączącego oba wpisy.
import { dice } from "./text-similarity.ts";

/** Wagi `zasieg` do porównań "który wyższy" — eksportowane, bo
 * `councilor-profile-delta.ts` musi egzekwować monotoniczność (zasieg może
 * tylko rosnąć) deterministycznie, tą samą skalą co render. */
export const ZASIEG_WAGA: Record<Zasieg, number> = { wzmianka: 0, wypowiedz: 1, dyskusja: 2 };

// Priorytet renderu — NIE ocena wagi tematu w jakimkolwiek moralnym/
// politycznym sensie, wyłącznie sygnał "ile miejsca dostanie w notatce",
// budowany z sygnałów, które już są w stanie (albo tanie do policzenia z
// niego), żeby model nigdy nie musiał samodzielnie oceniać "co jest ważne
// dla mieszkańców" — dokładnie tego typu osądu ten projekt konsekwentnie
// unika (zob. zakaz przymiotników oceniających w ZASADACH obu promptów).
function priorytetTematu(t: Temat, state: ProfileState, ostatnieSesje: string[]): number {
  let wynik = 0;
  if (t.sprawa) wynik += 2;
  wynik += Math.max(0, t.sesje.length - 1);
  wynik += ZASIEG_WAGA[t.zasieg ?? "wzmianka"] ?? 0;
  const zgloszonyPrzezMieszkancow = state.mieszkancy.some((m) => dice(m.temat, t.teza) >= 0.4);
  if (zgloszonyPrzezMieszkancow) wynik += 2;
  if (ostatnieSesje.length > 0) {
    const najnowsza = ostatnieSesje[ostatnieSesje.length - 1];
    if (t.ostatnia === najnowsza) wynik += 2;
    else if (ostatnieSesje.includes(t.ostatnia)) wynik += 1;
  }
  return wynik;
}

// Ostatnie kilka przetworzonych sesji, do warstwy świeżości w priorytecie.
// Bez jawnej listy (np. z 00-meta.json) przybliżamy ją unią dat obecnych w
// `sesje` wszystkich tematów — działa dobrze przy 20+ tematach (typowy
// przypadek), zawodzi tylko gdyby ostatnie sesje nie miały ŻADNEGO tematu
// (radny w ogóle nie mówił) — wtedy po prostu nie ma czym premiować świeżości,
// co jest neutralnym, bezpiecznym skutkiem, nie błędem.
function przyblizoneOstatnieSesje(state: ProfileState, ile = 3): string[] {
  const wszystkie = new Set<string>();
  for (const t of state.tematy) for (const d of t.sesje) wszystkie.add(d);
  return [...wszystkie].sort().slice(-ile);
}

const LIMIT_PELNYCH = 10;
const LIMIT_SKROCONYCH = 10;

function posortujTematyWgPriorytetu(state: ProfileState, ostatnieSesje?: string[]): Temat[] {
  const sesjeDlaSwiezosci = ostatnieSesje ?? przyblizoneOstatnieSesje(state);
  return [...state.tematy].sort((a, b) => {
    const roznica = priorytetTematu(b, state, sesjeDlaSwiezosci) - priorytetTematu(a, state, sesjeDlaSwiezosci);
    return roznica !== 0 ? roznica : a.pierwsza.localeCompare(b.pierwsza);
  });
}

/**
 * Id tematów, które w tym stanie wylądowałyby w warstwie pełnej (top 10 wg
 * priorytetu) — do budowania historii "gdzie ten temat był ostatnio opisany
 * w pełni" na podstawie kolejnych rewizji (zob. `RenderOpts.
 * historiaPelnychTematow`). Eksportowana osobno od `sekcjaTematy`, bo
 * wywołujący (UI, przy odczycie historii rewizji) potrzebuje tego samego
 * podziału na warstwy bez renderowania całej notatki.
 */
export function idTematowWWarstwiePelnej(state: ProfileState, ostatnieSesje?: string[]): Set<string> {
  return new Set(posortujTematyWgPriorytetu(state, ostatnieSesje).slice(0, LIMIT_PELNYCH).map((t) => t.id));
}

// Krótsza forma dla warstwy "skrócone" — bez czasownika/przypadka (nie
// wymaga `zdanie`) i bez klauzuli sprawy, tylko etykieta + daty. Ten sam
// bezczasownikowy wzorzec, co "Powroty do tematów" niżej.
//
// Gdy temat SPADŁ tutaj z warstwy pełnej we wcześniejszej rewizji (nie
// urodził się od razu jako drugorzędny), dopisujemy link do tamtej rewizji —
// inaczej jego pełny opis staje się bezpowrotnie niedostępny, mimo że kiedyś
// był na profilu w całości.
function zwiezleOTemacie(t: Temat, opts: RenderOpts): string {
  const daty = linkujListeDat(t.sesje, opts.datyDoSesji, t.kotwica?.sesja, t.kotwica?.segment_start_time);
  const seq = opts.historiaPelnychTematow?.get(t.id);
  const link = seq != null ? ` (pełny opis: [wcześniejsza rewizja](#rewizja-${seq}))` : "";
  const znacznik = znacznikDlaTematu(t, opts);
  return `- ${znacznik}„${t.teza}" (${daty})${link}.`;
}

function sekcjaTematy(state: ProfileState, opts: RenderOpts): string {
  if (state.tematy.length === 0) {
    return "Nie zanotowano wypowiedzi tego radnego na sesjach tej kadencji.";
  }
  const posortowane = posortujTematyWgPriorytetu(state, opts.ostatnieSesje);

  const pelne = posortowane.slice(0, LIMIT_PELNYCH);
  const skrocone = posortowane.slice(LIMIT_PELNYCH, LIMIT_PELNYCH + LIMIT_SKROCONYCH);
  const reszta = posortowane.slice(LIMIT_PELNYCH + LIMIT_SKROCONYCH);

  // Kolejność wyświetlania = kolejność priorytetu (bez ponownego sortowania
  // chronologicznego w środku warstwy) — temat, który trafi do konsolidacji
  // najpóźniej, ma stać na górze listy, nie temat najwcześniejszy w czasie.
  //
  // Dwa bloki z osobną rozbiegówką, nie jedna zlepiona lista — bez tego
  // przejście z pełnych zdań ("Mówił o...") na gołe etykiety w drugiej
  // dziesiątce czytało się jak przypadkowy zgrzyt stylu, nie jak celowy
  // podział wg priorytetu.
  const bloki: string[] = [];
  if (pelne.length > 0) {
    bloki.push(
      [
        "Tematy najszerzej poruszane w dotychczasowym materiale:",
        "",
        pelne.map((t) => zdanieOTemacie(t, opts)).join("\n"),
      ].join("\n")
    );
  }
  if (skrocone.length > 0) {
    bloki.push(
      [
        "Tematy poruszone krócej lub rzadziej:",
        "",
        skrocone.map((t) => zwiezleOTemacie(t, opts)).join("\n"),
      ].join("\n")
    );
  }

  let tekst = bloki.join("\n\n");
  if (reszta.length > 0) {
    tekst += `\n\noraz ${reszta.length} innych, drugorzędnych tematów.`;
  }
  return tekst;
}

// `kategoria_obszaru` jest surowa i drobnoziarnista (jeden temat = jedna
// wąska nazwa, nigdy nie nadpisywana po utworzeniu — jak `teza`). Przy 20+
// tematach mnoży się w kilkanaście bliskich znaczeniowo nazw, więc żadna nie
// przekracza progu dominacji, mimo że materiał ma wyraźne skupienia — po
// prostu rozbite na kilka etykiet. `grupy_kategorii` to osobna, aktywnie
// utrzymywana mapa (nazwa szerokiej grupy → lista surowych nazw), którą
// rolujemy tutaj PRZED liczeniem progów. Kategoria nieujęta w żadnej grupie
// (model zapomniał/stan sprzed tej zmiany) staje się swoją własną grupą —
// bezpieczny fallback, nic nie ginie z podsumowania.
function zrolujKategorie(state: ProfileState): Map<string, number> {
  const rawDoGrupy = new Map<string, string>();
  for (const [grupa, rawList] of Object.entries(state.grupy_kategorii ?? {})) {
    for (const raw of rawList) rawDoGrupy.set(raw, grupa);
  }
  const perGrupa = new Map<string, number>();
  for (const t of state.tematy) {
    const grupa = rawDoGrupy.get(t.kategoria_obszaru) ?? t.kategoria_obszaru;
    perGrupa.set(grupa, (perGrupa.get(grupa) ?? 0) + t.wystapien);
  }
  return perGrupa;
}

function topKategoria(perGrupa: Map<string, number>): [string, number] | null {
  if (perGrupa.size === 0) return null;
  return [...perGrupa.entries()].sort((a, b) => b[1] - a[1])[0];
}

// Środek osi czasu dotychczasowego materiału (najwcześniejsza `pierwsza` do
// najpóźniejszej `ostatnia` wśród wszystkich tez) — do rozróżnienia obszarów
// wciąż aktualnych od tych porzuconych we wcześniejszej części kadencji.
// `null`, gdy materiału za mało, żeby cokolwiek o osi czasu powiedzieć.
function polowaOkresu(state: ProfileState): string | null {
  const daty = state.tematy.flatMap((t) => [t.pierwsza, t.ostatnia]).filter(Boolean);
  if (daty.length < 2) return null;
  const min = daty.reduce((a, b) => (a < b ? a : b));
  const max = daty.reduce((a, b) => (a > b ? a : b));
  if (min === max) return null;
  const minMs = new Date(min).getTime();
  const maxMs = new Date(max).getTime();
  if (Number.isNaN(minMs) || Number.isNaN(maxMs)) return null;
  return new Date((minMs + maxMs) / 2).toISOString().slice(0, 10);
}

function sekcjaObszary(state: ProfileState): string {
  if (state.tematy.length === 0) {
    return "Materiał nie zawiera wypowiedzi ani spraw tego radnego — brak podstaw do wskazania obszarów zainteresowania.";
  }
  const total = state.tematy.reduce((sum, t) => sum + t.wystapien, 0);
  if (total < 3) {
    return "Materiał nie dostarcza wystarczających danych, by wskazać główne obszary zainteresowania tego radnego.";
  }
  const perGrupa = zrolujKategorie(state);
  const posortowane = [...perGrupa.entries()].sort((a, b) => b[1] - a[1]);
  const najwiekszyUdzial = posortowane[0][1] / total;

  let glowny: string;
  if (najwiekszyUdzial < 0.2) {
    glowny = "Aktywność radnego obejmuje szerokie spektrum tematów bez wyraźnie dominujących obszarów.";
  } else {
    const top3 = posortowane.slice(0, 3);
    const top3Suma = top3.reduce((s, [, n]) => s + n, 0);
    const linie = top3.map(
      ([kategoria, n]) => `- ${kategoria}: ok. ${Math.round((n / total) * 10) * 10}%`
    );
    if (posortowane.length > 3 && top3Suma < total) {
      const reszta = total - top3Suma;
      linie.push(`- pozostałe tematy: ok. ${Math.round((reszta / total) * 10) * 10}%`);
    }
    glowny = linie.join("\n");
  }

  // Dopisek o przesunięciu w czasie — tylko gdy druga połowa okresu ma
  // wystarczająco materiału (≥3 wystąpień, ten sam próg co wyżej) i wskazuje
  // na INNY główny obszar niż cała historia. Cichy brak dopisku w pozostałych
  // przypadkach — brak przesunięcia to informacja tak samo neutralna jak jego
  // obecność, nie trzeba tego osobno stwierdzać.
  const polowa = polowaOkresu(state);
  if (polowa) {
    const niedawne = state.tematy.filter((t) => t.ostatnia >= polowa);
    const totalNiedawne = niedawne.reduce((s, t) => s + t.wystapien, 0);
    if (totalNiedawne >= 3) {
      const perGrupaNiedawne = zrolujKategorie({ ...state, tematy: niedawne });
      const topNiedawny = topKategoria(perGrupaNiedawne);
      const topCaly = topKategoria(perGrupa);
      if (topNiedawny && topCaly && topNiedawny[0] !== topCaly[0]) {
        glowny += `\n\nW nowszej części dotychczas przetworzonego materiału (od ${polowa}) najwięcej wystąpień ma obszar „${topNiedawny[0]}" — w całości dotychczasowego materiału dominuje „${topCaly[0]}".`;
      }
    }
  }

  return glowny;
}

const FORMA_LABEL: Record<keyof ProfileState["udzial_forma"], string> = {
  odczytanie: "odczytanie dokumentu",
  formalna: "czynność formalna",
  prowadzenie: "prowadzenie obrad",
  dyskusja: "głos w dyskusji",
};

function sekcjaUdzialForma(state: ProfileState, opts: RenderOpts): string {
  const formy = Object.entries(state.udzial_forma) as [
    keyof ProfileState["udzial_forma"],
    UdzialForma,
  ][];
  const obecne = formy.filter(([, f]) => f.wystapil);
  if (obecne.length === 0) {
    return "Brak potwierdzonych wypowiedzi tego radnego w dostarczonym materiale.";
  }
  // `wystapien` to licznik NIEZALEŻNY od `przyklady` (który jest ucięty na 3)
  // — jedyne źródło do policzenia proporcji. Starsze stany (sprzed tego pola)
  // po prostu nie mają go wypełnionego — wtedy cicho pomijamy procent zamiast
  // pokazywać fałszywe wyliczenie z niepełnych danych.
  const total = formy.reduce((s, [, f]) => s + (f.wystapien ?? 0), 0);
  return [...obecne]
    .sort((a, b) => (b[1].wystapien ?? 0) - (a[1].wystapien ?? 0))
    .map(([klucz, f]) => {
      const przyklady = f.przyklady
        .map((p) => bezpiecznyOpisPrzykladu(p, opts.datyDoSesji))
        .filter((x): x is string => x !== null)
        .join("; ");
      const procent =
        total > 0 && f.wystapien != null ? ` (ok. ${Math.round((f.wystapien / total) * 10) * 10}%)` : "";
      return `- ${FORMA_LABEL[klucz]}${procent}${przyklady ? ` — np. ${przyklady}` : ""}.`;
    })
    .join("\n");
}

function sekcjaMieszkancy(state: ProfileState, opts: RenderOpts): string {
  if (state.mieszkancy.length === 0) {
    return "Brak w materiale wypowiedzi, w której radny powołuje się na zgłoszenie mieszkańców.";
  }
  // Najnowsze zgłoszenie na górze — ta sama reguła co przy sporach niżej i
  // wszędzie indziej w serwisie, gdzie lista ma naturalny porządek chronologiczny.
  return [...state.mieszkancy]
    .sort((a, b) => b.sesja.localeCompare(a.sesja))
    .map(
      (m) =>
        `- ${linkujDate(m.sesja, opts.datyDoSesji, m.kotwica_segment_start_time)}: ${m.temat} (zgłaszający: ${m.zrodlo})`
    )
    .join("\n");
}

const KOLEJNOSC_LABEL: Record<string, string> = {
  "dyskusja-potem-interpelacja": "dyskusja na sesji, potem interpelacja",
  "interpelacja-potem-dyskusja": "interpelacja, potem powrót na sesji",
};

function sekcjaPowroty(state: ProfileState, opts: RenderOpts): string {
  // Najnowszy powrót/najnowsza interpelacja na górze w obu podlistach —
  // wg `ostatnia`/`sesja`, ta sama reguła chronologiczna co reszta profilu.
  const wracajace = state.tematy
    .filter((t) => t.sesje.length >= 2)
    .sort((a, b) => b.ostatnia.localeCompare(a.ostatnia));
  const interpelacje = [...state.interpelacje_powiazane].sort((a, b) => b.sesja.localeCompare(a.sesja));
  if (wracajace.length === 0 && interpelacje.length === 0) {
    return "Brak w materiale powrotu do wcześniej poruszonego tematu ani interpelacji nawiązującej do dyskusji na sesji.";
  }
  const linie: string[] = [];
  for (const t of wracajace) {
    linie.push(
      `- temat wracający: „${t.teza}" (${linkujListeDat(t.sesje, opts.datyDoSesji, t.kotwica?.sesja, t.kotwica?.segment_start_time)})`
    );
  }
  for (const i of interpelacje) {
    // Data interpelacji celowo NIE jest linkiem do sesji — interpelacja to
    // osobny rekord (`interpellation`), nie posiedzenie, nie ma meeting.id.
    linie.push(
      `- interpelacja po dyskusji: ${i.temat} — sesja ${linkujDate(i.sesja, opts.datyDoSesji)}, interpelacja ${i.interpelacja} (${KOLEJNOSC_LABEL[i.kolejnosc] ?? i.kolejnosc})`
    );
  }
  return linie.join("\n");
}

function sekcjaSpory(state: ProfileState, opts: RenderOpts): string {
  if (state.spory.length === 0) {
    return "Nie zanotowano sporów z udziałem tego radnego w tej kadencji.";
  }
  // Najnowszy spór na górze (jak w pozostałych widokach chronologicznych),
  // mimo że w `state.spory` trzymamy kolejność dodawania (sesja po sesji).
  return [...state.spory]
    .sort((a, b) => b.sesja.localeCompare(a.sesja))
    .map(
      (s) =>
        `- ${linkujDate(s.sesja, opts.datyDoSesji, s.kotwica_segment_start_time)}: ${s.temat} — ${s.stanowiska}`
    )
    .join("\n");
}

// `ostatnia_sesja` istnieje w schemacie stanu od promptu v7 (zawsze
// ustawiane przy każdej aktualizacji — zob. Prompt_Profil_Radnego_
// Iteracyjny_v7.md, "REGUŁY AKTUALIZACJI"), ale starsze rewizje sprzed tej
// wersji promptu mogą go nie mieć — stąd `null`-check zamiast założenia, że
// pole zawsze istnieje. Rewizje bez tego pola po prostu nie dostają tej
// linijki; gdy taki radny doczeka się kolejnej rewizji (nowy prompt), pole
// się pojawi i linijka wyrenderuje się sama, bez ręcznej ingerencji w bazę.
// `state.ostatnia_sesja.id` NIE jest wiarygodnym meeting.id — model dostaje w
// promptcie `identyfikator: meeting.esesja_id ?? meeting.source_id ?? meeting.id`
// (zob. scripts/lib/profil-eksport.mjs) i zwykle odbija ten identyfikator
// esesja, a trasa `/sesje/[id]` oczekuje prawdziwego meeting.id z bazy — stąd
// link przez surowe `id` z modelu kończył się 404-ką. Tak jak wszystkie inne
// linki w tym pliku, rozwiązujemy datę przez `datyDoSesji` (data → realne
// meeting.id z bazy), ignorując `id` zwrócone przez model.
function sekcjaZakresSesji(state: ProfileState, opts: RenderOpts): string | null {
  if (!state.ostatnia_sesja) return null;
  const { data } = state.ostatnia_sesja;
  return `_Opis uwzględnia wypowiedzi radnego do sesji z dnia ${linkujDate(data, opts.datyDoSesji)} włącznie._`;
}

/**
 * Renderuje pełną notatkę Markdown ze stanu — jedyne miejsce, gdzie stan
 * staje się prozą.
 *
 * `opts` (wszystkie pola opcjonalne, zob. `RenderOpts`) — dane zewnętrzne
 * wobec `state`, których wywołujący nie musi mieć: świeżość sesji, mapa
 * dat na `meeting.id` (do linków `/sesje/[id]`) i historia rewizji (do
 * linków "pełny opis" przy tematach, które spadły do warstwy skróconej).
 * Bez nich renderProfile nadal działa poprawnie — po prostu bez linków.
 */
export function renderProfile(state: ProfileState, opts: RenderOpts = {}): string {
  const zakresSesji = sekcjaZakresSesji(state, opts);
  return [
    ...(zakresSesji ? [zakresSesji, ""] : []),
    "**Tematy wypowiedzi na sesjach:**",
    "",
    sekcjaTematy(state, opts),
    "",
    "**Główne obszary zainteresowania:**",
    "",
    sekcjaObszary(state),
    "",
    "**Rodzaj udziału w obradach:**",
    "",
    sekcjaUdzialForma(state, opts),
    "",
    "**Powołania na sprawy mieszkańców:**",
    "",
    sekcjaMieszkancy(state, opts),
    "",
    "**Powroty do tematów i ciąg dalszy poza sesją:**",
    "",
    sekcjaPowroty(state, opts),
    "",
    "**Spory z udziałem radnego:**",
    "",
    sekcjaSpory(state, opts),
  ].join("\n");
}

export type DiffResult = {
  nowe: Temat[];
  zmienione: { id: string; przed: Temat; po: Temat }[];
  usuniete: { id: string; teza: string; powod: string }[];
};

/** Porównuje dwa stany po `id` tez — dla paska zmian "+N nowe · M zaktualizowane · K wycofanych". */
export function diffStates(prev: ProfileState | null, next: ProfileState): DiffResult {
  const prevById = new Map((prev?.tematy ?? []).map((t) => [t.id, t]));
  const nowe: Temat[] = [];
  const zmienione: DiffResult["zmienione"] = [];
  for (const t of next.tematy) {
    const wczesniej = prevById.get(t.id);
    if (!wczesniej) {
      nowe.push(t);
    } else if (JSON.stringify(wczesniej) !== JSON.stringify(t)) {
      zmienione.push({ id: t.id, przed: wczesniej, po: t });
    }
  }
  const usuniete = next.odrzucone
    .filter((o) => o.kategoria === "temat")
    .map((o) => ({ id: o.teza, teza: o.teza, powod: o.powod }));
  return { nowe, zmienione, usuniete };
}
