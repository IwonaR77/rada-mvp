-- Historia rewizji przyrostowego profilu radnego (budowanego sesja-po-sesji,
-- zob. prompty/Prompt_Profil_Radnego_Iteracyjny_v7.md).
--
-- Świadomie bez kolumny na gotową prozę: renderujemy z `stan` przy każdym
-- odczycie profilu, tak jak dziś robi diagnostyczny render w
-- councilor-profile.tsx. "Proza jest funkcją stanu" dotyczy też historii,
-- nie tylko najnowszej rewizji — jedno źródło prawdy, żaden duplikat do
-- pilnowania w synchronizacji przy zmianie renderera.
--
-- Bez kolumny na wskaźnik postępu z tego samego powodu: to
-- `stan.sesje_przetworzone` / aktualna liczba sesji w kadencji, liczone
-- w locie przy odczycie — samoistnie spada, jeśli dojdzie nowa prawdziwa
-- sesja zanim radny ją dogoni, bez potrzeby osobnej aktualizacji.
--
-- Dane pisane wyłącznie przez scripts/profil/wdroz-produkcyjnie.mjs, po
-- SUPABASE_DB_URL — tak jak scripts/migrate-wybory.sql, nie przez appkę.
create table if not exists councilor_profile_revision (
  id uuid primary key default gen_random_uuid(),
  councilor_id uuid not null references councilor(id) on delete cascade,
  term_id uuid not null references term(id) on delete cascade,
  -- Kolejność w łańcuchu TEGO radnego (1, 2, 3…) — nie numer sesji kadencji,
  -- bo łańcuch zaczyna się od sesji 3 (seed), nie od pierwszej.
  seq integer not null check (seq > 0),
  -- Sesja, po której powstała ta rewizja. NULL tylko teoretycznie (na
  -- wszelki wypadek) — seed x=3 też ma realną meeting_id, po prostu trzecią
  -- sesję kadencji, nie sesję "swoją".
  meeting_id uuid references meeting(id) on delete set null,
  method text not null check (method in ('seed-jednorazowa', 'iteracyjna')),
  stan jsonb not null,
  prompt_version integer not null,
  created_at timestamptz not null default now(),
  unique (councilor_id, term_id, seq)
);

comment on table councilor_profile_revision is
  'Historia rewizji przyrostowo budowanego profilu radnego. Najnowsza rewizja per (councilor_id, term_id) = max(seq).';

create index if not exists idx_cpr_councilor on councilor_profile_revision(councilor_id, term_id, seq desc);

-- RLS: dane generowane skryptem, nie w aplikacji — ten sam wzorzec co
-- scripts/migrate-wybory.sql (odczyt na zasadach ogólnych, zapis wyłącznie
-- managerowie). Jedna polityka zapisu — bez `with check (true)` obok
-- ograniczonej, bo polityki WITH CHECK są OR-owane (zob. notatkę
-- feedback_rls_with_check_or).
alter table councilor_profile_revision enable row level security;

drop policy if exists "public read councilor_profile_revision" on councilor_profile_revision;
create policy "public read councilor_profile_revision" on councilor_profile_revision
  for select using (user_has_permission(auth.uid(), 'browse'));

drop policy if exists "managers manage councilor_profile_revision" on councilor_profile_revision;
create policy "managers manage councilor_profile_revision" on councilor_profile_revision
  for all using (is_manager(auth.uid())) with check (is_manager(auth.uid()));
