import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import mime from 'mime-types';

import { ApiError, badRequest, conflict, nodeNotFound, notFound, payloadTooLarge } from '../errors.js';
import { contentDisposition, contentTypeFor, normalizeNodeName, nowIso, parseRange } from '../util.js';

export const ROOT_BREADCRUMB_NAME = '我的文件';

/** Mime types that can execute in the browser and must be sandboxed inline. */
const UNSAFE_INLINE_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
]);

/** Mime type for a file name, defaulting to a safe binary type. */
export function mimeForName(name) {
  return mime.lookup(name) || 'application/octet-stream';
}

/**
 * macOS writes AppleDouble/metadata companions (`._foo`, `.DS_Store`, …) when a
 * WebDAV volume is mounted in Finder. They are real files on the server, but
 * showing them in the web UI would duplicate every user file, so the REST API
 * hides them. WebDAV still exposes them so Finder can preserve metadata.
 */
export function isHiddenMetadataName(name) {
  if (typeof name !== 'string') return false;
  return (
    name === '.DS_Store' ||
    name === '.localized' ||
    name.startsWith('._') ||
    name === '.Spotlight-V100' ||
    name === '.Trashes' ||
    name === '.fseventsd'
  );
}

/** Absolute blob path for a node. Never contains user supplied path parts. */
export function blobPath(config, ownerId, storageKey) {
  return path.join(config.storageDir, ownerId, storageKey);
}

/** Serialise a DB row into the documented `Node` shape. */
export function serializeNode(row) {
  if (!row) return null;
  const node = {
    id: row.id,
    parentId: row.parent_id ?? null,
    name: row.name,
    type: row.type,
    size: row.effective_size != null ? row.effective_size : row.size,
    mime: row.mime ?? null,
    starred: Boolean(row.starred),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at ?? null,
  };
  if (row.type === 'folder') node.childCount = row.child_count ?? 0;
  return node;
}

/**
 * Normalise a `parentId` query/body value: omitted/empty/`root`/`null` all mean
 * the user's virtual root.
 */
export function parseParentId(raw) {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  if (value === '' || value === 'root' || value === 'null') return null;
  return value;
}

function getParentFolder(store, ownerId, rawParentId) {
  const parentId = parseParentId(rawParentId);
  if (parentId === null) return null;
  const folder = store.getNodeForOwner(parentId, ownerId);
  if (!folder || folder.trashed_at) throw nodeNotFound();
  if (folder.type !== 'folder') throw badRequest('not_a_folder', 'The target is not a folder');
  return folder;
}

/** Fetch a live node owned by the user or raise a generic 404. */
export function getLiveNode(store, ownerId, id) {
  const node = store.getNodeForOwner(id, ownerId);
  if (!node || node.trashed_at) throw nodeNotFound();
  return node;
}

/** Fetch a trashed node owned by the user or raise a generic 404. */
export function getTrashedNode(store, ownerId, id) {
  const node = store.getNodeForOwner(id, ownerId);
  if (!node || !node.trashed_at) throw nodeNotFound();
  return node;
}

/**
 * Pick a name that does not collide with a live sibling. Existing names are
 * auto-renamed as documented: `report.pdf` -> `report (1).pdf`.
 */
export function uniqueName(store, ownerId, parentId, name) {
  if (!store.findLiveChild(ownerId, parentId, name)) return name;
  const dot = name.lastIndexOf('.');
  const hasExtension = dot > 0 && dot < name.length - 1;
  const base = hasExtension ? name.slice(0, dot) : name;
  const extension = hasExtension ? name.slice(dot) : '';
  for (let index = 1; index < 10000; index += 1) {
    const suffix = ` (${index})`;
    const trimmedBase = base.slice(0, Math.max(1, 200 - suffix.length - extension.length));
    const candidate = `${trimmedBase}${suffix}${extension}`;
    if (!store.findLiveChild(ownerId, parentId, candidate)) return candidate;
  }
  throw conflict('name_conflict', 'Could not allocate a unique name');
}

/** Ancestors from the virtual root down to (excluding) the given folder. */
export function breadcrumbFor(store, folder) {
  if (!folder) return [];
  const ancestors = store.ancestors(folder);
  return [
    { id: 'root', name: ROOT_BREADCRUMB_NAME },
    ...ancestors.map((ancestor) => ({ id: ancestor.id, name: ancestor.name })),
  ];
}

