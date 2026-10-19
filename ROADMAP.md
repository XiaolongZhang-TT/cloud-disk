# Roadmap

This is a living list, not a commitment. Priorities are based on user value,
security, and how much they move CloudDisk toward a dependable self-hosted
alternative to commercial cloud drives.

If you want to work on an item, open an issue first so we can agree on the
approach. Items marked **good first issue** are usually small and self-contained.

## Current limitations

These are known and accepted for v1.0.0:

- **No offline sync / File Provider.** The macOS client mounts a WebDAV network
  volume. It appears in Finder's *Locations* next to iCloud Drive, but unlike
  iCloud it needs the server to be reachable and cannot provide File Provider
  offline semantics. A native File Provider extension would also need an Apple
  Developer account, App Group entitlements and notarization.
- **Single process / single SQLite file.** No horizontal scaling or HA. SQLite WAL
  is fine for a personal or family NAS but not a multi-node cluster.
- **No file versioning.** Overwriting a file keeps only the latest content;
  trash protects deletions, not versions.
- **No resumable/chunked uploads.** Large uploads restart from zero on failure.
- **Trash has no automatic retention policy.** It grows until the user empties it
  or deletes items permanently.
- **WebDAV locks live in memory.** A server restart drops active locks; Finder
  re-locks on demand.
- **No thumbnails/video transcoding.** Image grids use the original bytes; HEIC
  and some RAW formats may not preview in all browsers.
- **No 2FA, audit log, or session management UI.**
- **No published container image.** Build locally from source; GitHub Container
  Registry publishing is planned.
- **No notarized macOS distribution.** The app is ad-hoc signed; Gatekeeper needs
  a right-click open or a quarantine removal.

## P1 — reliability and daily use

- [ ] Chunked/resumable uploads with checksums and retry (web + WebDAV).
- [ ] Persist WebDAV locks in SQLite with expiry cleanup.
- [ ] File versioning and restore from previous versions.
- [ ] Trash retention policy (e.g. auto-purge after N days) and storage accounting.
- [ ] Thumbnail pipeline (libvips/sharp worker) with HEIC/RAW poster support.
- [ ] Public folder browsing instead of ZIP-only folder shares.
- [ ] Dashboard for active sessions, share access counts and recent activity.
- [ ] TOTP two-factor authentication and recovery codes.
- [ ] Audit log for login, share, delete and admin actions.
- [ ] Share link revocation by owner with per-share download limits.

## P2 — integrations and operations

- [ ] Publish multi-arch images (`linux/amd64`, `linux/arm64`) to GHCR with tags.
- [ ] Helm chart / TrueNAS app / Unraid template.
- [ ] Prometheus metrics and structured JSON logging.
- [ ] CLI backup/restore and SQLite online backup helper.
- [ ] S3-compatible object storage backend for blobs.
- [ ] Optional S3/NAS snapshot integration for backups.
- [ ] Windows/Linux desktop clients (WebDAV mount guides at minimum).
- [ ] PWA install/offline shell and file search improvements.
- [ ] i18n (English UI in addition to Chinese) and accessibility audit.
- [ ] End-to-end encryption option (client-side encrypted blobs).

## P3 — community and ecosystem

- [ ] More example reverse-proxy configs (Traefik, Nginx Proxy Manager).
- [ ] Seed/demo dataset script for screenshots and local testing.
- [ ] Translation workflow and docs site.
- [ ] Security hardening guide for Synology/QNAP/Unraid.
- [ ] More automated browser E2E tests in CI (Playwright).
- [ ] Benchmark suite for large files and many entries.

## Done recently

- [x] Docker deployment with web build inside the image
- [x] macOS Finder mount client and `mount-smoke` verification
- [x] CI for server, web, Docker and macOS builds
- [x] Security policy, contribution guide and issue templates
- [x] Hidden AppleDouble files in the web UI
- [x] Quota enforcement on copy and trash restore
- [x] Inline content sandboxing (stored XSS hardening)
- [x] PUID/PGID support for arbitrary NAS users
