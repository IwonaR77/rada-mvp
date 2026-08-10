-- Blokowanie konta w Serwisie (Regulamin §5.6).
--
-- Model uprawnień obiecywał to od początku: „cofnij samo browse, żeby
-- całkowicie zablokować nadużywające konto" (patrz nagłówek
-- scripts/migrate-require-login-browse.sql). W praktyce nie działało —
-- grant_browse_permission() jest wołane z /auth/callback przy KAŻDYM logowaniu
-- i wstawia browse z powrotem, bo jedynym warunkiem było „nie ma jeszcze
-- browse". Blokada rozbrajała się sama przy pierwszym zalogowaniu.
--
-- Dlatego blokada jest stanem konta, a nie brakiem wiersza w user_role: brak
-- wiersza to dokładnie to, co logowanie uzupełnia. Wierszy user_role przy
-- blokowaniu NIE kasujemy — odblokowanie ma przywrócić poprzedni poziom
-- zamiast po cichu go gubić.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-block-account.sql

begin;

alter table public.app_user
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_by uuid references public.app_user(id),
  add column if not exists blocked_reason text;

comment on column public.app_user.blocked_at is
  'Kiedy zablokowano dostęp do Serwisu (Regulamin §5.6). NULL = konto czynne. Nie dotyczy konta auth w Supabase — osoba nadal może się zalogować, po prostu nic nie zobaczy.';

-- 1. Zablokowane konto nie ma żadnych uprawnień.
--    Kontrola siedzi tutaj, a nie w każdej polityce RLS z osobna: wszystkie
--    polityki i tak wołają tę funkcję, więc jedno miejsce odcina wszystko
--    naraz i nie da się o nim zapomnieć przy dodawaniu nowej tabeli.
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

-- 2. Logowanie nie odblokowuje.
--    Sama zmiana w user_has_permission by wystarczyła, żeby zablokowany nic
--    nie zobaczył, ale wiersz z browse i tak by mu się dopisywał przy każdym
--    logowaniu — a panel czytałby go jako czynne uprawnienie.
create or replace function public.grant_browse_permission(uid uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into user_role (app_user_id, role, permissions)
  select uid, 'manager', array['browse']
  where not exists (
    select 1 from user_role
    where app_user_id = uid and permissions @> array['browse']
  )
  and not exists (
    select 1 from app_user au where au.id = uid and au.blocked_at is not null
  );
end;
$$;

-- 3. Pozostałe bramki też muszą znać blokadę.
--    is_manager i is_moderator nie przechodzą przez user_has_permission, więc
--    bez tego zablokowany manager dalej otwierałby /admin/konta, a zablokowany
--    moderator dalej zatwierdzałby przypisania mówców.
create or replace function public.is_manager(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from user_role ur
    join app_user au on au.id = ur.app_user_id
    where ur.app_user_id = uid
      and ur.role = 'manager'
      and ur.permissions @> array['full_access']
      and au.blocked_at is null
  );
$$;

create or replace function public.is_moderator(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from app_user
    where id = uid and role in ('moderator', 'admin') and blocked_at is null
  );
$$;

-- 4. Zapis blokady przez funkcję, nie przez politykę UPDATE na app_user.
--    Managerowie nie mają dziś prawa zapisu do app_user i celowo tak zostaje:
--    polityka UPDATE otworzyłaby im całą tabelę (display_name, reputation,
--    liczniki głosów), a potrzebne są dokładnie trzy kolumny. Bez tej funkcji
--    blokowanie z panelu po cichu nic by nie zapisywało — brak polityki nie
--    zgłasza błędu (patrz feedback_rls_silent_denial).
create or replace function public.set_account_blocked(
  target_id uuid,
  blocked boolean,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- user_has_permission, nie is_manager sprzed tej migracji: zablokowany
  -- manager nie może odblokować sam siebie.
  if not user_has_permission(auth.uid(), 'full_access') then
    raise exception 'Brak uprawnień do blokowania kont';
  end if;
  if target_id = auth.uid() then
    raise exception 'Nie możesz zablokować własnego konta';
  end if;

  update app_user
  set blocked_at = case when blocked then now() else null end,
      blocked_by = case when blocked then auth.uid() else null end,
      blocked_reason = case when blocked then nullif(btrim(coalesce(reason, '')), '') else null end
  where id = target_id;

  if not found then
    raise exception 'Nie ma takiego konta';
  end if;
end;
$$;

grant execute on function public.set_account_blocked(uuid, boolean, text) to authenticated;

commit;
