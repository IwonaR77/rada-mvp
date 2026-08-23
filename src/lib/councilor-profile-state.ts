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
// przypadka — stąd osobne pole `po_mowil_o` (miejscownik, pisane przez model
// specjalnie pod zdanie "Mówił o ___"), żeby kod nie musiał syntetyzować
// polskiej gramatyki samodzielnie.

export type Kotwica = { sesja: string; cytat: string | null } | null;

export type Temat = {
  id: string;
  teza: string;
  po_mowil_o: string | null;
  kategoria_obszaru: string;
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
// Bez `po_mowil_o` (starszy stan albo model go pominął) cofamy się do
// etykiety w mianowniku, żeby nigdy nie wymusić błędnego przypadka po "o" —
// czytelniej "Temat: X" niż gramatycznie zepsute "Mówił o X".
function zdanieOTemacie(t: Temat): string {
  const daty = t.sesje.length > 1 ? t.sesje.join(", ") : t.sesje[0];
  const sprawaCzesc = t.sprawa
    ? ` — sprawa „${t.sprawa}" (${ROLA[t.rola_w_sprawie ?? ""] ?? t.rola_w_sprawie ?? "brak roli"})`
    : "";
  const rdzen = t.po_mowil_o ? `Mówił o ${t.po_mowil_o}` : `Temat: „${t.teza}"`;
  return `- ${rdzen} (${daty})${sprawaCzesc}.`;
}

function sekcjaTematy(state: ProfileState): string {
  if (state.tematy.length === 0) {
    return "Nie zanotowano wypowiedzi tego radnego na sesjach tej kadencji.";
  }
  return [...state.tematy]
    .sort((a, b) => a.pierwsza.localeCompare(b.pierwsza))
    .map(zdanieOTemacie)
    .join("\n");
}

function sekcjaObszary(state: ProfileState): string {
  if (state.tematy.length === 0) {
    return "Materiał nie zawiera wypowiedzi ani spraw tego radnego — brak podstaw do wskazania obszarów zainteresowania.";
  }
  const total = state.tematy.reduce((sum, t) => sum + t.wystapien, 0);
  if (total < 3) {
    return "Materiał nie dostarcza wystarczających danych, by wskazać główne obszary zainteresowania tego radnego.";
  }
  const perKategoria = new Map<string, number>();
  for (const t of state.tematy) {
    perKategoria.set(t.kategoria_obszaru, (perKategoria.get(t.kategoria_obszaru) ?? 0) + t.wystapien);
  }
  const posortowane = [...perKategoria.entries()].sort((a, b) => b[1] - a[1]);
  const najwiekszyUdzial = posortowane[0][1] / total;
  if (najwiekszyUdzial < 0.2) {
    return "Aktywność radnego obejmuje szerokie spektrum tematów bez wyraźnie dominujących obszarów.";
  }
  const top3 = posortowane.slice(0, 3);
  const top3Suma = top3.reduce((s, [, n]) => s + n, 0);
  const linie = top3.map(
    ([kategoria, n]) => `- ${kategoria}: ok. ${Math.round((n / total) * 10) * 10}%`
  );
  if (posortowane.length > 3 && top3Suma < total) {
    const reszta = total - top3Suma;
    linie.push(`- pozostałe tematy: ok. ${Math.round((reszta / total) * 10) * 10}%`);
  }
  return linie.join("\n");
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
  return obecne
    .map(([klucz, f]) => {
      const przyklady = f.przyklady
        .map(bezpiecznyOpisPrzykladu)
        .filter((x): x is string => x !== null)
        .join("; ");
      return `- ${FORMA_LABEL[klucz]}${przyklady ? ` — np. ${przyklady}` : ""}.`;
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

/** Renderuje pełną notatkę Markdown ze stanu — jedyne miejsce, gdzie stan staje się prozą. */
export function renderProfile(state: ProfileState): string {
  return [
    "**Tematy wypowiedzi na sesjach:**",
    "",
    sekcjaTematy(state),
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
