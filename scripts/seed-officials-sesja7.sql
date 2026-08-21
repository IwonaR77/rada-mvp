-- Osoba funkcyjna wychwycona przy przeglądzie transkrypcji VII sesji Rady
-- Miejskiej w Grójcu (4 września 2024) — odczytywała projekt uchwały,
-- a nie było jej w `official`.
--
-- Funkcja z zapowiedzi przewodniczącego („główny specjalista do spraw
-- pozyskiwania środków zewnętrznych”); brzmienie nazwiska spoza transkrypcji,
-- bo rozpoznawanie mowy przekręca nazwiska.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-officials-sesja7.sql

begin;

insert into public.official (full_name, role, council_id)
select v.full_name, v.role, c.id
from (values
  ('Daria Bobrowska-Wachniewska', 'Główny Specjalista ds. Pozyskiwania Środków Zewnętrznych')
) as v(full_name, role)
cross join public.council c
where c.name = 'Rada Miejska w Grójcu'
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = v.full_name
  );

commit;
