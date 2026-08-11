-- Indeksy pod zapytania, które rosną razem z liczbą sesji.
--
-- Znalezione pomiarem 2026-08-11 (`scripts/perf-check.sh`), nie z przeczucia.
--
-- 1. `idx_segment_finalized_meeting` — indeks CZĘŚCIOWY po `meeting_id`
--    dla samych `finalized`. Trafia w najgorętsze zapytanie serwisu:
--    `getSpeakingActivity` ciągnie wszystkie zatwierdzone segmenty kadencji
--    (podium na stronie rady, /rada/[id]/sesje, profil radnego).
--    Przed: Seq Scan po 77 tys. wierszy, **450 ms**.
--    Po:    Index Scan, **4,6 ms** — sto razy szybciej.
--    Częściowy, a nie zwykły po (status, meeting_id): `finalized` to dziś
--    9% tabeli, więc indeks jest ~10x mniejszy, a i tak obsługuje jedyny
--    filtr, w którym `status` występuje w gorących zapytaniach.
--
--    UWAGA przy zmianach: indeks działa tylko dopóki zapytanie filtruje
--    dokładnie `status = 'finalized'`. Zmiana na `status in (...)` albo
--    `status <> 'open'` wyłączy go po cichu — bez błędu, tylko wolniej.
--
-- Sprawdzone i świadomie NIEDODANE:
-- - `segment(confirmed_official_id)` — liczenie wypowiedzi jednej osoby
--   (kosz przy liście mówców) to dziś 11 ms przy Seq Scan. Indeks kosztowałby
--   zapis przy każdym tagowaniu, a oszczędziłby milisekundy przy akcji
--   wykonywanej raz na kilka dni. Wrócić, gdy `segment` przekroczy ~500 tys.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-perf-indexes.sql

begin;

create index if not exists idx_segment_finalized_meeting
  on public.segment (meeting_id)
  where status = 'finalized';

commit;

analyze public.segment;
