-- PoC pamięci semantycznej spraw (notatki/dyskusja-z-chatgpt-pamiec-semantyczna.txt,
-- pamięć project_semantic_matter_poc) — czy nowa, surowa wypowiedź z sesji
-- pasuje do już znanej `sprawy`, mimo innych słów niż w jej opisie.
--
-- Embeddingi liczone lokalnie (Xenova/multilingual-e5-small, 384 wymiary,
-- skwantyzowane) przez scripts/lib/embeddings.mjs — zero kosztu, zero
-- limitu API, więc nie oszczędzamy na zakresie: cała historia gotowych
-- bloków wypowiedzi, nie tylko próbka.
--
-- Dane pisane wyłącznie skryptem po SUPABASE_DB_URL, ten sam wzorzec co
-- scripts/migrate-councilor-profile-revision.sql — odczyt na zasadach
-- ogólnych, zapis wyłącznie managerowie.

create extension if not exists vector;

-- Embedding samej sprawy (tytuł+notatki) — do wykrywania kandydatów na
-- scalenie między już nazwanymi sprawami. Nullable: dopisywany backfillem,
-- nie przy tworzeniu sprawy.
alter table matter add column if not exists embedding vector(384);

-- Bloki wypowiedzi (src/lib/speech-blocks.ts: mergeIntoBlocks) nie istnieją
-- nigdzie w bazie — liczą się w locie z segmentów. Ta tabela jest ich
-- jedynym trwałym zapisem, i tylko dla tych, które doczekały się embeddingu.
--
-- first_segment_id to ta sama "jedyna trwała kotwica", której blok używa w
-- aplikacji (zakładki) — dzięki temu backfill jest idempotentny (unique),
-- a nie trzeba wymyślać nowego identyfikatora bloku.
create table if not exists speech_block_embedding (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meeting(id) on delete cascade,
  councilor_id uuid not null references councilor(id) on delete cascade,
  first_segment_id uuid not null references segment(id) on delete cascade,
  start_time numeric not null,
  end_time numeric not null,
  text text not null,
  embedding vector(384) not null,
  created_at timestamptz not null default now(),
  unique (meeting_id, first_segment_id)
);

comment on table speech_block_embedding is
  'PoC: embedding każdego bloku wypowiedzi (segmenty finalized+confirmed, sklejone progiem 30s) — patrz mergeIntoBlocks w src/lib/speech-blocks.ts. Backfill: scripts/poc-embeduj-bloki.mjs.';

create index if not exists idx_sbe_meeting on speech_block_embedding(meeting_id);
create index if not exists idx_sbe_councilor on speech_block_embedding(councilor_id);

alter table speech_block_embedding enable row level security;

drop policy if exists "public read speech_block_embedding" on speech_block_embedding;
create policy "public read speech_block_embedding" on speech_block_embedding
  for select using (user_has_permission(auth.uid(), 'browse'));

drop policy if exists "managers manage speech_block_embedding" on speech_block_embedding;
create policy "managers manage speech_block_embedding" on speech_block_embedding
  for all using (is_manager(auth.uid())) with check (is_manager(auth.uid()));
