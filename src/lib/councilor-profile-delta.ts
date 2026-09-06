// Delta zwracana przez model w kroku iteracyjnym (Prompt_Profil_Radnego_
// Iteracyjny_v8.md) + deterministyczne stosowanie jej do pełnego stanu.
//
// Zastępuje `REGUŁY AKTUALIZACJI` z promptu v7 (scalanie, liczniki, limit 40
// tematów — dotąd egzekwowane wyłącznie tekstem promptu, model go czasem
// ignorował) kodem: model decyduje tylko o TREŚCI (nowy temat? to samo co
// T17? niejednoznaczne?), kod liczy, scala i pilnuje limitów.
//
// `spory` świadomie NIE dostają decyzji NOWY/DOPASOWANIE/NIEJEDNOZNACZNE —
// dzisiejsza reguła to czyste dopisywanie ("nowy wpis na każdy spór z tej
// sesji"), więc jedyna brakująca reguła to limit (dziś: żaden). Dodanie
// dopasowania wymagałoby nadpisywania jedynej `kotwica`/`sesja` na `Spor`
// (utrata wcześniejszego cytatu) albo zmiany jego kształtu na listę sesji —
// żadne nie jest potrzebne do zamknięcia faktycznej luki (brak limitu).

import type { Kotwica, ProfileState, Spor, Temat, Zasieg } from "./councilor-profile-state.ts";
import { ZASIEG_WAGA } from "./councilor-profile-state.ts";
import type { ShortIndex } from "./councilor-profile-index.ts";
import { dice } from "./text-similarity.ts";

export const LIMIT_TEMATOW = 40;
export const LIMIT_SPOROW = 30;
const MAX_DL_KOTWICY = 120;

export type NowyTemat = {
  teza: string;
  zdanie: string | null;
  kategoria_obszaru: string;
  zasieg: Zasieg;
  kotwica: Kotwica;
  sprawa: string | null;
  rola_w_sprawie: string | null;
};

/** Co model zaobserwował TYLKO w tej sesji dla tematu, który już istnieje —
 * celowo bez `teza`/`zdanie`/`kategoria_obszaru`/`sprawa`/`rola_w_sprawie`,
 * żeby nie dało się ich przypadkiem nadpisać (te pola są zamrożone po
 * utworzeniu tematu, jak w promptcie v7). */
export type ObserwacjaTematu = {
  wystapien_w_tej_sesji: number;
  zasieg_w_tej_sesji: Zasieg;
  kotwica: Kotwica;
};

export type DecyzjaTemat =
  | { decyzja: "NOWY"; dane: NowyTemat }
  | { decyzja: "DOPASOWANIE"; id: string; obserwacja: ObserwacjaTematu }
  | { decyzja: "NIEJEDNOZNACZNE"; kandydaci: string[]; uzasadnienie: string; dane: NowyTemat };

export type NowySpor = { temat: string; stanowiska: string; kotwica: string };

export type UdzialFormaZdarzenie = {
  forma: keyof ProfileState["udzial_forma"];
  ile: number;
  przyklad?: { opis: string; kotwica: string } | null;
};

export type ProfileDelta = {
  sesja_ma_wypowiedzi: boolean;
  tematy: DecyzjaTemat[];
  spory_nowe: NowySpor[];
  udzial_forma_zdarzenia: UdzialFormaZdarzenie[];
  mieszkancy_nowi: { temat: string; zrodlo: string; kotwica: string }[];
  interpelacje_nowe: { interpelacja: string; temat: string; kolejnosc: string }[];
  odrzucone_nowe: { kategoria: string; teza: string; powod: string }[];
  /** Opcjonalne pełne zastąpienie mapy grup — model nadal aktywnie porządkuje
   * tę warstwę prezentacyjną co sesję, jak w v7; brak pola = bez zmian. */
  grupy_kategorii_zmiany?: Record<string, string[]>;
};

type TezaDoScalenia = { teza: string; zdanie: string | null };
type SporDoScalenia = { temat: string; stanowiska: string };

export type ApplyDeltaCtx = {
  sesjaData: string;
  meetingId: string;
  /** Mikro-wywołanie LLM tylko o te dwa tematy (nie cały stan) — wywoływane
   * jedynie przy przekroczeniu LIMIT_TEMATOW, rzadko. Zachowuje jakość prozy
   * scalonej tezy zamiast mechanicznej konkatenacji (wybór użytkowniczki). */
  generujWspolnaTeze: (a: TezaDoScalenia, b: TezaDoScalenia) => Promise<TezaDoScalenia>;
  /** Analogicznie dla `spory` przy przekroczeniu LIMIT_SPOROW. */
  generujWspolnySpor: (a: SporDoScalenia, b: SporDoScalenia) => Promise<SporDoScalenia>;
};

