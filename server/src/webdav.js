import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';

import { ApiError, asyncHandler, badRequest } from './errors.js';
import { createDavAuth } from './middleware.js';
import {
  assertUploadFits,
  blobPath,
  copyNodeTo,
  mimeForName,
  renameNode,
  resolveDavPath,
  softDeleteNode,
  streamBlob,
} from './services/files.js';
import { escapeXml, etagForNode, httpDate, normalizeNodeName, nowIso, readBody, xmlFirstText } from './util.js';

const DAV_METHODS = 'OPTIONS, PROPFIND, PROPPATCH, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE, LOCK, UNLOCK';
const XML_DECL = '<?xml version="1.0" encoding="utf-8"?>';
const ROOT_DISPLAY_NAME = 'Tern';

// Properties returned by an allprop PROPFIND / included by default.
const DEFAULT_PROPERTIES = [
  'creationdate',
  'displayname',
  'getcontentlanguage',
  'getcontentlength',
  'getcontenttype',
  'getetag',
  'getlastmodified',
  'resourcetype',
  'supportedlock',
  'lockdiscovery',
];

/** In-memory lock manager (locks only need to survive for the process, per docs). */
class DavLockStore {
  constructor() {
    this.locks = new Map();
  }

  sweep() {
    const now = Date.now();
    for (const [token, lock] of this.locks) {
      if (lock.expiresAt <= now) this.locks.delete(token);
    }
  }

  /** Active locks that cover `pathKey` for this user. */
  forPath(userId, pathKey) {
    this.sweep();
    const matches = [];
    for (const lock of this.locks.values()) {
      if (lock.userId !== userId) continue;
      if (lock.pathKey === pathKey) {
        matches.push(lock);
      } else if (lock.depth === 'infinity' && lock.pathKey === '') {
        matches.push(lock);
      } else if (lock.depth === 'infinity' && pathKey.startsWith(`${lock.pathKey}/`)) {
        matches.push(lock);
      }
    }
    return matches;
  }

