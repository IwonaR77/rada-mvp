-- Domknięcie podziału „redaktor proponuje / moderator zatwierdza" po stronie
-- bazy. Do dziś pilnowała go WYŁĄCZNIE akcja serwerowa (`assignSegments` sama
-- wybiera `status` na podstawie `finalize_vote`), a RLS przepuszczał wszystko.
--
-- Przyczyna: przy wielu politykach permissive PostgreSQL łączy przez OR
-- osobno wyrażenia USING (dla wiersza sprzed zmiany) i osobno WITH CHECK
-- (dla wiersza po zmianie) — NIE parami w obrębie jednej polityki. Polityka
-- „moderators finalize segments" miała `with check (true)`, więc to `true`
-- wchodziło do wspólnego OR dla KAŻDEGO, kto przeszedł dowolne USING.
-- W praktyce: redaktor (uprawnienie `vote`, bez `finalize_vote`) mógł wziąć
-- segment `open` — przechodzi USING polityki „editors propose segments" —
-- i zapisać w nim dowolny stan, łącznie z `status = 'finalized'`.
-- Sprawdzone empirycznie 2026-08-11 na koncie z samym `{vote}`: UPDATE 1.
--
-- Ominięcie nie wymagało niczego wyszukanego: klucz anon i token sesji są
-- w przeglądarce, więc wystarczyło PATCH prosto do /rest/v1/segment,
-- z pominięciem akcji serwerowej.
--
-- Naprawa: WITH CHECK dostaje ten sam warunek co USING, zamiast `true`.
-- Zapis `finalized` wymaga wtedy `finalize_vote` niezależnie od tego, którędy
-- przyszedł. Dla samych moderatorów nic się nie zmienia — warunek jest
-- identyczny z tym, który i tak już przechodzili w USING.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-segment-check-tighten.sql

begin;

drop policy if exists "moderators finalize segments" on public.segment;

create policy "moderators finalize segments" on public.segment
  for update
  using (
    exists (
      select 1
      from meeting m
      join term t on t.id = m.term_id
      where m.id = segment.meeting_id
        and user_has_permission(auth.uid(), 'finalize_vote', t.council_id)
    )
  )
  with check (
    exists (
      select 1
      from meeting m
      join term t on t.id = m.term_id
      where m.id = segment.meeting_id
        and user_has_permission(auth.uid(), 'finalize_vote', t.council_id)
    )
  );

commit;
