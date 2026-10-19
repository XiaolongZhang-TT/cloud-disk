import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { sha256 } from './util.js';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

/**
 * Hash a password with scrypt (node:crypto only, no native modules).
 * Format: `scrypt$N$r$p$saltBase64$hashBase64`.
 */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function parsePasswordHash(stored) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  return {
    n: Number.parseInt(parts[1], 10),
    r: Number.parseInt(parts[2], 10),
    p: Number.parseInt(parts[3], 10),
    salt: Buffer.from(parts[4], 'base64'),
    hash: Buffer.from(parts[5], 'base64'),
  };
}

/** Constant-time password verification. */
export function verifyPassword(password, stored) {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  try {
    const actual = scryptSync(password, parsed.salt, parsed.hash.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
      maxmem: SCRYPT_MAXMEM,
    });
    return actual.length === parsed.hash.length && timingSafeEqual(actual, parsed.hash);
  } catch {
    return false;
  }
}

/** SHA-256 of a session token; only the digest is persisted. */
export function sessionTokenHash(token) {
  return sha256(token);
}

/** Issue an opaque session token. */
export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function newShareToken() {
  return randomBytes(32).toString('base64url');
}

// ---------------------------------------------------------------------------
// Share access tokens (unlock a password-protected share, valid 2 hours).
// The secret is persisted in the DB so links keep working across restarts.
// ---------------------------------------------------------------------------

export function createShareAccessToken(secret, shareId, ttlMs) {
  const expiresAt = Date.now() + ttlMs;
  const payload = Buffer.from(JSON.stringify({ s: shareId, e: expiresAt })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt: new Date(expiresAt).toISOString() };
}

/** @returns {string|null} the share id when the token is valid. */
export function verifyShareAccessToken(secret, token) {
  if (typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || typeof data.s !== 'string' || typeof data.e !== 'number') return null;
    if (data.e <= Date.now()) return null;
    return data.s;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Login rate limiting (in-memory; adequate for a single-container deployment).
// ---------------------------------------------------------------------------

export class RateLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.entries = new Map();
  }

  _prune(key, now) {
    const list = this.entries.get(key);
    if (!list) return [];
    const fresh = list.filter((at) => now - at < this.windowMs);
    if (fresh.length === 0) this.entries.delete(key);
    else this.entries.set(key, fresh);
    return fresh;
  }

  /** Record an attempt; returns `{ allowed, retryAfter }` in seconds. */
  hit(key) {
    const now = Date.now();
    const list = this._prune(key, now);
    list.push(now);
    this.entries.set(key, list);
    if (list.length > this.max) {
      const retryAfter = Math.max(1, Math.ceil((list[0] + this.windowMs - now) / 1000));
      return { allowed: false, retryAfter };
    }
    return { allowed: true, retryAfter: 0 };
  }

  reset(key) {
    this.entries.delete(key);
  }
}

// ---------------------------------------------------------------------------
// HTTP Basic auth caching for WebDAV.
//
// Finder performs a burst of small requests. scrypt is deliberately slow, so a
// successful verification is cached for a short window keyed by the presented
// password digest + the stored hash (a password change invalidates it
// automatically). Only successful verifications are cached.
// ---------------------------------------------------------------------------

const BASIC_CACHE_TTL_MS = 5 * 60 * 1000;
const BASIC_CACHE_MAX = 512;

export class BasicAuthCache {
  constructor() {
    this.entries = new Map();
  }

  get(username, passwordDigest, storedHash) {
    const key = `${username}\u0000${passwordDigest}`;
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (Date.now() - entry.at > BASIC_CACHE_TTL_MS || entry.storedHash !== storedHash) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  set(username, passwordDigest, storedHash) {
    if (this.entries.size >= BASIC_CACHE_MAX) {
      // Evict the oldest entry (Map preserves insertion order).
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
    this.entries.set(`${username}\u0000${passwordDigest}`, { at: Date.now(), storedHash });
  }

  digest(password) {
    return createHash('sha256').update(password).digest('base64');
  }
}
