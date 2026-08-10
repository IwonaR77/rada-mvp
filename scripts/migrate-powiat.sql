-- Przygotowanie schematu pod drugą radę: Radę Powiatu Grójeckiego
-- (plan: notatki/plan-powiat-grojecki-2026-08-10.md, Faza 1).
--
-- Dziś schemat zakłada, że rada jest jedna i że jest radą miasta. Trzy rzeczy
-- to blokują:
--   1. council.city_id jest NOT NULL, a powiat nie jest miastem;
--   2. official nie ma żadnego zakresu, więc pierwszy "Skarbnik" powiatu
--      skleiłby się w jedną osobę ze skarbnikiem gminy;
--   3. meeting zakłada esesja.pl (esesja_id), a powiat nadaje w innym serwisie.
--
-- Nie ruszamy esesja_id: zostaje dla gminy jako historyczny identyfikator.
-- Zamiast przeciążać je cudzym numerem, wprowadzamy parę (source, source_id)
-- jako właściwy klucz naturalny posiedzenia i backfillujemy nią gminę.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-powiat.sql

begin;

-- 1. Rada nie musi być radą miasta.
--    admin_unit_id spina radę z hierarchią ltree z modelu uprawnień, więc
--    manager o zakresie powiatowym obejmie tę radę bez dodatkowej logiki.
alter table public.council alter column city_id drop not null;
alter table public.council
  add column if not exists admin_unit_id uuid references public.admin_unit(id);

update public.council c
set admin_unit_id = ci.admin_unit_id
from public.city ci
where ci.id = c.city_id
  and c.admin_unit_id is null
  and ci.admin_unit_id is not null;

-- 2. Urzędnicy dostają zakres rady. Bez tego nie ma czym odróżnić urzędnika
--    powiatu od gminnego — official ma dziś tylko full_name i role.
alter table public.official
  add column if not exists council_id uuid references public.council(id);

update public.official o
set council_id = (select id from public.council where name = 'Rada Miejska w Grójcu')
where o.council_id is null;

alter table public.official alter column council_id set not null;

-- 3. Posiedzenie przestaje zakładać esesja.pl.
--    source_id to numeryczne id nagrania u dostawcy (dla transmisjaobrad np.
--    "28931"). Dla gminy backfillujemy je z esesja_id, żeby klucz naturalny
--    był jednolity dla obu rad.
alter table public.meeting
  add column if not exists source text not null default 'esesja';
alter table public.meeting
  add column if not exists source_id text;

update public.meeting
set source_id = esesja_id
where source_id is null and esesja_id is not null;

-- Idempotencja rozpoznawania sesji przenosi się z aplikacji do bazy: dziś
-- discover-new-sessions.mjs pilnuje duplikatów wyłącznie w JS, a w bazie nie
-- ma na to żadnego ograniczenia.
create unique index if not exists meeting_source_natural_key
  on public.meeting (source, source_id)
  where source_id is not null;

-- 4. Która ścieżka transkrypcji obsługuje to posiedzenie.
--    transmisjaobrad.info udostępnia gotowe napisy WebVTT dla większości nagrań
--    — wtedy pobranie 1,5 h wideo i przepuszczenie go przez Groq jest czystym
--    marnotrawstwem. Ale nie dla wszystkich, więc "źródło = powiat" to za mało,
--    żeby o tym rozstrzygnąć; potrzebny jest fakt z listy nagrań.
--    NULL = nie wiemy (wszystkie sesje esesja.pl) i traktujemy jak brak napisów,
--    czyli ścieżkę Groq — dokładnie to, co się z nimi dzieje dzisiaj.
alter table public.meeting
  add column if not exists subtitles_available boolean;

-- 5. Wyszukiwanie musi umieć zawęzić się do jednej rady.
--    Dotąd search_segments przyjmowała wyłącznie frazę, bo rada była jedna.
--    Od pierwszej zaimportowanej sesji powiatu ta sama lista wyników miesza
--    dwie rady, a nic w wynikach nie mówi, która jest która.
--    Parametr jest opcjonalny (null = szukaj we wszystkich radach), więc
--    dotychczasowe wywołanie z samą frazą działa bez zmian. Zwracamy też radę,
--    żeby wynik dało się opisać bez dodatkowego zapytania na każdy wiersz.
drop function if exists public.search_segments(text);
drop function if exists public.search_segments(text, uuid);

create function public.search_segments(search_query text, p_council_id uuid default null)
returns table (
  id uuid,
  meeting_id uuid,
  meeting_title text,
  meeting_date date,
  start_time numeric,
  headline text,
  council_id uuid,
  council_name text
)
language sql
stable
as $$
  select
    s.id,
    s.meeting_id,
    m.title,
    m.date,
    s.start_time,
    ts_headline(
      'simple', s.text, plainto_tsquery('simple', search_query),
      'MaxWords=15, MinWords=5, ShortWord=3, HighlightAll=false, MaxFragments=1, StartSel=§§§, StopSel=§§§'
    ),
    c.id,
    c.name
  from segment s
  join meeting m on m.id = s.meeting_id
  join term t on t.id = m.term_id
  join council c on c.id = t.council_id
  where s.search_vector @@ plainto_tsquery('simple', search_query)
    and (p_council_id is null or c.id = p_council_id)
  order by ts_rank(s.search_vector, plainto_tsquery('simple', search_query)) desc
  limit 50;
$$;

grant execute on function public.search_segments(text, uuid) to anon, authenticated;

commit;
