// Wspólne dla wniosków o udostępnienie protokołów: co jest zaległe i jak
// brzmi pismo. Wydzielone, bo korzystają z tego dwa skrypty — ten, który
// tylko pokazuje i zapisuje plik, i ten, który zakłada wersję roboczą
// w Gmailu. Dwie kopie treści pisma rozjechałyby się przy pierwszej poprawce.

import { supabaseQuery } from "./db.mjs";
import { MONTHS } from "./pl.mjs";

export const ADRESAT = {
  nazwa: "Urząd Gminy i Miasta w Grójcu",
  email: "urzad@grojecmiasto.pl",
  adres: "ul. Józefa Piłsudskiego 47, 05-600 Grójec",
};

// Ustawowy termin odpowiedzi to 14 dni, ale protokół powstaje po posiedzeniu
// i musi zostać przyjęty — pytanie o niego po tygodniu byłoby pytaniem
// o dokument, który jeszcze nie istnieje.
export const PROG_DNI = 21;

/** "2026-03-25" → "25 marca 2026 r." — pismo do urzędu, nie log. */
export function dataSlownie(iso) {
  const [rok, mies, dzien] = iso.split("-");
  const nazwa = Object.entries(MONTHS).find(([, n]) => n === mies)?.[0];
  return `${Number(dzien)} ${nazwa ?? mies} ${rok} r.`;
}

/**
 * Posiedzenia, o których protokoły warto zapytać.
 *
 * Warunki są trzy i każdy odsiewa co innego:
 * - `protocol_status = 'brak'` — nie pytamy o to, co już mamy albo co urząd
 *   sam opublikował;
 * - starsze niż próg — protokół musiał mieć czas powstać;
 * - brak powiązania z jakimkolwiek `foi_request` — o to już pytaliśmy i
 *   ponowny wniosek byłby nękaniem urzędu tą samą sprawą, a nam zafałszowałby
 *   liczenie terminów.
 */
export async function zalegleposiedzenia(councilId, progDni = PROG_DNI) {
  return supabaseQuery(`
    select cm.id, cm.date, cm.number, c.name as komisja
    from committee_meeting cm
    join committee c on c.id = cm.committee_id
    where c.council_id = '${councilId}'
      and cm.protocol_status = 'brak'
      and cm.date <= current_date - ${Number(progDni)}
      and not exists (
        select 1 from foi_request_meeting frm
        where frm.committee_meeting_id = cm.id
      )
    order by cm.date
  `);
}

export function temat(posiedzenia) {
  const od = dataSlownie(posiedzenia[0].date);
  const do_ = dataSlownie(posiedzenia[posiedzenia.length - 1].date);
  return posiedzenia.length === 1
    ? `Wniosek o udostępnienie informacji publicznej — protokół z posiedzenia komisji z ${od}`
    : `Wniosek o udostępnienie informacji publicznej — protokoły z posiedzeń komisji (${od} – ${do_})`;
}

export function trescWniosku(posiedzenia, podpis = "[podpis]") {
  const lista = posiedzenia
    .map(
      (p) =>
        `- ${p.komisja}, posiedzenie${p.number ? ` nr ${p.number}` : ""} z dnia ${dataSlownie(p.date)}`
    )
    .join("\n");

  return `Do: ${ADRESAT.nazwa}
${ADRESAT.adres}

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
${podpis}
`;
}
