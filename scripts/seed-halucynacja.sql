-- Pozycja „Halucynacja transkrypcji" na liście mówców — obu rad.
--
-- Znaczy: w tym miejscu tekst transkrypcji nie ma pokrycia w nagraniu.
-- Rozpoznawanie mowy potrafi w ciszy, szumie sali albo na przesterowanym
-- mikrofonie dopisać całe zdania, których nikt nie wypowiedział.
--
-- To NIE to samo co pozostałe pozycje zbiorcze. „Nieustalony mówca" znaczy
-- „ktoś mówił, nie wiadomo kto"; ta pozycja znaczy „nikt tego nie powiedział".
-- Różnica jest istotna, bo taki segment nie powinien nigdy trafić ani do
-- wzorca głosu, ani do statystyk czyjejkolwiek aktywności — nie jest cudzą
-- wypowiedzią, jest artefaktem narzędzia.
--
-- Rola „Błąd rozpoznawania mowy" (a nie „Nie do ustalenia") jest po to, żeby
-- dało się te dwa stany rozróżnić w zapytaniach. `src/lib/council-activity.ts`
-- wyklucza obie z wiersza „Pozostali urzędnicy".
--
-- Ta sama konwencja co pozostałe pozycje zbiorcze (scripts/seed-official-
-- placeholders.sql): etykieta w `full_name`, kategoria w `role`.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-halucynacja.sql

begin;

insert into public.official (full_name, role, council_id)
select 'Halucynacja transkrypcji', 'Błąd rozpoznawania mowy', c.id
from public.council c
where c.name in ('Rada Miejska w Grójcu', 'Rada Powiatu Grójeckiego')
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = 'Halucynacja transkrypcji'
  );

commit;
