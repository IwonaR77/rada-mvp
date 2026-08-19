-- Prywatne zakładki użytkownika przy blokach wypowiedzi radnego.
--
-- Bloki nie istnieją w bazie — powstają dopiero przy renderowaniu profilu
-- (mergeIntoBlocks w src/lib/speech-blocks.ts), więc kotwicą jest segment_id
-- PIERWSZEGO segmentu bloku. Jest dokładniejszy niż sekunda i przeżywa zmianę
-- progu sklejania: po zmianie progu zakładka wskazuje blok, w którym ten
-- segment się znalazł, po prostu niekoniecznie jego początek.
--
-- anchor_seconds trzymamy obok jako zapas — gdyby segment kiedyś zniknął
-- (ponowny import z `force` wymiata wszystkie segmenty sesji), zostaje
-- pozycja na osi nagrania. Podział segmentu (splitSegment) jest bezpieczny:
-- zostawia stary wiersz i dopisuje drugą połowę jako nowy, więc kotwica się
-- nie sieroci.
--
-- Zakres v1 celowo prywatny: publiczne adnotacje przy cudzych wypowiedziach
-- to już system komentarzy z moderacją, a nie zakładka.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-bookmarks.sql

begin;

create table if not exists public.bookmark (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user(id) on delete cascade,
  segment_id uuid not null references public.segment(id) on delete cascade,
  meeting_id uuid not null references public.meeting(id) on delete cascade,
  -- Radny, na którego profilu zakładka powstała. Da się go wyliczyć z
  -- segmentu, ale tam może zostać odpięty (ON DELETE SET NULL przy usuwaniu
  -- osoby, cofnięcie przypisania) — a zakładka ma zostać tam, gdzie ją
  -- założono.
  councilor_id uuid references public.councilor(id) on delete cascade,
  anchor_seconds numeric not null,
  note text,
  created_at timestamptz not null default now(),
  -- Jedna zakładka na blok: przycisk przy bloku jest przełącznikiem, a nie
  -- sposobem na zrobienie dziesięciu zakładek w tym samym miejscu.
  unique (user_id, segment_id)
);

-- Pasek zakładek czyta zawsze „moje zakładki tego radnego", w kolejności
-- chronologicznej bloków — stąd taki właśnie indeks.
create index if not exists bookmark_user_councilor_idx
  on public.bookmark (user_id, councilor_id, anchor_seconds);

alter table public.bookmark enable row level security;

-- Cztery osobne polityki zamiast jednej „for all": WITH CHECK z różnych
-- polityk jest OR-owane, więc jedna nadmiarowo szeroka unieważniłaby
-- pozostałe. Każda operacja ma tu ten sam, jedyny warunek: właściciel.
drop policy if exists "owners read bookmark" on public.bookmark;
create policy "owners read bookmark" on public.bookmark
  for select using (user_id = auth.uid());

drop policy if exists "owners insert bookmark" on public.bookmark;
create policy "owners insert bookmark" on public.bookmark
  for insert with check (user_id = auth.uid());

drop policy if exists "owners update bookmark" on public.bookmark;
create policy "owners update bookmark" on public.bookmark
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "owners delete bookmark" on public.bookmark;
create policy "owners delete bookmark" on public.bookmark
  for delete using (user_id = auth.uid());

commit;
