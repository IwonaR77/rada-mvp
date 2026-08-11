#!/usr/bin/env bash
# Pomiar czasu najcięższych zapytań serwisu — do uruchomienia, gdy przybędzie
# sesji albo gdy strona zacznie się wlec.
#
# Mierzy to, co realnie rośnie z liczbą sesji, a nie wszystko po kolei:
# każde z tych zapytań chodzi przy zwykłym wejściu na stronę rady albo sesji.
#
# Progi w kolumnie "budżet" są arbitralne, ale nie przypadkowe: strona woła
# kilka z nich naraz, więc pojedyncze zapytanie ma się mieścić grubo poniżej
# 100 ms, żeby suma została w granicach odczuwalnej natychmiastowości.
#
#   ./scripts/perf-check.sh
set -euo pipefail
# Bez tego psql drukuje czasy z przecinkiem dziesiętnym, a printf w polskiej
# lokalizacji odrzuca kropkę — i skrypt wywala się na własnym wyniku.
export LC_ALL=C.UTF-8

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck disable=SC1091
source .env.backup

GMINA='846c8bce-7f11-4825-91dd-fe80cedf5289'
KADENCJA=$(psql "$SUPABASE_DB_URL" -At -c \
  "select id from term where council_id='$GMINA' order by start_date desc limit 1")

# Każdy pomiar dwa razy — pierwszy przebieg rozgrzewa cache, interesuje nas drugi.
zmierz() {
  local nazwa="$1" budzet="$2" sql="$3" ms
  psql "$SUPABASE_DB_URL" -At -c "$sql" > /dev/null
  # \timing to metapolecenie psql, więc musi wejść przez stdin, nie przez -c.
  ms=$(psql "$SUPABASE_DB_URL" -At <<SQL | grep -oP 'Time: \K[0-9,.]+' | tail -1 | tr ',' '.'
\timing on
$sql;
SQL
  )
  ms=${ms:-0}
  local flaga="ok "
  awk -v a="$ms" -v b="$budzet" 'BEGIN{exit !(a>b)}' && flaga="WOLNE"
  printf '%-42s %8.1f ms   (budżet %5s ms)  %s\n' "$nazwa" "$ms" "$budzet" "$flaga"
}

echo "Pomiar na kadencji $KADENCJA"
echo

zmierz "heatmapa (bloki mówienia)" 150 \
  "select count(*) from term_speaking_blocks('$KADENCJA', 60)"

zmierz "podium: zatwierdzone segmenty kadencji" 100 \
  "select count(*) from segment s join meeting m on m.id=s.meeting_id
   where s.status='finalized' and m.term_id='$KADENCJA'"

zmierz "użycie mówców (lista przy tagowaniu)" 100 \
  "select count(*) from council_speaker_usage('$GMINA')"

zmierz "postęp tagowania sesji" 100 \
  "select count(*) from meeting_tagging_progress('$KADENCJA')"

zmierz "czas tagowania kadencji" 100 \
  "select count(*) from term_tagging_time('$KADENCJA')"

zmierz "frekwencja radnych" 100 \
  "select count(*) from term_attendance_stats('$KADENCJA')"

zmierz "zgodność głosowań (macierz)" 200 \
  "select count(*) from term_voting_correlation('$KADENCJA')"

zmierz "wyszukiwarka pełnotekstowa" 200 \
  "select count(*) from search_segments('budżet', '$GMINA')"

zmierz "segmenty jednej sesji (strona sesji)" 100 \
  "select count(*) from segment where meeting_id in
   (select id from meeting where term_id='$KADENCJA' order by date desc limit 1)"

echo
psql "$SUPABASE_DB_URL" -c "
select relname as tabela, n_live_tup as wiersze,
       pg_size_pretty(pg_total_relation_size(relid)) as rozmiar
from pg_stat_user_tables where schemaname='public'
order by pg_total_relation_size(relid) desc limit 5;"
