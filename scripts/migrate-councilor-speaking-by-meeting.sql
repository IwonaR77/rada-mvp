-- Czas wypowiedzi jednego radnego w rozbiciu na sesje — PER BLOK.
--
-- Nadbudowa nad `term_speaking_blocks`, żeby logika bloków (blok przerywa
-- wtrącenie innej osoby, segment nieotagowany albo przerwa dłuższa niż próg)
-- żyła w jednym miejscu. Profil radnego liczył dotąd czas per segment i
-- pokazywał liczbę o ~17% niższą niż heatmapa tej samej rady.
--
-- Zwraca też sesje, w których radny nie zabrał głosu (zero sekund) — wykres
-- na profilu ma pokazywać przebieg kadencji, a nie tylko dni z wypowiedziami.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-councilor-speaking-by-meeting.sql

create or replace function public.councilor_speaking_by_meeting(
  p_councilor_id uuid,
  p_term_id uuid
)
returns table(meeting_id uuid, meeting_date date, seconds numeric)
language sql
stable
as $$
  select m.id, m.date, coalesce(b.total_seconds, 0)
    from meeting m
    left join term_speaking_blocks(p_term_id) b
      on b.mtg_id = m.id and b.speaker_id = p_councilor_id and b.is_councilor_flag
   where m.term_id = p_term_id
     and m.meeting_type is distinct from 'komisja'
   order by m.date;
$$;
