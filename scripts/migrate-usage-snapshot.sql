-- Ostatni znany stan limitów usług zewnętrznych.
--
-- Limitów Groqa nie da się odczytać na żądanie: stan przychodzi wyłącznie
-- w nagłówkach odpowiedzi z endpointu, który wykonuje pracę (lista modeli ich
-- nie zwraca). Pipeline transkrypcji je widzi, więc to on je tu odkłada —
-- strona managera pokazuje ostatni odczyt razem z datą, zamiast udawać, że
-- zna stan bieżący.
--
-- Jeden wiersz na metrykę (klucz: źródło + metryka), nadpisywany przy każdym
-- biegu. Historia zużycia to osobny temat; tu chodzi o „ile zostało".
--
-- Uruchomić raz: psql "$SUPABASE_DB_URL" -f scripts/migrate-usage-snapshot.sql

begin;

create table if not exists public.usage_snapshot (
  source text not null,
  metric text not null,
  value numeric,
  unit text,
  note text,
  recorded_at timestamptz not null default now(),
  primary key (source, metric)
);

alter table public.usage_snapshot enable row level security;

-- Czyta manager; zapisuje pipeline, który łączy się bezpośrednio (pomija RLS).
create policy "managers read usage" on public.usage_snapshot
  for select using (is_manager(auth.uid()));

commit;
