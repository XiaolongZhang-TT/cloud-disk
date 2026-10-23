# Tern

**English** | [简体中文](README.md)

[![CI](https://github.com/XiaolongZhang-dev/tern/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/XiaolongZhang-dev/tern/actions/workflows/ci.yml)
[![Docker Hub](https://img.shields.io/docker/pulls/acc110789/tern?logo=docker)](https://hub.docker.com/r/acc110789/tern)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A private cloud drive for your NAS: one-command Docker deployment, a clean web UI, and a macOS menu-bar client that puts your files in Finder’s Locations sidebar via File Provider.

> Your data stays on your own NAS, never on a third-party cloud. MIT licensed.

![Tern web UI](docs/screenshots/02-drive.png)

## Features

- Files and folders, drag-and-drop uploads, previews (images/video/PDF/text), search, favorites and trash
- Multi-user quotas and public share links with optional password and expiry
- WebDAV at `/dav` and `/Tern`, usable by rclone and other clients (the macOS and Windows clients no longer use WebDAV)
- macOS menu-bar client: native File Provider location with on-demand download, offline writes, conflict copies and live sync
- One Docker container: SQLite + local file storage, amd64 / arm64

## Quick start

The image is published on Docker Hub: **[acc110789/tern](https://hub.docker.com/r/acc110789/tern)**. It includes the web app and API; no local build is needed.

```bash
mkdir -p data

docker run -d --name tern --restart unless-stopped \
  -p 8080:8080 \
  -v "$PWD/data:/data" \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD='change-me' \
  -e DATA_UID="$(id -u)" \
  -e DATA_GID="$(id -g)" \
  acc110789/tern:latest
```

Open `http://<NAS-IP>:8080`. The administrator is created on first boot; data lives in `./data`.

Or use Docker Compose:

```bash
cp .env.example .env
# Edit ADMIN_PASSWORD, DATA_UID and DATA_GID

docker compose -f docker-compose.hub.yml up -d
```

Build from source:

```bash
git clone https://github.com/XiaolongZhang-dev/tern.git
cd tern
cp .env.example .env
# Edit ADMIN_PASSWORD, DATA_UID and DATA_GID
docker compose up -d --build
```

## macOS client

The macOS client uses **File Provider**. **Tern** appears in Finder’s **Locations** sidebar next to iCloud Drive; it no longer mounts a `/Volumes` WebDAV volume.

Tern menu bar → **Settings**:

```text
Server: https://<NAS>:<PORT>/Tern
User:   web account
Pass:   web password
```

Save, click **Enable Tern in Finder**, then enable Tern under **System Settings → General → Login Items & Extensions → File Providers**. The first build must be signed from Xcode; a free Personal Team works.

Features: on-demand download, Quick Look/thumbnails, create/edit/rename/move/delete, offline write queue, conflict copies, Keep Downloaded/Remove Download, and a long-poll watcher that makes web uploads appear in Finder within about a second.

Build and install:

```bash
cd macos
TEAM=YOUR_TEAM_ID ./build-xcode.sh
cp -R .build-xcode/Build/Products/Debug/Tern.app /Applications/
```

See [docs/MAC.md](docs/MAC.md) and [docs/MAC_OFFLINE.md](docs/MAC_OFFLINE.md).

## Windows client

A Windows 10/11 x64 tray app built on the **Windows Cloud Files API**. It
creates an Explorer cloud location with on-demand download, offline reads and
writes, native “Always keep on this device / Free up space”, conflict copies
and an optional `T:` drive letter. No WebDAV / WebClient setup is required.

Download `Tern-Windows-Setup.exe` from Releases (or build with
`windows/build.ps1`), open Tern in the tray → **Settings**, and enter the server,
account and sync folder. See [docs/WINDOWS.md](docs/WINDOWS.md).

## Documentation

- [Deployment](docs/DEPLOY.md): NAS, HTTPS, backups and upgrades
- [macOS client](docs/MAC.md): build, install and Finder integration
- [macOS File Provider details](docs/MAC_OFFLINE.md): offline writes, conflicts, watcher
- [Windows client](docs/WINDOWS.md): Cloud Files location, drive letter, offline writes
- [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md)
- [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Development and tests

```bash
(cd server && npm ci && npm test)
(cd web && npm ci && npm run build)
(cd macos && ./build.sh)          # menu-bar app only; File Provider uses build-xcode.sh
cd windows && powershell -File build.ps1   # Windows
```

## Security

Use HTTPS when exposing Tern outside a trusted network. WebDAV uses HTTP Basic authentication; do not expose plain HTTP to untrusted networks. Keep `data/` backed up.

## Contributing

Issues and pull requests are welcome. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Tern contributors
