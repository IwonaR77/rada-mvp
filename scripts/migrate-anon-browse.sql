-- Otwiera poziom uprawnień 'browse' dla anonimowych (bez logowania).
--
-- Kontekst: NEXT_PUBLIC_SUPABASE_ANON_KEY jest już publiczny w przeglądarce,
-- a rola `anon` ma już pełne uprawnienia GRANT na wszystkich tabelach
-- (sprawdzone na żywej bazie) — jedyną realną barierą jest ta funkcja,
-- wołana przez ~30 polityk SELECT. Dodajemy jedną gałąź `or`, tylko dla
-- perm = 'browse' (jedyne uprawnienie używane wyłącznie do odczytu — żadna
-- polityka INSERT/UPDATE/DELETE się na nie nie powołuje). Reszta funkcji bez
-- zmian względem scripts/migrate-block-account.sql.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-anon-browse.sql

begin;

create or replace function public.user_has_permission(
  uid uuid,
  perm text,
  target_council_id uuid default null::uuid,
  target_city_id uuid default null::uuid
)
returns boolean
language sql
stable
as $$
  select
    (perm = 'browse' and uid is null)
    or (
      not exists (select 1 from app_user au where au.id = uid and au.blocked_at is not null)
      and exists (
        select 1 from user_role ur
        where ur.app_user_id = uid
        and (ur.permissions @> array[perm] or ur.permissions @> array['full_access'])
        and (
          (ur.scope_council_id is null and ur.scope_city_id is null)
          or (target_council_id is not null and ur.scope_council_id = target_council_id)
          or (target_city_id is not null and ur.scope_city_id = target_city_id)
        )
      )
    );
$$;

commit;
