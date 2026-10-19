import { Router } from 'express';

import { asyncHandler, notFound, unauthorized } from '../errors.js';
import { createShareAccessToken, verifyPassword, verifyShareAccessToken } from '../auth.js';
import { collectZipEntries, streamBlob } from '../services/files.js';
import { serializePublicShare, shareIsExpired } from '../services/shares.js';
import { sendZip } from '../services/zip.js';

function loadShare(store, token) {
  const share = store.getShareByToken(token);
  if (!share || shareIsExpired(share) || share.node_trashed_at) {
    throw notFound('share_not_found', 'Share not found');
  }
  return share;
}

/** Public (unauthenticated) share endpoints. */
export function createPublicSharesRouter({ store, config }) {
  const router = Router();

  router.get('/public/shares/:token', (req, res) => {
    const share = loadShare(store, req.params.token);
    res.json({ share: serializePublicShare(share) });
  });

  router.post(
    '/public/shares/:token/unlock',
    asyncHandler(async (req, res) => {
      const share = loadShare(store, req.params.token);
      if (share.password_hash) {
        const password = req.body?.password;
        if (typeof password !== 'string' || password === '') {
          throw unauthorized('password_required', 'This share is password protected');
        }
        if (!verifyPassword(password, share.password_hash)) {
          throw unauthorized('invalid_password', 'Incorrect password');
        }
      }
      const access = createShareAccessToken(store.accessSecret(), share.id, config.shareAccessTtlMs);
      res.json({ accessToken: access.token, expiresAt: access.expiresAt });
    }),
  );

  router.get(
    '/public/shares/:token/content',
    asyncHandler(async (req, res) => {
      const share = loadShare(store, req.params.token);
      if (share.password_hash) {
        const accessToken = typeof req.query.accessToken === 'string' ? req.query.accessToken : '';
        const shareId = accessToken ? verifyShareAccessToken(store.accessSecret(), accessToken) : null;
        if (shareId !== share.id) {
          throw unauthorized('password_required', 'This share is password protected');
        }
      }

      const node = store.getNode(share.node_id);
      if (!node || node.trashed_at) throw notFound('share_not_found', 'Share not found');

      if (node.type === 'folder') {
        store.incrementShareDownload(share.id);
        sendZip(res, config, node.owner_id, node.name, collectZipEntries(store, node.owner_id, node));
        return;
      }

      const download = req.query.download === '1' || req.query.download === 'true';
      if (download) store.incrementShareDownload(share.id);
      await streamBlob(req, res, config, node, { attachment: download, inline: !download });
    }),
  );

  return router;
}
