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

export type Kotwica = { sesja: string; cytat: string | null } | null;

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

export type PrzykladUdzialu = { opis: string; sesja: string; kotwica: string | null };

export type UdzialForma = {
  wystapil: boolean;
  wystapien: number | null;
  przyklady: PrzykladUdzialu[];
};

// Model nie zawsze trzyma się dokładnie schematu (obserwowane: zwykły string
// zamiast obiektu, brakujące klucze) — zamiast liczyć na "undefined" w
// interpolacji, wycinamy wpisy, których nie da się bezpiecznie odczytać.
function bezpiecznyOpisPrzykladu(p: unknown): string | null {
  if (p && typeof p === "object" && "opis" in p && "sesja" in p) {
    const { opis, sesja } = p as { opis: unknown; sesja: unknown };
    if (typeof opis === "string" && typeof sesja === "string") return `${opis} (${sesja})`;
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

// Bez statusu sprawy: sprawa niezatwierdzona jest niewidoczna dla
// użytkownika, więc każda, którą w ogóle widzi, jest zatwierdzona z definicji
// — dopisywanie tego słowa nic nie mówi, tylko sugeruje istnienie innego,
// niewidocznego stanu, którego czytelnik i tak nie ma jak sprawdzić.
// Bez `zdanie` (starszy stan albo model je pominął) cofamy się do etykiety
// w mianowniku, żeby nigdy nie wymusić błędnego przypadka — czytelniej
// "Temat: X" niż gramatycznie zepsute "Mówił o X" (X w mianowniku po "o").
function zdanieOTemacie(t: Temat): string {
  const daty = t.sesje.length > 1 ? t.sesje.join(", ") : t.sesje[0];
  const sprawaCzesc = t.sprawa
    ? ` — sprawa „${t.sprawa}" (${ROLA[t.rola_w_sprawie ?? ""] ?? t.rola_w_sprawie ?? "brak roli"})`
    : "";
  const rdzen = t.zdanie ? t.zdanie.charAt(0).toUpperCase() + t.zdanie.slice(1) : `Temat: „${t.teza}"`;
  return `- ${rdzen} (${daty})${sprawaCzesc}.`;
}

// Bigramowe podobieństwo (Dice) — lokalna kopia tej samej miary, co w
// scripts/profil/porownaj-stan.mjs. Tu służy do (miękkiego) dopasowania
// zgłoszenia mieszkańców do tematu bez nowego pola łączącego oba wpisy —
// ten sam kompromis, którym świadomie pominęliśmy analogiczne pole dla
// sporów (koszt osobnej infrastruktury nieuzasadniony przy garstce trafień).
function bigramy(tekst: string): Set<string> {
  const znorm = tekst.toLocaleLowerCase("pl-PL").replace(/\s+/g, " ").trim();
  const zestaw = new Set<string>();
  for (let i = 0; i < znorm.length - 1; i++) zestaw.add(znorm.slice(i, i + 2));
  return zestaw;
}

function dice(a: string, b: string): number {
  const ba = bigramy(a);
  const bb = bigramy(b);
  if (ba.size === 0 || bb.size === 0) return 0;
  let wspolne = 0;
  for (const x of ba) if (bb.has(x)) wspolne++;
  return (2 * wspolne) / (ba.size + bb.size);
}

const ZASIEG_WAGA: Record<Zasieg, number> = { wzmianka: 0, wypowiedz: 1, dyskusja: 2 };

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

// Krótsza forma dla warstwy "skrócone" — bez czasownika/przypadka (nie
// wymaga `zdanie`) i bez klauzuli sprawy, tylko etykieta + daty. Ten sam
// bezczasownikowy wzorzec, co "Powroty do tematów" niżej.
function zwiezleOTemacie(t: Temat): string {
  const daty = t.sesje.length > 1 ? t.sesje.join(", ") : t.sesje[0];
  return `- „${t.teza}" (${daty}).`;
}

function sekcjaTematy(state: ProfileState, ostatnieSesje?: string[]): string {
  if (state.tematy.length === 0) {
    return "Nie zanotowano wypowiedzi tego radnego na sesjach tej kadencji.";
  }
  const sesjeDlaSwiezosci = ostatnieSesje ?? przyblizoneOstatnieSesje(state);

  const posortowane = [...state.tematy].sort((a, b) => {
    const roznica = priorytetTematu(b, state, sesjeDlaSwiezosci) - priorytetTematu(a, state, sesjeDlaSwiezosci);
    return roznica !== 0 ? roznica : a.pierwsza.localeCompare(b.pierwsza);
  });

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
      ["Tematy najszerzej poruszane w dotychczasowym materiale:", "", pelne.map(zdanieOTemacie).join("\n")].join("\n")
    );
  }
  if (skrocone.length > 0) {
    bloki.push(
      ["Tematy poruszone krócej lub rzadziej:", "", skrocone.map(zwiezleOTemacie).join("\n")].join("\n")
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
  formalna: "czynność formalna / prowadzenie obrad",
  dyskusja: "głos w dyskusji",
};

function sekcjaUdzialForma(state: ProfileState): string {
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
        .map(bezpiecznyOpisPrzykladu)
        .filter((x): x is string => x !== null)
        .join("; ");
      const procent =
        total > 0 && f.wystapien != null ? ` (ok. ${Math.round((f.wystapien / total) * 10) * 10}%)` : "";
      return `- ${FORMA_LABEL[klucz]}${procent}${przyklady ? ` — np. ${przyklady}` : ""}.`;
    })
    .join("\n");
}

