-- Pozycja „Nieustalony mówca" na liście mówców — obu rad.
--
-- To NIE to samo co istniejący „Nieustalony urzędnik", który znaczy „wiadomo,
-- że mówi urzędnik, tylko nie wiadomo który". Ta pozycja znaczy „słuchałem
-- i nie da się ustalić, kto to jest" — ani radny, ani urzędnik, ani nawet
-- wiadoma rola.
--
-- Sens jest w odróżnieniu dwóch stanów, które dziś wyglądają identycznie:
-- segment bez przypisania to zarówno „nikt tego jeszcze nie sprawdził", jak
-- i „sprawdzone, nie do ustalenia". Bez tej pozycji drugi przypadek zostaje
-- na zawsze w filtrze „Nieustalone" i każdy kolejny tagujący traci na niego
-- czas jeszcze raz.
--
-- Ta sama konwencja co pozostałe pozycje zbiorcze (scripts/seed-official-
-- placeholders.sql): etykieta w `full_name`, kategoria w `role`.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-nieustalony-mowca.sql

begin;

insert into public.official (full_name, role, council_id)
select 'Nieustalony mówca', 'Nie do ustalenia', c.id
from public.council c
where c.name in ('Rada Miejska w Grójcu', 'Rada Powiatu Grójeckiego')
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = 'Nieustalony mówca'
  );

commit;
