-- Zbiorcze pozycje na liście mówców: mieszkaniec i zaproszony gość.
--
-- Na sesjach zabierają głos osoby, które nie są ani radnymi, ani urzędnikami,
-- a `segment` potrafi wskazać tylko `confirmed_councilor_id` albo
-- `confirmed_official_id`. Bez takich pozycji ich wypowiedzi zostają na zawsze
-- „nieustalone", choć wiadomo, kto mówił w sensie roli — tylko nie z imienia.
--
-- Ta sama konwencja co istniejący wpis „Nieustalony urzędnik": etykieta idzie
-- w `full_name`, kategoria w `role`. Imion i nazwisk celowo NIE zapisujemy —
-- to osoby prywatne, a Serwis opisuje działalność publiczną radnych
-- i urzędników, nie mieszkańców z nazwiska.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-official-placeholders.sql

begin;

-- Osoby imienne spoza rady, które regularnie zabierają głos na jej sesjach —
-- ta sama półka co „Zastępca Komendanta Powiatowego Policji", który leży tu od
-- początku. Radny powiatu wystąpił na sesji rady miasta, a `segment` potrafi
-- wskazać tylko radnego TEJ rady albo urzędnika, więc bez wpisu jego
-- wypowiedzi zostają nieprzypisane.
--
-- To drugi wiersz dla tej samej osoby (pierwszy to `councilor` w kadencji
-- powiatu), więc jego wystąpienia w gminie NIE doliczą się do profilu radnego
-- powiatu. To zachowanie pożądane, nie ograniczenie do naprawienia:
-- statystyki radnego mierzą jego pracę we WŁASNEJ radzie i są porównywane
-- z pozostałymi radnymi tej samej rady. Doliczenie gościnnego wystąpienia
-- w innej radzie zawyżałoby go wobec kolegów, którzy takiej okazji nie mieli.
--
-- Gdyby kiedyś powstała wspólna tożsamość osoby ponad radami, ta zasada musi
-- zostać: wspólny profil owszem, wspólne liczniki aktywności nie.

insert into public.official (full_name, role, council_id)
select v.full_name, v.role, c.id
from (values
  ('Mieszkaniec miasta', 'Mieszkaniec'),
  ('Zaproszony gość',    'Gość'),
  ('Janusz Karbowiak',   'Radny Powiatu Grójeckiego')
) as v(full_name, role)
cross join public.council c
where c.name = 'Rada Miejska w Grójcu'
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = v.full_name
  );

commit;
