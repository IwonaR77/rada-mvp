-- Osoba funkcyjna wychwycona przy przeglądzie transkrypcji XXIV sesji Rady
-- Miejskiej w Grójcu (18 grudnia 2025) — referowała projekt uchwały pod
-- literką G, a nie było jej w `official`, więc jej wypowiedzi nie miały do
-- kogo trafić. Pojawia się też w sesjach z 30 stycznia i 27 lutego 2025, więc
-- to stała postać, nie jednorazowy gość.
--
-- Nazwisko i funkcja zweryfikowane poza transkrypcją (grojecmiasto.pl, Punkt
-- Konsultacyjny ds. uzależnień) — transkrypcja jest z rozpoznawania mowy i
-- przekręca nazwiska, więc sama w sobie nie jest źródłem brzmienia nazwiska.
-- Na sesji padło skrócone „pełnomocnik burmistrza (…) do spraw uzależnień”,
-- tu pełna nazwa funkcji ze strony gminy.
--
-- Pozostałe osoby funkcyjne z tej sesji (Mariola Komorowska, Sebastian
-- Litewnicki, Ewelina Gębska, Ireneusz Wojciechowski) były już w `official`.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-officials-sesja24.sql

begin;

insert into public.official (full_name, role, council_id)
select v.full_name, v.role, c.id
from (values
  ('Dagmara Biedrzycka', 'Pełnomocnik Burmistrza ds. Profilaktyki i Przeciwdziałania Uzależnieniom')
) as v(full_name, role)
cross join public.council c
where c.name = 'Rada Miejska w Grójcu'
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = v.full_name
  );

commit;
