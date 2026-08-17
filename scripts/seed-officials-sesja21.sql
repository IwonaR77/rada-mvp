-- Osoba funkcyjna wychwycona przy przeglądzie transkrypcji XXI sesji Rady
-- Miejskiej w Grójcu (18 września 2025) — odpowiadała na pytania radnych przy
-- sprawozdaniu z działalności biblioteki za I półrocze 2025, a nie było jej
-- w `official`, więc jej wypowiedzi nie miały do kogo trafić.
--
-- Imię i nazwisko potwierdza sesja z 29 maja 2025 („pani dyrektor Kinga
-- Majewska jest z nami"), gdzie pada w pełnym brzmieniu — na XXI sesji jest
-- już tylko „pani dyrektor Majewska". Dwa wystąpienia w różnych sesjach, więc
-- to stała postać, nie jednorazowy gość.
--
-- Nazwa instytucji za samą transkrypcją w wersji urzędowej („Sprawozdanie
-- z działalności Miejsko-Gminnej Biblioteki Publicznej"), nie za potoczną
-- „Biblioteka Miejska w Grójcu" z pytania radnego.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-officials-sesja21.sql

begin;

insert into public.official (full_name, role, council_id)
select v.full_name, v.role, c.id
from (values
  ('Kinga Majewska', 'Dyrektor Miejsko-Gminnej Biblioteki Publicznej w Grójcu')
) as v(full_name, role)
cross join public.council c
where c.name = 'Rada Miejska w Grójcu'
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = v.full_name
  );

commit;
