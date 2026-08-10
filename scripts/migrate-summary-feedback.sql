-- Uwagi managera do promptu podsumowań: „czego ten prompt nie wyłapał".
--
-- Podsumowania powstają poza serwisem (prompt → czat → gotowy plik .md), więc
-- jedyny ślad, że prompt coś przegapił, ginął dotąd w rozmowie. Ta tabela robi
-- z tego trwały materiał wejściowy do kolejnej wersji promptu.
--
-- prompt_version to wersja, którą wygenerowano krytykowany tekst — bez niej
-- po dwóch podbiciach promptu nie wiadomo, czy uwaga jest jeszcze aktualna.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-summary-feedback.sql

begin;

create table if not exists public.summary_feedback (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meeting(id) on delete cascade,
  author_id uuid not null references public.app_user(id),
  prompt_version integer,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists summary_feedback_meeting_idx
  on public.summary_feedback (meeting_id, created_at desc);

alter table public.summary_feedback enable row level security;

-- Zakres: manager tej rady albo manager bez zakresu (globalny). Ta sama
-- funkcja i ten sam wzorzec EXISTS-em przez meeting → term, co polityki na
-- `segment` — rada wynika z posiedzenia, w tabeli jej nie duplikujemy.
drop policy if exists "managers read summary_feedback" on public.summary_feedback;
create policy "managers read summary_feedback" on public.summary_feedback
  for select using (
    exists (
      select 1 from meeting m
      join term t on t.id = m.term_id
      where m.id = summary_feedback.meeting_id
        and user_has_permission(auth.uid(), 'full_access', t.council_id)
    )
  );

drop policy if exists "managers write summary_feedback" on public.summary_feedback;
create policy "managers write summary_feedback" on public.summary_feedback
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1 from meeting m
      join term t on t.id = m.term_id
      where m.id = summary_feedback.meeting_id
        and user_has_permission(auth.uid(), 'full_access', t.council_id)
    )
  );

-- Kasować może tylko autor uwagi: to jego zdanie, a nie wspólny rejestr.
drop policy if exists "authors delete summary_feedback" on public.summary_feedback;
create policy "authors delete summary_feedback" on public.summary_feedback
  for delete using (
    author_id = auth.uid()
    and exists (
      select 1 from meeting m
      join term t on t.id = m.term_id
      where m.id = summary_feedback.meeting_id
        and user_has_permission(auth.uid(), 'full_access', t.council_id)
    )
  );

commit;
