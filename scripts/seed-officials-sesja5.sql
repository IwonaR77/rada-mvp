-- Osoba funkcyjna wychwycona przy przeglądzie transkrypcji V sesji Rady
-- Miejskiej w Grójcu (26 czerwca 2024) — składała sprawozdanie z działalności
-- Zakładu Gospodarki Komunalnej za 2023 rok, a nie było jej w `official`.
--
-- Transkrypcja podaje imię niekonsekwentnie („Małgorzata” przy zapowiedzi
-- z mównicy, „Monika” w dalszej części) — przyjęte brzmienie pochodzi
-- spoza transkrypcji, rozpoznawanie mowy przekręca nazwiska i imiona.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-officials-sesja5.sql

begin;

insert into public.official (full_name, role, council_id)
select v.full_name, v.role, c.id
from (values
  ('Małgorzata Nowakowska', 'Dyrektor Zakładu Gospodarki Komunalnej')
) as v(full_name, role)
cross join public.council c
where c.name = 'Rada Miejska w Grójcu'
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = v.full_name
  );

commit;
