-- Mówcy spoza urzędu i spoza składu rady, zgłaszani na bieżąco przy tagowaniu.
--
-- Nie są urzędnikami gminy, ale `segment` potrafi wskazać tylko radnego TEJ
-- rady albo `official`, więc bez wpisu ich wypowiedzi zostają nieprzypisane.
-- Ta sama półka co „Janusz Karbowiak" w scripts/seed-official-placeholders.sql.
--
-- Funkcje wpisujemy TRWAŁE, nie chwilowe (patrz [[feedback-stable-role-labels]]).
-- Stąd „były wicestarosta" zamiast „wicestarosta": Piątkowski pełnił tę
-- funkcję w poprzedniej kadencji, a w obecnej wicestarostą jest Adam
-- Balcerowicz (sprawdzone w składzie Rady Powiatu w tej bazie 2026-08-11).
-- Kandydowanie na burmistrza w 2024 to fakt historyczny, który nie zdezaktualizuje
-- się nigdy — w odróżnieniu od stanowiska, z którego można wypaść między sesjami.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/seed-officials-goscie.sql

begin;

insert into public.official (full_name, role, council_id)
select v.full_name, v.role, c.id
from (values
  ('Sylwester Kucharczyk', 'Zastępca Komendanta Powiatowego Policji'),
  ('Dariusz Piątkowski',   'Były wicestarosta powiatu, kandydat na burmistrza 2024')
) as v(full_name, role)
cross join public.council c
where c.name = 'Rada Miejska w Grójcu'
  and not exists (
    select 1 from public.official o
    where o.council_id = c.id and o.full_name = v.full_name
  );

commit;
