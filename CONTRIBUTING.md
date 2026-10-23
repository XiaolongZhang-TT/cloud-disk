# Contributing to Tern

Thanks for your interest in improving Tern. This project is a self-hosted
NAS cloud drive with a Node.js/Express + SQLite backend, a React web client and a
native macOS SwiftUI menu-bar client.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
For security issues, please **do not** open a public issue — see
[SECURITY.md](SECURITY.md).

## Ways to contribute

- Report reproducible bugs and deployment problems.
- Improve documentation, screenshots and translations.
- Add tests, harden edge cases, or improve accessibility.
- Propose and implement features from [ROADMAP.md](ROADMAP.md).
- Review pull requests and help other users in Discussions/Issues.

New contributors are welcome. Issues labelled `good first issue` are a good
starting point.

## Development setup

### Requirements

- Node.js **24+** (the server uses the built-in `node:sqlite` module)
- npm 11+
- Docker + Docker Compose for deployment tests
- macOS 13+ with Xcode Command Line Tools for the macOS client

### Server

```bash
cd server
npm ci
PORT=18080 DATA_DIR=./.data ADMIN_USERNAME=admin ADMIN_PASSWORD=tern123 npm run dev
```

### Web client

```bash
# in a second terminal
cd web
npm ci
npm run dev
# http://127.0.0.1:5173, Vite proxies /api and /Tern to :18080
```

Production build:

```bash
cd web && npm run build   # outputs web/dist, served by the Node server
```

### macOS client

```bash
cd macos
./build.sh          # menu-bar app only, no Xcode required
open dist/Tern.app

# Full File Provider build (requires Xcode + signing):
TEAM=YOUR_TEAM_ID ./build-xcode.sh
```

`build.sh` uses `swiftc` directly and needs no Apple Developer account, but it
does not embed the File Provider extension. Use `build-xcode.sh` for Finder
integration. See [docs/MAC.md](docs/MAC.md).

### Docker

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f
```

## Tests

Run the same checks as CI before opening a pull request:

```bash
cd server && npm test        # Node integration tests (API + WebDAV)
cd web && npm run build      # TypeScript + Vite production build
cd macos && ARCHS=x86_64 ./build.sh   # optional, macOS only
```

The server suite boots the real Express stack against a temporary data directory;
it covers auth, file CRUD, uploads, Range requests, trash, quotas, shares and
WebDAV. When you change behavior, add or update a test. If you change the HTTP
contract, update [docs/API.md](docs/API.md) and both clients.

## Pull request guidelines

1. Fork the repository and create a topic branch from `main`
   (e.g. `feat/resumable-upload`, `fix/webdav-lock`).
2. Keep one logical change per PR; avoid unrelated formatting churn.
3. Use clear commit messages. [Conventional Commits](https://www.conventionalcommits.org/)
   are appreciated (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
4. Add tests and documentation for behavior changes.
5. Confirm that no credentials, tokens, private file names or personal data are
   included in code, logs, screenshots or fixtures.
6. Open the PR with a short description, test commands and any deployment notes.
   Fill in the PR template checklist.

Maintainers may ask for changes, squash commits, or adjust the implementation to
fit the security and architecture constraints.

## Architecture and conventions

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — data model and design decisions
- [docs/API.md](docs/API.md) — REST/WebDAV contract (source of truth)
- [docs/DEPLOY.md](docs/DEPLOY.md) — NAS deployment and reverse proxy guidance
- Server: ESM JavaScript, no native npm modules, `node:sqlite`, Express 5.
- Web: React 19 + TypeScript, hand-written CSS tokens, no external UI framework.
- macOS: SwiftUI + AppKit, NetFS, Keychain; no third-party Swift dependencies.
- All user-supplied names stay in the database; never build filesystem paths
  from user input.

## Release process (maintainers)

1. Update `CHANGELOG.md` and the version in `server/package.json`,
   `web/package.json` and `macos/Resources/Info.plist`.
2. Run the full test matrix locally or wait for CI.
3. Build the macOS zip with `macos/build.sh` and commit it under
   `macos/dist/` (the zip and `.sha256` are tracked; `.app` is not).
4. Tag `vX.Y.Z`, push, and create a GitHub Release with the zip asset.
5. Add release notes highlighting breaking changes and migration steps.

## Questions

Use GitHub Issues for bugs/features and Discussions for usage questions. For
security reports, use the private advisory flow in [SECURITY.md](SECURITY.md).
