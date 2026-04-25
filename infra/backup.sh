#!/bin/bash
# ============================================================
# Alegra Festas — Database Backup Script
# ============================================================
#
# Usage:
#   chmod +x infra/backup.sh
#   ./infra/backup.sh
#
# Environment variables (set in .env or export before running):
#   DATABASE_URL — PostgreSQL connection string
#   BACKUP_DIR  — Directory to store backups (default: ./backups)
#
# Crontab setup (daily at 3 AM):
#   crontab -e
#   0 3 * * * cd /path/to/alegra_backend && ./infra/backup.sh >> /var/log/alegra-backup.log 2>&1
#
# Retention: keeps the last 7 backups, deletes older ones.
# ============================================================

set -euo pipefail

# Load .env if exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Configuration
DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS=7
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
FILENAME="alegra_festas_backup_${TIMESTAMP}.sql.gz"

# Extract connection parts from DATABASE_URL
# Format: postgresql://user:password@host:port/database?schema=public
DB_HOST=$(echo "$DB_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
DB_PORT=$(echo "$DB_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_NAME=$(echo "$DB_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')
DB_USER=$(echo "$DB_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
DB_PASS=$(echo "$DB_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup of database: $DB_NAME"

# Run pg_dump with gzip compression
PGPASSWORD="$DB_PASS" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  | gzip > "${BACKUP_DIR}/${FILENAME}"

FILESIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
echo "[$(date)] Backup completed: ${FILENAME} (${FILESIZE})"

# Remove old backups (keep last N days)
find "$BACKUP_DIR" -name "alegra_festas_backup_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
REMAINING=$(find "$BACKUP_DIR" -name "alegra_festas_backup_*.sql.gz" | wc -l)
echo "[$(date)] Retention: keeping ${REMAINING} backup(s), removed files older than ${RETENTION_DAYS} days"

echo "[$(date)] Backup process finished successfully"
