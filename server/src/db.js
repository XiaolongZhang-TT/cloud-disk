import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Tern SQLite schema.
 *
 * Metadata lives here while file blobs live in `storage/<owner>/<node-id>`.
 * No user supplied string is ever used as a filesystem path, which removes the
 * entire class of path-traversal bugs.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  quota         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uidx ON users(lower(username));

CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('file', 'folder')),
  size        INTEGER NOT NULL DEFAULT 0,
  mime        TEXT,
  storage_key TEXT,
  starred     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  trashed_at  TEXT
);
CREATE INDEX IF NOT EXISTS nodes_owner_parent_idx ON nodes(owner_id, parent_id);
CREATE INDEX IF NOT EXISTS nodes_owner_trashed_idx ON nodes(owner_id, trashed_at);
CREATE INDEX IF NOT EXISTS nodes_owner_starred_idx ON nodes(owner_id, starred);
-- Live names are unique per owner + parent. Trashed nodes are excluded so the
-- unique constraint never blocks a restore or a delete.
CREATE UNIQUE INDEX IF NOT EXISTS nodes_live_name_uidx
  ON nodes(owner_id, COALESCE(parent_id, ''), name) WHERE trashed_at IS NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS shares (
  id             TEXT PRIMARY KEY,
  token          TEXT NOT NULL UNIQUE,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id        TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  password_hash  TEXT,
  expires_at     TEXT,
  created_at     TEXT NOT NULL,
  download_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS shares_owner_idx ON shares(owner_id);
CREATE INDEX IF NOT EXISTS shares_node_idx ON shares(node_id);
`;

/**
 * Open (and migrate) the SQLite database.
 *
 * WAL keeps readers unblocked while Finder is hammering the WebDAV endpoint
 * and the browser is browsing the SPA at the same time.
 */
export function openDatabase(config) {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  const db = new DatabaseSync(config.dbFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);
  db.exec(SCHEMA);
  return db;
}
