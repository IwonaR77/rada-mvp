-- Wspólna skala dla wykresów na profilach radnych.
--
-- Do każdego wiersza dokładamy maksimum z CAŁEJ kadencji (najdłuższy czas
-- wypowiedzi jednego radnego na jednej sesji). Bez tego każdy profil skalował
-- się do własnego szczytu i słupki radnego mówiącego 3 minuty wyglądały tak
-- samo jak słupki przewodniczącej mówiącej 40 — wykresy dwóch osób nie dawały
-- się porównać, choć wyglądały identycznie.
--
-- Maksimum liczone tylko po radnych (`is_councilor_flag`), bo to ich profile
-- porównujemy; burmistrz mówiący najwięcej w radzie zaniżałby wszystkie słupki.
-- DROP przed CREATE, bo zmienia się lista kolumn zwracanych (doszło
-- `max_seconds`), a Postgres nie pozwala tego zrobić przez CREATE OR REPLACE.
drop function if exists public.councilor_speaking_by_meeting(uuid, uuid);

create function public.councilor_speaking_by_meeting(
  p_councilor_id uuid,
  p_term_id uuid
)
returns table(meeting_id uuid, meeting_date date, seconds numeric, max_seconds numeric)
language sql
stable
as $$
  with bloki as (select * from term_speaking_blocks(p_term_id)),
       sufit as (
         select coalesce(max(total_seconds), 0) as m
           from bloki where is_councilor_flag
       )
  select m.id, m.date, coalesce(b.total_seconds, 0), sufit.m
    from meeting m
    cross join sufit
    left join bloki b
      on b.mtg_id = m.id and b.speaker_id = p_councilor_id and b.is_councilor_flag
   where m.term_id = p_term_id
     and m.meeting_type is distinct from 'komisja'
   order by m.date;
$$;
