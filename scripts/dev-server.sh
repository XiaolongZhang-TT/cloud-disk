#!/usr/bin/env bash
# Start the Tern backend locally (no Docker) with the repository-local npm
# cache, so it also works in sandboxed environments where $HOME is read-only.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export npm_config_cache="${npm_config_cache:-$ROOT_DIR/.npm-cache}"
export npm_config_logs_dir="${npm_config_logs_dir:-$ROOT_DIR/.npm-logs}"

cd "$ROOT_DIR/server"

if [ ! -d node_modules ]; then
  echo "[dev] installing server dependencies..."
  npm ci --no-audit --no-fund
fi

export PORT="${PORT:-8080}"
export DATA_DIR="${DATA_DIR:-$ROOT_DIR/server/.data}"

mkdir -p "$DATA_DIR"
echo "[dev] Tern listening on http://127.0.0.1:${PORT} (data: ${DATA_DIR})"
echo "[dev] WebDAV: http://127.0.0.1:${PORT}/Tern"

exec node src/index.js
