# Security Policy

## Supported versions

Tern is currently maintained on the `main` branch. Security fixes are
applied to the latest release line.

| Version | Supported |
| --- | --- |
| 1.x | ✅ |
| < 1.0 | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Click **Report a vulnerability** (GitHub Security Advisories).
3. Include: affected version/commit, deployment mode (Docker/bare Node, reverse
   proxy), reproduction steps, impact, and any suggested fix.

Direct link: <https://github.com/XiaolongZhang-TT/tern/security/advisories/new>

We will acknowledge reports on a best-effort basis, usually within a few days,
and coordinate disclosure after a fix is available. Please give us a reasonable
amount of time before publishing details.

## Scope

Examples of issues we want to hear about:

- Authentication/session bypass, privilege escalation, or cross-user data access
- Path traversal or arbitrary file read/write
- Stored/reflected XSS, CSRF that changes state, or share-token weaknesses
- WebDAV authentication/authorization flaws
- Quota or upload-limit bypasses with practical impact
- Secrets exposed in logs, defaults, or build artifacts
- Docker/entrypoint privilege or permission issues

Out of scope (unless they demonstrate a concrete vulnerability in this project):

- Misconfiguration such as exposing port 8080 directly to the internet, weak
  administrator passwords, or running without HTTPS
- Reports against unsupported versions or heavily modified forks
- Denial of service from deliberately resource-exhausting an admin account
- Social engineering, physical access, or issues in third-party dependencies
  without a practical exploit path through Tern

## Security model and deployment expectations

- **HTTPS is required for any untrusted network.** WebDAV uses HTTP Basic
  authentication and sessions use cookies; plain HTTP exposes credentials.
  Terminate TLS at a reverse proxy and set `TRUST_PROXY=true`,
  `COOKIE_SECURE=true`, and `PUBLIC_BASE_URL`.
- **The admin account is highly privileged.** Use a strong unique password and
  create member accounts for everyday use. There is no 2FA yet.
- **Share links are bearer capabilities.** Anyone with the link can access the
  shared node unless a password is set. Expiry and passwords are optional per
  share.
- **Data is not end-to-end encrypted.** The server stores file blobs and metadata
  in plaintext under `data/`; protect the NAS volume and backups accordingly.
- **Run the container as a non-root UID** via `DATA_UID`/`DATA_GID` and restrict
  access to the data directory at the host level.
- **Backups matter.** A compromised or lost NAS volume is not recoverable by the
  application. Follow the backup guidance in [docs/DEPLOY.md](docs/DEPLOY.md).

## Hardening checklist

- [ ] Put Tern behind HTTPS (Caddy/Nginx/Synology reverse proxy).
- [ ] Set a strong `ADMIN_PASSWORD`; never keep the sample password.
- [ ] Do not publish container port 8080 to the internet.
- [ ] Keep Docker and the base image updated.
- [ ] Restrict `data/` permissions and include it in encrypted backups.
- [ ] Review members, quotas and shares periodically.
