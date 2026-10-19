import { createHash, randomBytes } from 'node:crypto';

/** Raise an `ApiError`-compatible validation failure. */
export class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

const INVALID_NAME = /[/\\:\0]/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Validate and normalise a user supplied node name.
 *
 * Rules (docs/API.md): NFC normalisation, trimmed, max 200 chars, no `/`, `\`,
 * `:` or NUL, and never `.` / `..`. The returned value is the only string ever
 * used as a display name; it is never used as a filesystem path.
 *
 * @throws {ValidationError}
 */
export function normalizeNodeName(raw) {
  if (typeof raw !== 'string') throw new ValidationError('invalid_name', 'Name must be a string');
  const name = raw.normalize('NFC').trim();
  if (name.length === 0) throw new ValidationError('invalid_name', 'Name must not be empty');
  if (name.length > 200) throw new ValidationError('invalid_name', 'Name is too long (max 200 characters)');
  if (name === '.' || name === '..') throw new ValidationError('invalid_name', 'Invalid name');
  if (INVALID_NAME.test(name) || CONTROL_CHARS.test(name)) {
    throw new ValidationError('invalid_name', 'Name contains invalid characters');
  }
  return name;
}

/** Validate a username. Usernames are unique case-insensitively. */
export function normalizeUsername(raw) {
  if (typeof raw !== 'string') throw new ValidationError('invalid_username', 'Username must be a string');
  const username = raw.normalize('NFC').trim();
  if (username.length < 1 || username.length > 64) {
    throw new ValidationError('invalid_username', 'Username must be between 1 and 64 characters');
  }
  if (INVALID_NAME.test(username) || CONTROL_CHARS.test(username)) {
    throw new ValidationError('invalid_username', 'Username contains invalid characters');
  }
  return username;
}

/** Validate a password (used for accounts, not share passwords). */
export function validatePassword(raw) {
  if (typeof raw !== 'string') throw new ValidationError('invalid_password', 'Password must be a string');
  if (raw.length < 6) throw new ValidationError('invalid_password', 'Password must be at least 6 characters');
  if (raw.length > 1024) throw new ValidationError('invalid_password', 'Password is too long');
  return raw;
}

/** Escape regexp metacharacters (used for SQL LIKE patterns). */
export function likeEscape(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Random URL-safe token. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

/** HTTP date (RFC 7231) used by WebDAV / Last-Modified. */
export function httpDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString();
}

/** Strong-ish ETag derived from the metadata row. */
export function etagForNode(node) {
  const updated = Date.parse(node.updated_at ?? node.updatedAt ?? '') || 0;
  return `"${node.id}-${updated.toString(36)}-${node.size ?? 0}"`;
}

/** Parse a `Range: bytes=...` header for a single range. */
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return undefined; // malformed -> caller answers 416
  let start;
  let end;
  if (match[1] === '' && match[2] === '') return undefined;
  if (match[1] === '') {
    // suffix range: last N bytes
    const suffix = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return undefined;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] === '' ? size - 1 : Number.parseInt(match[2], 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return undefined;
    end = Math.min(end, size - 1);
  }
  if (start >= size || size === 0) return undefined;
  return { start, end, length: end - start + 1 };
}

/**
 * `Content-Disposition` value with an ASCII fallback plus RFC 5987 UTF-8
 * filename so Chinese names survive in every browser.
 */
export function contentDisposition(type, filename) {
  const fallback = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Escape a string for XML text/attribute content. */
export function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Encode a list of path segments for a WebDAV href (each segment separately). */
export function encodeHref(segments) {
  return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

/** Parse a Cookie header into a plain object. */
export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key || key in cookies) continue;
    const value = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

/** Serialise a Set-Cookie header value. */
export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

/** Clamp an integer query parameter. */
export function intParam(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Map a stored mime type onto a safe inline content type. */
export function contentTypeFor(mime) {
  if (!mime || typeof mime !== 'string') return 'application/octet-stream';
  // Never let a stored value inject headers.
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mime)) {
    return 'application/octet-stream';
  }
  return mime;
}

/** Read a request body (for WebDAV XML verbs) with a hard size cap. */
export function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ValidationError('payload_too_large', 'Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
    req.on('aborted', () => reject(new ValidationError('request_aborted', 'Request aborted')));
  });
}

/** Return the local part of a possibly namespaced XML tag name. */
export function xmlLocalName(tag) {
  const index = tag.indexOf(':');
  return index >= 0 ? tag.slice(index + 1) : tag;
}

/**
 * Very small XML helper: extract element names from an XML document. WebDAV
 * request bodies are simple and this keeps the dependency footprint at zero.
 */
export function xmlElementNames(xml) {
  const names = [];
  const re = /<([A-Za-z_][\w.:-]*)(?:\s[^>]*)?\/?>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/** Extract the text content of the first matching element. */
export function xmlFirstText(xml, localName) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}>`, 'i');
  const match = re.exec(xml);
  if (!match) return null;
  return match[1].replace(/<[^>]*>/g, '').trim();
}
