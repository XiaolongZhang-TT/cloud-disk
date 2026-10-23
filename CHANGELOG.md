# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

See [ROADMAP.md](ROADMAP.md) for the prioritized backlog.

### Added

- Server `GET /api/sync/changes` append-only change feed with bootstrap snapshots, incremental upserts and tombstones, plus integration tests.
- macOS File Provider Phase 3: online create/upload/modify/move/delete, client-supplied IDs, durable offline write queue, automatic conflict copies, image thumbnails, sync status, Keep Downloaded / Remove Download actions, WebDAV-mount migration and a Developer ID/notarization script.
- Windows 10/11 x64 tray client that maps Tern as a drive letter (`Tern (T:)`) via WebDAV, with Credential Manager storage, auto-connect, drive-letter selection and a Windows build workflow.
- GitHub Actions workflow to publish multi-arch (`amd64`/`arm64`) Docker images to
  Docker Hub on `v*` tags, plus a `docker-compose.hub.yml` deployment path for the
  prebuilt image.

## [1.1.1] - 2026-10-19

### Fixed

- macOS: clicking **Settings…** in the menu bar now always opens a dedicated
  AppKit settings window. The previous implementation relied on a private
  SwiftUI `showSettingsWindow:` action that could return success without showing
  a window on recent macOS releases.
- macOS: the settings window is explicitly activated and ordered to the front
  when opened.

## [1.1.0] - 2026-10-19

Tern is the new name of the project. This release is the first public Tern
release.

### Added

- Docker Compose deployment: one Node.js container serving the REST API, WebDAV
  and the compiled React SPA, with bind-mounted `./data` storage.
- Multi-stage image build (web build + production dependencies) on Node 24
  Alpine; runs as a non-root UID via `DATA_UID`/`DATA_GID`, includes healthcheck.
- Authentication and accounts: first-run setup, scrypt password hashing,
  HttpOnly session cookies, admin member management with per-user quotas.
- File management: folders, multi-file streaming uploads, downloads, Range
  requests, image previews, rename/move/copy, star, search, recent, overview,
  soft-delete trash with restore/permanent delete/empty, folder ZIP downloads.
- Share links with optional scrypt-hashed passwords, expiry and download
  counters; public share page with password gate and inline preview.
- Finder-compatible WebDAV at `/dav` and `/Tern`:
  DAV 1,2, PROPFIND, PROPPATCH, GET/HEAD with Range, PUT, MKCOL, DELETE, COPY,
  MOVE, LOCK/UNLOCK.
- React 19 + TypeScript web client with light/dark themes, responsive layout,
  drag-and-drop upload queue with progress, previews, dialogs, toasts and admin
  screens; no external CDN/font dependencies.
- SwiftUI macOS menu-bar client `Tern.app` that mounts the WebDAV endpoint via
  NetFS at `/Volumes/Tern`, stores passwords in Keychain, supports launch at
  login, clean unmount, diagnostics and a `mount-smoke` CLI.
- Documentation: deployment (Synology/QNAP/Unraid, HTTPS proxy), macOS client,
  architecture, API contract, English README and UI screenshots.
- 35 server integration tests covering auth, file operations, shares, quotas and
  WebDAV; CI for server, web, Docker and macOS builds.
- Open-source infrastructure: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY,
  CHANGELOG, ROADMAP, issue/PR templates and Dependabot.

### Changed

- Rebranded to **Tern**:
  - Docker image/container/project: `tern`;
  - WebDAV path: `/Tern`;
  - macOS app: `Tern.app`, bundle id `com.tern.menubar`, volume `/Volumes/Tern`;
  - default server name and UI copy use Tern.
- macOS users upgrading from the pre-release build must re-enter the server
  password because the Keychain service identifier changed.
- The macOS bundle is ad-hoc signed; see [docs/MAC.md](docs/MAC.md) for
  Gatekeeper instructions.

### Security

- Upload and WebDAV PUT size limits plus per-user quotas.
- Inline HTML/SVG/XML content is sandboxed via CSP; downloads keep attachments.
- Login and WebDAV Basic-auth rate limiting.
- macOS AppleDouble/metadata files are hidden from REST listings while remaining
  available to Finder over WebDAV.

[Unreleased]: https://github.com/XiaolongZhang-dev/tern/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/XiaolongZhang-dev/tern/releases/tag/v1.1.1
[1.1.0]: https://github.com/XiaolongZhang-dev/tern/releases/tag/v1.1.0
