#!/usr/bin/env bash
# Daily database backup via a direct Postgres connection string (not the
# Supabase CLI's --linked/access-token auth, which depends on a desktop
# keyring/D-Bus session unavailable to cron — see feedback_remote_server_screen-
# adjacent finding from the earlier abandoned real-cron attempt for the
# transcription pipeline).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f .env.backup ]; then
  echo "Brak .env.backup — zobacz scripts/backup-db.sh dla instrukcji." >&2
  exit 1
fi
# shellcheck disable=SC1091
source .env.backup

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL nie jest ustawione w .env.backup" >&2
  exit 1
fi

BACKUP_DIR="$REPO_ROOT/backups"
RETENTION_DAYS=14
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d_%H%M)"
OUT_FILE="$BACKUP_DIR/rada-mvp-${STAMP}.sql"

pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges -f "$OUT_FILE"
gzip -f "$OUT_FILE"

find "$BACKUP_DIR" -name 'rada-mvp-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "Backup OK: ${OUT_FILE}.gz"
