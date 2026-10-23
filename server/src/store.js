import { randomBytes, randomUUID } from 'node:crypto';
import { etagForNode, nowIso } from './util.js';

/**
 * Virtual root of a user's tree. `parent_id IS NULL` in the database; the
 * WebDAV layer and API use this sentinel object so handlers never special-case
 * "no folder" everywhere.
 */
export const ROOT_ID = 'root';

/**
 * Selected node columns plus derived metadata used by the HTTP layer:
 * `effective_size` (folder = sum of direct child file sizes) and
 * `child_count` (live children, folders only).
 */
const NODE_SELECT = `
  SELECT n.*,
         CASE WHEN n.type = 'folder'
              THEN (SELECT COALESCE(SUM(c.size), 0) FROM nodes c
                     WHERE c.parent_id = n.id AND c.type = 'file' AND c.trashed_at IS NULL
                       AND c.name NOT LIKE '._%' AND c.name <> '.DS_Store')
              ELSE n.size END AS effective_size,
         CASE WHEN n.type = 'folder'
              THEN (SELECT COUNT(*) FROM nodes c WHERE c.parent_id = n.id AND c.trashed_at IS NULL
                      AND c.name NOT LIKE '._%' AND c.name <> '.DS_Store')
              ELSE 0 END AS child_count
    FROM nodes n`;

const SORT_COLUMNS = {
  name: (dir) => `n.name COLLATE NOCASE ${dir}`,
  modified: (dir) => `n.updated_at ${dir}`,
  size: (dir) => `n.effective_size ${dir}`,
  trashed: (dir) => `n.trashed_at ${dir}`,
};

function sortClause(sort, order) {
  const column = SORT_COLUMNS[sort] ?? SORT_COLUMNS.name;
  return column(order === 'desc' ? 'DESC' : 'ASC');
}

