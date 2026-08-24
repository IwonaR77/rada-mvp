-- Rozszerzenie speech_block_embedding (scripts/migrate-embeddingi-semantyczne.sql)
-- o bloki wypowiedzi urzędników (burmistrz, zastępcy, naczelnicy) — dotąd
-- tabela obejmowała wyłącznie radnych (councilor_id not null), co pomijało
-- 14 078 z 33 045 sfinalizowanych segmentów Grójca (43%) — w tym dużą część
-- merytorycznych odpowiedzi burmistrza, nie tylko pytań radnych.
--
-- councilor_id/official_id: nullable, dokładnie jeden wypełniony — ten sam
-- wzorzec co matter_reference (wiele nullable kolumn + CHECK), nie
-- polimorficzny speaker_id/speaker_type, żeby zachować FK integrity osobno
-- dla każdego typu mówcy.

alter table speech_block_embedding alter column councilor_id drop not null;
alter table speech_block_embedding add column if not exists official_id uuid references official(id) on delete cascade;

alter table speech_block_embedding drop constraint if exists speech_block_embedding_dokladnie_jeden_mowca;
alter table speech_block_embedding add constraint speech_block_embedding_dokladnie_jeden_mowca
  check ((councilor_id is not null) <> (official_id is not null));

create index if not exists idx_sbe_official on speech_block_embedding(official_id);

comment on table speech_block_embedding is
  'PoC: embedding każdego bloku wypowiedzi (segmenty finalized, sklejone progiem 30s) — radnego (councilor_id) albo urzędnika (official_id), dokładnie jedno z dwóch. Patrz mergeIntoBlocks w src/lib/speech-blocks.ts. Backfill: scripts/poc-embeduj-bloki.mjs.';
