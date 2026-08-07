-- Revert public/anonymous browsing (introduced in af7d9f0, 2026-08-05) back
-- to login-required-for-everything, but as an explicit, revocable
-- permission ("browse") auto-granted on first login, rather than the
-- pre-af7d9f0 model of gating purely on auth.role() = 'authenticated'.
--
-- This lets a manager later revoke just the "browse" grant to fully block
-- an abusive account (per Regulamin §5.6) without touching their Supabase
-- auth account itself.
--
-- Run once, e.g.: psql "$SUPABASE_DB_URL" -f scripts/migrate-require-login-browse.sql

begin;

-- 1. Idempotent grant function, called from /auth/callback on every login.
create or replace function public.grant_browse_permission(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into user_role (app_user_id, role, permissions)
  select uid, 'manager', array['browse']
  where not exists (
    select 1 from user_role
    where app_user_id = uid and permissions @> array['browse']
  );
end;
$$;

grant execute on function public.grant_browse_permission(uuid) to authenticated;

-- 2. Backfill: every existing app_user gets "browse" so nobody who already
--    has an account is locked out once the RLS policies below tighten.
insert into user_role (app_user_id, role, permissions)
select au.id, 'manager', array['browse']
from app_user au
where not exists (
  select 1 from user_role ur
  where ur.app_user_id = au.id and ur.permissions @> array['browse']
);

-- 3. Tighten previously fully-public (qual = true) read policies.
alter policy "public read admin_unit" on public.admin_unit
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read city" on public.city
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read council" on public.council
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read councilor" on public.councilor
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read councilor_term" on public.councilor_term
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read district" on public.district
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read official" on public.official
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read interpellation" on public.interpellation
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read term" on public.term
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read meeting" on public.meeting
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read resolution" on public.resolution
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read resolution_vote" on public.resolution_vote
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read matter_thread" on public.matter_thread
  using (user_has_permission(auth.uid(), 'browse'));

-- 4. Tighten mixed policies whose "everyone else" branch was
--    auth.role() = 'authenticated' — under the old model this meant "any
--    logged-in user sees everything regardless of status", with anon only
--    seeing already-approved/finalized rows. Since anon now gets nothing
--    at all, the two branches collapse into a single browse-permission
--    check (X AND (status = 'approved' OR X) simplifies to X).
alter policy "public read flag" on public.flag
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read matter" on public.matter
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read matter_participant" on public.matter_participant
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read matter_reference" on public.matter_reference
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read matter_relation" on public.matter_relation
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read matter_tag" on public.matter_tag
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read segment" on public.segment
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read user_role" on public.user_role
  using (user_has_permission(auth.uid(), 'browse'));

alter policy "public read vote" on public.vote
  using (user_has_permission(auth.uid(), 'browse'));

commit;