function sekcjaMieszkancy(state: ProfileState): string {
  if (state.mieszkancy.length === 0) {
    return "Brak w materiale wypowiedzi, w której radny powołuje się na zgłoszenie mieszkańców.";
  }
  return state.mieszkancy
    .map((m) => `- ${m.sesja}: ${m.temat} (zgłaszający: ${m.zrodlo})`)
    .join("\n");
}

const KOLEJNOSC_LABEL: Record<string, string> = {
  "dyskusja-potem-interpelacja": "dyskusja na sesji, potem interpelacja",
  "interpelacja-potem-dyskusja": "interpelacja, potem powrót na sesji",
};

function sekcjaPowroty(state: ProfileState): string {
  const wracajace = state.tematy.filter((t) => t.sesje.length >= 2);
  if (wracajace.length === 0 && state.interpelacje_powiazane.length === 0) {
    return "Brak w materiale powrotu do wcześniej poruszonego tematu ani interpelacji nawiązującej do dyskusji na sesji.";
  }
  const linie: string[] = [];
  for (const t of wracajace) {
    linie.push(`- temat wracający: „${t.teza}" (${t.sesje.join(", ")})`);
  }
  for (const i of state.interpelacje_powiazane) {
    linie.push(
      `- interpelacja po dyskusji: ${i.temat} — sesja ${i.sesja}, interpelacja ${i.interpelacja} (${KOLEJNOSC_LABEL[i.kolejnosc] ?? i.kolejnosc})`
    );
  }
  return linie.join("\n");
}

function sekcjaSpory(state: ProfileState): string {
  if (state.spory.length === 0) {
    return "Nie zanotowano sporów z udziałem tego radnego w tej kadencji.";
  }
  return state.spory
    .map((s) => `- ${s.sesja}: ${s.temat} — ${s.stanowiska}`)
    .join("\n");
}

/**
 * Renderuje pełną notatkę Markdown ze stanu — jedyne miejsce, gdzie stan
 * staje się prozą.
 *
 * `ostatnieSesje` (opcjonalne) — daty ostatnich ~3 przetworzonych sesji tego
 * radnego, do warstwy świeżości w priorytecie tematów. Gdy wywołujący ma
 * pełną listę sesji (np. z `00-meta.json` w skryptach eksperymentu, docelowo
 * z zapytania do bazy) — powinien ją podać, to dokładniejsze niż wewnętrzne
 * przybliżenie z samych dat w `tematy`.
 */
export function renderProfile(state: ProfileState, ostatnieSesje?: string[]): string {
  return [
    "**Tematy wypowiedzi na sesjach:**",
    "",
    sekcjaTematy(state, ostatnieSesje),
    "",
    "**Główne obszary zainteresowania:**",
    "",
    sekcjaObszary(state),
    "",
    "**Rodzaj udziału w obradach:**",
    "",
    sekcjaUdzialForma(state),
    "",
    "**Powołania na sprawy mieszkańców:**",
    "",
    sekcjaMieszkancy(state),
    "",
    "**Powroty do tematów i ciąg dalszy poza sesją:**",
    "",
    sekcjaPowroty(state),
    "",
    "**Spory z udziałem radnego:**",
    "",
    sekcjaSpory(state),
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
