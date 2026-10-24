import { Router } from 'express';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import archiver from 'archiver';
import path from 'node:path';

import { asyncHandler, badRequest, conflict, notFound } from '../errors.js';
import { hashPassword } from '../auth.js';
import { normalizeUsername, validatePassword } from '../util.js';
import { quotaBytesFromGb, serializeUser } from '../services/users.js';

function parseRole(value, fallback = 'member') {
  if (value === undefined) return fallback;
  if (value !== 'admin' && value !== 'member') throw badRequest('invalid_role', 'Role must be "admin" or "member"');
  return value;
}

function parseQuota(value, fallback) {
  if (value === undefined) return fallback;
  const gb = Number(value);
  if (!Number.isFinite(gb) || gb < 0) throw badRequest('invalid_quota', 'Quota must be a non-negative number of GB');
  return quotaBytesFromGb(gb);
}

/** Administration endpoints (role=admin only). */
export function createAdminRouter({ store, config }) {
  const router = Router();

  router.get('/users', (req, res) => {
    res.json({ items: store.listUsers().map((user) => serializeUser(store, user)) });
  });

  router.post(
    '/users',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const username = normalizeUsername(body.username);
      const password = validatePassword(body.password);
      const displayName =
        typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim().slice(0, 100) : null;
      if (store.getUserByUsername(username)) throw conflict('username_taken', 'Username is already taken');
      const user = store.createUser({
        username,
        passwordHash: hashPassword(password),
        displayName,
        role: parseRole(body.role, 'member'),
        quota: parseQuota(body.quotaGb, config.defaultQuotaBytes),
      });
      res.status(201).json({ user: serializeUser(store, user) });
    }),
  );

  router.patch(
    '/users/:id',
    asyncHandler(async (req, res) => {
      const target = store.getUserById(req.params.id);
      if (!target) throw notFound('user_not_found', 'User not found');
      const body = req.body ?? {};
      const patch = {};
      if (body.displayName !== undefined) {
        if (typeof body.displayName !== 'string') throw badRequest('invalid_display_name', 'Display name must be a string');
        patch.displayName = body.displayName.trim().slice(0, 100) || null;
      }
      if (body.password !== undefined) patch.passwordHash = hashPassword(validatePassword(body.password));
      if (body.role !== undefined) {
        const role = parseRole(body.role, target.role);
        if (target.role === 'admin' && role !== 'admin' && store.countAdmins() <= 1) {
          throw badRequest('last_admin', 'Cannot demote the last administrator');
        }
        patch.role = role;
      }
      if (body.quotaGb !== undefined) patch.quota = parseQuota(body.quotaGb, target.quota);
      const user = store.updateUser(target.id, patch);
      if (patch.passwordHash) store.deleteSessionsForUser(target.id);
      res.json({ user: serializeUser(store, user) });
    }),
  );

  router.delete(
    '/users/:id',
    asyncHandler(async (req, res) => {
      const target = store.getUserById(req.params.id);
      if (!target) throw notFound('user_not_found', 'User not found');
      if (target.id === req.user.id) throw badRequest('cannot_delete_self', 'You cannot delete your own account');
      if (target.role === 'admin' && store.countAdmins() <= 1) {
        throw badRequest('last_admin', 'Cannot delete the last administrator');
      }
      store.deleteUser(target.id);
      // Remove blob storage for the deleted user.
      await fsp.rm(path.join(config.storageDir, target.id), { recursive: true, force: true }).catch(() => {});
      res.json({ ok: true });
    }),
  );

  router.get(
    '/backup',
    asyncHandler(async (req, res) => {
      const id = randomUUID();
      const database = path.join(config.tmpDir, `backup-${id}.db`);
      await fsp.mkdir(config.tmpDir, { recursive: true });
      store.backupDatabase(database);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="tern-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
      const archive = archiver('zip', { zlib: { level: 6 } });
      const cleanup = () => fsp.unlink(database).catch(() => {});
      archive.on('error', (error) => {
        cleanup();
        if (!res.headersSent) res.status(500).end();
        else res.destroy(error);
      });
      res.on('close', cleanup);
      archive.pipe(res);
      archive.file(database, { name: 'cloud.db' });
      if (fs.existsSync(config.storageDir)) {
        archive.directory(config.storageDir, 'storage');
      }
      await archive.finalize();
    }),
  );

  return router;
}