  create({ userId, pathKey, depth, scope, owner, ttlMs }) {
    const token = `opaquelocktoken:${randomUUID()}`;
    const lock = {
      token,
      userId,
      pathKey,
      depth,
      scope,
      owner: owner || userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
    this.locks.set(token, lock);
    return lock;
  }

  getByToken(token) {
    this.sweep();
    return this.locks.get(token) ?? null;
  }

  refresh(lock, ttlMs) {
    lock.expiresAt = Date.now() + ttlMs;
    return lock;
  }

  remove(token) {
    return this.locks.delete(token);
  }

  removeForPath(userId, pathKey) {
    for (const [token, lock] of this.locks) {
      if (lock.userId !== userId) continue;
      if (lock.pathKey === pathKey || (lock.depth === 'infinity' && pathKey.startsWith(`${lock.pathKey}/`))) {
        this.locks.delete(token);
      }
    }
  }

  /** Keep locks attached when a locked resource is moved/renamed. */
  renamePath(userId, oldPathKey, newPathKey) {
    for (const lock of this.locks.values()) {
      if (lock.userId !== userId) continue;
      if (lock.pathKey === oldPathKey) {
        lock.pathKey = newPathKey;
      } else if (lock.pathKey.startsWith(`${oldPathKey}/`)) {
        lock.pathKey = `${newPathKey}${lock.pathKey.slice(oldPathKey.length)}`;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Path / header helpers
// ---------------------------------------------------------------------------

/** Split the mount-relative request URL into decoded path segments. */
function requestSegments(req) {
  const raw = String(req.url ?? '/').split('?')[0];
  const parts = raw.split('/').filter((part) => part.length > 0);
  return parts.map((part) => {
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw badRequest('invalid_path', 'Malformed percent-encoding in path');
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\0')) {
      throw badRequest('invalid_path', 'Invalid path segment');
    }
    return decoded;
  });
}

const KNOWN_MOUNTS = ['/dav', '/Tern'];

/** Parse the `Destination` header of COPY/MOVE relative to this mount. */
function destinationSegments(req) {
  const destination = req.headers.destination;
  if (!destination) throw badRequest('missing_destination', 'Destination header is required');
  let pathname;
  try {
    pathname = new URL(destination, `${req.protocol}://${req.headers.host ?? 'localhost'}`).pathname;
  } catch {
    throw badRequest('invalid_destination', 'Destination header is not a valid URL');
  }
  let relative = pathname;
  for (const mount of KNOWN_MOUNTS) {
    if (pathname === mount) {
      relative = '/';
      break;
    }
    if (pathname.startsWith(`${mount}/`)) {
      relative = pathname.slice(mount.length);
      break;
    }
  }
  return requestSegments({ url: relative });
}

function hrefFor(base, segments, collection) {
  const encoded = segments.map((segment) => encodeURIComponent(segment)).join('/');
  let href = encoded ? `${base}/${encoded}` : `${base}/`;
  if (collection && !href.endsWith('/')) href += '/';
  return href;
}

function lockTokensFrom(req) {
  const tokens = new Set();
  const ifHeader = req.headers.if ?? '';
  for (const match of String(ifHeader).matchAll(/<([^>]+)>/g)) {
    if (match[1].toLowerCase().startsWith('opaquelocktoken:')) tokens.add(match[1]);
  }
  const lockToken = req.headers['lock-token'] ?? '';
  for (const match of String(lockToken).matchAll(/<([^>]+)>/g)) {
    if (match[1].toLowerCase().startsWith('opaquelocktoken:')) tokens.add(match[1]);
  }
  return tokens;
}

function parseTimeout(header, config) {
  const match = /Second-(\d+)/i.exec(String(header ?? ''));
  if (match) {
    const ms = Number.parseInt(match[1], 10) * 1000;
    return Math.min(config.davLockMaxTtlMs, Math.max(1000, ms));
  }
  return config.davLockTtlMs;
}

function parseLockInfo(body) {
  if (!body || !new RegExp(`<(?:(?:[\\w.-]+):)?lockinfo\\b`, 'i').test(body)) return null;
  const scope = new RegExp(`<(?:(?:[\\w.-]+):)?lockscope\\b[^>]*>[\\s\\S]*?<(?:(?:[\\w.-]+):)?shared\\b`, 'i').test(body)
    ? 'shared'
    : 'exclusive';
  const hrefMatch = new RegExp(
    `<(?:(?:[\\w.-]+):)?owner\\b[^>]*>[\\s\\S]*?<(?:(?:[\\w.-]+):)?href\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?href>`,
    'i',
  ).exec(body);
  const ownerMatch = new RegExp(
    `<(?:(?:[\\w.-]+):)?owner\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?owner>`,
    'i',
  ).exec(body);
  const owner = (hrefMatch?.[1] ?? ownerMatch?.[1] ?? '')
    .replace(/<[^>]*>/g, '')
    .trim();
  return { scope, owner: owner.slice(0, 512) };
}

function activeLockXml(lock, base) {
  const pathSegments = lock.pathKey === '' ? [] : lock.pathKey.split('/');
  const href = hrefFor(base, pathSegments, true);
  const seconds = Math.max(1, Math.floor((lock.expiresAt - Date.now()) / 1000));
  return (
    '<D:activelock>' +
    '<D:locktype><D:write/></D:locktype>' +
    `<D:lockscope>${lock.scope === 'shared' ? '<D:shared/>' : '<D:exclusive/>'}</D:lockscope>` +
    `<D:depth>${lock.depth === '0' ? '0' : 'infinity'}</D:depth>` +
    `<D:owner>${escapeXml(lock.owner)}</D:owner>` +
    `<D:timeout>Second-${seconds}</D:timeout>` +
    `<D:locktoken><D:href>${escapeXml(lock.token)}</D:href></D:locktoken>` +
    `<D:lockroot><D:href>${escapeXml(href)}</D:href></D:lockroot>` +
    '</D:activelock>'
  );
}

function lockdiscoveryXml(locks, base) {
  if (locks.length === 0) return '<D:lockdiscovery/>';
  return `<D:lockdiscovery>${locks.map((lock) => activeLockXml(lock, base)).join('')}</D:lockdiscovery>`;
}

function supportedLockXml() {
  return (
    '<D:supportedlock>' +
    '<D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>' +
    '<D:lockentry><D:lockscope><D:shared/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>' +
    '</D:supportedlock>'
  );
}

// ---------------------------------------------------------------------------
// PROPFIND parsing / rendering
// ---------------------------------------------------------------------------

function parseRequestedProperties(body) {
  if (!body || body.trim() === '') {
    return { mode: 'allprop', names: [] };
  }
  if (/<(?:(?:[\w.-]+):)?propname\b/i.test(body)) return { mode: 'propname', names: [] };
  if (/<(?:(?:[\w.-]+):)?allprop\b/i.test(body)) return { mode: 'allprop', names: [] };
  const propMatch = /<(?:(?:[\w.-]+):)?prop\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?prop>/i.exec(body);
  if (!propMatch) return { mode: 'allprop', names: [] };
  const names = [];
  for (const match of propMatch[1].matchAll(/<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b[^>]*\/?>/g)) {
    const local = match[2];
    if (local && local !== 'prop' && !names.includes(local)) names.push(local);
  }
  return { mode: 'prop', names };
}

function renderProps({
  user,
  store,
  config,
  node,
  isRoot,
  segments,
  requested,
  locks,
  base,
  pathKey,
}) {
  const isCollection = isRoot || node.type === 'folder';
  const displayName = isRoot ? ROOT_DISPLAY_NAME : node.name;
  const etag = isRoot ? `"root-${user.id}"` : etagForNode(node);
  const mime = isRoot || node.type === 'folder' ? null : node.mime || 'application/octet-stream';
  const updatedAt = isRoot ? nowIso() : node.updated_at;
  const createdAt = isRoot ? user.created_at : node.created_at;
  void pathKey;

  const supported = new Map();
  supported.set('displayname', `<D:displayname>${escapeXml(displayName)}</D:displayname>`);
  supported.set(
    'resourcetype',
    isCollection ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>',
  );
  supported.set('creationdate', `<D:creationdate>${escapeXml(createdAt)}</D:creationdate>`);
  supported.set('getlastmodified', `<D:getlastmodified>${httpDate(updatedAt)}</D:getlastmodified>`);
  supported.set('getetag', `<D:getetag>${escapeXml(etag)}</D:getetag>`);
  supported.set('getcontentlanguage', '<D:getcontentlanguage/>');
  supported.set('supportedlock', supportedLockXml());
  supported.set('lockdiscovery', lockdiscoveryXml(locks, base));
  if (!isCollection) {
    const size = node.effective_size ?? node.size ?? 0;
    supported.set('getcontentlength', `<D:getcontentlength>${size}</D:getcontentlength>`);
    supported.set('getcontenttype', `<D:getcontenttype>${escapeXml(mime)}</D:getcontenttype>`);
  }
  if (isRoot) {
    const used = store.usedBytes(user.id);
    supported.set('quota-used-bytes', `<D:quota-used-bytes>${used}</D:quota-used-bytes>`);
    if (user.quota > 0) {
      supported.set('quota-available-bytes', `<D:quota-available-bytes>${Math.max(0, user.quota - used)}</D:quota-available-bytes>`);
    }
    supported.set('quota', `<D:quota>${user.quota}</D:quota>`);
  }

  const want = requested.mode === 'propname' ? [] : requested.mode === 'allprop' ? DEFAULT_PROPERTIES : requested.names;
  const okProps = [];
  const missingProps = [];
  if (requested.mode === 'propname') {
    for (const name of [...supported.keys()]) {
      okProps.push(`<D:${name}/>`);
    }
  } else {
    for (const name of want) {
      if (requested.mode === 'allprop' && !supported.has(name)) continue;
      if (supported.has(name)) okProps.push(supported.get(name));
      else missingProps.push(`<D:${escapeXml(name)}/>`);
    }
  }

  let xml = `<D:response><D:href>${escapeXml(hrefFor(base, segments, isCollection))}</D:href>`;
  if (okProps.length > 0) {
    xml += `<D:propstat><D:prop>${okProps.join('')}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>`;
  }
  if (missingProps.length > 0) {
    xml += `<D:propstat><D:prop>${missingProps.join('')}</D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>`;
  }
  xml += '</D:response>';
  return xml;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * WebDAV endpoint mounted at `/dav` and `/Tern`.
 *
 * Finder support relies on: DAV class 1+2 advertisement, 207 multistatus with
 * quoted ETags/ISO dates, `getcontentlength`, lock support, Range GET, MOVE
 * for rename and COPY/PUT/DELETE/MKCOL for the usual file operations.
 */
export function createWebdavRouter({ store, config, basicCache }) {
  const router = Router();
  const locks = new DavLockStore();
  const auth = createDavAuth({ store, config, basicCache });

  function rootRow(user) {
    return {
      id: null,
      owner_id: user.id,
      parent_id: null,
      name: '',
      type: 'folder',
      size: 0,
      effective_size: 0,
      child_count: 0,
      mime: null,
      starred: 0,
      created_at: user.created_at,
      updated_at: nowIso(),
      trashed_at: null,
    };
  }

  function baseFor(req) {
    return req.baseUrl || '/dav';
  }

  function assertUnlocked(req, pathKey) {
    const covering = locks.forPath(req.user.id, pathKey);
    if (covering.length === 0) return;
    const provided = lockTokensFrom(req);
    if (covering.some((lock) => provided.has(lock.token))) return;
    throw new ApiError(423, 'locked', 'The resource is locked', { lockToken: covering[0].token });
  }

  /** Resolve a target or throw the appropriate WebDAV status. */
  function resolveTarget(req, { allowMissing = false } = {}) {
    const segments = requestSegments(req);
    const resolved = resolveDavPath(store, req.user.id, segments);
    const missing = resolved.missingParent || (!resolved.node && !resolved.isRoot);
    if (missing && !allowMissing) {
      throw new ApiError(404, 'not_found', 'Not found');
    }
    return { segments, resolved };
  }

  async function handleOptions(req, res) {
    res.setHeader('DAV', '1, 2');
    res.setHeader('Allow', DAV_METHODS);
    res.setHeader('MS-Author-Via', 'DAV');
    res.setHeader('Accept-Ranges', 'bytes');
    res.status(200).end();
  }

  async function handlePropfind(req, res) {
    const { segments, resolved } = resolveTarget(req);
    const base = baseFor(req);
    const body = await readBody(req);
    const requested = parseRequestedProperties(body);
    const depthRaw = String(req.headers.depth ?? 'infinity').toLowerCase();
    const depth = depthRaw === '0' ? '0' : depthRaw === '1' ? '1' : 'infinity';

    const rootIsCollection = resolved.isRoot || resolved.node.type === 'folder';
    const resources = [];
    const targetNode = resolved.isRoot ? rootRow(req.user) : resolved.node;
    resources.push({ node: targetNode, segments, isRoot: resolved.isRoot });

    if (rootIsCollection && depth !== '0') {
      const queue = [{ node: targetNode, segments, isRoot: resolved.isRoot }];
      while (queue.length > 0) {
        const current = queue.shift();
        const children = store.listChildren(
          req.user.id,
          current.isRoot ? null : current.node.id,
          { sort: 'name', order: 'asc' },
        );
        for (const child of children) {
          const childSegments = [...current.segments, child.name];
          resources.push({ node: child, segments: childSegments, isRoot: false });
          if (depth === 'infinity' && child.type === 'folder') {
            queue.push({ node: child, segments: childSegments, isRoot: false });
          }
          if (resources.length > config.davMaxDepthEntries) {
            throw new ApiError(507, 'too_many_items', 'The requested depth is too large');
          }
        }
      }
    }

    const responses = resources.map((resource) => {
      const pathKey = resource.segments.join('/');
      const coveringLocks = locks.forPath(req.user.id, pathKey);
      return renderProps({
        user: req.user,
        store,
        config,
        node: resource.node,
        isRoot: resource.isRoot,
        segments: resource.segments,
        requested,
        locks: coveringLocks,
        base,
        pathKey,
      });
    });

    const xml = `${XML_DECL}<D:multistatus xmlns:D="DAV:">${responses.join('')}</D:multistatus>`;
    res.status(207);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('DAV', '1, 2');
    res.send(xml);
  }

  async function handleProppatch(req, res) {
    const { resolved } = resolveTarget(req);
    const node = resolved.isRoot ? null : resolved.node;
    const body = await readBody(req);
    if (!node) throw new ApiError(403, 'forbidden', 'The root collection cannot be modified');
    assertUnlocked(req, requestSegments(req).join('/'));

    const requested = parseRequestedProperties(body);
    const displayName = xmlFirstText(body, 'displayname');
    if (displayName && displayName !== node.name) {
      try {
        renameNode(store, req.user.id, node, displayName);
      } catch (error) {
        if (error instanceof ApiError) {
          const failed = requested.names.length > 0 ? requested.names : ['displayname'];
          const xml =
            `${XML_DECL}<D:multistatus xmlns:D="DAV:"><D:response><D:href>${escapeXml(
              hrefFor(baseFor(req), requestSegments(req), true),
            )}</D:href><D:propstat><D:prop>${failed
              .map((name) => `<D:${escapeXml(name)}/>`)
              .join('')}</D:prop><D:status>HTTP/1.1 ${error.status} ${escapeXml(error.code)}</D:status></D:propstat></D:response></D:multistatus>`;
          res.status(207).setHeader('Content-Type', 'application/xml; charset=utf-8').send(xml);
          return;
        }
        throw error;
      }
    }

    const names = requested.names.length > 0 ? requested.names : ['displayname'];
    const xml =
      `${XML_DECL}<D:multistatus xmlns:D="DAV:"><D:response><D:href>${escapeXml(
        hrefFor(baseFor(req), requestSegments(req), node.type === 'folder'),
      )}</D:href><D:propstat><D:prop>${names
        .map((name) => `<D:${escapeXml(name)}/>`)
        .join('')}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
    res.status(207).setHeader('Content-Type', 'application/xml; charset=utf-8').send(xml);
  }

  async function handleGetHead(req, res) {
    const { resolved } = resolveTarget(req);
    const node = resolved.isRoot ? null : resolved.node;
    if (!node || node.type === 'folder') {
      if (req.method === 'HEAD') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).end();
        return;
      }
      throw new ApiError(405, 'method_not_allowed', 'Collections cannot be retrieved with GET');
    }
    await streamBlob(req, res, config, node);
  }

  async function handlePut(req, res) {
    const { segments, resolved } = resolveTarget(req, { allowMissing: true });
    if (resolved.missingParent) {
      throw new ApiError(409, 'conflict', 'Parent collection does not exist');
    }
    if (resolved.isRoot) {
      throw new ApiError(405, 'method_not_allowed', 'The root collection cannot be replaced');
    }
    const pathKey = segments.join('/');
    assertUnlocked(req, pathKey);
    if (resolved.node && resolved.node.type === 'folder') {
      throw new ApiError(405, 'method_not_allowed', 'A collection cannot be replaced with PUT');
    }
    if (!resolved.node) normalizeNodeName(resolved.missingName);

    const declaredLength = Number.parseInt(String(req.headers['content-length'] ?? ''), 10);
    if (Number.isFinite(declaredLength)) {
      assertUploadFits(store, config, req.user, declaredLength);
    }

    const nodeId = resolved.node?.id ?? randomUUID();
    const tempPath = path.join(config.tmpDir, `${randomUUID()}.put`);
    let size = 0;
    let overflowed = false;
    try {
      await new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(tempPath);
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          if (error) {
            req.unpipe(writeStream);
            writeStream.destroy();
            reject(error);
          } else {
            resolve();
          }
        };
        req.on('data', (chunk) => {
          size += chunk.length;
          if (!overflowed && size > config.maxUploadBytes) {
            overflowed = true;
            // Stop writing, drain the remaining request body so the client can
            // still receive the 413, and let the route cleanup remove the temp
            // file (no partial blob is ever committed).
            req.unpipe(writeStream);
            writeStream.destroy();
            req.resume();
            finish(new ApiError(413, 'upload_too_large', 'The upload exceeds the maximum request size'));
          }
        });
        req.on('aborted', () => finish(new ApiError(400, 'request_aborted', 'Upload aborted')));
        req.on('error', (error) => finish(error));
        writeStream.on('error', (error) => {
          if (!overflowed) finish(error);
        });
        writeStream.on('finish', () => {
          if (!overflowed) finish();
        });
        req.pipe(writeStream);
      });

      const used = store.usedBytes(req.user.id);
      const previousSize = resolved.node ? resolved.node.size : 0;
      if (req.user.quota > 0 && used - previousSize + size > req.user.quota) {
        throw new ApiError(507, 'quota_exceeded', 'Not enough storage quota available');
      }

      const target = blobPath(config, req.user.id, nodeId);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.rename(tempPath, target);
      if (resolved.node) {
        const updated = store.updateNode(nodeId, {
          size,
          mime: mimeForName(resolved.node.name),
          updatedAt: nowIso(),
        });
        res.setHeader('ETag', etagForNode(updated));
        res.status(204).end();
      } else {
        const node = store.createNode({
          id: nodeId,
          ownerId: req.user.id,
          parentId: resolved.parent ? resolved.parent.id : null,
          name: resolved.missingName,
          type: 'file',
          size,
          mime: mimeForName(resolved.missingName),
          storageKey: nodeId,
        });
        res.setHeader('ETag', etagForNode(node));
        res.status(201).end();
      }
    } catch (error) {
      await fsp.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  async function handleDelete(req, res) {
    const { segments, resolved } = resolveTarget(req);
    if (resolved.isRoot) throw new ApiError(403, 'forbidden', 'The root collection cannot be deleted');
    const pathKey = segments.join('/');
    assertUnlocked(req, pathKey);
    softDeleteNode(store, req.user.id, resolved.node);
    locks.removeForPath(req.user.id, pathKey);
    res.status(204).end();
  }

  async function handleMkcol(req, res) {
    const { segments, resolved } = resolveTarget(req, { allowMissing: true });
    if (resolved.missingParent) throw new ApiError(409, 'conflict', 'Parent collection does not exist');
    if (resolved.isRoot) throw new ApiError(405, 'method_not_allowed', 'The root collection already exists');
    if (resolved.node) throw new ApiError(405, 'method_not_allowed', 'The resource already exists');
    const name = normalizeNodeName(resolved.missingName);
    assertUnlocked(req, segments.slice(0, -1).join('/'));
    if (store.findLiveChild(req.user.id, resolved.parent ? resolved.parent.id : null, name)) {
      throw new ApiError(405, 'method_not_allowed', 'The resource already exists');
    }
    try {
      store.createNode({
        ownerId: req.user.id,
        parentId: resolved.parent ? resolved.parent.id : null,
        name,
        type: 'folder',
      });
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint')) {
        throw new ApiError(405, 'method_not_allowed', 'The resource already exists');
      }
      throw error;
    }
    res.status(201).end();
  }

  async function handleCopyMove(req, res) {
    const { segments, resolved } = resolveTarget(req, { allowMissing: false });
    if (resolved.isRoot) throw new ApiError(403, 'forbidden', 'The root collection cannot be copied or moved');
    const source = resolved.node;
    const destSegments = destinationSegments(req);
    if (destSegments.length === 0) {
      throw new ApiError(403, 'forbidden', 'The root collection cannot be replaced');
    }
    const destNameRaw = destSegments[destSegments.length - 1];
    const destName = normalizeNodeName(destNameRaw);
    const destParentSegments = destSegments.slice(0, -1);
    const destParentResolved = resolveDavPath(store, req.user.id, destParentSegments);
    if (destParentResolved.missingName || destParentResolved.missingParent) {
      throw new ApiError(409, 'conflict', 'Destination parent collection does not exist');
    }
    const destParent = destParentResolved.isRoot ? null : destParentResolved.node;
    if (destParent && destParent.type !== 'folder') {
      throw new ApiError(409, 'conflict', 'Destination parent is not a collection');
    }

    const destExisting = store.findLiveChild(req.user.id, destParent ? destParent.id : null, destName);
    const overwrite = String(req.headers.overwrite ?? 'T').toUpperCase() !== 'F';
    if (destExisting && !overwrite) {
      throw new ApiError(412, 'precondition_failed', 'The destination exists and Overwrite is F');
    }

    const moving = req.method.toUpperCase() === 'MOVE';
    assertUnlocked(req, segments.join('/'));
    assertUnlocked(req, destSegments.join('/'));

    if (destExisting && destExisting.id === source.id && destParentSegments.join('/') === segments.slice(0, -1).join('/')) {
      if (moving) {
        res.status(204).end();
        return;
      }
      throw new ApiError(403, 'forbidden', 'A resource cannot be copied onto itself');
    }

    // Source must not be moved inside itself.
    if (destParent && (destParent.id === source.id || store.isDescendant(source.id, destParent.id))) {
      throw new ApiError(403, 'forbidden', 'A collection cannot be copied or moved into itself');
    }
    // Replacing an ancestor of the source would trash the source.
    if (destExisting && store.isDescendant(destExisting.id, source.id)) {
      throw new ApiError(403, 'forbidden', 'A collection cannot replace its own ancestor');
    }

    if (destExisting) {
      softDeleteNode(store, req.user.id, destExisting);
      locks.removeForPath(req.user.id, destSegments.join('/'));
    }

    if (moving) {
      store.updateNode(source.id, {
        parentId: destParent ? destParent.id : null,
        name: destName,
        updatedAt: nowIso(),
      });
      locks.renamePath(req.user.id, segments.join('/'), destSegments.join('/'));
      res.status(destExisting ? 204 : 201).end();
      return;
    }

    const depth = String(req.headers.depth ?? 'infinity').toLowerCase() === '0' ? '0' : 'infinity';
    await copyNodeTo(store, config, req.user, source, destParent ? destParent.id : null, destName, { depth });
    res.status(destExisting ? 204 : 201).end();
  }

  async function handleLock(req, res) {
    const { segments, resolved } = resolveTarget(req);
    const pathKey = segments.join('/');
    const body = await readBody(req);
    const timeoutMs = parseTimeout(req.headers.timeout, config);
    const existing = locks.forPath(req.user.id, pathKey);
    const base = baseFor(req);

    const info = parseLockInfo(body);
    if (!info) {
      // Lock refresh: requires the current lock token via the If header.
      const provided = lockTokensFrom(req);
      const lock = existing.find((candidate) => provided.has(candidate.token));
      if (!lock) throw new ApiError(400, 'lock_token_required', 'A lock token is required to refresh a lock');
      locks.refresh(lock, timeoutMs);
      const xml = `${XML_DECL}<D:prop xmlns:D="DAV:">${lockdiscoveryXml([lock], base)}</D:prop>`;
      res.status(200);
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Lock-Token', `<${lock.token}>`);
      res.send(xml);
      return;
    }

    const conflicting = existing.filter(
      (lock) => lock.scope === 'exclusive' || info.scope === 'exclusive',
    );
    if (conflicting.length > 0) {
      throw new ApiError(423, 'locked', 'The resource is already locked', {
        lockToken: conflicting[0].token,
      });
    }

    const depthRaw = String(req.headers.depth ?? 'infinity').toLowerCase();
    const depth = depthRaw === '0' ? '0' : 'infinity';
    const lock = locks.create({
      userId: req.user.id,
      pathKey,
      depth,
      scope: info.scope,
      owner: info.owner,
      ttlMs: timeoutMs,
    });
    const xml = `${XML_DECL}<D:prop xmlns:D="DAV:">${lockdiscoveryXml([lock], base)}</D:prop>`;
    res.status(200);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Lock-Token', `<${lock.token}>`);
    res.send(xml);
  }

  async function handleUnlock(req, res) {
    const { segments } = resolveTarget(req);
    const header = String(req.headers['lock-token'] ?? '');
    const match = /<([^>]+)>/.exec(header);
    if (!match) throw badRequest('lock_token_required', 'Lock-Token header is required');
    const lock = locks.getByToken(match[1]);
    if (!lock || lock.userId !== req.user.id || lock.pathKey !== segments.join('/')) {
      throw new ApiError(409, 'conflict', 'No matching lock found');
    }
    locks.remove(lock.token);
    res.status(204).end();
  }

  router.use(auth);
  router.use(
    asyncHandler(async (req, res) => {
      switch (req.method.toUpperCase()) {
        case 'OPTIONS':
          return handleOptions(req, res);
        case 'PROPFIND':
          return handlePropfind(req, res);
        case 'PROPPATCH':
          return handleProppatch(req, res);
        case 'GET':
        case 'HEAD':
          return handleGetHead(req, res);
        case 'PUT':
          return handlePut(req, res);
        case 'DELETE':
          return handleDelete(req, res);
        case 'MKCOL':
          return handleMkcol(req, res);
        case 'COPY':
        case 'MOVE':
          return handleCopyMove(req, res);
        case 'LOCK':
          return handleLock(req, res);
        case 'UNLOCK':
          return handleUnlock(req, res);
        default:
          res.setHeader('Allow', DAV_METHODS);
          throw new ApiError(405, 'method_not_allowed', 'Unsupported WebDAV method');
      }
    }),
  );

  return router;
}
