# Tern server

The Tern backend: a single Node.js (ESM) process that serves the REST API,
the WebDAV endpoint used by macOS Finder, and the compiled React SPA (when
`web/dist` exists) on one port.

## Requirements

- Node.js **24+** (uses the built-in `node:sqlite` module — no native addons)
- No database server, no native build toolchain

## Quick start (local)

```bash
# from the repository root
./scripts/dev-server.sh
```

or manually:

```bash
cd server
npm ci
PORT=8080 DATA_DIR=./.data ADMIN_USERNAME=admin ADMIN_PASSWORD=tern123 npm start
```

First boot behaviour:

- If the `users` table is empty and `ADMIN_USERNAME` / `ADMIN_PASSWORD` are set,
  an administrator is created automatically.
- Otherwise the web UI shows the one-time `/api/auth/setup` screen.

Open <http://127.0.0.1:8080> for the SPA (if built), and mount
`http://127.0.0.1:8080/Tern` from Finder (HTTP Basic auth with the same
account). `/dav` is an equivalent WebDAV alias.

## Configuration

All configuration is environment based; see `../.env.example` and the table in
`../docs/API.md`. Highlights:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `DATA_DIR` | `/data` | SQLite database + blob storage |
| `STATIC_DIR` | `../web/dist` | Compiled SPA directory (empty/absent is fine) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | – | Auto-create the first admin |
| `DEFAULT_QUOTA_GB` | `0` | Per-user quota in GB (`0` = unlimited) |
| `MAX_UPLOAD_BYTES` | 20 GiB | Per-request upload cap |
| `COOKIE_SECURE` | `auto` | `true` / `false` / `auto` |
| `TRUST_PROXY` | `false` | Honour `X-Forwarded-*` headers |
| `DATA_UID` / `DATA_GID` | `1000` | Runtime `/data` ownership in Docker |

## Layout

```
src/
  index.js          process entrypoint, graceful shutdown
  app.js            Express wiring, static SPA fallback, bootstrap
  config.js         environment -> immutable config object
  db.js             node:sqlite schema (WAL) + connection
  store.js          data access layer (users, nodes, shares, sessions)
  auth.js           scrypt hashing, sessions, share access tokens, rate limit
  middleware.js     security headers, session/basic auth guards
  errors.js         problem-details error handling
  util.js           names, cookies, ranges, ETag/XML helpers
  webdav.js         Finder-compatible WebDAV (DAV 1,2 + LOCK)
  routes/           auth, admin, nodes/collections, shares, public shares
  services/         virtual-tree business logic, ZIP streaming, serialisers
test/               node:test integration tests against a real HTTP server
```

## Storage model

- `DATA_DIR/cloud.db` — SQLite database (users, virtual tree, sessions, shares).
- `DATA_DIR/storage/<userId>/<nodeId>` — opaque file blobs. Renames/moves only
  touch metadata, and no user-supplied string ever becomes a filesystem path.
- Deleting moves nodes to a restorable trash; WebDAV `DELETE` uses the same
  trash so Finder deletes are recoverable from the web UI.

## Tests

```bash
cd server
npm test
```

The suite boots the real Express stack on an ephemeral port with a temporary
data directory and covers auth, folders/uploads/downloads, Range requests,
rename/move/copy (incl. the copy-into-descendant guard), trash/restore,
quota enforcement on upload/copy/restore, stored-XSS sandboxing, shares
(incl. password + expiry + folder ZIP) and WebDAV (`OPTIONS`, `PROPFIND`,
`MKCOL`, `PUT`, `GET`, `COPY`, `MOVE`, `LOCK`, `UNLOCK`, `DELETE`, plus an
oversized-PUT abort test).

## Docker

```bash
# from the repository root
cp .env.example .env   # then edit
mkdir -p data
docker compose up -d --build
docker compose logs -f
```

`docker compose up -d --build` works on a fresh clone: the multi-stage
`Dockerfile` builds the React SPA from `web/` inside the image, so no host-side
`npm run build` is required.

The image stages:

1. `web-build` — `npm ci` + `npm run build` in `web/`, producing `web/dist`;
2. `deps` — installs the server's production dependencies on `node:24-alpine`;
3. `runtime` — copies the server + built SPA, installs `su-exec`, and runs
   `scripts/entrypoint.sh`, which chowns `/data` for `DATA_UID:DATA_GID` and
   then drops privileges to that non-root user before starting Node.

### Data directory and backups

Compose bind-mounts the repository-local `./data` directory to `/data`
(`DATA_DIR=/data` inside the container), so the SQLite database
(`data/cloud.db`) and the blob tree (`data/storage/`) are plain host files.
Back the NAS up by snapshotting/copying that one `data/` directory; there is no
named Docker volume to export. Delete `data/cloud.db*` and `data/storage/` to
start from scratch (users, files and shares are then gone).

Run the container with a different host port with `PORT=9090 docker compose up -d`.
