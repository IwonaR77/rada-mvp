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

insert into public.official (full_name, role, council_id)
select v.full_name, v.role, c.id
from (values
  ('Mieszkaniec miasta', 'Mieszkaniec'),
  ('Zaproszony gość',    'Gość')
) as v(full_name, role)
cross join public.council c
where c.name = 'Rada Miejska w Grójcu'
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = v.full_name
  );

commit;
