-- Liczba segmentów wg statusu — jedno zapytanie zamiast trzech `count` z
-- PostgREST, na potrzeby panelu managera.
create or replace function public.segment_status_counts()
returns table(status text, ile bigint)
language sql
stable
as $$
  select s.status, count(*) from segment s group by s.status;
$$;
