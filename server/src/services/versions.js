import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { blobPath } from './files.js';
import { notFound } from '../errors.js';
import { nowIso } from '../util.js';

function versionBlobPath(config, ownerId, version) {
  return blobPath(config, ownerId, version.storage_key);
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

/** Copy the current blob into history before an overwrite. */
export async function snapshotVersion(store, config, user, node) {
  if (!node || node.type !== 'file') return null;
  const source = blobPath(config, user.id, node.storage_key ?? node.id);
  let stat;
  try {
    stat = await fsp.stat(source);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const versionId = randomUUID();
  const key = `versions/${node.id}/${versionId}`;
  const target = blobPath(config, user.id, key);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.copyFile(source, target);

  const version = store.createVersion({
    id: versionId,
    ownerId: user.id,
    nodeId: node.id,
    version: store.nextVersion(node.id, user.id),
    size: stat.size,
    mime: node.mime ?? null,
    storageKey: key,
    sha256: node.sha256 ?? (await sha256File(source)),
    createdAt: nowIso(),
  });

  const before = config.versionRetentionDays > 0
    ? new Date(Date.now() - config.versionRetentionDays * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const stale = store.pruneVersions(node.id, user.id, {
    maxVersions: config.maxVersionsPerFile,
    before,
  });
  await Promise.all(stale.map((row) => fsp.unlink(versionBlobPath(config, user.id, row)).catch(() => {})));
  return version;
}

export function serializeVersion(version) {
  if (!version) return null;
  return {
    id: version.id,
    version: version.version,
    size: version.size,
    mime: version.mime ?? null,
    sha256: version.sha256 ?? null,
    createdAt: version.created_at,
  };
}

export function listVersions(store, user, node) {
  if (node.type !== 'file') return [];
  return store.listVersions(node.id, user.id).map(serializeVersion);
}

export function getVersion(store, user, node, versionId) {
  if (node.type !== 'file') throw notFound('version_not_found', 'Version not found');
  const version = store.getVersion(versionId, node.id, user.id);
  if (!version) throw notFound('version_not_found', 'Version not found');
  return version;
}

export function versionContentPath(config, version, ownerId) {
  return versionBlobPath(config, ownerId, version);
}

/** Replace the current blob with a historical version, keeping the current one. */
export async function restoreVersion(store, config, user, node, version) {
  if (node.type !== 'file') throw notFound('version_not_found', 'Version not found');
  const source = versionBlobPath(config, user.id, version);
  let stat;
  try {
    stat = await fsp.stat(source);
  } catch {
    throw notFound('version_content_missing', 'Version content is missing');
  }
  await snapshotVersion(store, config, user, node);

  const target = blobPath(config, user.id, node.storage_key ?? node.id);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.restore-${randomUUID()}.part`;
  await fsp.copyFile(source, temporary);
  await fsp.rename(temporary, target);

  const updated = store.updateNode(node.id, {
    size: stat.size,
    mime: version.mime ?? node.mime,
    sha256: version.sha256 ?? (await sha256File(target)),
    updatedAt: nowIso(),
  });
  return updated;
}

/** Remove all version blobs belonging to a permanently deleted subtree. */
export async function deleteVersionBlobs(store, config, ownerId, rootId) {
  const rows = store.listSubtree(rootId);
  const dirs = new Set(rows.map((row) => path.join(config.storageDir, ownerId, 'versions', row.id)));
  for (const dir of dirs) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  for (const row of rows) {
    store.deleteVersionsForNode(row.id, ownerId);
  }
}

export { sha256File };
