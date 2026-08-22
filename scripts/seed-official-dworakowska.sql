-- Osoba funkcyjna wychwycona przy przeglądzie transkrypcji sesji Rady
-- Miejskiej w Grójcu z 27 listopada 2024 (X sesja licząc chronologicznie) —
-- czytała dwa projekty uchwał o gospodarce odpadami (literki J i K), a nie
-- było jej w `official`, więc jej wypowiedzi zostały nieprzypisane (status
-- 'open').
--
-- Dwa bloki jej wypowiedzi wyznaczone po zapowiedziach prowadzącego obrady
-- (segmenty 7b735087.../ce7f274a...) i odgraniczone od jego kolejnych uwag
-- proceduralnych ("Czy są pytania", "Nie widzę", wyniki głosowań):
--   blok 1: 3377.526–3781.353 (odczytanie uchwały ws. metody i stawki opłaty)
--   blok 2: 3829.861–3905.653 (odczytanie uchwały ws. wzoru deklaracji)
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-official-dworakowska.sql

begin;

insert into public.official (full_name, role, council_id)
select v.full_name, v.role, c.id
from (values
  ('Małgorzata Dworakowska', 'Naczelnik Wydziału Gospodarki Odpadami')
) as v(full_name, role)
cross join public.council c
where c.name = 'Rada Miejska w Grójcu'
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = v.full_name
  );

update public.segment s
set confirmed_official_id = o.id,
    status = 'finalized',
    finalized_by = '0a8f0b64-0a09-4f8f-9c47-2f269209ad6a',
    finalized_at = now()
from public.official o
join public.council c on c.id = o.council_id
where o.full_name = 'Małgorzata Dworakowska'
  and c.name = 'Rada Miejska w Grójcu'
  and s.meeting_id = '17fb77c1-4f33-4f45-a582-0a279746658f'
  and s.status = 'open'
  and s.confirmed_councilor_id is null
  and s.confirmed_official_id is null
  and (
    s.start_time between 3377.526 and 3781.353
    or s.start_time between 3829.861 and 3905.653
  );

commit;
