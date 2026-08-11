-- Uwagi do podsumowań: dostęp także dla moderatora, nie tylko managera.
--
-- Uwagi zgłasza ten, kto siedzi w transkrypcie i widzi, czego podsumowanie nie
-- wyłapało — czyli moderator. Wgrywanie samych podsumowań zostaje przy
-- managerze (`full_access`), bo to już redakcja tekstu o realnych ludziach.
--
-- Wystarczy podmienić `full_access` na `finalize_vote`, bez sumy logicznej:
-- `user_has_permission` traktuje `full_access` jak wildcard
-- (`permissions @> array[perm] or permissions @> array['full_access']`),
-- więc manager przechodzi test na `finalize_vote` automatycznie.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-feedback-moderator.sql

begin;

drop policy if exists "managers read summary_feedback" on public.summary_feedback;
drop policy if exists "managers write summary_feedback" on public.summary_feedback;
drop policy if exists "authors delete summary_feedback" on public.summary_feedback;

create policy "moderators read summary_feedback" on public.summary_feedback
  for select
  using (
    exists (
      select 1 from meeting m join term t on t.id = m.term_id
      where m.id = summary_feedback.meeting_id
        and user_has_permission(auth.uid(), 'finalize_vote', t.council_id)
    )
  );

create policy "moderators write summary_feedback" on public.summary_feedback
  for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from meeting m join term t on t.id = m.term_id
      where m.id = summary_feedback.meeting_id
        and user_has_permission(auth.uid(), 'finalize_vote', t.council_id)
    )
  );

-- Kasować wolno wyłącznie własną uwagę — tak jak dotąd.
create policy "authors delete summary_feedback" on public.summary_feedback
  for delete
  using (
    author_id = auth.uid()
    and exists (
      select 1 from meeting m join term t on t.id = m.term_id
      where m.id = summary_feedback.meeting_id
        and user_has_permission(auth.uid(), 'finalize_vote', t.council_id)
    )
  );

commit;
