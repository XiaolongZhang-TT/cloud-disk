# Tern API Contract (v1)

> This document is the source of truth shared by the server, web UI and macOS client.
> Base URL: `/api`. All request/response bodies are JSON unless noted.
> Authentication: HttpOnly session cookie `cd_session` set by `/api/auth/login` and `/api/auth/setup`.
> Errors use an HTTP 4xx/5xx status and `{ "error": { "code": "snake_case_code", "message": "Human readable message" } }`.

## Conventions

- IDs are opaque strings (UUIDs).
- Timestamps are ISO-8601 UTC strings (`2026-10-19T04:00:00.000Z`).
- `Node` object:
  ```json
  {
    "id": "uuid",
    "parentId": "uuid|null",
    "name": "设计稿",
    "type": "folder|file",
    "size": 12345,
    "mime": "image/png",
    "starred": false,
    "createdAt": "...",
    "updatedAt": "...",
    "trashedAt": null,
    "childCount": 3
  }
  ```
  `childCount` is only present for folders. `size` for folders is the sum of direct children (best effort).
- Root folder is represented by `parentId: null` (also accepted as the string `"root"` in query params).
- All authenticated endpoints are scoped to the current user's own tree.

## Auth & account

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/auth/status` | – | `{ authenticated, setupRequired, user?, serverName, version, allowRegistration, maxUploadBytes }` |
| POST | `/api/auth/setup` | `{username,password,displayName?}` | `{ user }` + cookie. Only allowed when there are no users. |
| POST | `/api/auth/login` | `{username,password,remember?}` | `{ user }` + cookie |
| POST | `/api/auth/logout` | – | `{ ok: true }` |
| POST | `/api/auth/register` | `{username,password,displayName?}` | `{ user }` + cookie. Only when `ALLOW_REGISTRATION=true`. |
| GET | `/api/me` | – | `{ user }` |
| PATCH | `/api/me` | `{displayName?, currentPassword?, newPassword?}` | `{ user }` |
| GET | `/api/config` | – | `{ serverName, version, allowRegistration, maxUploadBytes }` (public) |

`user`: `{ id, username, displayName, role: "admin"|"member", quota, used, createdAt }`.

### Admin (role=admin only)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/admin/users` | – | `{ items: user[] }` |
| POST | `/api/admin/users` | `{username,password,displayName?,quotaGb?,role?}` | `{ user }` |
| PATCH | `/api/admin/users/:id` | `{displayName?,password?,quotaGb?,role?}` | `{ user }` |
| DELETE | `/api/admin/users/:id` | – | `{ ok: true }` (cannot delete self; deletes data) |

`quotaGb: 0` means unlimited. `quota` is stored as bytes in the user object.

