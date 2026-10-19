#!/bin/sh
# Tern container entrypoint.
#
# 1. Creates the data directories inside the mounted volume.
# 2. When running as root (the default), fixes ownership of DATA_DIR so the
#    non-root runtime user can read/write SQLite + file blobs.
# 3. Drops privileges to DATA_UID:DATA_GID with su-exec and execs the Node
#    process (PID 1 receives SIGTERM directly, so graceful shutdown works).
set -eu

DATA_DIR="${DATA_DIR:-/data}"
DATA_UID="${DATA_UID:-1000}"
DATA_GID="${DATA_GID:-1000}"
PORT="${PORT:-8080}"

export DATA_DIR PORT

case "${DATA_UID}" in
  ''|*[!0-9]*) echo "[entrypoint] DATA_UID must be a numeric uid (got '${DATA_UID}')" >&2; exit 1 ;;
esac
case "${DATA_GID}" in
  ''|*[!0-9]*) echo "[entrypoint] DATA_GID must be a numeric gid (got '${DATA_GID}')" >&2; exit 1 ;;
esac

mkdir -p "${DATA_DIR}/storage" "${DATA_DIR}/tmp" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  # Belt and braces for arbitrary DATA_UID values: the build already applies
  # `chmod -R a+rX /app`, but re-apply in case a volume/image was built by an
  # older revision or files were injected with restrictive modes.
  if [ -d /app ]; then
    chmod -R a+rX /app 2>/dev/null || true
  fi
  echo "[entrypoint] fixing ownership of ${DATA_DIR} for ${DATA_UID}:${DATA_GID}"
  if ! chown -R "${DATA_UID}:${DATA_GID}" "${DATA_DIR}" 2>/dev/null; then
    echo "[entrypoint] warning: could not chown ${DATA_DIR}; continuing anyway" >&2
  fi
  echo "[entrypoint] dropping privileges to ${DATA_UID}:${DATA_GID} on port ${PORT}"
  cd /app
  exec su-exec "${DATA_UID}:${DATA_GID}" node src/index.js
fi

echo "[entrypoint] already running as uid $(id -u); skipping privilege drop"
cd /app
exec node src/index.js
