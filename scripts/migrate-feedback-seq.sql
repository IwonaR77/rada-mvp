-- Minor wersji promptu = zbiór uwag redakcji, które trafiły do pobranego pliku.
--
-- Problem: uwagi z `summary_feedback` doklejane przy pobraniu promptu
-- (src/lib/feedback-section.ts) realnie zmieniają treść opisu, ale nie
-- zostawiały śladu — z czatu wracało samo „prompt v7", więc po fakcie nie
-- dało się powiedzieć, które uwagi ten opis w ogóle widział.
--
-- Rozwiązanie: każda uwaga dostaje trwały numer `seq` w obrębie JEDNEJ RADY,
-- a wersja pobranego promptu staje się `7.12` = prompt v7 + uwagi tej rady
-- do #12. Numer jest własnością uwag, nie promptu: ta sama pula zasila też
-- prompt spraw, a numeracja jest per rada — `.12` u Grójca to inny zbiór niż
-- `.12` u powiatu i nie wolno ich porównywać między radami.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-feedback-seq.sql

begin;

alter table public.summary_feedback
  -- Rada wyliczona przy zapisie i utrwalona: `seq` musi być stabilny, a
  -- droga meeting → term → council jest zbyt daleka, żeby liczyć ją przy
  -- każdym odczycie i sortowaniu.
  add column if not exists council_id uuid references public.council(id),
  add column if not exists seq integer,
  -- Kasowanie musi być miękkie, inaczej usunięcie uwagi #5 czyni `v7.12`
  -- nieodtwarzalnym, a dziury w numeracji z czasem zaczynają znaczyć co
  -- innego niż w chwili powstania.
  add column if not exists retired_at timestamptz;

-- Numeracja istniejących uwag po czasie zgłoszenia, osobno w każdej radzie.
update public.summary_feedback f
set council_id = t.council_id
from public.meeting m
join public.term t on t.id = m.term_id
where m.id = f.meeting_id and f.council_id is null;

with numbered as (
  select id, row_number() over (
    partition by council_id order by created_at, id
  ) as nr
  from public.summary_feedback
  where seq is null
)
update public.summary_feedback f
set seq = numbered.nr
from numbered
where numbered.id = f.id;

alter table public.summary_feedback
  alter column council_id set not null,
  alter column seq set not null;

create unique index if not exists summary_feedback_council_seq_key
  on public.summary_feedback (council_id, seq);

/**
 * Nadaje uwadze radę i kolejny numer w tej radzie.
 *
 * Blokada doradcza na radzie, bo `max(seq)+1` bez niej potrafi wyprodukować
 * dwa razy ten sam numer przy równoczesnych zapisach; unikalny indeks jest
 * wtedy siatką bezpieczeństwa, ale kosztem błędu u użytkownika.
 */
create or replace function public.summary_feedback_assign_seq()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_council uuid;
begin
  select t.council_id into v_council
  from meeting m join term t on t.id = m.term_id
  where m.id = new.meeting_id;

  if v_council is null then
    raise exception 'Uwaga bez rady: posiedzenie % nie ma kadencji', new.meeting_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('summary_feedback_seq'), hashtext(v_council::text));

  new.council_id := v_council;
  new.seq := coalesce(
    (select max(seq) from summary_feedback where council_id = v_council), 0
  ) + 1;
  return new;
end;
$$;

drop trigger if exists summary_feedback_assign_seq on public.summary_feedback;
create trigger summary_feedback_assign_seq
  before insert on public.summary_feedback
  for each row execute function public.summary_feedback_assign_seq();

-- Wycofanie zamiast skasowania: ta sama osoba, to samo uprawnienie, co przy
-- dotychczasowym `delete`. Twardej polityki kasowania już nie ma — jeden
-- `delete` przebiłby dziurę w numeracji, na której stoi cały minor.
drop policy if exists "authors delete summary_feedback" on public.summary_feedback;

drop policy if exists "authors retire summary_feedback" on public.summary_feedback;
create policy "authors retire summary_feedback"
  on public.summary_feedback for update
  using (
    author_id = auth.uid()
    and exists (
      select 1 from meeting m join term t on t.id = m.term_id
      where m.id = summary_feedback.meeting_id
        and user_has_permission(auth.uid(), 'finalize_vote', t.council_id)
    )
  )
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from meeting m join term t on t.id = m.term_id
      where m.id = summary_feedback.meeting_id
        and user_has_permission(auth.uid(), 'finalize_vote', t.council_id)
    )
  );

-- Minor wersji promptu, którym powstał opis sesji. Osobno od
-- `summary_prompt_version` (major), bo to dwie różne rzeczy: major mówi,
-- która wersja pliku promptu, minor — z jakim zestawem uwag redakcji.
alter table public.meeting
  add column if not exists summary_prompt_minor integer;

/**
 * Co dokładnie poszło w pobranym pliku promptu.
 *
 * Etykieta `7.12` mówi, do którego numeru sięgały uwagi, ale nie mówi,
 * których w paczce zabrakło — a zabraknąć może, bo uwagi da się wycofać.
 * Ten wiersz zapisuje konkretną listę numerów, więc zbiór jest odtwarzalny
 * także po wycofaniu, i nie zależy od tego, czy model nie pogubi długiej
 * listy w drodze powrotnej.
 */
create table if not exists public.prompt_download (
  id uuid primary key default gen_random_uuid(),
  council_id uuid not null references public.council(id),
  -- Prompt spraw pobiera się dla całej rady, bez sesji — stąd nullable.
  meeting_id uuid references public.meeting(id) on delete set null,
  kind text not null check (kind in ('podsumowanie', 'sprawy')),
  prompt_version integer not null,
  -- Najwyższy `seq` w paczce; 0 = pobrano bez uwag.
  feedback_minor integer not null,
  feedback_seqs integer[] not null default '{}',
  downloaded_by uuid references public.app_user(id),
  created_at timestamptz not null default now()
);

create index if not exists prompt_download_council_created_idx
  on public.prompt_download (council_id, created_at desc);

alter table public.prompt_download enable row level security;

drop policy if exists "moderators read prompt_download" on public.prompt_download;
create policy "moderators read prompt_download"
  on public.prompt_download for select
  using (user_has_permission(auth.uid(), 'finalize_vote', council_id));

drop policy if exists "moderators write prompt_download" on public.prompt_download;
create policy "moderators write prompt_download"
  on public.prompt_download for insert
  with check (
    downloaded_by = auth.uid()
    and user_has_permission(auth.uid(), 'finalize_vote', council_id)
  );

commit;

-- Dopisane po zderzeniu z generatorem typów: `council_id` i `seq` wypełnia
-- wyzwalacz, ale kolumny NOT NULL bez wartości domyślnej generator uznaje za
-- obowiązkowe przy zapisie i aplikacja nie kompiluje się bez podania czegoś,
-- czego z aplikacji podać się nie da (numer musi powstać pod blokadą w bazie).
-- Wymóg zostaje ten sam, tylko wyrażony ograniczeniem CHECK, którego generator
-- nie widzi.
begin;

alter table public.summary_feedback
  alter column council_id drop not null,
  alter column seq drop not null;

alter table public.summary_feedback
  drop constraint if exists summary_feedback_seq_wypelnione;
alter table public.summary_feedback
  add constraint summary_feedback_seq_wypelnione
  check (council_id is not null and seq is not null);

commit;
