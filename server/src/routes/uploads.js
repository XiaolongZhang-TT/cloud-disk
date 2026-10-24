import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express, { Router } from 'express';

import { ApiError, asyncHandler, badRequest, notFound } from '../errors.js';
import { importUploads, mimeForName, parseParentId } from '../services/files.js';
import { sha256File } from '../services/versions.js';
import { normalizeNodeName, nowIso } from '../util.js';

const MAX_NAME = 200;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function uploadDir(config, ownerId, id) {
  return path.join(config.tmpDir, 'uploads', ownerId, id);
}

function serializeSession(session) {
  return {
    id: session.id,
    name: session.name,
    size: session.size,
    mime: session.mime,
    chunkSize: session.chunk_size,
    chunksTotal: session.chunks_total,
    received: session.received,
    sha256: session.sha256,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

/** Resumable, chunked uploads for large files and unreliable networks. */
export function createUploadsRouter({ store, config }) {
  const router = Router();

  async function cleanupExpired() {
    const before = new Date(Date.now() - SESSION_TTL_MS).toISOString();
    const sessions = store.listExpiredUploadSessions(before);
    for (const session of sessions) {
      store.deleteUploadSession(session.id, session.owner_id);
      await fsp.rm(uploadDir(config, session.owner_id, session.id), { recursive: true, force: true }).catch(() => {});
    }
  }

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      await cleanupExpired();
      const body = req.body ?? {};
      if (typeof body.name !== 'string') throw badRequest('invalid_name', 'name is required');
      const name = normalizeNodeName(body.name);
      if (name.length > MAX_NAME) throw badRequest('invalid_name', 'File name is too long');
      const size = Number(body.size);
      if (!Number.isSafeInteger(size) || size < 0) throw badRequest('invalid_size', 'size must be a non-negative integer');
      if (size > config.maxUploadBytes) {
        throw new ApiError(413, 'upload_too_large', 'The file exceeds the maximum upload size');
      }
      const parentId = parseParentId(body.parentId);
      if (parentId) {
        const parent = store.getNodeForOwner(parentId, req.user.id);
        if (!parent || parent.trashed_at || parent.type !== 'folder') throw badRequest('invalid_parent', 'Parent folder not found');
      }
      const used = store.usedBytes(req.user.id);
      if (req.user.quota > 0 && used + size > req.user.quota) {
        throw new ApiError(507, 'quota_exceeded', 'Not enough storage quota available');
      }
      let sha256 = null;
      if (body.sha256 !== undefined && body.sha256 !== null && body.sha256 !== '') {
        if (typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(body.sha256)) {
          throw badRequest('invalid_sha256', 'sha256 must be 64 hexadecimal characters');
        }
        sha256 = body.sha256.toLowerCase();
      }
      const chunkSize = Math.max(256 * 1024, config.uploadChunkBytes);
      const chunksTotal = Math.max(1, Math.ceil(size / chunkSize));
      const session = store.createUploadSession({
        ownerId: req.user.id,
        parentId,
        name,
        size,
        mime: mimeForName(name),
        chunkSize,
        chunksTotal,
        sha256,
      });
      await fsp.mkdir(uploadDir(config, req.user.id, session.id), { recursive: true });
      res.status(201).json({ upload: serializeSession(session) });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const session = store.getUploadSession(req.params.id, req.user.id);
      if (!session) throw notFound('upload_not_found', 'Upload not found');
      res.json({ upload: serializeSession(session) });
    }),
  );

  router.put(
    '/:id/chunks/:index',
    express.raw({ type: () => true, limit: Math.max(config.uploadChunkBytes, 256 * 1024) + 1024 }),
    asyncHandler(async (req, res) => {
      const session = store.getUploadSession(req.params.id, req.user.id);
      if (!session) throw notFound('upload_not_found', 'Upload not found');
      const index = Number(req.params.index);
      if (!Number.isInteger(index) || index < 0 || index >= session.chunks_total) {
        throw badRequest('invalid_chunk', 'Chunk index is out of range');
      }
      if (!Buffer.isBuffer(req.body)) throw badRequest('invalid_chunk', 'Expected a binary chunk body');
      if (req.body.length > session.chunk_size) throw badRequest('chunk_too_large', 'Chunk exceeds chunk size');
      if (index === session.chunks_total - 1) {
        const expected = session.size - index * session.chunk_size;
        if (req.body.length !== expected) throw badRequest('chunk_size_mismatch', 'Last chunk size does not match the declared file size');
      } else if (req.body.length !== session.chunk_size) {
        throw badRequest('chunk_size_mismatch', 'Chunk size does not match the upload session');
      }

      const directory = uploadDir(config, req.user.id, session.id);
      await fsp.mkdir(directory, { recursive: true });
      const target = path.join(directory, `${index}.part`);
      const existed = await fsp.stat(target).then(() => true).catch(() => false);
      await fsp.writeFile(target, req.body);
      const received = existed ? session.received : session.received + 1;
      const updated = store.updateUploadSession(session.id, req.user.id, {
        received,
        updatedAt: nowIso(),
      });
      res.json({ upload: serializeSession(updated) });
    }),
  );

  router.post(
    '/:id/complete',
    asyncHandler(async (req, res) => {
      const session = store.getUploadSession(req.params.id, req.user.id);
      if (!session) throw notFound('upload_not_found', 'Upload not found');
      if (session.received !== session.chunks_total) {
        throw badRequest('upload_incomplete', 'Not all chunks have been received');
      }
      const directory = uploadDir(config, req.user.id, session.id);
      const merged = path.join(config.tmpDir, `merged-${randomUUID()}.part`);
      try {
        const output = fs.createWriteStream(merged, { flags: 'wx' });
        for (let index = 0; index < session.chunks_total; index += 1) {
          const chunkPath = path.join(directory, `${index}.part`);
          await new Promise((resolve, reject) => {
            const input = fs.createReadStream(chunkPath);
            input.on('error', reject);
            input.on('end', resolve);
            input.pipe(output, { end: false });
          });
        }
        await new Promise((resolve, reject) => {
          output.end(resolve);
          output.on('error', reject);
        });
        const stat = await fsp.stat(merged);
        if (stat.size !== session.size) throw badRequest('upload_size_mismatch', 'Uploaded file size does not match');
        if (session.sha256) {
          const actual = await sha256File(merged);
          if (actual !== session.sha256) throw badRequest('upload_checksum_mismatch', 'SHA-256 checksum does not match');
        }
        const nodes = await importUploads(
          store,
          config,
          req.user,
          session.parent_id,
          [{ path: merged, originalname: session.name, size: stat.size, mimetype: session.mime }],
          { clientId: session.id },
        );
        store.deleteUploadSession(session.id, req.user.id);
        await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
        res.status(201).json({ node: nodes[0] });
      } catch (error) {
        await fsp.unlink(merged).catch(() => {});
        throw error;
      }
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const session = store.getUploadSession(req.params.id, req.user.id);
      if (!session) throw notFound('upload_not_found', 'Upload not found');
      store.deleteUploadSession(session.id, req.user.id);
      await fsp.rm(uploadDir(config, req.user.id, session.id), { recursive: true, force: true }).catch(() => {});
      res.json({ ok: true });
    }),
  );

  return router;
}
