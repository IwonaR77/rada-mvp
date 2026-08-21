// Sprawdza, czy tekst wypowiedzi kłóci się z płcią przypisanego mówcy.
//
// Polskie końcówki pierwszej osoby zdradzają płeć mówiącego („chciałbym" vs
// „chciałabym"), więc przypisanie wypowiedzi osobie niewłaściwej płci widać
// w samym tekście — kanałem niezależnym od dźwięku i od protokołu.
//
// Plik jest zwykłym modułem .mjs, żeby dokładnie te same reguły obowiązywały
// w interfejsie (podświetlanie segmentu) i w skrypcie kontrolnym
// (scripts/voice/sprawdz-rodzaj.mjs). Dwie kopie tych wyrażeń rozjechałyby się
// przy pierwszej poprawce, a poprawek było już kilka.
//
// UWAGA: to jest wskazówka, nie wyrok. Rozpoznawanie mowy potrafi przekręcić
// samą końcówkę (widziane: wypowiedź burmistrza zapisana jako „Ja
// powiedziałam"), więc podświetlony segment trzeba obejrzeć, a nie poprawiać
// w ciemno.

// Czas przeszły 1. os. to rdzeń zakończony SAMOGŁOSKĄ + ł + em/am (zrobiłam,
// wziąłem, czułem). Sama końcówka „łem/łam" nie wystarcza: łapie czas przyszły
// („wywołam pana") i rzeczowniki w narzędniku („protokołem"), gdzie przed „ł"
// stoi spółgłoska albo „o". Flaga `u` jest konieczna — bez niej `\w` nie
// obejmuje polskich liter i formy typu „wzięłam" cicho wypadają.
const ZENSKIE = /[aiyeęąóu]ł(am|abym)\b/iu;
const MESKIE = /[aiyeęąóu]ł(em|bym)\b/iu;

// Rdzenie, których narzędnik ma tę samą postać co czasownik. `\b` na początku
// jest konieczne: bez niego „dział" trafiał w ŚRODEK czasowników
// („powiedziałem" zawiera „działem") i wycinał właśnie te formy, o które chodzi.
const RZECZOWNIKI =
  /\b(protokoł|wydział|podział|udział|oddział|przedział|źródł|dział|koł|czoł|ciał|dzieł|tł|stoł|okoł|zespoł|osiedl|ogół|mysł|węzł|hasł|krzesł|artykuł|tytuł|rozdział|paragraf)em\b/giu;

/** Usuwa rzeczowniki w narzędniku, zanim zadziała reguła morfologiczna. */
function bezNarzednika(tekst) {
  return tekst
    .replace(RZECZOWNIKI, "")
    // Zasada ogólna: narzędnik rzeczownika prawie zawsze stoi po przyimku
    // („z udziałem") albo po przymiotniku w narzędniku („kwalifikowanym
    // materiałem"), a czasownik w 1. osobie nie ma przed sobą ani jednego,
    // ani drugiego.
    .replace(/\b(z|ze|nad|pod|przed|za|między|pomiędzy|wraz)\s+\p{L}+ł(em|am)\b/giu, "")
    .replace(/\p{L}+(ym|im|om)\s+\p{L}+ł(em|am)\b/giu, "");
}

/**
 * Etykiety zbiorcze — nie są osobami, więc nie mają płci.
 *
 * Pod „Zaproszonym gościem" kryje się za każdym razem ktoś inny, raz kobieta,
 * raz mężczyzna. Reguła `plecPoImieniu` odczytałaby z takiej etykiety rodzaj
 * gramatyczny jej pierwszego słowa („Zaproszony" → mężczyzna, „Halucynacja" →
 * kobieta) i podświetlała na czerwono każdą wypowiedź gościa mówiącego
 * o sobie w drugą stronę. To fałszywy alarm co do jednego: sprzeczności tam
 * nie ma i być nie może, bo nie ma z czym.
 */
export const ETYKIETY_BEZ_PLCI = new Set([
  "Zaproszony gość",
  "Mieszkaniec miasta",
  "Nieustalony mówca",
  "Nieustalony urzędnik",
  "Halucynacja transkrypcji",
]);

/** Płeć po imieniu: polskie imiona żeńskie kończą się na „a". */
export function plecPoImieniu(pelneImie) {
  return pelneImie.split(" ")[0].toLowerCase().endsWith("a") ? "k" : "m";
}

/**
 * @param {string} tekst treść segmentu
 * @param {string} mowca pełne imię i nazwisko przypisanej osoby
 * @returns {boolean} czy końcówka w tekście przeczy płci mówcy
 */
export function sprzecznyRodzaj(tekst, mowca) {
  if (!tekst || !mowca) return false;
  if (ETYKIETY_BEZ_PLCI.has(mowca)) return false;
  const oczyszczony = bezNarzednika(tekst);
  const zenska = ZENSKIE.test(oczyszczony);
  const meska = MESKIE.test(oczyszczony);
  // Obie formy naraz nie rozstrzygają niczego: albo przekręcona końcówka,
  // albo dwie osoby w jednym segmencie.
  if (zenska === meska) return false;
  const plec = plecPoImieniu(mowca);
  return (zenska && plec === "m") || (meska && plec === "k");
}
