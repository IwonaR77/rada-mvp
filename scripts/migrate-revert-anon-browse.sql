-- Cofa scripts/migrate-anon-browse.sql: eSesja.tv (dostawca nagrań, z
-- których serwis korzysta) nie potwierdziła zgody na sposób ich
-- przetwarzania, więc do wyjaśnienia serwis nie jest już publiczny ani
-- nawet ogólnie dostępny dla zalogowanych — patrz src/lib/site-lockdown.ts.
-- Ta migracja domyka stronę bazy: bez niej surowe zapytanie REST kluczem
-- anon (publicznym w przeglądarce) nadal zwracałoby dane, mimo że proxy.ts
-- już nikogo poza właścicielką nie wpuszcza do samej aplikacji.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-revert-anon-browse.sql

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
    );
$$;

commit;
