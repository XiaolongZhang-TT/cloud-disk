import { Router } from 'express';

import { asyncHandler, badRequest, notFound } from '../errors.js';
import { hashPassword } from '../auth.js';
import { getLiveNode } from '../services/files.js';
import { serializeOwnerShare } from '../services/shares.js';
import { newShareToken } from '../auth.js';

const MAX_EXPIRY_HOURS = 24 * 365;

/** Authenticated share management endpoints. */
export function createSharesRouter({ store, config }) {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      if (typeof body.nodeId !== 'string' || !body.nodeId) {
        throw badRequest('invalid_node', 'nodeId is required');
      }
      const node = getLiveNode(store, req.user.id, body.nodeId);

      let passwordHash = null;
      if (body.password !== undefined && body.password !== null && body.password !== '') {
        if (typeof body.password !== 'string' || body.password.length > 200) {
          throw badRequest('invalid_password', 'Share password must be a string of at most 200 characters');
        }
        passwordHash = hashPassword(body.password);
      }

      let expiresAt = null;
      if (body.expiresInHours !== undefined && body.expiresInHours !== null) {
        const hours = Number(body.expiresInHours);
        if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_EXPIRY_HOURS) {
          throw badRequest('invalid_expiry', 'expiresInHours must be between 0 and 8760 hours');
        }
        expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      }

      const share = store.createShare({
        token: newShareToken(),
        ownerId: req.user.id,
        nodeId: node.id,
        passwordHash,
        expiresAt,
      });
      res.status(201).json({ share: serializeOwnerShare(store.getShareForOwner(share.id, req.user.id), config) });
    }),
  );

  router.get('/', (req, res) => {
    res.json({ items: store.listShares(req.user.id).map((share) => serializeOwnerShare(share, config)) });
  });

  router.delete('/:id', (req, res) => {
    const changes = store.deleteShare(req.params.id, req.user.id);
    if (changes === 0) throw notFound('share_not_found', 'Share not found');
    res.json({ ok: true });
  });

  return router;
}
