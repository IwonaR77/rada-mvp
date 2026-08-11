-- Osoby funkcyjne wychwycone przy przeglądzie transkrypcji XXIX sesji Rady
-- Miejskiej w Grójcu (26 marca 2026) — wszystkie trzy zabierały głos z mównicy,
-- a nie było ich w `official`, więc ich wypowiedzi nie miały do kogo trafić.
--
-- Nazwiska i funkcje zweryfikowane poza transkrypcją (BIP UGiM Grójec,
-- grojec24.net) — transkrypcja jest z rozpoznawania mowy i przekręca nazwiska,
-- więc sama w sobie nie jest źródłem brzmienia nazwiska.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-officials-sesja29.sql

begin;

insert into public.official (full_name, role, council_id)
select v.full_name, v.role, c.id
from (values
  -- „Komendant gminny" z transkrypcji; pełna nazwa funkcji z relacji ze zjazdu
  -- oddziału. Na sesji zdał sprawozdanie z działalności OSP i zapowiedział, że
  -- po 25 latach kończy pełnienie funkcji.
  ('Sławomir Maroszek',    'Komendant Gminno-Miejski ZOSP RP'),
  ('Ireneusz Wojciechowski', 'Dyrektor Grójeckiego Ośrodka Sportu „Mazowsze”'),
  -- Wydział nazywa się szerzej, niż podano na sesji („Wydział Ochrony
  -- Środowiska"), stąd pełna nazwa z BIP-u.
  ('Agnieszka Skarżyńska', 'Naczelnik Wydziału Ochrony Środowiska i Gospodarki Komunalnej')
) as v(full_name, role)
cross join public.council c
where c.name = 'Rada Miejska w Grójcu'
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = v.full_name
  );

commit;
