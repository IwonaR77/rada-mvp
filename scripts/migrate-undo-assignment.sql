-- Cofanie ostatniego przypisania mówcy — brakująca polityka dla redaktorów.
--
-- Moderator mógł cofnąć zawsze: „moderators finalize segments" ma
-- `with check (true)`, więc dowolny stan docelowy przechodzi. Redaktor
-- (uprawnienie `vote` bez `finalize_vote`) NIE mógł: jego polityka
-- „editors propose segments" wymaga `status = 'open'` na wejściu i
-- `status = 'proposed'` na wyjściu, a cofnięcie to dokładnie ruch odwrotny.
-- Bez tej polityki przycisk „Cofnij" byłby dla redaktora martwy i to po
-- cichu — brak polityki nie daje błędu, tylko zero zmienionych wierszy
-- (patrz [[feedback_rls_silent_denial]]).
--
-- Zakres jest wąsko obcięty: wyłącznie WŁASNA propozycja (`finalized_by =
-- auth.uid()`) i wyłącznie z powrotem do stanu nieprzypisanego. Redaktor nie
-- może więc ruszyć propozycji z dopasowania do protokołów ani cudzej, a
-- „cofnięcie" nie może być użyte do podmiany mówcy z pominięciem moderatora.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-undo-assignment.sql

begin;

drop policy if exists "editors revert own proposal" on public.segment;

create policy "editors revert own proposal" on public.segment
  for update
  using (
    status = 'proposed'
    and finalized_by = auth.uid()
    and exists (
      select 1
      from meeting m
      join term t on t.id = m.term_id
      where m.id = segment.meeting_id
        and user_has_permission(auth.uid(), 'vote', t.council_id)
    )
  )
  with check (
    status = 'open'
    and confirmed_councilor_id is null
    and confirmed_official_id is null
  );

commit;
