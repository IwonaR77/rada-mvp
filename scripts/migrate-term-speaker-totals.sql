-- Suma czasu wypowiedzi radnego w kadencji, liczona w bazie.
--
-- Dotąd `getSpeakingActivity` ściągało do aplikacji WSZYSTKIE zatwierdzone
-- segmenty kadencji (25 604 w Grójcu i rosnąco), po tysiąc na żądanie, czyli
-- 26 kolejnych zapytań do bazy w chmurze — tylko po to, żeby zsumować długości
-- per radny. Stąd kilkusekundowe wejście na stronę rady.
--
-- Liczone PER SEGMENT, nie per blok wypowiedzi — świadomie, tak jak dotąd:
-- podium i profile radnych mają dotychczasowe liczby, a zmiana metody
-- przesunęłaby je wszystkie naraz (patrz komentarz przy `heatmapMatrix`
-- w src/lib/council-activity.ts).
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-term-speaker-totals.sql

create or replace function public.term_speaker_totals(p_term_id uuid)
returns table(councilor_id uuid, seconds numeric)
language sql
stable
as $$
  select s.confirmed_councilor_id, sum(s.end_time - s.start_time)
    from segment s
    join meeting m on m.id = s.meeting_id
   where m.term_id = p_term_id
     and s.status = 'finalized'
     and s.confirmed_councilor_id is not null
   group by s.confirmed_councilor_id;
$$;
