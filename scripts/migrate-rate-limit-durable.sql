-- Trwały (Postgres-owy) licznik rate limitu, dla tras uruchamianych na
-- Vercelu — w odróżnieniu od `src/lib/rate-limit.ts` (licznik w pamięci
-- procesu), które działa poprawnie tylko na jednoprocesowym serwerze
-- domowym (systemd). Na Vercelu każde żądanie może trafić na inną
-- instancję funkcji, więc licznik w pamięci liczy osobno na każdej i limit
-- realnie prawie nie działa.
--
-- Używane przez `src/proxy.ts` (middleware, każde żądanie) do:
-- 1) limitu na `/szukaj` (już istniał, tylko przeniesiony na trwały licznik),
-- 2) nowego ogólnego limitu na strony z danymi (sesje/sprawy/radni), żeby
--    masowe pobieranie otagowanych ręcznie segmentów (patrz rozmowa
--    2026-08-24 o ochronie przed scrapingiem) kosztowało więcej niż jest
--    warte, a nie żeby całkiem zablokować dostęp — dane są z założenia
--    publiczne.
--
-- `rate_limit_bucket` nie ma polityk RLS (domyślna odmowa), więc klucz
-- anon nie może go czytać/pisać wprost — jedyna droga to `check_rate_limit`
-- poniżej, `security definer`. Wielkość tabeli ograniczona liczbą unikalnych
-- kluczy (IP × trasa), nie liczbą żądań — każde żądanie robi UPSERT na tym
-- samym wierszu w oknie, nie nowy wiersz. Sprzątanie starych wierszy dzieje
-- się okazjonalnie (1% wywołań), więc nie trzeba osobnego crona.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-rate-limit-durable.sql

begin;

create table if not exists public.rate_limit_bucket (
  key text primary key,
  count integer not null default 1,
  reset_at timestamptz not null
);

alter table public.rate_limit_bucket enable row level security;

-- Atomowy upsert-inkrement: `on conflict ... do update` bierze blokadę na
-- wierszu, więc równoległe żądania z tego samego klucza (ten sam
-- IP/trasa) liczą się poprawnie zamiast się gubić w wyścigu
-- odczyt-potem-zapis.
create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_reset_at timestamptz;
begin
  insert into rate_limit_bucket as b (key, count, reset_at)
  values (p_key, 1, v_now + make_interval(secs => p_window_seconds))
  on conflict (key) do update
    set count = case
          when b.reset_at <= v_now then 1
          else b.count + 1
        end,
        reset_at = case
          when b.reset_at <= v_now then v_now + make_interval(secs => p_window_seconds)
          else b.reset_at
        end
  returning b.count, b.reset_at into v_count, v_reset_at;

  if random() < 0.01 then
    delete from rate_limit_bucket where reset_at < v_now - interval '1 day';
  end if;

  if v_count > p_limit then
    return query select false, greatest(0, ceil(extract(epoch from (v_reset_at - v_now)))::integer);
  else
    return query select true, 0;
  end if;
end;
$$;

grant execute on function public.check_rate_limit(text, integer, integer) to anon, authenticated;

commit;
