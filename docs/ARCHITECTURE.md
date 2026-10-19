# Architecture

Tern / Tern is a self-hosted personal cloud drive designed for a home NAS.

```
┌──────────────────────┐        HTTPS / HTTP        ┌─────────────────────────────┐
│  Browser (React SPA) │ ─────────────────────────► │  Node.js server (Express)   │
└──────────────────────┘                            │                             │
┌──────────────────────┐        WebDAV (Basic)      │  /api   REST + session      │
│  macOS Finder        │ ─────────────────────────► │  /dav   WebDAV              │
│  (mounted volume)    │                            │  /Tern  WebDAV alias   │
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
- **WebDAV first.** The macOS client does not reimplement sync: macOS mounts the WebDAV endpoint
  through `NetFSMountURLSync`. The volume is managed by Finder and appears in the sidebar under
  **Locations**, next to iCloud Drive and other cloud services. This requires no Apple Developer
  account, no kernel extension and no File Provider entitlement.
- **Soft delete + restorable trash**, share links with optional password/expiry, per-user quotas.

## Repository layout

```
server/    Express API, WebDAV, SQLite, tests, Docker runtime
web/       React + TypeScript + Vite single-page app (built into web/dist)
macos/     Swift menu-bar client, build script, Finder mount smoke test
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

The client builds a `.app` that lives in the menu bar. On connect it calls
`NetFSMountURLSync` for `http(s)://host:port/Tern` with the user's credentials; macOS then
mounts it as a normal network volume. WebDAV `LOCK`/`UNLOCK`, `PROPFIND`, Range `GET` and `MOVE`
are implemented so Finder mounts read-write and Quick Look works.

The volume appears in Finder's sidebar under **Locations** alongside iCloud Drive. Users can drag
it into Favorites for a permanent spot; the app also opens Finder at the mount on connect.
