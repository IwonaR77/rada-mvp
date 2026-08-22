// Nazwa katalogu wsadu/wyników eksperymentu przyrostowego budowania profilu
// (scripts/profil/eksport-wsadu.mjs, scripts/profil/uruchom-iteracje.mjs,
// odczyt w councilor-profile.tsx) — wspólna, żeby obie strony trafiały w ten
// sam katalog bez ręcznego przepisywania.
export function slugifyRadny(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
