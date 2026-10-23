import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { ApiClient, startTestServer, uploadFiles } from './helpers.js';

let server;
let api;

before(async () => {
  server = await startTestServer();
  api = new ApiClient(server.base);
  await api.setup();
});

after(async () => {
  await server.close();
});

async function bootstrap() {
  const res = await api.get('/api/sync/changes?cursor=0');
  assert.equal(res.status, 200);
  assert.equal(res.json.reset, true);
  return res.json;
}

async function changes(cursor) {
  const res = await api.get(`/api/sync/changes?cursor=${cursor}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.reset, false);
  return res.json;
}

test('sync: requires authentication', async () => {
  const anon = new ApiClient(server.base);
  const res = await anon.get('/api/sync/changes?cursor=0');
  assert.equal(res.status, 401);
});

test('sync: bootstrap snapshot then incremental upsert', async () => {
  const empty = await bootstrap();
  assert.equal(empty.cursor, 0);
  assert.deepEqual(empty.changes, []);

  let res = await api.post('/api/nodes/folder', { name: 'Photos' });
  assert.equal(res.status, 201);
  const photos = res.json.node;

  const files = await uploadFiles(api, photos.id, [{ name: 'a.txt', content: 'hello' }]);
  const file = files[0];

  const snapshot = await bootstrap();
  assert.ok(snapshot.cursor > 0);
  const ids = new Set(snapshot.changes.map((item) => item.id));
  assert.ok(ids.has(photos.id));
  assert.ok(ids.has(file.id));
  assert.ok(snapshot.changes.find((item) => item.id === file.id).etag);
  assert.equal(snapshot.changes.find((item) => item.id === file.id).parentId, photos.id);

  const after = snapshot.cursor;
  res = await api.post('/api/nodes/folder', { parentId: photos.id, name: '2026' });
  assert.equal(res.status, 201);
  const year = res.json.node;

  const delta = await changes(after);
  assert.ok(delta.cursor > after);
  const yearChange = delta.changes.find((item) => item.id === year.id);
  assert.ok(yearChange);
  assert.equal(yearChange.deleted, false);
  assert.equal(yearChange.parentId, photos.id);
});

test('sync: rename/move coalesce to the latest item state', async () => {
  const before = await bootstrap();
  const folderRes = await api.post('/api/nodes/folder', { name: 'Rename me' });
  const folder = folderRes.json.node;

  // Rename and then move the same node; a client syncing from `before.cursor`
  // should only need the final state, not every intermediate transition.
  await api.patch(`/api/nodes/${folder.id}`, { name: 'Renamed' });
  await api.patch(`/api/nodes/${folder.id}`, { parentId: null, name: 'Moved' });

  const delta = await changes(before.cursor);
  const entry = delta.changes.find((item) => item.id === folder.id);
  assert.ok(entry);
  assert.equal(entry.deleted, false);
  assert.equal(entry.name, 'Moved');
  assert.equal(entry.parentId, null);
});

test('sync: folder trash, restore and permanent delete emit tombstones', async () => {
  const rootRes = await api.post('/api/nodes/folder', { name: 'Tree' });
  const root = rootRes.json.node;
  const childRes = await api.post('/api/nodes/folder', { parentId: root.id, name: 'Child' });
  const child = childRes.json.node;
  const file = (await uploadFiles(api, child.id, [{ name: 'nested.txt', content: 'nested' }]))[0];

  let cursor = (await bootstrap()).cursor;
  let res = await api.delete(`/api/nodes/${root.id}`);
  assert.equal(res.status, 200);
  let delta = await changes(cursor);
  let ids = new Set(delta.changes.map((item) => item.id));
  assert.ok(ids.has(root.id));
  assert.ok(ids.has(child.id));
  assert.ok(ids.has(file.id));
  assert.ok(delta.changes.every((item) => item.deleted === true));

  cursor = delta.cursor;
  res = await api.post(`/api/trash/${root.id}/restore`);
  assert.equal(res.status, 200);
  delta = await changes(cursor);
  ids = new Set(delta.changes.map((item) => item.id));
  assert.ok(ids.has(root.id));
  assert.ok(ids.has(child.id));
  assert.ok(ids.has(file.id));
  assert.ok(delta.changes.every((item) => item.deleted === false));

  // Soft-delete again, then permanently remove it. The second tombstone must
  // still be replayable after the rows are gone.
  cursor = delta.cursor;
  await api.delete(`/api/nodes/${root.id}`);
  delta = await changes(cursor);
  cursor = delta.cursor;
  res = await api.delete(`/api/trash/${root.id}`);
  assert.equal(res.status, 200);
  delta = await changes(cursor);
  ids = new Set(delta.changes.map((item) => item.id));
  assert.ok(ids.has(root.id));
  assert.ok(ids.has(child.id));
  assert.ok(ids.has(file.id));
  assert.ok(delta.changes.every((item) => item.deleted === true));
});

test('sync: deleted items do not appear in a fresh bootstrap', async () => {
  const res = await api.post('/api/nodes/folder', { name: 'Temporary' });
  const folder = res.json.node;
  await api.delete(`/api/nodes/${folder.id}`);

  const snapshot = await bootstrap();
  assert.ok(!snapshot.changes.some((item) => item.id === folder.id));
});

test('sync: cursor rejects invalid values', async () => {
  const res = await api.get('/api/sync/changes?cursor=-1');
  assert.equal(res.status, 400);
});