/** `prefix + (max istniejący numer + 1)` — id nadaje wyłącznie kod, nigdy
 * model, więc nie ma ryzyka kolizji między krokami. Eksportowana też dla
 * skryptu jednorazowej migracji (na wypadek potrzeby renumeracji). */
export function nextId(prefix: string, existing: { id: string }[]): string {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const item of existing) {
    const m = re.exec(item.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

function dodajKategorieDoGrupy(state: ProfileState, kategoria: string): void {
  if (!state.kategorie_znane.includes(kategoria)) state.kategorie_znane.push(kategoria);
  const jestWGrupie = Object.values(state.grupy_kategorii).some((lista) => lista.includes(kategoria));
  if (!jestWGrupie) state.grupy_kategorii[kategoria] = [kategoria];
}

/**
 * Redukuje listę do `limit` przez dobór ZACHŁANNY NIEROZŁĄCZNYCH par do
 * scalenia na jednej, oryginalnej liście (każdy element bierze udział
 * najwyżej w jednym scaleniu w tym wywołaniu) — nie przez "znajdź najbardziej
 * podobną parę, scal, powtórz na już zmienionej liście".
 *
 * Ten drugi, prostszy wariant miał realny błąd, zaobserwowany na Kozłowskiej
 * (2026-09-06, pierwszy prawdziwy krok v8): scalony wpis ma dłuższy tekst niż
 * każdy z osobna, więc podobieństwo bigramowe (Dice) do KOLEJNEGO kandydata
 * rośnie sztucznie wraz z długością tekstu — dłuższy tekst ma więcej
 * bigramów, więc łatwiej o przypadkowe trafienie z czymkolwiek. Efekt:
 * jeden wpis wchłonął w jednym wywołaniu kolejno 13 niepowiązanych tematów,
 * dając jeden temat mieszający zadłużenie gminy, oświatę i media
 * społecznościowe pod wspólną etykietą. Wariant nierozłączny ogranicza
 * szkodę do jednego scalenia na element w jednym wywołaniu — kolejne
 * scalenia tego samego wpisu (jeśli w ogóle potrzebne) czekają do
 * następnego wywołania, na świeżo policzonym podobieństwie.
 */
async function scalDoLimitu<T extends { id: string }>(
  lista: T[],
  limit: number,
  kluczPodobienstwa: (item: T) => string,
  scal: (a: T, b: T) => Promise<T>
): Promise<T[]> {
  const nadmiar = lista.length - limit;
  if (nadmiar <= 0) return lista;

  const pary: { i: number; j: number; wynik: number }[] = [];
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      pary.push({ i, j, wynik: dice(kluczPodobienstwa(lista[i]), kluczPodobienstwa(lista[j])) });
    }
  }
  pary.sort((a, b) => b.wynik - a.wynik);

  const uzyte = new Set<number>();
  const doScalenia: { i: number; j: number }[] = [];
  for (const p of pary) {
    if (doScalenia.length >= nadmiar) break;
    if (uzyte.has(p.i) || uzyte.has(p.j)) continue;
    uzyte.add(p.i);
    uzyte.add(p.j);
    doScalenia.push(p);
  }

  const scalone: T[] = [];
  for (const { i, j } of doScalenia) {
    scalone.push(await scal(lista[i], lista[j]));
  }
  const nietkniete = lista.filter((_, idx) => !uzyte.has(idx));
  return [...nietkniete, ...scalone];
}

function scalTematy(ctx: Pick<ApplyDeltaCtx, "generujWspolnaTeze">) {
  return async (a: Temat, b: Temat): Promise<Temat> => {
    const { teza, zdanie } = await ctx.generujWspolnaTeze(
      { teza: a.teza, zdanie: a.zdanie },
      { teza: b.teza, zdanie: b.zdanie }
    );
    const nowszy = a.ostatnia >= b.ostatnia ? a : b;
    return {
      id: a.id,
      teza,
      zdanie,
      kategoria_obszaru: a.kategoria_obszaru,
      zasieg:
        ZASIEG_WAGA[a.zasieg ?? "wzmianka"] >= ZASIEG_WAGA[b.zasieg ?? "wzmianka"] ? a.zasieg : b.zasieg,
      sesje: [...new Set([...a.sesje, ...b.sesje])].sort(),
      wystapien: a.wystapien + b.wystapien,
      pierwsza: a.pierwsza < b.pierwsza ? a.pierwsza : b.pierwsza,
      ostatnia: a.ostatnia > b.ostatnia ? a.ostatnia : b.ostatnia,
      kotwica: nowszy.kotwica,
      sprawa: a.sprawa ?? b.sprawa,
      rola_w_sprawie: a.rola_w_sprawie ?? b.rola_w_sprawie,
    };
  };
}

