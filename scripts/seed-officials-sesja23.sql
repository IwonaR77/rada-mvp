-- Osoby funkcyjne z przeglądu transkrypcji XXIII sesji Rady Miejskiej w Grójcu
-- (27 listopada 2025).
--
-- Nazwiska i nazwy wydziałów zweryfikowane poza transkrypcją (BIP UGiM Grójec,
-- struktura urzędu) — transkrypcja jest z rozpoznawania mowy i przekręca
-- nazwiska, więc sama w sobie nie jest źródłem brzmienia nazwiska.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-officials-sesja23.sql

begin;

-- Nowa osoba: czyta projekty uchwał pod literkami B, C i D tej sesji, a w
-- wykazie jej nie było. Występuje też w sesjach z 17.07.2024, 25.09.2024
-- i 27.11.2024, więc to stała postać, nie jednorazowy gość.
--
-- Pisownia nazwiska przez „ź" (Kaźmierczak, nie Kazimierczak) — za BIP-em,
-- bo tu akurat obie wersje brzmią przy odsłuchu tak samo.
insert into public.official (full_name, role, council_id)
select v.full_name, v.role, c.id
from (values
  ('Renata Kaźmierczak', 'Naczelnik Wydziału Podatków i Opłat')
) as v(full_name, role)
cross join public.council c
where c.name = 'Rada Miejska w Grójcu'
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = v.full_name
  );

-- Doprecyzowanie funkcji już istniejącego wpisu: Magdalena Śmietańska miała
-- ogólnikowe „Naczelnik Wydziału", bez wskazania którego. Ta sesja podaje go
-- wprost („naczelnik Wydziału Gospodarki Nieruchomościami"), a BIP to
-- potwierdza. Warunek na starej wartości, żeby ponowne uruchomienie pliku
-- niczego nie nadpisało, gdyby funkcja zmieniła się w międzyczasie.
update public.official o
set role = 'Naczelnik Wydziału Gospodarki Nieruchomościami'
from public.council c
where o.council_id = c.id
  and c.name = 'Rada Miejska w Grójcu'
  and o.full_name = 'Magdalena Śmietańska'
  and o.role = 'Naczelnik Wydziału';

commit;
