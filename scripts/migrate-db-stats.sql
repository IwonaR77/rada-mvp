-- Statystyki bazy dla panelu managera.
--
-- `pg_stat_user_tables` i `pg_database_size` leżą w katalogu systemowym,
-- do którego PostgREST nie sięga — stąd funkcja. SECURITY DEFINER, bo
-- zwykły użytkownik nie ma prawa czytać katalogu, ale z jawnym sprawdzeniem
-- uprawnienia w środku: bez niego funkcja byłaby furtką dla każdego
-- zalogowanego.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-db-stats.sql

create or replace function public.db_stats()
returns table(tabela text, wierszy bigint, rozmiar_bajty bigint, baza_bajty bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if not is_manager(auth.uid()) then
    raise exception 'Brak uprawnień';
  end if;

  return query
    select t.relname::text, t.n_live_tup, pg_total_relation_size(t.relid),
           pg_database_size(current_database())
      from pg_stat_user_tables t
     order by pg_total_relation_size(t.relid) desc
     limit 12;
end;
$$;