/** List a folder (or the root) as documented by `GET /api/nodes`. */
export function listFolder(store, ownerId, rawParentId, { sort = 'name', order = 'asc' } = {}) {
  const folder = getParentFolder(store, ownerId, rawParentId);
  const items = store
    .listChildren(ownerId, folder ? folder.id : null, { sort, order })
    .filter((item) => !isHiddenMetadataName(item.name));
  return {
    folder: folder ? serializeNode(folder) : null,
    breadcrumb: breadcrumbFor(store, folder),
    items: items.map(serializeNode),
  };
}

export function createFolder(store, ownerId, { parentId, name }) {
  const parent = getParentFolder(store, ownerId, parentId);
  const normalized = normalizeNodeName(name);
  const finalName = uniqueName(store, ownerId, parent ? parent.id : null, normalized);
  return store.createNode({
    ownerId,
    parentId: parent ? parent.id : null,
    name: finalName,
    type: 'folder',
  });
}

/**
 * Import a completed multipart upload (multer has already streamed every part
 * to disk). Validation, quota enforcement, auto-renaming, blob moves and DB
 * inserts all happen here so a partial failure leaves no orphaned rows.
 */
export async function importUploads(store, config, user, rawParentId, files) {
  const ownerId = user.id;
  const parent = getParentFolder(store, ownerId, rawParentId);
  const parentId = parent ? parent.id : null;
  const movedBlobs = [];
  const createdIds = [];
  try {
    // 1. Stat + validate every part before touching the tree, so invalid input
    //    never leaves a half-imported batch behind.
    const entries = [];
    let total = 0;
    for (const file of files) {
      const stat = await fsp.stat(file.path);
      entries.push({ file, size: stat.size, name: normalizeNodeName(file.originalname) });
      total += stat.size;
    }
    if (total > config.maxUploadBytes) {
      throw payloadTooLarge('upload_too_large', 'The upload exceeds the maximum request size');
    }
    const used = store.usedBytes(ownerId);
    if (user.quota > 0 && used + total > user.quota) {
      throw payloadTooLarge('quota_exceeded', 'Not enough storage quota available');
    }

    // 2. Move blobs first (atomic rename on the same volume), then insert rows.
    const items = [];
    for (const entry of entries) {
      const name = uniqueName(store, ownerId, parentId, entry.name);
      const id = randomUUID();
      const target = blobPath(config, ownerId, id);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.rename(entry.file.path, target);
      movedBlobs.push(target);
      const row = store.createNode({
        id,
        ownerId,
        parentId,
        name,
        type: 'file',
        size: entry.size,
        mime: mimeForName(name),
        storageKey: id,
      });
      createdIds.push(row.id);
      items.push(row);
    }
    return items.map(serializeNode);
  } catch (error) {
    await Promise.all(files.map((file) => fsp.unlink(file.path).catch(() => {})));
    await Promise.all(movedBlobs.map((blob) => fsp.unlink(blob).catch(() => {})));
    for (const id of createdIds) store.deleteNodeRow(id);
    throw error;
  }
}

/** Rename a live node. Explicit renames reject conflicts instead of renaming. */
export function renameNode(store, ownerId, node, rawName) {
  const name = normalizeNodeName(rawName);
  if (name === node.name) return node;
  const existing = store.findLiveChild(ownerId, node.parent_id, name);
  if (existing && existing.id !== node.id) {
    throw conflict('name_conflict', `An item named "${name}" already exists in this folder`);
  }
  const patch = { name, updatedAt: nowIso() };
  if (node.type === 'file') patch.mime = mimeForName(name);
  return store.updateNode(node.id, patch);
}

/** Move a node to another folder; name collisions are auto-renamed. */
export function moveNode(store, ownerId, node, rawParentId) {
  const parent = getParentFolder(store, ownerId, rawParentId);
  const parentId = parent ? parent.id : null;
  if (parentId === node.id) throw badRequest('invalid_move', 'Cannot move a folder into itself');
  if (parent && store.isDescendant(node.id, parent.id)) {
    throw badRequest('invalid_move', 'Cannot move a folder into one of its descendants');
  }
  const sameParent = node.parent_id === parentId;
  if (sameParent && rawParentId !== undefined) return node;
  const name = uniqueName(store, ownerId, parentId, node.name);
  return store.updateNode(node.id, { parentId, name, updatedAt: nowIso() });
}

/** Recursively copy a node into a folder (blobs are duplicated on disk). */
/** Best-effort quota guard shared by copy and restore. */
function assertQuotaForSubtree(store, user, source, status) {
  if (!user.quota) return;
  const needed = store.subtreeSize(source.id);
  if (store.usedBytes(user.id) + needed > user.quota) {
    throw new ApiError(status, 'quota_exceeded', 'Not enough storage quota available');
  }
}

