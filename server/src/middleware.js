import { parseCookies } from './util.js';
import { RateLimiter, sessionTokenHash, verifyPassword } from './auth.js';
import { ApiError, unauthorized } from './errors.js';

/**
 * `middleware.js` — cross cutting HTTP concerns shared by the REST API and the
 * WebDAV endpoint.
 */

export function createSecurityHeaders(config) {
  void config;
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-XSS-Protection', '0');
    // The SPA is self hosted; allow inline styles (common in built bundles) but
    // never remote script execution.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    );
    next();
  };
}

/**
 * Resolve the `cd_session` cookie (if any) to `req.user` / `req.sessionHash`.
 * Never rejects — route level guards decide whether a user is required.
 */
export function createSessionMiddleware({ store, config }) {
  return (req, res, next) => {
    req.user = null;
    req.sessionHash = null;
    const token = parseCookies(req.headers.cookie)[config.cookieName];
    if (token) {
      const hash = sessionTokenHash(token);
      const user = store.getSessionUser(hash);
      if (user) {
        req.user = user;
        req.sessionHash = hash;
      }
    }
    next();
  };
}

/** Reject unauthenticated requests to a guarded endpoint. */
export function requireUser(req, res, next) {
  if (!req.user) return next(unauthorized('unauthenticated', 'Please sign in'));
  next();
}

/** Admin-only guard. */
export function requireAdmin(req, res, next) {
  if (!req.user) return next(unauthorized('unauthenticated', 'Please sign in'));
  if (req.user.role !== 'admin') return next(new ApiError(403, 'forbidden', 'Administrator access required'));
  next();
}

/**
 * HTTP Basic authentication for WebDAV with a short-lived successful-auth cache
 * so Finder's many requests do not each pay for scrypt.
 */
export function createDavAuth({ store, config, basicCache }) {
  const failureLimiter = new RateLimiter({ windowMs: config.davAuthWindowMs, max: config.davAuthMaxAttempts });
  const challenge = (res) => {
    res.setHeader('WWW-Authenticate', 'Basic realm="CloudDisk", charset="UTF-8"');
  };

  return (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (!header.toLowerCase().startsWith('basic ')) {
      challenge(res);
      return next(unauthorized('unauthenticated', 'WebDAV requires HTTP Basic authentication'));
    }

    let username;
    let password;
    try {
      const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
      const index = decoded.indexOf(':');
      if (index < 0) throw new Error('malformed');
      username = decoded.slice(0, index);
      password = decoded.slice(index + 1);
    } catch {
      challenge(res);
      return next(unauthorized('invalid_credentials', 'Invalid credentials'));
    }

    const limit = failureLimiter.hit(`dav:${clientIp}`);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      return next(new ApiError(429, 'rate_limited', 'Too many failed authentication attempts'));
    }

    const user = store.getUserByUsername(username);
    const digest = basicCache.digest(password);
    const cacheHit = user ? basicCache.get(user.username, digest, user.password_hash) : false;
    const ok = user && (cacheHit || verifyPassword(password, user.password_hash));
    if (!ok) {
      challenge(res);
      return next(unauthorized('invalid_credentials', 'Invalid username or password'));
    }

    basicCache.set(user.username, digest, user.password_hash);
    failureLimiter.reset(`dav:${clientIp}`);
    req.user = user;
    req.davUser = user;
    next();
  };
}
