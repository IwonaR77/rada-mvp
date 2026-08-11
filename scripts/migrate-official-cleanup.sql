-- Sprzątanie listy mówców: licznik użycia + możliwość usunięcia pomyłki.
--
-- Lista `official` puchnie przy każdym przeglądzie transkrypcji, a przy okazji
-- łapie literówki i osoby dopisane „na wszelki wypadek". Do dziś nie było jak
-- ich usunąć ani nawet zobaczyć, że nigdy nikomu nie posłużyły.
--
-- 1. `council_speaker_usage` — ile segmentów ma przypisanych każdy mówca rady
--    (radni i urzędnicy razem, propozycje TEŻ się liczą: przypisanie to
--    przypisanie, niezależnie od tego, czy ktoś je już zatwierdził).
--
-- 2. Polityka DELETE. Do dziś `official` miała wyłącznie politykę SELECT, więc
--    usunięcie nie zgłaszało błędu — po prostu nie ruszało ani jednego wiersza
--    (patrz [[feedback_rls_silent_denial]]).
--
--    Warunek „bez przypisanych wypowiedzi" siedzi W POLITYCE, nie tylko
--    w kodzie aplikacji. To celowe: `segment.confirmed_official_id` ma
--    ON DELETE SET NULL, więc usunięcie osoby z otagowanymi wypowiedziami nie
--    rzuciłoby błędu, tylko po cichu odpięło jej wszystkie wypowiedzi i wrzuciło
--    je z powrotem do puli nieprzypisanych — bez śladu, kto tam był. Baza ma
--    tego nie dopuścić niezależnie od tego, co zrobi kod nad nią.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-official-cleanup.sql

begin;

create or replace function public.council_speaker_usage(p_council_id uuid)
returns table (speaker_id uuid, segments bigint)
language sql
stable
as $$
  select spk, count(*)
  from (
    select coalesce(s.confirmed_councilor_id, s.confirmed_official_id) as spk
    from segment s
    join meeting m on m.id = s.meeting_id
    join term t on t.id = m.term_id
    where t.council_id = p_council_id
      and (s.confirmed_councilor_id is not null
           or s.confirmed_official_id is not null)
  ) x
  group by spk;
$$;

drop policy if exists "moderators delete unused officials" on public.official;

create policy "moderators delete unused officials" on public.official
  for delete
  using (
    user_has_permission(auth.uid(), 'finalize_vote', council_id)
    and not exists (
      select 1 from segment s where s.confirmed_official_id = official.id
    )
  );

commit;
