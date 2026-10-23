# Tern

**English** | [简体中文](README.md)

[![CI](https://github.com/XiaolongZhang-dev/tern/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/XiaolongZhang-dev/tern/actions/workflows/ci.yml)
[![Docker Hub](https://img.shields.io/docker/pulls/acc110789/tern?logo=docker)](https://hub.docker.com/r/acc110789/tern)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A private cloud drive for your NAS: one-command Docker deployment, a clean web UI, and a macOS menu-bar client that mounts your files in Finder next to iCloud Drive.

> Your data stays on your own NAS, never on a third-party cloud. MIT licensed.

![Tern web UI](docs/screenshots/02-drive.png)

## Features

- Files and folders, drag-and-drop uploads, previews (images/video/PDF/text), search, favorites and trash
- Multi-user quotas and public share links with optional password and expiry
- WebDAV at `/dav` and `/Tern`, usable by Finder, rclone and other clients
- macOS menu-bar client: mounts as a Finder network volume, with optional auto-connect
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

Download [Tern-1.1.1.zip](macos/dist/Tern-1.1.1.zip) (or from [Releases](https://github.com/XiaolongZhang-dev/tern/releases)) and move `Tern.app` to `/Applications`. If Gatekeeper blocks it, right-click → **Open**.

Open Tern in the menu bar → **Settings**:

```text
Server: http://<NAS-IP>:8080/Tern
User:   web account
Pass:   web password
```

After connecting, **Tern** appears in Finder's **Locations** sidebar; drag it to **Favorites** to pin it. See [docs/MAC.md](docs/MAC.md) for details.

> A File Provider offline prototype is in progress (Phase 3: writes, offline queue, conflict copies and thumbnails): [docs/MAC_OFFLINE.md](docs/MAC_OFFLINE.md).

## Windows client

A Windows 10/11 x64 tray app that maps the drive as **`Tern (T:)`** in **This PC**.

Download `Tern-Windows-Setup.exe` from [Releases](https://github.com/XiaolongZhang-dev/tern/releases/tag/v1.1.1) (or use the portable `Tern-Windows-x64.zip`; build with `windows/build.ps1`), install and run `Tern.exe`:

1. Tray icon → **Settings**;
2. enter `https://<NAS-IP>:8080/Tern`, username, password and drive letter;
3. click **Save and connect**, then open `Tern (T:)` in This PC.

The Windows **WebClient** service is required. See [docs/WINDOWS.md](docs/WINDOWS.md) for the 50MB default limit and troubleshooting.

## Documentation

- [Deployment](docs/DEPLOY.md): NAS, HTTPS, backups and upgrades
- [macOS client](docs/MAC.md): build, install and Finder integration
- [macOS offline location (experimental)](docs/MAC_OFFLINE.md): File Provider Phase 2
- [Windows client](docs/WINDOWS.md): install, drive mapping, WebClient
- [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md)
- [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Development and tests

```bash
(cd server && npm ci && npm test)
(cd web && npm ci && npm run build)
(cd macos && ./build.sh)
cd windows && powershell -File build.ps1   # Windows
```

## Security

Use HTTPS when exposing Tern outside a trusted network. WebDAV uses HTTP Basic authentication; do not expose plain HTTP to untrusted networks. Keep `data/` backed up.

## Contributing

Issues and pull requests are welcome. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Tern contributors