function scalSpory(ctx: Pick<ApplyDeltaCtx, "generujWspolnySpor">) {
  return async (a: Spor, b: Spor): Promise<Spor> => {
    const { temat, stanowiska } = await ctx.generujWspolnySpor(
      { temat: a.temat, stanowiska: a.stanowiska },
      { temat: b.temat, stanowiska: b.stanowiska }
    );
    const nowszy = a.sesja >= b.sesja ? a : b;
    return {
      id: a.id,
      sesja: nowszy.sesja,
      temat,
      stanowiska,
      kotwica: nowszy.kotwica,
      kotwica_segment_start_time: nowszy.kotwica_segment_start_time,
    };
  };
}

/**
 * Stosuje deltę do pełnego stanu, deterministycznie — jedyne miejsce, gdzie
 * `ProfileState` się zmienia. Wywoływać wyłącznie po `validateDelta` z
 * `niejednoznaczne.length === 0` (w przeciwnym razie rzuca — patrz niżej).
 */
export async function applyDelta(
  state: ProfileState,
  delta: ProfileDelta,
  ctx: ApplyDeltaCtx
): Promise<ProfileState> {
  const next: ProfileState = structuredClone(state);

  next.sesje_przetworzone += 1;
  next.ostatnia_sesja = { data: ctx.sesjaData, id: ctx.meetingId };
  if (delta.sesja_ma_wypowiedzi) next.sesje_z_wypowiedziami += 1;

  if (delta.grupy_kategorii_zmiany) next.grupy_kategorii = delta.grupy_kategorii_zmiany;

  for (const d of delta.tematy) {
    if (d.decyzja === "NIEJEDNOZNACZNE") {
      throw new Error(
        "applyDelta: delta zawiera NIEJEDNOZNACZNE — validateDelta powinno było zablokować cały krok przed wywołaniem applyDelta."
      );
    }
    if (d.decyzja === "NOWY") {
      const nowy: Temat = {
        id: nextId("t", next.tematy),
        teza: d.dane.teza,
        zdanie: d.dane.zdanie,
        kategoria_obszaru: d.dane.kategoria_obszaru,
        zasieg: d.dane.zasieg,
        sesje: [ctx.sesjaData],
        wystapien: 1,
        pierwsza: ctx.sesjaData,
        ostatnia: ctx.sesjaData,
        kotwica: d.dane.kotwica,
        sprawa: d.dane.sprawa,
        rola_w_sprawie: d.dane.rola_w_sprawie,
      };
      next.tematy.push(nowy);
      dodajKategorieDoGrupy(next, d.dane.kategoria_obszaru);
      continue;
    }
    // DOPASOWANIE
    const temat = next.tematy.find((t) => t.id === d.id);
    if (!temat) {
      throw new Error(
        `applyDelta: DOPASOWANIE na nieistniejące id "${d.id}" — validateDelta powinno było odrzucić ten wpis wcześniej.`
      );
    }
    if (!temat.sesje.includes(ctx.sesjaData)) temat.sesje.push(ctx.sesjaData);
    temat.wystapien += d.obserwacja.wystapien_w_tej_sesji;
    temat.ostatnia = ctx.sesjaData;
    const obecnaWaga = ZASIEG_WAGA[temat.zasieg ?? "wzmianka"];
    const nowaWaga = ZASIEG_WAGA[d.obserwacja.zasieg_w_tej_sesji];
    if (nowaWaga > obecnaWaga) temat.zasieg = d.obserwacja.zasieg_w_tej_sesji;
    if (d.obserwacja.kotwica) temat.kotwica = d.obserwacja.kotwica;
    // `teza`/`zdanie`/`kategoria_obszaru`/`sprawa`/`rola_w_sprawie` celowo
    // nietknięte — `ObserwacjaTematu` w ogóle nie ma tych pól.
  }

  while (next.tematy.length > LIMIT_TEMATOW) {
    const przed = next.tematy.length;
    next.tematy = await scalDoLimitu(next.tematy, LIMIT_TEMATOW, (t) => t.teza, scalTematy(ctx));
    if (next.tematy.length === przed) break; // bezpiecznik: brak dostępnych par (nie powinno wystąpić przy limit>=2)
  }

  for (const s of delta.spory_nowe) {
    next.spory.push({
      id: nextId("s", next.spory),
      sesja: ctx.sesjaData,
      temat: s.temat,
      stanowiska: s.stanowiska,
      kotwica: s.kotwica,
    });
  }
  while (next.spory.length > LIMIT_SPOROW) {
    const przed = next.spory.length;
    next.spory = await scalDoLimitu(next.spory, LIMIT_SPOROW, (s) => s.temat, scalSpory(ctx));
    if (next.spory.length === przed) break;
  }

  for (const zdarzenie of delta.udzial_forma_zdarzenia) {
    const forma = next.udzial_forma[zdarzenie.forma];
    forma.wystapil = true;
    forma.wystapien = (forma.wystapien ?? 0) + zdarzenie.ile;
    if (zdarzenie.przyklad && forma.przyklady.length < 3) {
      forma.przyklady.push({ opis: zdarzenie.przyklad.opis, sesja: ctx.sesjaData, kotwica: zdarzenie.przyklad.kotwica });
    }
  }

  for (const m of delta.mieszkancy_nowi) {
    next.mieszkancy.push({ id: nextId("m", next.mieszkancy), sesja: ctx.sesjaData, temat: m.temat, zrodlo: m.zrodlo, kotwica: m.kotwica });
  }
  for (const i of delta.interpelacje_nowe) {
    next.interpelacje_powiazane.push({
      id: nextId("i", next.interpelacje_powiazane),
      sesja: ctx.sesjaData,
      interpelacja: i.interpelacja,
      temat: i.temat,
      kolejnosc: i.kolejnosc,
    });
  }
  for (const o of delta.odrzucone_nowe) {
    next.odrzucone.push({ kategoria: o.kategoria, teza: o.teza, powod: o.powod, sesja: ctx.sesjaData });
  }

  return next;
}

