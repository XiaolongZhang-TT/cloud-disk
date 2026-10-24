#!/bin/sh
#
# Restore a Tern backup ZIP produced by Settings → 数据备份.
# Stop the Tern container/server before running this script.
#
#   ./scripts/restore-backup.sh tern-backup-2026-10-24.zip [data-dir]
#
set -eu

BACKUP="${1:?usage: restore-backup.sh <backup.zip> [data-dir]}"
DATA_DIR="${2:-./data}"

[ -f "$BACKUP" ] || { echo "backup not found: $BACKUP" >&2; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "unzip is required" >&2; exit 1; }

mkdir -p "$DATA_DIR"
if [ -n "$(find "$DATA_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]; then
  SAFE="$(date +%Y%m%d-%H%M%S)"
  echo "existing data found; moving it to ${DATA_DIR}.pre-restore-${SAFE}"
  mv "$DATA_DIR" "${DATA_DIR}.pre-restore-${SAFE}"
  mkdir -p "$DATA_DIR"
fi

unzip -q "$BACKUP" -d "$DATA_DIR"
echo "restored: $BACKUP -> $DATA_DIR"
echo "start Tern again and check /api/health and the file tree."
