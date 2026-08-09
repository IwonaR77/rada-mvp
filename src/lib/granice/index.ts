import powiatGrojecki from "./powiat-grojecki.json";

// Granice jednostek administracyjnych rysowane na mapie wyboru rady. Rada
// powiatu nie jest punktem, więc pinezka byłaby dla niej myląca — obszar
// pokazujemy kształtem.
//
// Pliki .json generuje scripts/fetch-boundary.mjs (raz na jednostkę, offline).
// Ten moduł dokłada do nich tylko to, czego nie da się wyczytać z OSM:
// etykietę po polsku i nazwę rady, po której obszar zostanie połączony
// z wierszem `council`.
export type Boundary = {
  slug: string;
  /** Etykieta przy wskazaniu kształtu. */
  label: string;
  /**
   * Nazwa rady w tabeli `council`. Obszar staje się klikalny dopiero, gdy taka
   * rada istnieje — dzięki temu kształt można pokazać, zanim rada powiatu
   * zostanie założona, i nic nie trzeba potem zmieniać w kodzie.
   */
  councilName: string;
  /** Pierścień [lat, lng], już uproszczony. */
  ring: [number, number][];
  source: string;
};

export const BOUNDARIES: Boundary[] = [
  {
    slug: powiatGrojecki.slug,
    label: "Powiat grójecki",
    councilName: "Rada Powiatu Grójeckiego",
    ring: powiatGrojecki.ring as [number, number][],
    source: powiatGrojecki.source,
  },
];
