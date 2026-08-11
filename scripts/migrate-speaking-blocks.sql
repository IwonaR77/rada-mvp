-- Czas mówienia w heatmapie liczony per BLOK, nie per segment.
--
-- Blok = przylegające do siebie segmenty tego samego mówcy, mierzone od
-- początku pierwszego do końca ostatniego. Sumowanie długości pojedynczych
-- segmentów gubiło pauzy WEWNĄTRZ jednej ciągłej wypowiedzi, a mówca w tym
-- czasie trzymał głos. Zmierzone na całej bazie 2026-08-11: 10,89 h per
-- segment wobec 12,72 h per blok, czyli +17%.
--
-- Dlaczego w SQL, a nie w aplikacji: poprawny podział na bloki wymaga
-- KOLEJNOŚCI WSZYSTKICH segmentów sesji, także nieotagowanych. Aplikacja
-- pobiera dziś wyłącznie `finalized`, więc nie widzi, że między dwiema
-- wypowiedziami danej osoby leży segment, którego nikt nie przypisał — i
-- skleiłaby je w jeden blok, dopisując tej osobie cudzy (albo niczyj) czas.
-- Przy 10% otagowania to nie jest przypadek brzegowy, tylko norma.
--
-- `p_max_gap` przerywa blok, gdy przerwa między segmentami przekracza próg.
-- Bez progu jedna wadliwie otagowana sesja potrafi wyprodukować „blok"
-- dwugodzinny (taki w bazie jest) i dopisać go komuś jako czas mówienia.
-- Zmierzony wpływ progu: bez progu 13,48 h, 120 s → 12,76 h, 60 s → 12,72 h,
-- 30 s → 12,54 h. Między 30 a 120 s różnica jest w granicach 2%, więc próg
-- nie jest parametrem krytycznym — ma odciąć patologie, nie stroić wynik.
--
-- Liczone wyłącznie z segmentów `finalized`, tak samo jak dotąd: propozycje
-- nie mogą wpływać na publiczne liczby o konkretnych osobach.
--
-- Funkcja jest SECURITY INVOKER (domyślnie), więc czyta pod RLS wołającego —
-- dokładnie tak, jak robił to dotąd kod aplikacji.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-speaking-blocks.sql

begin;

create or replace function public.term_speaking_blocks(
  p_term_id uuid,
  p_max_gap numeric default 60
)
returns table (
  speaker_id uuid,
  mtg_id uuid,
  is_councilor_flag boolean,
  total_seconds numeric
)
language sql
stable
as $$
  with all_seg as (
    select
      s.meeting_id,
      s.start_time,
      s.end_time,
      case
        when s.status = 'finalized'
        then coalesce(s.confirmed_councilor_id, s.confirmed_official_id)
      end as speaker,
      s.confirmed_councilor_id is not null as councilor_row,
      -- Numeracja po WSZYSTKICH segmentach sesji — to ona sprawia, że
      -- nieotagowany segment przerywa blok.
      row_number() over (partition by s.meeting_id order by s.start_time) as rn_all
    from segment s
    join meeting m on m.id = s.meeting_id
    where m.term_id = p_term_id
  ),
  marked as (
    select *,
      row_number() over (partition by meeting_id, speaker order by start_time) as rn_sp
    from all_seg
    where speaker is not null
  ),
  -- Klasyczne „wyspy i luki": różnica obu numeracji jest stała w obrębie
  -- jednego nieprzerwanego ciągu segmentów tego samego mówcy.
  runs as (
    select *, rn_all - rn_sp as run_id from marked
  ),
  gapped as (
    select *,
      start_time - lag(end_time) over (
        partition by meeting_id, speaker, run_id order by start_time
      ) as gap_before
    from runs
  ),
  blocked as (
    select *,
      count(*) filter (where gap_before > p_max_gap) over (
        partition by meeting_id, speaker, run_id order by start_time
      ) as blk
    from gapped
  ),
  per_block as (
    select
      speaker,
      meeting_id,
      bool_or(councilor_row) as councilor_row,
      max(end_time) - min(start_time) as seconds
    from blocked
    group by speaker, meeting_id, run_id, blk
  )
  select speaker, meeting_id, bool_or(councilor_row), sum(seconds)
  from per_block
  group by speaker, meeting_id;
$$;

commit;
