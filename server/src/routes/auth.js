import { Router } from 'express';

import { ApiError, asyncHandler, badRequest, conflict, unauthorized } from '../errors.js';
import {
  hashPassword,
  newSessionToken,
  RateLimiter,
  sessionTokenHash,
  verifyPassword,
} from '../auth.js';
import { requestIsSecure } from '../config.js';
import { normalizeUsername, serializeCookie, validatePassword } from '../util.js';
import { publicConfig, serializeUser } from '../services/users.js';

// Verifying against a dummy hash when the user does not exist keeps login
// timing independent of account existence.
const DUMMY_HASH = hashPassword('tern-timing-equaliser');

function setSessionCookie(req, res, config, token, ttlMs) {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(config.cookieName, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: requestIsSecure(req, config),
      maxAge: Math.floor(ttlMs / 1000),
    }),
  );
}

function clearSessionCookie(req, res, config) {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(config.cookieName, '', {
      httpOnly: true,
      sameSite: 'Lax',
      secure: requestIsSecure(req, config),
      maxAge: 0,
    }),
  );
}

function startSession(store, config, req, res, user, remember = true) {
  const token = newSessionToken();
  const ttl = remember ? config.sessionTtlMs : config.nonRememberSessionTtlMs;
  store.createSession(sessionTokenHash(token), user.id, new Date(Date.now() + ttl).toISOString());
  setSessionCookie(req, res, config, token, ttl);
}

function assertAllowed(limiter, key) {
  const result = limiter.hit(key);
  if (!result.allowed) {
    throw new ApiError(429, 'rate_limited', 'Too many attempts. Please try again later.', {
      retryAfter: result.retryAfter,
    });
  }
}

/** Auth, account and public configuration endpoints. */
export function createAuthRouter({ store, config }) {
  const router = Router();
  const loginLimiter = new RateLimiter({ windowMs: config.loginWindowMs, max: config.loginMaxAttempts });

  router.get('/auth/status', (req, res) => {
    const setupRequired = store.countUsers() === 0;
    const body = {
      authenticated: Boolean(req.user),
      setupRequired,
      ...publicConfig(config),
    };
    if (req.user) body.user = serializeUser(store, req.user);
    res.json(body);
  });

  router.get('/config', (req, res) => {
    res.json(publicConfig(config));
  });

  router.post(
    '/auth/setup',
    asyncHandler(async (req, res) => {
      if (store.countUsers() > 0) {
        throw new ApiError(403, 'setup_not_allowed', 'Setup has already been completed');
      }
      const username = normalizeUsername(req.body?.username);
      const password = validatePassword(req.body?.password);
      const displayName =
        typeof req.body?.displayName === 'string' && req.body.displayName.trim()
          ? req.body.displayName.trim().slice(0, 100)
          : null;
      if (store.getUserByUsername(username)) throw conflict('username_taken', 'Username is already taken');
      const user = store.createUser({
        username,
        passwordHash: hashPassword(password),
        displayName,
        role: 'admin',
        quota: config.defaultQuotaBytes,
      });
      startSession(store, config, req, res, user, true);
      res.status(201).json({ user: serializeUser(store, user) });
    }),
  );

  router.post(
    '/auth/login',
    asyncHandler(async (req, res) => {
      const rawUsername = req.body?.username;
      const password = req.body?.password;
      if (typeof rawUsername !== 'string' || typeof password !== 'string' || rawUsername.trim() === '') {
        throw badRequest('invalid_credentials', 'Username and password are required');
      }
      const username = rawUsername.trim();
      const ipKey = `ip:${req.ip ?? 'unknown'}`;
      const userKey = `user:${username.toLowerCase()}`;
      assertAllowed(loginLimiter, ipKey);
      assertAllowed(loginLimiter, userKey);

      const user = store.getUserByUsername(username);
      const valid = user
        ? verifyPassword(password, user.password_hash)
        : (verifyPassword(password, DUMMY_HASH), false);
      if (!valid) {
        // One generic error for unknown user and bad password.
        throw unauthorized('invalid_credentials', 'Invalid username or password');
      }
      loginLimiter.reset(ipKey);
      loginLimiter.reset(userKey);
      startSession(store, config, req, res, user, req.body?.remember !== false);
      res.json({ user: serializeUser(store, user) });
    }),
  );

  router.post(
    '/auth/register',
    asyncHandler(async (req, res) => {
      if (!config.allowRegistration) {
        throw new ApiError(403, 'registration_disabled', 'Registration is disabled on this server');
      }
      const username = normalizeUsername(req.body?.username);
      const password = validatePassword(req.body?.password);
      const displayName =
        typeof req.body?.displayName === 'string' && req.body.displayName.trim()
          ? req.body.displayName.trim().slice(0, 100)
          : null;
      if (store.getUserByUsername(username)) throw conflict('username_taken', 'Username is already taken');
      const user = store.createUser({
        username,
        passwordHash: hashPassword(password),
        displayName,
        role: 'member',
        quota: config.defaultQuotaBytes,
      });
      startSession(store, config, req, res, user, true);
      res.status(201).json({ user: serializeUser(store, user) });
    }),
  );

  router.post('/auth/logout', (req, res) => {
    if (req.sessionHash) store.deleteSession(req.sessionHash);
    clearSessionCookie(req, res, config);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    if (!req.user) throw unauthorized('unauthenticated', 'Please sign in');
    res.json({ user: serializeUser(store, req.user) });
  });

  router.patch(
    '/me',
    asyncHandler(async (req, res) => {
      if (!req.user) throw unauthorized('unauthenticated', 'Please sign in');
      const body = req.body ?? {};
      const patch = {};
      if (body.displayName !== undefined) {
        if (typeof body.displayName !== 'string') throw badRequest('invalid_display_name', 'Display name must be a string');
        patch.displayName = body.displayName.trim().slice(0, 100) || null;
      }
      if (body.newPassword !== undefined) {
        const newPassword = validatePassword(body.newPassword);
        if (typeof body.currentPassword !== 'string' || !verifyPassword(body.currentPassword, req.user.password_hash)) {
          throw unauthorized('invalid_password', 'Current password is incorrect');
        }
        patch.passwordHash = hashPassword(newPassword);
        store.updateUser(req.user.id, patch);
        // Sessions other than the current one are invalidated after a password
        // change; the browser issuing the request stays signed in.
        store.deleteSessionsForUser(req.user.id, req.sessionHash);
        return res.json({ user: serializeUser(store, store.getUserById(req.user.id)) });
      }
      const user = store.updateUser(req.user.id, patch);
      res.json({ user: serializeUser(store, user) });
    }),
  );

  return router;
}
