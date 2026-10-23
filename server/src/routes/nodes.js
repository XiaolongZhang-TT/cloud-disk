import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import multer from 'multer';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { etagForNode, intParam, likeEscape, nowIso } from '../util.js';
import { ApiError, asyncHandler, badRequest } from '../errors.js';
import {
  collectZipEntries,
  copyNode,
  createFolder,
  emptyTrash,
  getLiveNode,
  getTrashedNode,
  importUploads,
  isHiddenMetadataName,
  mimeForName,
  listFolder,
  moveNode,
  overview,
  permanentlyDeleteNode,
  renameNode,
  restoreNode,
  serializeNode,
  softDeleteNode,
  storageInfo,
  streamBlob,
} from '../services/files.js';
import { sendZip } from '../services/zip.js';

const SORT_FIELDS = new Set(['name', 'modified', 'size', 'trashed']);
const TRASH_SORT_FIELDS = new Set(['trashed', 'name', 'size']);

function pickEnum(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

/** Serialise a node list, hiding macOS AppleDouble/metadata companions. */
function serializeVisible(items) {
  return items.filter((node) => !isHiddenMetadataName(node.name)).map(serializeNode);
}

/** REST endpoints for the virtual file tree (`/api/nodes`, `/api/trash`, ...). */
export function createNodesRouter({ store, config }) {
  const router = Router();

  const upload = multer({
    storage: multer.diskStorage({
      destination: config.tmpDir,
      filename: (req, file, cb) => cb(null, `${randomUUID()}.part`),
    }),
    limits: {
      fileSize: config.maxUploadBytes,
      files: config.maxFilesPerUpload,
      fields: 20,
      parts: config.maxFilesPerUpload + 20,
    },
    // Busboy defaults to latin1 for multipart header parameters; browsers and
    // fetch() send UTF-8, so opt in explicitly or non-ASCII names are mangled.
    defParamCharset: 'utf8',
  });

  // ------------------------------------------------------------- listing ---

  router.get('/', (req, res) => {
    const sort = pickEnum(req.query.sort, SORT_FIELDS, 'name');
    const order = req.query.order === 'desc' ? 'desc' : 'asc';
    res.json(listFolder(store, req.user.id, req.query.parentId, { sort, order }));
  });

  router.get('/:id', (req, res) => {
    res.json({ node: serializeNode(getLiveNode(store, req.user.id, req.params.id)) });
  });

  router.post('/folder', (req, res) => {
    const node = createFolder(store, req.user.id, {
      parentId: req.body?.parentId,
      name: req.body?.name,
      id: req.body?.clientId,
    });
    res.status(201).json({ node: serializeNode(node) });
  });

  router.post(
    '/upload',
    upload.array('files', config.maxFilesPerUpload),
    asyncHandler(async (req, res) => {
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) throw badRequest('invalid_upload', 'At least one file part named "files" is required');
      const items = await importUploads(store, config, req.user, req.query.parentId, files, {
        clientId: typeof req.query.clientId === 'string' ? req.query.clientId : null,
      });
      res.status(201).json({ items });
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      let node = getLiveNode(store, req.user.id, req.params.id);
      const body = req.body ?? {};
      if (body.name !== undefined) node = renameNode(store, req.user.id, node, body.name);
      if (body.parentId !== undefined) node = moveNode(store, req.user.id, node, body.parentId);
      if (body.starred !== undefined) {
        node = store.updateNode(node.id, { starred: Boolean(body.starred) });
      }
      res.json({ node: serializeNode(node) });
    }),
  );

  router.post(
    '/:id/copy',
    asyncHandler(async (req, res) => {
      const source = getLiveNode(store, req.user.id, req.params.id);
      const node = await copyNode(store, config, req.user, source, req.body?.parentId);
      res.status(201).json({ node: serializeNode(store.getNodeForOwner(node.id, req.user.id)) });
    }),
  );

  router.delete('/:id', (req, res) => {
    const node = getLiveNode(store, req.user.id, req.params.id);
    softDeleteNode(store, req.user.id, node);
    res.json({ ok: true });
  });

  // --------------------------------------------------------- download ----

  router.get(
    '/:id/download',
    asyncHandler(async (req, res) => {
      const node = getLiveNode(store, req.user.id, req.params.id);
      if (node.type === 'folder') {
        const entries = collectZipEntries(store, req.user.id, node);
        sendZip(res, config, req.user.id, node.name, entries);
        return;
      }
      await streamBlob(req, res, config, node, { attachment: true });
    }),
  );

  router.get(
    '/:id/content',
    asyncHandler(async (req, res) => {
      const node = getLiveNode(store, req.user.id, req.params.id);
      if (node.type !== 'file') throw badRequest('not_a_file', 'Only files have inline content');
      const download = req.query.download === '1' || req.query.download === 'true';
      await streamBlob(req, res, config, node, { attachment: download, inline: !download });
    }),
  );

  // File Provider uploads raw bytes to an existing file.  This is separate
  // from the multipart upload endpoint so the client can send If-Match and
  // receive a 412 on a stale version.
  router.put(
    '/:id/content',
    express.raw({ type: () => true, limit: config.maxUploadBytes }),
    asyncHandler(async (req, res) => {
      const node = getLiveNode(store, req.user.id, req.params.id);
      if (node.type !== 'file') throw badRequest('not_a_file', 'Only files have content');
      if (!Buffer.isBuffer(req.body)) throw badRequest('invalid_body', 'Expected a raw file body');

      const currentEtag = etagForNode(node);
      const ifMatch = req.headers['if-match'];
      if (ifMatch && String(ifMatch).trim() !== '*') {
        const tags = String(ifMatch).split(',').map((tag) => tag.trim());
        if (!tags.includes(currentEtag)) {
          throw new ApiError(412, 'version_conflict', 'The file was modified by another client', { etag: currentEtag });
        }
      }

      const size = req.body.length;
      const used = store.usedBytes(req.user.id);
      if (req.user.quota > 0 && used - node.size + size > req.user.quota) {
        throw new ApiError(507, 'quota_exceeded', 'Not enough storage quota available');
      }

      const target = path.join(config.storageDir, req.user.id, node.storage_key ?? node.id);
      const temp = path.join(config.tmpDir, `content-${randomUUID()}.part`);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      try {
        await fsp.writeFile(temp, req.body);
        await fsp.rename(temp, target);
      } catch (error) {
        await fsp.unlink(temp).catch(() => {});
        throw error;
      }

      const updated = store.updateNode(node.id, {
        size,
        mime: mimeForName(node.name),
        updatedAt: nowIso(),
      });
      res.setHeader('ETag', etagForNode(updated));
      res.json({ node: serializeNode(updated) });
    }),
  );

  return router;
}