## Files & folders

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/api/nodes` | `parentId?` (`root`/omitted = root), `sort=name|modified|size`, `order=asc|desc` | `{ folder: Node\|null, breadcrumb: [{id,name}], items: Node[] }` |
| GET | `/api/nodes/:id` | – | `{ node: Node }` |
| POST | `/api/nodes/folder` | `{ parentId?, name }` | `{ node }` |
| POST | `/api/nodes/upload` | multipart, field `files` (1..n), query `parentId?` | `{ items: Node[] }` 201 |
| PATCH | `/api/nodes/:id` | any of `{ name?, parentId?, starred? }` | `{ node }` |
| POST | `/api/nodes/:id/copy` | `{ parentId? }` | `{ node }` 201 |
| DELETE | `/api/nodes/:id` | – | `{ ok: true }` (moves to trash) |
| GET | `/api/nodes/:id/download` | – | binary attachment; folders stream a ZIP |
| GET | `/api/nodes/:id/content` | `download=1?` | inline binary (preview); Range supported |
| GET | `/api/trash` | `sort=trashed|name|size` | `{ items: Node[] }` |
| POST | `/api/trash/:id/restore` | – | `{ node }` |
| DELETE | `/api/trash/:id` | – | `{ ok: true }` (permanent) |
| DELETE | `/api/trash` | – | `{ ok: true }` (empty trash) |
| GET | `/api/starred` | `limit?` | `{ items: Node[] }` |
| GET | `/api/recent` | `limit?` (default 24, max 100) | `{ items: Node[] }` |
| GET | `/api/search` | `q`, `limit?` | `{ query, items: Node[] }` |
| GET | `/api/storage` | – | `{ used, quota, fileCount, folderCount, trashCount, trashSize }` |
| GET | `/api/overview` | – | `{ storage, recent: Node[], starred: Node[] }` |

### Upload rules

- Existing names in the same folder are auto-renamed: `report.pdf` → `report (1).pdf`.
- Names are NFC-normalized, trimmed, max 200 chars, and may not contain `/`, `\`, `:`, NUL, or be `.`/`..`.
- Quota: uploads that would exceed the user's quota are rejected with `413 quota_exceeded`.
- Max single request size: `MAX_UPLOAD_BYTES` (default 20 GiB).
- `POST /api/nodes/upload` returns 201, body `{ items }`.
- macOS AppleDouble/metadata companions (`._*`, `.DS_Store`, `.localized`, `.Spotlight-V100`, `.Trashes`, `.fseventsd`) are stored and visible over WebDAV so Finder can preserve them, but are hidden from REST listings, search, recent, starred, trash and ZIP downloads.

## Sharing

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/shares` | `{ nodeId, password?, expiresInHours? }` | `{ share }` 201 |
| GET | `/api/shares` | – | `{ items: share[] }` |
| DELETE | `/api/shares/:id` | – | `{ ok: true }` |
| GET | `/api/public/shares/:token` | – | `{ share }` |
| POST | `/api/public/shares/:token/unlock` | `{ password }` | `{ accessToken, expiresAt }` |
| GET | `/api/public/shares/:token/content` | `accessToken?`, `download=1?` | binary (Range supported) |

`share` for the owner:
```json
{
  "id": "uuid",
  "token": "urlsafe-token",
  "url": "https://host/s/urlsafe-token",   // absolute when PUBLIC_BASE_URL is set, else relative
  "node": { "id":"...", "name":"...", "type":"file", "size":123, "mime":"..." },
  "hasPassword": true,
  "expiresAt": "...|null",
  "createdAt": "...",
  "downloadCount": 2
}
```
Public `share` omits internal ids and includes `ownerName`, `expired`, `hasPassword`.
Expired/invalid shares return 404 `share_not_found`; wrong/required password returns 401 `password_required` / `invalid_password`.
Folder shares download as ZIP. If a share has a password, content requests require `accessToken` (valid 2 hours).

## WebDAV

- Endpoints: `/dav` and `/Tern` (same root; use `/Tern` so Finder names the volume “Tern”).
- HTTP Basic auth with the same username/password as the web app. Realm `Tern`.
- Supported methods: `OPTIONS, PROPFIND, PROPPATCH, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE, LOCK, UNLOCK`.
- Read-write Finder mounting requires `DAV: 1, 2` and LOCK support.
- Virtual root maps to the user's root folder.

## Health

`GET /api/health` → `{ status: "ok", version, uptime }` (public).

## Environment (server)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Listen port |
| `DATA_DIR` | `/data` | SQLite DB + file blobs |
| `SERVER_NAME` | `Tern` | Brand shown in UI |
| `PUBLIC_BASE_URL` | empty | Absolute share URLs, e.g. `https://disk.example.com` |
| `ADMIN_USERNAME` | empty | Auto-create admin on first boot when users table is empty |
| `ADMIN_PASSWORD` | empty | Password for auto-created admin |
| `ALLOW_REGISTRATION` | `false` | Enable public registration |
| `DEFAULT_QUOTA_GB` | `0` | Per-user quota, 0 = unlimited |
| `MAX_UPLOAD_BYTES` | `21474836480` | Per-request upload cap |
| `COOKIE_SECURE` | `auto` | `true`/`false`/auto (based on request protocol) |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-*` headers |
| `DATA_UID` / `DATA_GID` | `1000` / `1000` | Runtime ownership of `/data` in Docker |

## Web routes

- `/` and app routes (`/recent`, `/starred`, `/shares`, `/trash`, `/search`, `/settings`) → SPA.
- `/s/:token` → public share page (SPA).
- Server must fall back to `web/dist/index.html` for non-API GET requests.
