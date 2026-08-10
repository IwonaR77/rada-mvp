-- Postęp tagowania mówców liczony CZASEM wypowiedzi, nie ich liczbą.
--
-- Istniejące meeting_tagging_progress liczy segmenty, co wystarcza plakietkom
-- przy sesjach, ale zaniża obraz pracy: segmenty są krótkie i nierówne, a
-- „ile jeszcze zostało" mierzy się godzinami nagrania do przesłuchania,
-- nie liczbą wierszy.
--
-- Rozdzielenie na potwierdzone i zaproponowane jest tu istotne, nie kosmetyczne:
-- dziś w Radzie Miejskiej zaproponowanych jest 13,9 h wobec 5,3 h potwierdzonych,
-- więc pasek liczący je razem pokazywałby postęp czterokrotnie większy niż
-- realnie zatwierdzony.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-tagging-time.sql

begin;

create or replace function public.term_tagging_time(p_term_id uuid)
returns table (
  total_seconds numeric,
  finalized_seconds numeric,
  proposed_seconds numeric
)
language sql
stable
as $$
  select
    coalesce(sum(s.end_time - s.start_time), 0),
    coalesce(sum(s.end_time - s.start_time) filter (where s.status = 'finalized'), 0),
    coalesce(sum(s.end_time - s.start_time) filter (where s.status = 'proposed'), 0)
  from segment s
  join meeting m on m.id = s.meeting_id
  where m.term_id = p_term_id;
$$;

grant execute on function public.term_tagging_time(uuid) to anon, authenticated;

commit;