/**
 * Egzekwuje limity `tematy`/`spory` bez żadnej innej zmiany stanu (nie
 * dotyka `sesje_przetworzone`/`ostatnia_sesja`/liczników) — do jednorazowej
 * migracji (scripts/profil/migracja-jednorazowa-v8.mjs) naprawiającej
 * istniejące rewizje sprzed wprowadzenia limitu `spory`, oraz do testów.
 * Poza kontekstem migracji `applyDelta` i tak egzekwuje oba limity sam.
 */
export async function wymusLimity(
  state: ProfileState,
  ctx: Pick<ApplyDeltaCtx, "generujWspolnaTeze" | "generujWspolnySpor">
): Promise<ProfileState> {
  const next: ProfileState = structuredClone(state);
  while (next.tematy.length > LIMIT_TEMATOW) {
    const przed = next.tematy.length;
    next.tematy = await scalDoLimitu(next.tematy, LIMIT_TEMATOW, (t) => t.teza, scalTematy(ctx));
    if (next.tematy.length === przed) break;
  }
  while (next.spory.length > LIMIT_SPOROW) {
    const przed = next.spory.length;
    next.spory = await scalDoLimitu(next.spory, LIMIT_SPOROW, (s) => s.temat, scalSpory(ctx));
    if (next.spory.length === przed) break;
  }
  return next;
}

export type NiejednoznacznyKandydat = {
  kategoria: "temat";
  kandydaci: string[];
  uzasadnienie: string;
  dane: NowyTemat;
};

export type WalidacjaWynik = {
  ok: true;
  delta: ProfileDelta;
  niejednoznaczne: NiejednoznacznyKandydat[];
  ostrzezenia: string[];
};

function czyKotwicaOk(cytat: string | null | undefined): boolean {
  return cytat == null || cytat.length <= MAX_DL_KOTWICY;
}

/**
 * Waliduje surową odpowiedź modelu przed `applyDelta`. Twardy błąd
 * strukturalny (kształt niezgodny z `ProfileDelta`) rzuca wyjątek — dokładnie
 * jak dzisiejsze `wyciagnijJson` przy braku bloku ```json```, przerywa cały
 * krok tego radnego, nic nie jest zapisywane. Błędy pojedynczych pozycji
 * (zmyślone `id`, zbyt długa kotwica) są fail-open: odrzucają TYLKO tę
 * pozycję z ostrzeżeniem, reszta delty się stosuje — tak jak dziś
 * `bezpiecznyOpisPrzykladu` w rendererze cicho pomija niepoprawne wpisy
 * zamiast wywalać cały render.
 *
 * `NIEJEDNOZNACZNE` nigdy nie trafia do `delta.tematy` zwróconej stąd — jest
 * zbierane osobno w `niejednoznaczne`. Wywołujący (`wdroz-produkcyjnie.mjs`)
 * ma sprawdzić `niejednoznaczne.length` i przy >0 NIE wołać `applyDelta` w
 * ogóle (blokuje cały krok tego radnego, nie tylko sporny wpis) — patrz
 * `scripts/profil/zastosuj-delte-reczna.mjs` do ręcznego rozstrzygnięcia.
 */
