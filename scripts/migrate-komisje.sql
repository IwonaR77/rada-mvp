-- Prace komisji: harmonogram posiedzeń, protokoły i wnioski o ich udostępnienie.
--
-- Do dziś komisje istniały w serwisie szczątkowo — jako pojedyncze wiersze
-- `meeting` z `meeting_type='komisja'`, świadomie wykluczane z każdego widoku,
-- żeby nie mieszały się z sesjami. To wystarczało, dopóki komisje były
-- ciekawostką. Przestaje wystarczać, gdy mają być pilnowane automatycznie:
-- automat musi pamiętać, o co już pytał i co dostał, inaczej co miesiąc
-- zaczyna od zera.
--
-- Osobne tabele, a nie kolumny w `meeting`, z dwóch powodów:
-- 1. Posiedzenie komisji nie ma nagrania, transkrypcji, mówców ani głosowań —
--    czyli nie ma połowy tego, czym jest `meeting`. Dokładanie do niej kolumn
--    „protokół" i „status wniosku" obciążyłoby 65 sesji polami, które ich
--    nie dotyczą.
-- 2. Komisja jest bytem trwałym, ponad posiedzeniami — zakładka „prace komisji"
--    z podziałem na komisje potrzebuje czegoś, do czego można się odwołać.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-komisje.sql

begin;

create table if not exists public.committee (
  id uuid primary key default gen_random_uuid(),
  council_id uuid not null references public.council(id) on delete cascade,
  name text not null,
  -- Identyfikator grupy na esesja.pl (/grupa/31703/...) — po nim da się dojść
  -- do pełnego archiwum posiedzeń tej komisji, gdy strona zbiorcza pokazuje
  -- tylko ostatnie kilkanaście.
  esesja_group_id text,
  created_at timestamptz not null default now(),
  unique (council_id, name)
);

create table if not exists public.committee_meeting (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references public.committee(id) on delete cascade,
  date date not null,
  -- Numer rzymski z esesji („XVII"). Tekst, bo tak go podaje źródło i tak
  -- występuje w pismach do urzędu.
  number text,
  esesja_url text,
  --  brak        — posiedzenie się odbyło, protokołu nigdzie nie ma
  --  zazadany    — jest w wysłanym wniosku, czekamy
  --  otrzymany   — urząd przysłał, leży u nas
  --  opublikowany— urząd opublikował go sam (wtedy wniosek jest bezprzedmiotowy)
  protocol_status text not null default 'brak'
    check (protocol_status in ('brak', 'zazadany', 'otrzymany', 'opublikowany')),
  protocol_url text,
  protocol_received_at date,
  created_at timestamptz not null default now(),
  unique (committee_id, date)
);

create index if not exists idx_committee_meeting_status
  on public.committee_meeting (protocol_status, date);

create table if not exists public.foi_request (
  id uuid primary key default gen_random_uuid(),
  council_id uuid not null references public.council(id) on delete cascade,
  subject text not null,
  body text not null,
  -- Id wersji roboczej w Gmailu. Automat tworzy TYLKO draft; wysyła człowiek,
  -- więc `sent_at` uzupełnia się dopiero po wykryciu wiadomości w „Wysłanych".
  gmail_draft_id text,
  gmail_thread_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  -- Ustawowe 14 dni od wysłania — po tej dacie brak odpowiedzi sam jest
  -- informacją i podstawą do ponaglenia.
  due_at date,
  answered_at timestamptz,
  note text
);

create table if not exists public.foi_request_meeting (
  request_id uuid not null references public.foi_request(id) on delete cascade,
  committee_meeting_id uuid not null references public.committee_meeting(id) on delete cascade,
  primary key (request_id, committee_meeting_id)
);

alter table public.committee enable row level security;
alter table public.committee_meeting enable row level security;
alter table public.foi_request enable row level security;
alter table public.foi_request_meeting enable row level security;

-- Harmonogram i protokoły są docelowo publiczne (zakładka „prace komisji"),
-- więc czytają je wszyscy, którzy w ogóle mogą przeglądać serwis.
create policy "public read committee" on public.committee
  for select using (user_has_permission(auth.uid(), 'browse'));

create policy "public read committee_meeting" on public.committee_meeting
  for select using (user_has_permission(auth.uid(), 'browse'));

-- Korespondencja z urzędem nie jest treścią serwisu — to warsztat redakcji.
create policy "managers read foi_request" on public.foi_request
  for select using (user_has_permission(auth.uid(), 'full_access', council_id));

create policy "managers read foi_request_meeting" on public.foi_request_meeting
  for select using (
    exists (
      select 1 from foi_request r
      where r.id = foi_request_meeting.request_id
        and user_has_permission(auth.uid(), 'full_access', r.council_id)
    )
  );

-- Zapis wyłącznie przez skrypty (połączenie właściciela bazy, z pominięciem
-- RLS). Aplikacja niczego tu nie zapisuje, więc świadomie nie ma polityk
-- INSERT/UPDATE — gdyby kiedyś powstał panel, trzeba je dopisać, a brak
-- polityki objawi się cichym „zero wierszy" (patrz feedback_rls_silent_denial).

commit;