/** `/api/trash`, `/api/starred`, `/api/recent`, `/api/search`, … */
export function createCollectionsRouter({ store, config }) {
  const router = Router();

  router.get('/trash', (req, res) => {
    const sort = pickEnum(req.query.sort, TRASH_SORT_FIELDS, 'trashed');
    const order = req.query.order === 'asc' ? 'asc' : 'desc';
    res.json({ items: serializeVisible(store.listTrashRoots(req.user.id, { sort, order })) });
  });

  router.post(
    '/trash/:id/restore',
    asyncHandler(async (req, res) => {
      const node = getTrashedNode(store, req.user.id, req.params.id);
      res.json({ node: serializeNode(restoreNode(store, req.user, node)) });
    }),
  );

  router.delete(
    '/trash/:id',
    asyncHandler(async (req, res) => {
      const node = getTrashedNode(store, req.user.id, req.params.id);
      await permanentlyDeleteNode(store, config, req.user.id, node);
      res.json({ ok: true });
    }),
  );

  router.delete(
    '/trash',
    asyncHandler(async (req, res) => {
      await emptyTrash(store, config, req.user.id);
      res.json({ ok: true });
    }),
  );

  router.get('/starred', (req, res) => {
    const limit = intParam(req.query.limit, 100, 1, 500);
    res.json({ items: serializeVisible(store.listStarred(req.user.id, limit)) });
  });

  router.get('/recent', (req, res) => {
    const limit = intParam(req.query.limit, 24, 1, 100);
    res.json({ items: serializeVisible(store.listRecent(req.user.id, limit)) });
  });

  router.get('/search', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) throw badRequest('invalid_query', 'Search query "q" is required');
    const limit = intParam(req.query.limit, 50, 1, 100);
    const items = serializeVisible(store.search(req.user.id, likeEscape(query), limit));
    res.json({ query, items });
  });

  router.get('/storage', (req, res) => {
    res.json(storageInfo(store, config, req.user));
  });

  router.get('/overview', (req, res) => {
    res.json(overview(store, config, req.user));
  });

  // Bootstrap (cursor 0) returns a full live-tree snapshot; subsequent calls
  // replay the append-only change feed. Used by the macOS File Provider.
  router.get('/sync/changes', (req, res) => {
    let cursor = 0;
    if (req.query.cursor !== undefined) {
      cursor = Number.parseInt(String(req.query.cursor), 10);
      if (!Number.isInteger(cursor) || cursor < 0) {
        throw badRequest('invalid_cursor', 'cursor must be a non-negative integer');
      }
    }
    const limit = intParam(req.query.limit, 500, 1, 5000);

    if (cursor === 0) {
      res.json({
        reset: true,
        cursor: store.syncCursor(req.user.id),
        changes: store.syncSnapshot(req.user.id),
      });
      return;
    }

    const result = store.syncChanges(req.user.id, cursor, limit);
    res.json({ reset: false, ...result });
  });

  // Long-poll companion to /sync/changes.  Without a cursor it returns the
  // current head immediately so a client can establish its reference point.
  // With a cursor it holds the request until a change is recorded or the
  // timeout expires.  This is what lets the menu-bar app wake File Provider
  // when another client (web/WebDAV/another Mac) changes the tree.
  router.get('/sync/watch', (req, res) => {
    const rawCursor = req.query.cursor;
    const head = store.syncCursor(req.user.id);
    if (rawCursor === undefined || rawCursor === '') {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ cursor: head, changed: false });
      return;
    }

    const cursor = Number.parseInt(String(rawCursor), 10);
    if (!Number.isInteger(cursor) || cursor < 0) {
      throw badRequest('invalid_cursor', 'cursor must be a non-negative integer');
    }
    const timeoutSeconds = intParam(req.query.timeout, 25, 1, 30);
    const deadline = Date.now() + timeoutSeconds * 1000;

    let timer = null;
    let finished = false;
    const finish = (payload) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (!res.headersSent) {
        res.setHeader('Cache-Control', 'no-store');
        res.json(payload);
      }
    };
    const cleanup = () => {
      finished = true;
      if (timer) clearTimeout(timer);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);

    const check = () => {
      if (finished) return;
      const current = store.syncCursor(req.user.id);
      if (current > cursor) {
        finish({ cursor: current, changed: true });
        return;
      }
      if (Date.now() >= deadline) {
        finish({ cursor, changed: false });
        return;
      }
      timer = setTimeout(check, 500);
    };
    check();
  });

  return router;
}