export function validateDelta(surowaDelta: unknown, index: ShortIndex): WalidacjaWynik {
  if (!surowaDelta || typeof surowaDelta !== "object") {
    throw new Error("validateDelta: odpowiedź modelu nie jest obiektem JSON.");
  }
  const d = surowaDelta as Record<string, unknown>;
  if (typeof d.sesja_ma_wypowiedzi !== "boolean") {
    throw new Error("validateDelta: brak pola `sesja_ma_wypowiedzi` (boolean).");
  }
  for (const pole of ["tematy", "spory_nowe", "udzial_forma_zdarzenia", "mieszkancy_nowi", "interpelacje_nowe", "odrzucone_nowe"]) {
    if (!Array.isArray(d[pole])) {
      throw new Error(`validateDelta: brak pola \`${pole}\` (tablica) w odpowiedzi modelu.`);
    }
  }

  const znaneId = new Set(index.tematy.map((t) => t.id));
  const ostrzezenia: string[] = [];
  const niejednoznaczne: NiejednoznacznyKandydat[] = [];
  const tematyOczyszczone: DecyzjaTemat[] = [];

  for (const surowa of d.tematy as DecyzjaTemat[]) {
    if (surowa.decyzja === "DOPASOWANIE") {
      if (!znaneId.has(surowa.id)) {
        ostrzezenia.push(
          `Odrzucono DOPASOWANIE na nieistniejące id "${surowa.id}" (halucynacja) — pominięto zamiast cicho traktować jako NOWY.`
        );
        continue;
      }
      if (!czyKotwicaOk(surowa.obserwacja?.kotwica?.cytat)) {
        ostrzezenia.push(`Odrzucono DOPASOWANIE (id ${surowa.id}) — kotwica dłuższa niż ${MAX_DL_KOTWICY} znaków.`);
        continue;
      }
      tematyOczyszczone.push(surowa);
      continue;
    }
    // NOWY i NIEJEDNOZNACZNE oba niosą `dane: NowyTemat`
    if (!czyKotwicaOk(surowa.dane?.kotwica?.cytat)) {
      ostrzezenia.push(`Odrzucono wpis "${surowa.dane?.teza}" — kotwica dłuższa niż ${MAX_DL_KOTWICY} znaków.`);
      continue;
    }
    if (surowa.decyzja === "NIEJEDNOZNACZNE") {
      niejednoznaczne.push({
        kategoria: "temat",
        kandydaci: surowa.kandydaci,
        uzasadnienie: surowa.uzasadnienie,
        dane: surowa.dane,
      });
      continue;
    }
    tematyOczyszczone.push(surowa);
  }

  const sporyOczyszczone = (d.spory_nowe as NowySpor[]).filter((s) => {
    if (!czyKotwicaOk(s.kotwica)) {
      ostrzezenia.push(`Odrzucono spór "${s.temat}" — kotwica dłuższa niż ${MAX_DL_KOTWICY} znaków.`);
      return false;
    }
    return true;
  });

  const mieszkancyOczyszczeni = (d.mieszkancy_nowi as ProfileDelta["mieszkancy_nowi"]).filter((m) => {
    if (!czyKotwicaOk(m.kotwica)) {
      ostrzezenia.push(`Odrzucono zgłoszenie mieszkańców "${m.temat}" — kotwica dłuższa niż ${MAX_DL_KOTWICY} znaków.`);
      return false;
    }
    return true;
  });

  return {
    ok: true,
    delta: {
      sesja_ma_wypowiedzi: d.sesja_ma_wypowiedzi as boolean,
      tematy: tematyOczyszczone,
      spory_nowe: sporyOczyszczone,
      udzial_forma_zdarzenia: d.udzial_forma_zdarzenia as ProfileDelta["udzial_forma_zdarzenia"],
      mieszkancy_nowi: mieszkancyOczyszczeni,
      interpelacje_nowe: d.interpelacje_nowe as ProfileDelta["interpelacje_nowe"],
      odrzucone_nowe: d.odrzucone_nowe as ProfileDelta["odrzucone_nowe"],
      grupy_kategorii_zmiany: d.grupy_kategorii_zmiany as ProfileDelta["grupy_kategorii_zmiany"],
    },
    niejednoznaczne,
    ostrzezenia,
  };
}
