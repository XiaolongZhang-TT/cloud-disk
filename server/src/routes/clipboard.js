import { Router } from 'express';

import { badRequest } from '../errors.js';

const MAX_CLIPBOARD_CHARS = 256 * 1024;

function serializeClipboard(row) {
  if (!row) return null;
  return {
    text: row.content,
    version: Number(row.version),
    device: row.device ?? null,
    updatedAt: row.updated_at,
  };
}

/** Authenticated manual cross-device clipboard. */
export function createClipboardRouter({ store }) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ clipboard: serializeClipboard(store.getClipboard(req.user.id)) });
  });

  router.put('/', (req, res) => {
    const body = req.body ?? {};
    if (typeof body.text !== 'string' || body.text.length === 0) {
      throw badRequest('invalid_clipboard', 'text is required');
    }
    if (body.text.length > MAX_CLIPBOARD_CHARS) {
      throw badRequest('clipboard_too_large', `text must be at most ${MAX_CLIPBOARD_CHARS} characters`);
    }
    let device = null;
    if (body.device !== undefined && body.device !== null && body.device !== '') {
      if (typeof body.device !== 'string' || body.device.length > 120) {
        throw badRequest('invalid_device', 'device must be a string of at most 120 characters');
      }
      device = body.device;
    }
    const row = store.setClipboard(req.user.id, body.text, device);
    res.json({ clipboard: serializeClipboard(row) });
  });

  return router;
}
