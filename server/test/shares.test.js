import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { ApiClient, startTestServer, uploadFiles } from './helpers.js';

let server;
let api;
let fileNode;
let folderNode;
let sharedFile;

before(async () => {
  server = await startTestServer();
  api = new ApiClient(server.base);
  await api.setup();

  const folderRes = await api.post('/api/nodes/folder', { name: 'Shared Folder' });
  folderNode = folderRes.json.node;
  const items = await uploadFiles(api, folderNode.id, [
    { name: 'inside.txt', content: 'inside the folder' },
  ]);
  assert.equal(items.length, 1);

  const [rootFile] = await uploadFiles(api, null, [{ name: 'share-me.txt', content: 'shared content' }]);
  fileNode = rootFile;
});

after(async () => {
  await server.close();
});

test('shares: create public file share and download it', async () => {
  let res = await api.post('/api/shares', { nodeId: fileNode.id });
  assert.equal(res.status, 201);
  sharedFile = res.json.share;
  assert.ok(sharedFile.token);
  assert.equal(sharedFile.url, `/s/${sharedFile.token}`);
  assert.equal(sharedFile.node.id, fileNode.id);
  assert.equal(sharedFile.node.name, 'share-me.txt');
  assert.equal(sharedFile.hasPassword, false);
  assert.equal(sharedFile.expiresAt, null);
  assert.equal(sharedFile.downloadCount, 0);

  res = await api.get('/api/shares');
  assert.equal(res.status, 200);
  assert.equal(res.json.items.length, 1);

  const publicApi = new ApiClient(server.base);
  res = await publicApi.get(`/api/public/shares/${sharedFile.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.share.hasPassword, false);
  assert.equal(res.json.share.expired, false);
  assert.equal(res.json.share.ownerName, 'Administrator');
  assert.equal(res.json.share.node.name, 'share-me.txt');
  assert.equal(res.json.share.node.id, undefined, 'public share omits node ids');

  res = await publicApi.get(`/api/public/shares/${sharedFile.token}/content`);
  assert.equal(res.status, 200);
  assert.equal(res.text, 'shared content');

  res = await publicApi.get(`/api/public/shares/${sharedFile.token}/content?download=1`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment/);

  res = await api.get('/api/shares');
  assert.equal(res.json.items[0].downloadCount, 1);

  // Range requests work on public content too.
  res = await publicApi.request('GET', `/api/public/shares/${sharedFile.token}/content`, {
    headers: { range: 'bytes=0-5' },
  });
  assert.equal(res.status, 206);
  assert.equal(res.text, 'shared');
});

test('shares: password protection and unlock access tokens', async () => {
  let res = await api.post('/api/shares', { nodeId: fileNode.id, password: 'open-sesame' });
  assert.equal(res.status, 201);
  const share = res.json.share;
  assert.equal(share.hasPassword, true);

  const publicApi = new ApiClient(server.base);
  res = await publicApi.get(`/api/public/shares/${share.token}/content`);
  assert.equal(res.status, 401);
  assert.equal(res.json.error.code, 'password_required');

  res = await publicApi.post(`/api/public/shares/${share.token}/unlock`, { password: 'wrong' });
  assert.equal(res.status, 401);
  assert.equal(res.json.error.code, 'invalid_password');

  res = await publicApi.post(`/api/public/shares/${share.token}/unlock`, { password: 'open-sesame' });
  assert.equal(res.status, 200);
  assert.ok(res.json.accessToken);
  assert.ok(res.json.expiresAt);

  const accessToken = res.json.accessToken;
  res = await publicApi.get(`/api/public/shares/${share.token}/content?accessToken=${accessToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.text, 'shared content');

  res = await publicApi.get(`/api/public/shares/${share.token}/content?accessToken=not-a-real-token`);
  assert.equal(res.status, 401);
});

test('shares: public inline HTML content is sandboxed', async () => {
  const [evil] = await uploadFiles(api, null, [
    { name: 'public-evil.html', content: '<script>alert(document.cookie)</script>' },
  ]);
  let res = await api.post('/api/shares', { nodeId: evil.id });
  assert.equal(res.status, 201);
  const share = res.json.share;

  const publicApi = new ApiClient(server.base);
  res = await publicApi.get(`/api/public/shares/${share.token}/content`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp.includes('sandbox'), 'public inline active content gets a sandbox CSP');
  assert.match(csp, /script-src 'none'/);
});

test('shares: folder shares download as a zip', async () => {
  let res = await api.post('/api/shares', { nodeId: folderNode.id });
  assert.equal(res.status, 201);
  const share = res.json.share;
  assert.equal(share.node.type, 'folder');
  assert.ok(share.node.size > 0);

  const publicApi = new ApiClient(server.base);
  res = await publicApi.request('GET', `/api/public/shares/${share.token}/content`, { raw: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/zip/);
  const buffer = Buffer.from(await res.arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString('ascii'), 'PK');
});

test('shares: expiry, deletion and unknown tokens', async () => {
  let res = await api.post('/api/shares', { nodeId: fileNode.id, expiresInHours: 1 });
  assert.equal(res.status, 201);
  const share = res.json.share;
  assert.ok(share.expiresAt);

  // Force-expire the share directly in SQLite (the public API only accepts
  // positive hours, so an in-database tweak is the deterministic test).
  const store = server.app.locals.store;
  store.db.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', share.id);

  const publicApi = new ApiClient(server.base);
  res = await publicApi.get(`/api/public/shares/${share.token}`);
  assert.equal(res.status, 404);
  assert.equal(res.json.error.code, 'share_not_found');

  res = await api.delete(`/api/shares/${share.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });

  res = await api.delete(`/api/shares/${share.id}`);
  assert.equal(res.status, 404);
  assert.equal(res.json.error.code, 'share_not_found');

  res = await publicApi.get('/api/public/shares/definitely-not-a-token');
  assert.equal(res.status, 404);

  // Invalid expiry values are rejected.
  res = await api.post('/api/shares', { nodeId: fileNode.id, expiresInHours: -3 });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'invalid_expiry');

  res = await api.post('/api/shares', { nodeId: 'not-a-node' });
  assert.equal(res.status, 404);
  assert.equal(res.json.error.code, 'node_not_found');
});

test('shares: share urls become absolute when PUBLIC_BASE_URL is configured', async (t) => {
  const publicServer = await startTestServer({ publicBaseUrl: 'https://disk.example.com' });
  t.after(() => publicServer.close());
  const publicApi = new ApiClient(publicServer.base);
  await publicApi.setup();
  const [node] = await uploadFiles(publicApi, null, [{ name: 'public.txt', content: 'hi' }]);
  const res = await publicApi.post('/api/shares', { nodeId: node.id });
  assert.equal(res.status, 201);
  assert.match(res.json.share.url, /^https:\/\/disk\.example\.com\/s\//);
});