/** Names that Finder writes as metadata and should never become File Provider items. */
function isSyncHiddenName(name) {
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

/**
 * Thin, synchronous data-access layer over node:sqlite. Keeping SQL in one
 * place makes the route handlers read like business logic instead of queries.
 */
export class Store {
  constructor(db, config) {
    this.db = db;
    this.config = config;
  }

  close() {
    this.db.close();
  }

  /** Run a synchronous function inside an IMMEDIATE transaction. */
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback failures
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- meta ---

  getMeta(key) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  setMeta(key, value) {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  /** Persistent HMAC secret used to sign share access tokens. */
  accessSecret() {
    let secret = this.getMeta('access_secret');
    if (!secret) {
      secret = randomBytes(32).toString('base64url');
      this.setMeta('access_secret', secret);
    }
    return secret;
  }

  // --------------------------------------------------------------- users ---

  countUsers() {
    return this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  }

  countAdmins() {
    return this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
  }

  createUser({ id = randomUUID(), username, passwordHash, displayName = null, role = 'member', quota = 0, createdAt = nowIso() }) {
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, display_name, role, quota, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, username, passwordHash, displayName, role, quota, createdAt);
    return this.getUserById(id);
  }

  getUserById(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
  }

  getUserByUsername(username) {
    return this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) ?? null;
  }

  listUsers() {
    return this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
  }

  updateUser(id, patch) {
    const columns = {
      username: 'username',
      passwordHash: 'password_hash',
      displayName: 'display_name',
      role: 'role',
      quota: 'quota',
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(columns)) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(patch[key]);
      }
    }
    if (sets.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
    return this.getUserById(id);
  }

  deleteUser(id) {
    const user = this.getUserById(id);
    if (!user) return null;
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return user;
  }

  // ------------------------------------------------------------ sessions ---

  createSession(tokenHash, userId, expiresAt, createdAt = nowIso()) {
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, userId, expiresAt, createdAt);
  }

  getSessionUser(tokenHash) {
    return (
      this.db
        .prepare(
          `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ?`,
        )
        .get(tokenHash, nowIso()) ?? null
    );
  }

  deleteSession(tokenHash) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  deleteSessionsForUser(userId, exceptTokenHash = null) {
    if (exceptTokenHash) {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, exceptTokenHash);
    } else {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    }
  }

  purgeExpiredSessions() {
    return this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes;
  }

  // --------------------------------------------------------------- nodes ---

  createNode({
    id = randomUUID(),
    ownerId,
    parentId = null,
    name,
    type,
    size = 0,
    mime = null,
    storageKey = null,
    starred = 0,
    createdAt = nowIso(),
    updatedAt = createdAt,
  }) {
    this.db
      .prepare(
        `INSERT INTO nodes (id, owner_id, parent_id, name, type, size, mime, storage_key, starred, created_at, updated_at, trashed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, ownerId, parentId, name, type, size, mime, storageKey, starred ? 1 : 0, createdAt, updatedAt);
    const node = this.getNode(id);
    if (node) this.recordSyncUpsert(node);
    return node;
  }

  getNode(id) {
    return this.db.prepare(`${NODE_SELECT} WHERE n.id = ?`).get(id) ?? null;
  }

  getNodeForOwner(id, ownerId) {
    return this.db.prepare(`${NODE_SELECT} WHERE n.id = ? AND n.owner_id = ?`).get(id, ownerId) ?? null;
  }

  findLiveChild(ownerId, parentId, name) {
    return (
      this.db
        .prepare('SELECT * FROM nodes WHERE owner_id = ? AND parent_id IS ? AND name = ? AND trashed_at IS NULL LIMIT 1')
        .get(ownerId, parentId, name) ?? null
    );
  }

  listChildren(ownerId, parentId, { sort = 'name', order = 'asc' } = {}) {
    return this.db
      .prepare(
        `${NODE_SELECT} WHERE n.owner_id = ? AND n.parent_id IS ? AND n.trashed_at IS NULL
         ORDER BY ${sortClause(sort, order)}, n.name COLLATE NOCASE ASC`,
      )
      .all(ownerId, parentId);
  }

  updateNode(id, patch) {
    const columns = {
      name: 'name',
      parentId: 'parent_id',
      starred: 'starred',
      size: 'size',
      mime: 'mime',
      storageKey: 'storage_key',
      updatedAt: 'updated_at',
      trashedAt: 'trashed_at',
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(columns)) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(key === 'starred' ? (patch[key] ? 1 : 0) : patch[key]);
      }
    }
    if (sets.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
    const node = this.getNode(id);
    // Trash/restore transitions are recorded by markSubtreeTrashed /
    // untrashSubtree, because they can affect a whole subtree at once.
    if (node && !node.trashed_at) this.recordSyncUpsert(node);
    return node;
  }

  /** Ancestors of a node ordered from the root down to the direct parent. */
  ancestors(node) {
    const chain = [];
    const seen = new Set([node.id]);
    let parentId = node.parent_id;
    while (parentId && seen.size < 512) {
      if (seen.has(parentId)) break;
      const parent = this.getNode(parentId);
      if (!parent) break;
      seen.add(parent.id);
      chain.unshift(parent);
      parentId = parent.parent_id;
    }
    return chain;
  }

  isDescendant(ancestorId, nodeId) {
    let current = this.getNode(nodeId);
    const seen = new Set();
    while (current && current.parent_id && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.parent_id === ancestorId) return true;
      current = this.getNode(current.parent_id);
    }
    return false;
  }

  /** Every node in the subtree rooted at `id`, parents before children. */
  listSubtree(id) {
    return this.db
      .prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM nodes WHERE id = ?
           UNION ALL
           SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
         )
         SELECT n.* FROM nodes n JOIN sub s ON n.id = s.id
         ORDER BY n.created_at ASC`,
      )
      .all(id);
  }

  subtreeSize(id) {
    const row = this.db
      .prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM nodes WHERE id = ?
           UNION ALL
           SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
         )
         SELECT COALESCE(SUM(n.size), 0) AS total FROM nodes n JOIN sub s ON n.id = s.id WHERE n.type = 'file'`,
      )
      .get(id);
    return row ? row.total : 0;
  }

  markSubtreeTrashed(id, timestamp = nowIso()) {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM nodes WHERE id = ?
           UNION ALL
           SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
         )
         SELECT n.id, n.owner_id FROM nodes n JOIN sub s ON n.id = s.id
          WHERE n.trashed_at IS NULL`,
      )
      .all(id);
    const changes = this.db
      .prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM nodes WHERE id = ?
           UNION ALL
           SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
         )
         UPDATE nodes SET trashed_at = ?, updated_at = ?
          WHERE id IN (SELECT id FROM sub) AND trashed_at IS NULL`,
      )
      .run(id, timestamp, timestamp).changes;
    for (const row of rows) this.recordSyncDelete(row.owner_id, row.id);
    return changes;
  }

  untrashSubtree(id, timestamp = nowIso()) {
    const changes = this.db
      .prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM nodes WHERE id = ?
           UNION ALL
           SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
         )
         UPDATE nodes SET trashed_at = NULL, updated_at = ?
          WHERE id IN (SELECT id FROM sub)`,
      )
      .run(id, timestamp).changes;
    for (const node of this.listSubtree(id)) {
      if (!node.trashed_at) this.recordSyncUpsert(node);
    }
    return changes;
  }

  listTrashRoots(ownerId, { sort = 'trashed', order = 'desc' } = {}) {
    return this.db
      .prepare(
        `${NODE_SELECT}
          WHERE n.owner_id = ? AND n.trashed_at IS NOT NULL
            AND (n.parent_id IS NULL OR n.parent_id NOT IN (SELECT p.id FROM nodes p WHERE p.trashed_at IS NOT NULL))
          ORDER BY ${sortClause(sort, order)}, n.name COLLATE NOCASE ASC`,
      )
      .all(ownerId);
  }

  listStarred(ownerId, limit = 100) {
    return this.db
      .prepare(
        `${NODE_SELECT} WHERE n.owner_id = ? AND n.starred = 1 AND n.trashed_at IS NULL
          ORDER BY n.updated_at DESC LIMIT ?`,
      )
      .all(ownerId, limit);
  }

  listRecent(ownerId, limit = 24) {
    return this.db
      .prepare(`${NODE_SELECT} WHERE n.owner_id = ? AND n.trashed_at IS NULL ORDER BY n.updated_at DESC LIMIT ?`)
      .all(ownerId, limit);
  }

  search(ownerId, query, limit = 50) {
    return this.db
      .prepare(
        `${NODE_SELECT} WHERE n.owner_id = ? AND n.trashed_at IS NULL AND n.name LIKE ? ESCAPE '\\'
          ORDER BY n.updated_at DESC LIMIT ?`,
      )
      .all(ownerId, `%${query}%`, limit);
  }

  storageStats(ownerId) {
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'file' AND trashed_at IS NULL THEN size ELSE 0 END), 0) AS used,
           COALESCE(SUM(CASE WHEN type = 'file' AND trashed_at IS NOT NULL THEN size ELSE 0 END), 0) AS trash_size,
           COALESCE(SUM(CASE WHEN type = 'file' AND trashed_at IS NULL THEN 1 ELSE 0 END), 0) AS file_count,
           COALESCE(SUM(CASE WHEN type = 'folder' AND trashed_at IS NULL THEN 1 ELSE 0 END), 0) AS folder_count,
           COALESCE(SUM(CASE WHEN trashed_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS trash_count
         FROM nodes WHERE owner_id = ?`,
      )
      .get(ownerId);
    return {
      used: row.used,
      trashSize: row.trash_size,
      fileCount: row.file_count,
      folderCount: row.folder_count,
      trashCount: row.trash_count,
    };
  }

  usedBytes(ownerId) {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(size), 0) AS used FROM nodes WHERE owner_id = ? AND type = 'file' AND trashed_at IS NULL")
      .get(ownerId);
    return row.used;
  }

  /** Rows for files in a subtree (used for ZIP download and blob cleanup). */
  listSubtreeFiles(id) {
    return this.db
      .prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM nodes WHERE id = ?
           UNION ALL
           SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
         )
         SELECT n.* FROM nodes n JOIN sub s ON n.id = s.id WHERE n.type = 'file'`,
      )
      .all(id);
  }

  deleteNodeRow(id) {
    // A parent delete cascades to children in SQLite, so tombstone the whole
    // subtree before the rows disappear.
    const rows = this.listSubtree(id);
    const changes = this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id).changes;
    for (const row of rows) this.recordSyncDelete(row.owner_id, row.id);
    return changes;
  }

  /** Live direct children of many folders in one query (tree expansion). */
  listChildrenOfParents(ownerId, parentIds, { sort = 'name', order = 'asc' } = {}) {
    if (parentIds.length === 0) return [];
    const placeholders = parentIds.map(() => '?').join(', ');
    return this.db
      .prepare(
        `${NODE_SELECT} WHERE n.owner_id = ? AND n.parent_id IN (${placeholders}) AND n.trashed_at IS NULL
          ORDER BY ${sortClause(sort, order)}`,
      )
      .all(ownerId, ...parentIds);
  }

  // ---------------------------------------------------------------- sync ---

  /** Append a change to the feed. Returns the monotonically increasing seq. */
  recordSyncChange(ownerId, nodeId, kind, payload) {
    const result = this.db
      .prepare(
        `INSERT INTO sync_changes (owner_id, node_id, kind, payload, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(ownerId, nodeId, kind, JSON.stringify(payload), nowIso());
    return Number(result.lastInsertRowid);
  }

  recordSyncUpsert(node) {
    if (!node || node.trashed_at) return;
    this.recordSyncChange(node.owner_id, node.id, 'upsert', this.syncPayload(node));
  }

  recordSyncDelete(ownerId, nodeId) {
    this.recordSyncChange(ownerId, nodeId, 'delete', { id: nodeId, deleted: true });
  }

  syncPayload(node) {
    return {
      id: node.id,
      parentId: node.parent_id ?? null,
      name: node.name,
      type: node.type,
      size: node.effective_size != null ? node.effective_size : node.size,
      mime: node.mime ?? null,
      starred: Boolean(node.starred),
      createdAt: node.created_at,
      updatedAt: node.updated_at,
      etag: etagForNode(node),
      deleted: false,
    };
  }

  /** Max sequence for a user. Used for the bootstrap cursor. */
  syncCursor(ownerId) {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_changes WHERE owner_id = ?')
      .get(ownerId);
    return Number(row?.seq ?? 0);
  }

  /**
   * Bootstrap snapshot: every live, user-visible node. File Provider starts
   * from this and then follows the change feed.
   */
  syncSnapshot(ownerId) {
    return this.db
      .prepare(`${NODE_SELECT} WHERE n.owner_id = ? AND n.trashed_at IS NULL ORDER BY n.created_at ASC`)
      .all(ownerId)
      .filter((node) => !isSyncHiddenName(node.name))
      .map((node) => this.syncPayload(node));
  }

  /**
   * Incremental changes after `afterSeq`, newest change per node. `hasMore`
   * lets the client page until it catches up.
   */
  syncChanges(ownerId, afterSeq, limit = 500) {
    const rows = this.db
      .prepare(
        `SELECT seq, node_id, kind, payload
           FROM sync_changes
          WHERE owner_id = ? AND seq > ?
          ORDER BY seq ASC
          LIMIT ?`,
      )
      .all(ownerId, afterSeq, limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const byNode = new Map();
    for (const row of page) {
      let payload;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        continue;
      }
      if (payload.deleted === false && isSyncHiddenName(payload.name)) continue;
      byNode.set(row.node_id, { seq: Number(row.seq), ...payload });
    }
    const changes = [...byNode.values()].sort((a, b) => a.seq - b.seq);
    return {
      changes,
      cursor: page.length > 0 ? Number(page[page.length - 1].seq) : afterSeq,
      hasMore,
    };
  }

  // -------------------------------------------------------------- shares ---

  createShare({
    id = randomUUID(),
    token,
    ownerId,
    nodeId,
    passwordHash = null,
    expiresAt = null,
    createdAt = nowIso(),
  }) {
    this.db
      .prepare(
        `INSERT INTO shares (id, token, owner_id, node_id, password_hash, expires_at, created_at, download_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(id, token, ownerId, nodeId, passwordHash, expiresAt, createdAt);
    return this.getShareById(id);
  }

  getShareById(id) {
    return this.db.prepare('SELECT * FROM shares WHERE id = ?').get(id) ?? null;
  }

  listShares(ownerId) {
    return this.db
      .prepare(
        `SELECT s.*, n.name AS node_name, n.type AS node_type, n.size AS node_size, n.mime AS node_mime,
                n.trashed_at AS node_trashed_at,
                (SELECT COALESCE(SUM(c.size), 0) FROM nodes c WHERE c.parent_id = n.id AND c.type = 'file' AND c.trashed_at IS NULL) AS node_effective_size
           FROM shares s JOIN nodes n ON n.id = s.node_id
          WHERE s.owner_id = ? ORDER BY s.created_at DESC`,
      )
      .all(ownerId);
  }

  getShareByToken(token) {
    return (
      this.db
        .prepare(
          `SELECT s.*, n.name AS node_name, n.type AS node_type, n.size AS node_size, n.mime AS node_mime,
                  n.trashed_at AS node_trashed_at,
                  (SELECT COALESCE(SUM(c.size), 0) FROM nodes c WHERE c.parent_id = n.id AND c.type = 'file' AND c.trashed_at IS NULL) AS node_effective_size,
                  u.username AS owner_username, u.display_name AS owner_display_name
             FROM shares s
             JOIN nodes n ON n.id = s.node_id
             JOIN users u ON u.id = s.owner_id
            WHERE s.token = ?`,
        )
        .get(token) ?? null
    );
  }

  getShareForOwner(id, ownerId) {
    return (
      this.db
        .prepare(
          `SELECT s.*, n.name AS node_name, n.type AS node_type, n.size AS node_size, n.mime AS node_mime,
                  n.trashed_at AS node_trashed_at,
                  (SELECT COALESCE(SUM(c.size), 0) FROM nodes c WHERE c.parent_id = n.id AND c.type = 'file' AND c.trashed_at IS NULL) AS node_effective_size
             FROM shares s JOIN nodes n ON n.id = s.node_id
            WHERE s.id = ? AND s.owner_id = ?`,
        )
        .get(id, ownerId) ?? null
    );
  }

  deleteShare(id, ownerId) {
    return this.db.prepare('DELETE FROM shares WHERE id = ? AND owner_id = ?').run(id, ownerId).changes;
  }

  incrementShareDownload(id) {
    this.db.prepare('UPDATE shares SET download_count = download_count + 1 WHERE id = ?').run(id);
  }

  // ------------------------------------------------------------ clipboard ---

  getClipboard(ownerId) {
    return this.db
      .prepare(
        `SELECT owner_id, content, version, device, updated_at
           FROM clipboard WHERE owner_id = ?`,
      )
      .get(ownerId) ?? null;
  }

  setClipboard(ownerId, content, device = null) {
    const updatedAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO clipboard (owner_id, content, version, device, updated_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET
           content = excluded.content,
           version = clipboard.version + 1,
           device = excluded.device,
           updated_at = excluded.updated_at`,
      )
      .run(ownerId, content, device, updatedAt);
    return this.getClipboard(ownerId);
  }
}
