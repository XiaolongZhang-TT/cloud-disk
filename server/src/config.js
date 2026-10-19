import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the `server/` directory. */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8'));

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function int(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const GB = 1024 ** 3;

/**
 * Build the runtime configuration from environment variables, optionally
 * overridden by explicit values (used by tests).
 *
 * Every value is resolved once at startup so request handlers never touch
 * `process.env` directly.
 */
export function loadConfig(overrides = {}) {
  const env = process.env;
  const dataDir = path.resolve(overrides.dataDir ?? env.DATA_DIR ?? '/data');
  const defaultQuotaGb = overrides.defaultQuotaGb ?? int(env.DEFAULT_QUOTA_GB, 0);
  const defaultQuotaBytes =
    overrides.defaultQuotaBytes ?? Math.max(0, defaultQuotaGb) * GB;

  return {
    version: pkg.version,
    serverRoot: SERVER_ROOT,
    dataDir,
    storageDir: path.join(dataDir, 'storage'),
    tmpDir: path.join(dataDir, 'tmp'),
    dbFile: path.join(dataDir, 'cloud.db'),

    port: overrides.port ?? int(env.PORT, 8080),
    serverName: overrides.serverName ?? env.SERVER_NAME ?? 'Tern',
    staticDir: path.resolve(
      overrides.staticDir ?? env.STATIC_DIR ?? path.join(SERVER_ROOT, '..', 'web', 'dist'),
    ),
    publicBaseUrl: String(overrides.publicBaseUrl ?? env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),

    adminUsername: overrides.adminUsername ?? env.ADMIN_USERNAME ?? '',
    adminPassword: overrides.adminPassword ?? env.ADMIN_PASSWORD ?? '',
    allowRegistration: overrides.allowRegistration ?? bool(env.ALLOW_REGISTRATION, false),
    defaultQuotaBytes,
    maxUploadBytes: overrides.maxUploadBytes ?? int(env.MAX_UPLOAD_BYTES, 20 * 1024 ** 3),
    maxFilesPerUpload: overrides.maxFilesPerUpload ?? 100,

    cookieName: 'cd_session',
    cookieSecure: String(overrides.cookieSecure ?? env.COOKIE_SECURE ?? 'auto').toLowerCase(),
    trustProxy: overrides.trustProxy ?? bool(env.TRUST_PROXY, false),

    sessionTtlMs: overrides.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000,
    nonRememberSessionTtlMs: overrides.nonRememberSessionTtlMs ?? 24 * 60 * 60 * 1000,
    shareAccessTtlMs: overrides.shareAccessTtlMs ?? 2 * 60 * 60 * 1000,

    // Rate limits (in-memory, per process).
    loginWindowMs: 15 * 60 * 1000,
    loginMaxAttempts: 10,
    davAuthWindowMs: 60 * 1000,
    davAuthMaxAttempts: 30,

    // WebDAV tuning.
    davLockTtlMs: 60 * 60 * 1000,
    davLockMaxTtlMs: 24 * 60 * 60 * 1000,
    davMaxDepthEntries: 10000,
  };
}

/** Create the data directories the server needs. Safe to call repeatedly. */
export function ensureDataDirs(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.storageDir, { recursive: true });
  fs.mkdirSync(config.tmpDir, { recursive: true });
}

/** True when the request arrived over HTTPS (honours TRUST_PROXY). */
export function requestIsSecure(req, config) {
  if (config.cookieSecure === 'true') return true;
  if (config.cookieSecure === 'false') return false;
  return Boolean(req.secure);
}
