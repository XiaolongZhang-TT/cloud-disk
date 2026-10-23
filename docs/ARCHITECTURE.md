# Architecture

Tern / Tern is a self-hosted personal cloud drive designed for a home NAS.

```
┌──────────────────────┐        HTTPS / HTTP        ┌─────────────────────────────┐
│  Browser (React SPA) │ ─────────────────────────► │  Node.js server (Express)   │
└──────────────────────┘                            │                             │
┌──────────────────────┐   REST + session + watch   │  /api   REST + session      │
│  macOS File Provider │ ─────────────────────────► │  /dav   WebDAV              │
│  (Finder location)   │                            │  /Tern  WebDAV alias   │
└──────────────────────┘                            │  /      static SPA          │
                                                    └──────────────┬──────────────┘
                                                                   │
                                                    ┌──────────────▼──────────────┐
                                                    │  /data                      │
                                                    │   cloud.db   (SQLite WAL)   │
                                                    │   storage/   (file blobs)   │
                                                    └─────────────────────────────┘
```

## Key decisions

- **One container.** The Node process serves the compiled SPA, REST API and WebDAV on one
  port (`8080`). Reverse proxies (Nginx / Caddy / Synology) only need to forward one upstream.
- **Metadata in SQLite, blobs in UUID files.** The virtual tree lives in `nodes`; file contents
  live at `storage/<user>/<node-id>`. Renames and moves are metadata-only, and no user-supplied
  path ever reaches the filesystem.
- **Node built-in SQLite** (`node:sqlite`) removes native build dependencies, so the Docker image
  stays small and works on x86_64 and arm64 NAS devices.
- **scrypt password hashing** via Node crypto, with transparent Basic-auth caching for the many
  small requests Finder makes over WebDAV.
- **File Provider on macOS.** The menu-bar app owns a replicated
  `NSFileProviderReplicatedExtension`; Finder sees a native cloud location. Sync uses the
  append-only `/api/sync/changes` feed, and a long-poll watcher (`/api/sync/watch`) wakes File
  Provider when the web UI or another client changes the tree. WebDAV remains available for
  Windows/rclone but is no longer used by the macOS client.
- **Soft delete + restorable trash**, share links with optional password/expiry, per-user quotas.

## Repository layout

```
server/    Express API, WebDAV, SQLite, tests, Docker runtime
web/       React + TypeScript + Vite single-page app (built into web/dist)
macos/     Swift menu-bar app + File Provider extension, build scripts
docs/      API contract, architecture, deployment, macOS guide
```

## Data model

- `users(id, username, password_hash, display_name, role, quota, created_at)`
- `nodes(id, owner_id, parent_id, name, type, size, mime, storage_key, starred, created_at, updated_at, trashed_at)`
- `shares(id, token, owner_id, node_id, password_hash, expires_at, created_at, download_count)`
- `sessions(token_hash, user_id, expires_at, created_at)`
- `locks(token, owner_id, path, expires_at)` (in-memory is acceptable; persists only per process)

A user's root is `parent_id IS NULL`. Names are unique per `(owner_id, parent_id)` among live
nodes; trashed nodes are excluded from that constraint.

## Security notes

- Session cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS.
- WebDAV uses HTTP Basic. On a LAN, HTTP is acceptable; for internet exposure put the container
  behind HTTPS (see docs/DEPLOY.md).
- Uploads are size-capped; quota is enforced server-side.
- Public share tokens are 256-bit random; optional passwords are scrypt-hashed.
- The container drops to UID/GID `DATA_UID`/`DATA_GID` after fixing volume ownership.

## macOS Finder integration

The menu-bar app registers a replicated File Provider domain. Finder shows **Tern** under
**Locations** alongside iCloud Drive. The extension pulls metadata through
`GET /api/sync/changes`, streams contents through `/api/nodes/:id/content`, and writes through the
same REST endpoints with `If-Match` conflict detection.

A long-poll watcher in the menu-bar app holds `GET /api/sync/watch`; when another client changes
the tree, the app calls `NSFileProviderManager.signalEnumerator` and the extension applies the
incremental changes. There is no server push connection and no WebDAV mount on macOS.
