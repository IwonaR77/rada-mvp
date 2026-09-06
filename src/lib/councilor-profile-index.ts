// Skrócony indeks istniejących tematów — to, i tylko to, dostaje model przy
// kroku iteracyjnym (Prompt_Profil_Radnego_Iteracyjny_v8.md) zamiast pełnego
// `ProfileState`, żeby zdecydować NOWY/DOPASOWANIE/NIEJEDNOZNACZNE. Czysta
// projekcja — każde pole tu już istnieje w `ProfileState`, tylko bez ciężkich/
// nieistotnych do tej decyzji pól (`kotwica.cytat`, pełna `sesje[]`, `spory`,
// `mieszkancy` itd. — `spory` nie potrzebuje indeksu w ogóle, bo nie ma
// decyzji dopasowania, zob. councilor-profile-delta.ts).
//
// Świadomie bez FTS/pgvector: nawet najgorszy dziś zmierzony stan (51
// tematów, Kozłowska) w tej skróconej formie to kilka KB, ułamek stanu który
// spowodował awarię (68 000 zn.) — a po wdrożeniu limitu 40 w kodzie liczba
// pozycji jest z definicji ograniczona. Selektywny retrieval (pgvector) do
// rozważenia dopiero, gdyby ten limit kiedyś istotnie wzrósł.

import type { ProfileState, Zasieg } from "./councilor-profile-state.ts";

export type TematIndeksowy = {
  id: string;
  teza: string;
  zdanie: string | null;
  kategoria_obszaru: string;
  zasieg: Zasieg | null;
  wystapien: number;
  ostatnia: string;
  sprawa: string | null;
};

export type ShortIndex = {
  tematy: TematIndeksowy[];
  kategorie_znane: string[];
  grupy_kategorii: Record<string, string[]>;
  sesje_przetworzone: number;
  sesje_z_wypowiedziami: number;
};

export function buildShortIndex(state: ProfileState): ShortIndex {
  return {
    tematy: state.tematy.map((t) => ({
      id: t.id,
      teza: t.teza,
      zdanie: t.zdanie,
      kategoria_obszaru: t.kategoria_obszaru,
      zasieg: t.zasieg,
      wystapien: t.wystapien,
      ostatnia: t.ostatnia,
      sprawa: t.sprawa,
    })),
    kategorie_znane: state.kategorie_znane,
    grupy_kategorii: state.grupy_kategorii,
    sesje_przetworzone: state.sesje_przetworzone,
    sesje_z_wypowiedziami: state.sesje_z_wypowiedziami,
  };
}