export async function copyNode(store, config, user, source, rawParentId) {
  const ownerId = user.id;
  const parent = getParentFolder(store, ownerId, rawParentId);
  const parentId = parent ? parent.id : null;
  // Copying a collection into itself or one of its descendants would recurse
  // forever (the freshly copied folder would contain itself).
  if (parent && (parent.id === source.id || store.isDescendant(source.id, parent.id))) {
    throw badRequest('invalid_copy', 'A folder cannot be copied into itself');
  }
  assertQuotaForSubtree(store, user, source, 413);
  const name = uniqueName(store, ownerId, parentId, source.name);
  return copyRecursive(store, config, ownerId, source, parentId, name);
}

/**
 * Copy a node into a known parent using an exact destination name. Used by the
 * WebDAV COPY method, which addresses the destination by path rather than by
 * folder id.
 */
export async function copyNodeTo(store, config, user, source, parentId, name, { depth = 'infinity' } = {}) {
  if (parentId && (parentId === source.id || store.isDescendant(source.id, parentId))) {
    throw badRequest('invalid_copy', 'A folder cannot be copied into itself');
  }
  assertQuotaForSubtree(store, user, source, 507);
  return copyRecursive(store, config, user.id, source, parentId, name, depth);
}

async function copyRecursive(store, config, ownerId, source, parentId, name, depth = 'infinity') {
  if (source.type === 'file') {
    const id = randomUUID();
    const target = blobPath(config, ownerId, id);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(blobPath(config, ownerId, source.storage_key ?? source.id), target);
    return store.createNode({
      id,
      ownerId,
      parentId,
      name,
      type: 'file',
      size: source.size,
      mime: source.mime,
      storageKey: id,
    });
  }
  const folder = store.createNode({ ownerId, parentId, name, type: 'folder' });
  if (depth === '0') return store.getNode(folder.id);
  for (const child of store.listChildren(ownerId, source.id, { sort: 'name', order: 'asc' })) {
    await copyRecursive(store, config, ownerId, child, folder.id, child.name, depth);
  }
  return store.getNode(folder.id);
}

/** Soft delete: the whole subtree becomes restorable trash. */
export function softDeleteNode(store, ownerId, node) {
  if (node.trashed_at) throw nodeNotFound();
  store.markSubtreeTrashed(node.id);
  return store.getNode(node.id);
}

/** Restore a trashed subtree, falling back to the root when needed. */
export function restoreNode(store, user, node) {
  const ownerId = user.id;
  if (!node.trashed_at) throw badRequest('not_trashed', 'Item is not in the trash');
  assertQuotaForSubtree(store, user, node, 413);
  let parentId = node.parent_id;
  if (parentId) {
    const parent = store.getNode(parentId);
    if (!parent || parent.trashed_at || parent.type !== 'folder') parentId = null;
  }
  const name = uniqueName(store, ownerId, parentId, node.name);
  store.transaction(() => {
    store.updateNode(node.id, { parentId, name, updatedAt: nowIso() });
    store.untrashSubtree(node.id);
  });
  return store.getNode(node.id);
}

/** Permanently delete a trashed subtree (rows + blobs). */
export async function permanentlyDeleteNode(store, config, ownerId, node) {
  if (!node.trashed_at) throw badRequest('not_trashed', 'Item must be in the trash before permanent deletion');
  const files = store.listSubtreeFiles(node.id);
  store.transaction(() => store.deleteNodeRow(node.id));
  await Promise.all(
    files.map((file) => fsp.unlink(blobPath(config, ownerId, file.storage_key ?? file.id)).catch(() => {})),
  );
}

export async function emptyTrash(store, config, ownerId) {
  const roots = store.listTrashRoots(ownerId);
  for (const root of roots) {
    await permanentlyDeleteNode(store, config, ownerId, root);
  }
  return roots.length;
}

/** Aggregated storage numbers for the current user. */
export function storageInfo(store, config, user) {
  void config;
  const stats = store.storageStats(user.id);
  return {
    used: stats.used,
    quota: user.quota,
    fileCount: stats.fileCount,
    folderCount: stats.folderCount,
    trashCount: stats.trashCount,
    trashSize: stats.trashSize,
  };
}

export function overview(store, config, user) {
  return {
    storage: storageInfo(store, config, user),
    recent: store
      .listRecent(user.id, 12)
      .filter((node) => !isHiddenMetadataName(node.name))
      .map(serializeNode),
    starred: store
      .listStarred(user.id, 12)
      .filter((node) => !isHiddenMetadataName(node.name))
      .map(serializeNode),
  };
}

