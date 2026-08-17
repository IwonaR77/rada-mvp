-- Flagowanie segmentów przesuniętych w czasie względem nagrania.
--
-- Tabela `flag` istniała już (segment, autor, powód, status), ale bez polityki
-- na DELETE: autor mógł flagę postawić i nie mógł jej zdjąć. RLS nie zgłasza
-- przy tym błędu — kasowanie po prostu nie usuwa żadnego wiersza i z poziomu
-- interfejsu wygląda to jak zawieszony przycisk.
--
-- Indeks po segmencie: widok sesji pyta „które segmenty tej sesji są
-- oflagowane" przy każdym wejściu.
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-flag-desync.sql

begin;

create policy "authors delete own flag"
  on public.flag for delete
  using (auth.uid() = app_user_id);

create index if not exists flag_segment_id_idx on public.flag (segment_id);

commit;
