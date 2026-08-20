-- Wyniki wyborów samorządowych z PKW: kandydaci, komitety, okręgi, głosy.
--
-- Po co, skoro mamy już komitety w councilor_term: tamto ma wyłącznie 21
-- zwycięzców i ani jednej liczby. Tu wchodzi komplet — 200 kandydatów, 8
-- komitetów, głosy co do sztuki — czyli materiał na pytanie, którego rada
-- sama sobie nie zada: ile głosów stoi za tym składem i czy przy innym
-- przeliczniku byłby inny.
--
-- Osobne tabele, a nie kolumny przy councilor: kandydat to nie radny.
-- Większość z tych 200 osób nigdy nie zasiądzie w radzie i nie ma powodu
-- zakładać im wierszy w councilor. Powiązanie idzie w drugą stronę —
-- election_candidate.councilor_id, nullable, wypełniane tylko tam, gdzie
-- kandydat naprawdę jest w naszej bazie.
--
-- Nazwy z przedrostkiem election_, bo `district` już istnieje i znaczy co
-- innego (dzielnica miasta przy council), a `committee` to komisja rady.
-- Bez przedrostka byłyby to trzy różne znaczenia tego samego słowa.

create table if not exists election (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references term(id) on delete cascade,
  held_on date not null,
  seats integer not null check (seats > 0),
  teryt text not null,
  source text not null default 'pkw-samorzad2024',
  source_dataset text not null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (term_id)
);

comment on table election is
  'Wybory, które wyłoniły daną kadencję rady. Jedne wybory na kadencję.';

create table if not exists election_district (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references election(id) on delete cascade,
  number integer not null check (number > 0),
  seats integer not null check (seats > 0),
  valid_votes integer not null check (valid_votes >= 0),
  unique (election_id, number)
);

comment on table election_district is
  'Okręg wyborczy — jednostka podziału mandatów. NIE mylić z `district` (dzielnica miasta).';

create table if not exists election_committee (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references election(id) on delete cascade,
  list_number integer not null check (list_number > 0),
  name text not null,
  short_name text not null,
  -- Ten sam kod co councilor_term.election_committee_code, żeby kolory i
  -- etykiety na mapie korelacji i na stronie wyborów znaczyły to samo.
  code text not null check (char_length(code) <= 6),
  unique (election_id, list_number),
  unique (election_id, code)
);

create table if not exists election_candidate (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references election(id) on delete cascade,
  district_id uuid not null references election_district(id) on delete cascade,
  committee_id uuid not null references election_committee(id) on delete cascade,
  list_position integer not null check (list_position > 0),
  full_name text not null,
  votes integer not null check (votes >= 0),
  won_mandate boolean not null,
  age integer,
  gender text,
  residence text,
  support text,
  -- Dopasowanie do naszej bazy radnych. Nullable, bo większość kandydatów
  -- nie weszła do rady i nie ma tu czego dopasowywać.
  councilor_id uuid references councilor(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (election_id, district_id, committee_id, list_position)
);

create index if not exists idx_election_candidate_election on election_candidate(election_id);
create index if not exists idx_election_candidate_committee on election_candidate(committee_id);
create index if not exists idx_election_candidate_councilor on election_candidate(councilor_id)
  where councilor_id is not null;

-- RLS: dane importowane, nie tworzone w aplikacji — odczyt na tych samych
-- zasadach co reszta serwisu, zapis wyłącznie dla managerów (import i tak
-- chodzi po SUPABASE_DB_URL, czyli obok RLS).
--
-- Uwaga z wcześniejszej wtopy: polityki WITH CHECK są OR-owane, więc każda
-- tabela dostaje dokładnie jedną politykę zapisu — żadnego `with check (true)`
-- obok ograniczonej polityki, bo to unieważnia tę drugą.
alter table election enable row level security;
alter table election_district enable row level security;
alter table election_committee enable row level security;
alter table election_candidate enable row level security;

do $$
declare t text;
begin
  foreach t in array array['election','election_district','election_committee','election_candidate']
  loop
    execute format('drop policy if exists "public read %1$s" on %1$I', t);
    execute format(
      'create policy "public read %1$s" on %1$I for select using (user_has_permission(auth.uid(), ''browse''))', t);
    execute format('drop policy if exists "managers manage %1$s" on %1$I', t);
    execute format(
      'create policy "managers manage %1$s" on %1$I for all using (is_manager(auth.uid())) with check (is_manager(auth.uid()))', t);
  end loop;
end $$;