/**
 * Resolve decoded WebDAV path segments to a node. Returns the root sentinel
 * (`isRoot`) for `/`, the node when found, or the deepest existing parent plus
 * the missing segment so PUT/MKCOL can tell 409 from 404.
 */
export function resolveDavPath(store, ownerId, segments) {
  if (segments.length === 0) return { node: null, isRoot: true, parent: null, missingName: null, missingParent: null };
  let parent = null;
  let parentId = null;
  for (let index = 0; index < segments.length; index += 1) {
    const child = store.findLiveChild(ownerId, parentId, segments[index]);
    const isLast = index === segments.length - 1;
    if (isLast) {
      return { node: child ?? null, isRoot: false, parent, missingName: child ? null : segments[index], missingParent: null };
    }
    if (!child || child.type !== 'folder') {
      return {
        node: null,
        isRoot: false,
        parent,
        missingName: segments[index],
        missingParent: segments.slice(0, index + 1),
      };
    }
    parent = child;
    parentId = child.id;
  }
  return { node: null, isRoot: true, parent: null, missingName: null, missingParent: null };
}

/** Flatten a subtree into ZIP entries (files only; directories are implicit). */
export function collectZipEntries(store, ownerId, rootNode) {
  const entries = [];
  const walk = (node, prefix) => {
    if (isHiddenMetadataName(node.name)) return;
    if (node.type === 'file') {
      entries.push({ node, archivePath: prefix ? `${prefix}/${node.name}` : node.name });
      return;
    }
    const folderPath = prefix ? `${prefix}/${node.name}` : node.name;
    for (const child of store.listChildren(ownerId, node.id, { sort: 'name', order: 'asc' })) {
      walk(child, folderPath);
    }
  };
  walk(rootNode, '');
  return entries;
}

/**
 * Stream a node's blob with ETag, Last-Modified and single-range support.
 * Shared by the REST download/preview endpoints, public shares and WebDAV GET.
 */
export async function streamBlob(req, res, config, node, { attachment = false, inline = false } = {}) {
  const filePath = blobPath(config, node.owner_id, node.storage_key ?? node.id);
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    throw nodeNotFound();
  }

  const etag = `"${node.id}-${Math.floor(stat.mtimeMs).toString(36)}-${stat.size.toString(36)}"`;
  const mime = contentTypeFor(node.mime);
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  res.setHeader('Content-Type', mime);
  if (attachment) {
    res.setHeader('Content-Disposition', contentDisposition('attachment', node.name));
  } else {
    if (inline) res.setHeader('Content-Disposition', contentDisposition('inline', node.name));
    // Stored XSS defence: user-uploaded HTML/SVG/XML/JS must never execute with
    // the CloudDisk origin's cookies. A sandbox CSP blocks scripts, framing and
    // network access while still letting images/text be previewed.
    if (UNSAFE_INLINE_MIME_TYPES.has(mime)) {
      res.setHeader(
        'Content-Security-Policy',
        "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  }

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && String(ifNoneMatch).split(',').some((tag) => tag.trim() === etag)) {
    res.status(304).end();
    return;
  }

  const range = parseRange(req.headers.range, stat.size);
  if (range === undefined) {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    res.end();
    return;
  }
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
    res.setHeader('Content-Length', String(range.length));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
    stream.on('error', (error) => res.destroy(error));
    stream.pipe(res);
    return;
  }

  res.setHeader('Content-Length', String(stat.size));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', (error) => res.destroy(error));
  stream.pipe(res);
}

/** Enforce quota + max-size before accepting a WebDAV PUT. */
export function assertUploadFits(store, config, user, incomingBytes) {
  if (Number.isFinite(incomingBytes) && incomingBytes > config.maxUploadBytes) {
    throw payloadTooLarge('upload_too_large', 'The upload exceeds the maximum request size');
  }
  if (user.quota > 0) {
    const used = store.usedBytes(user.id);
    const incoming = Number.isFinite(incomingBytes) ? incomingBytes : 0;
    if (used + incoming > user.quota) {
      throw new ApiError(507, 'quota_exceeded', 'Not enough storage quota available');
    }
  }
}

/** Resolve the filesystem path of a trashed/live node blob. */
export function nodeBlobPath(config, node) {
  return blobPath(config, node.owner_id, node.storage_key ?? node.id);
}

export function assertFound(value, code = 'not_found') {
  if (!value) throw notFound(code, 'Not found');
  return value;
}
