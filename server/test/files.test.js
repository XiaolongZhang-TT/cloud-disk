import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';

import { ApiClient, startTestServer, uploadFiles } from './helpers.js';

let server;
let api;
let documents;
let projects;

before(async () => {
  server = await startTestServer();
  api = new ApiClient(server.base);
  await api.setup();
});

after(async () => {
  await server.close();
});

test('files: create folders, list root and nested breadcrumbs', async () => {
  let res = await api.post('/api/nodes/folder', { name: 'Documents' });
  assert.equal(res.status, 201);
  documents = res.json.node;
  assert.equal(documents.type, 'folder');
  assert.equal(documents.parentId, null);
  assert.equal(documents.size, 0);
  assert.equal(documents.childCount, 0);

  res = await api.post('/api/nodes/folder', { parentId: documents.id, name: 'Projects' });
  assert.equal(res.status, 201);
  projects = res.json.node;
  assert.equal(projects.parentId, documents.id);

  // Duplicate folder names auto-rename rather than failing the operation.
  res = await api.post('/api/nodes/folder', { name: 'Documents' });
  assert.equal(res.status, 201);
  assert.equal(res.json.node.name, 'Documents (1)');
  // Remove the duplicate again so later assertions stay tidy.
  let del = await api.delete(`/api/nodes/${res.json.node.id}`);
  assert.equal(del.status, 200);

  res = await api.get('/api/nodes');
  assert.equal(res.status, 200);
  assert.equal(res.json.folder, null);
  assert.deepEqual(res.json.breadcrumb, []);
  const docs = res.json.items.find((item) => item.id === documents.id);
  assert.ok(docs);
  assert.equal(docs.childCount, 1);

  res = await api.get(`/api/nodes?parentId=${documents.id}`);
  assert.equal(res.json.folder.id, documents.id);
  assert.equal(res.json.folder.name, 'Documents');
  assert.deepEqual(res.json.breadcrumb, [{ id: 'root', name: '我的文件' }]);
  assert.ok(res.json.items.some((item) => item.id === projects.id));

  res = await api.get(`/api/nodes?parentId=${projects.id}`);
  assert.deepEqual(res.json.breadcrumb, [
    { id: 'root', name: '我的文件' },
    { id: documents.id, name: 'Documents' },
  ]);

  res = await api.get(`/api/nodes/${documents.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.node.name, 'Documents');
});

test('files: multipart upload, auto-rename and node metadata', async () => {
  const items = await uploadFiles(api, documents.id, [
    { name: 'hello.txt', content: 'hello world' },
    { name: '中文 文件.txt', content: '你好，世界' },
  ]);
  assert.equal(items.length, 2);
  const hello = items.find((item) => item.name === 'hello.txt');
  assert.ok(hello);
  assert.equal(hello.type, 'file');
  assert.equal(hello.size, 11);
  assert.equal(hello.mime, 'text/plain');
  assert.equal(hello.parentId, documents.id);
  assert.equal(hello.starred, false);

  const chinese = items.find((item) => item.name === '中文 文件.txt');
  assert.ok(chinese, 'UTF-8 multipart filenames are preserved');

  const duplicates = await uploadFiles(api, documents.id, [{ name: 'hello.txt', content: 'second copy' }]);
  assert.equal(duplicates[0].name, 'hello (1).txt');
  assert.equal(duplicates[0].size, 11);

  // Folder size is the sum of direct child files; childCount includes folders.
  const res = await api.get(`/api/nodes/${documents.id}`);
  assert.equal(res.json.node.childCount, 4);
  assert.equal(res.json.node.size, Buffer.byteLength('hello world') + Buffer.byteLength('你好，世界') + Buffer.byteLength('second copy'));
});

test('files: preview, attachment download, Range and search', async () => {
  const listing = await api.get(`/api/nodes?parentId=${documents.id}`);
  const hello = listing.json.items.find((item) => item.name === 'hello.txt');

  let res = await api.get(`/api/nodes/${hello.id}/content`);
  assert.equal(res.status, 200);
  assert.equal(res.text, 'hello world');
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.match(res.headers.get('content-disposition'), /^inline/);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.ok(res.headers.get('etag'));

  res = await api.request('GET', `/api/nodes/${hello.id}/content`, { headers: { range: 'bytes=0-4' } });
  assert.equal(res.status, 206);
  assert.equal(res.text, 'hello');
  assert.equal(res.headers.get('content-range'), 'bytes 0-4/11');

  res = await api.get(`/api/nodes/${hello.id}/download`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment/);

  res = await api.get('/api/search?q=hello');
  assert.equal(res.status, 200);
  assert.equal(res.json.query, 'hello');
  assert.ok(res.json.items.length >= 1);
  assert.ok(res.json.items.every((item) => item.name.includes('hello')));

  res = await api.get('/api/recent?limit=5');
  assert.equal(res.status, 200);
  assert.ok(res.json.items.length >= 1);

  res = await api.get('/api/search');
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'invalid_query');
});

test('files: inline HTML content is sandboxed (stored XSS defence)', async () => {
  const [evil] = await uploadFiles(api, documents.id, [
    { name: 'evil.html', content: '<script>alert(document.cookie)</script>' },
  ]);
  const res = await api.get(`/api/nodes/${evil.id}/content`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp.includes('sandbox'), 'inline active content gets a sandbox CSP');
  assert.match(csp, /script-src 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('files: rename, move, star and recursive copy', async () => {
  const listing = await api.get(`/api/nodes?parentId=${documents.id}`);
  const hello = listing.json.items.find((item) => item.name === 'hello.txt');

  let res = await api.patch(`/api/nodes/${hello.id}`, { name: 'hello (1).txt' });
  assert.equal(res.status, 409);
  assert.equal(res.json.error.code, 'name_conflict');

  res = await api.patch(`/api/nodes/${hello.id}`, { name: 'greeting.txt' });
  assert.equal(res.status, 200);
  assert.equal(res.json.node.name, 'greeting.txt');

  res = await api.patch(`/api/nodes/${hello.id}`, { parentId: projects.id });
  assert.equal(res.status, 200);
  assert.equal(res.json.node.parentId, projects.id);

  res = await api.patch(`/api/nodes/${hello.id}`, { starred: true });
  assert.equal(res.status, 200);
  assert.equal(res.json.node.starred, true);
  res = await api.get('/api/starred');
  assert.ok(res.json.items.some((item) => item.id === hello.id));

  // Move a folder into its own descendant must be rejected.
  res = await api.patch(`/api/nodes/${documents.id}`, { parentId: projects.id });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'invalid_move');

  // Copying a folder into its own descendant must be rejected.
  res = await api.post(`/api/nodes/${documents.id}/copy`, { parentId: projects.id });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'invalid_copy');

  res = await api.post(`/api/nodes/${documents.id}/copy`, {});
  assert.equal(res.status, 201);
  assert.equal(res.json.node.name, 'Documents (1)');
  assert.equal(res.json.node.type, 'folder');

  const copied = res.json.node;
  const copiedListing = await api.get(`/api/nodes?parentId=${copied.id}`);
  assert.equal(copiedListing.json.items.length, 4);
  const copiedProjects = copiedListing.json.items.find((item) => item.name === 'Projects');
  assert.ok(copiedProjects, 'nested folders are copied recursively');
  const copiedProjectsListing = await api.get(`/api/nodes?parentId=${copiedProjects.id}`);
  const copiedGreeting = copiedProjectsListing.json.items.find((item) => item.name === 'greeting.txt');
  assert.ok(copiedGreeting);
  const content = await api.get(`/api/nodes/${copiedGreeting.id}/content`);
  assert.equal(content.text, 'hello world');
});

test('files: trash, restore, permanent delete and empty trash', async () => {
  const listing = await api.get(`/api/nodes?parentId=${projects.id}`);
  const greeting = listing.json.items.find((item) => item.name === 'greeting.txt');
  assert.ok(greeting, 'greeting.txt was moved into Projects earlier');

  let res = await api.delete(`/api/nodes/${greeting.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });

  res = await api.get(`/api/nodes?parentId=${documents.id}`);
  assert.ok(!res.json.items.some((item) => item.id === greeting.id));

  res = await api.get('/api/trash');
  assert.ok(res.json.items.some((item) => item.id === greeting.id && item.trashedAt));

  res = await api.post(`/api/trash/${greeting.id}/restore`);
  assert.equal(res.status, 200);
  assert.equal(res.json.node.trashedAt, null);
  res = await api.get(`/api/nodes?parentId=${projects.id}`);
  assert.ok(res.json.items.some((item) => item.id === greeting.id));

  // Trashing a folder hides its children and lists only the trash root.
  res = await api.delete(`/api/nodes/${projects.id}`);
  assert.equal(res.status, 200);
  res = await api.get('/api/trash');
  assert.ok(res.json.items.some((item) => item.id === projects.id));
  assert.ok(!res.json.items.some((item) => item.id === greeting.id));

  res = await api.post(`/api/trash/${projects.id}/restore`);
  assert.equal(res.status, 200);
  res = await api.get(`/api/nodes?parentId=${projects.id}`);
  assert.ok(res.json.items.some((item) => item.id === greeting.id), 'children are restored with the folder');

  // Permanent delete removes a single trashed item.
  await api.delete(`/api/nodes/${greeting.id}`);
  res = await api.delete(`/api/trash/${greeting.id}`);
  assert.equal(res.status, 200);
  res = await api.get(`/api/nodes/${greeting.id}`);
  assert.equal(res.status, 404);

  // Empty trash.
  const chinese = (await api.get(`/api/nodes?parentId=${documents.id}`)).json.items.find(
    (item) => item.name === '中文 文件.txt',
  );
  await api.delete(`/api/nodes/${chinese.id}`);
  res = await api.delete('/api/trash');
  assert.equal(res.status, 200);
  res = await api.get('/api/trash');
  assert.deepEqual(res.json.items, []);
});

test('files: zip download of a folder', async () => {
  const listing = await api.get(`/api/nodes?parentId=${documents.id}`);
  const folder = listing.json.items.find((item) => item.id === documents.id) ?? documents;
  const res = await api.request('GET', `/api/nodes/${folder.id}/download`, { raw: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/zip/);
  const buffer = Buffer.from(await res.arrayBuffer());
  assert.ok(buffer.length > 0);
  assert.equal(buffer.subarray(0, 2).toString('ascii'), 'PK');
});

test('files: storage and overview', async () => {
  let res = await api.get('/api/storage');
  assert.equal(res.status, 200);
  assert.ok(res.json.used > 0);
  assert.equal(res.json.quota, 0);
  assert.ok(res.json.fileCount > 0);
  assert.ok(res.json.folderCount > 0);
  assert.equal(typeof res.json.trashCount, 'number');
  assert.equal(typeof res.json.trashSize, 'number');

  res = await api.get('/api/overview');
  assert.equal(res.status, 200);
  assert.ok(res.json.storage);
  assert.ok(Array.isArray(res.json.recent));
  assert.ok(Array.isArray(res.json.starred));
});

test('files: quota enforcement rejects oversized uploads with 413', async (t) => {
  const quotaServer = await startTestServer({ defaultQuotaBytes: 8 });
  t.after(() => quotaServer.close());
  const quotaApi = new ApiClient(quotaServer.base);
  await quotaApi.setup();

  let res = await quotaApi.request('POST', '/api/nodes/upload', {
    body: (() => {
      const form = new FormData();
      form.append('files', new Blob(['1234']), 'small.txt');
      return form;
    })(),
  });
  assert.equal(res.status, 201);

  res = await quotaApi.request('POST', '/api/nodes/upload', {
    body: (() => {
      const form = new FormData();
      form.append('files', new Blob(['0123456789']), 'big.txt');
      return form;
    })(),
  });
  assert.equal(res.status, 413);
  assert.equal(res.json.error.code, 'quota_exceeded');
});

test('files: MAX_UPLOAD_BYTES is enforced', async (t) => {
  const smallServer = await startTestServer({ maxUploadBytes: 8 });
  t.after(() => smallServer.close());
  const smallApi = new ApiClient(smallServer.base);
  await smallApi.setup();

  const res = await smallApi.request('POST', '/api/nodes/upload', {
    body: (() => {
      const form = new FormData();
      form.append('files', new Blob(['more than eight bytes']), 'big.txt');
      return form;
    })(),
  });
  assert.equal(res.status, 413);
  assert.equal(res.json.error.code, 'upload_too_large');
  const leftovers = await fsp.readdir(smallServer.config.tmpDir);
  assert.deepEqual(leftovers, [], 'failed uploads must not leave temp files behind');
});

test('files: copy and restore enforce the storage quota', async (t) => {
  const quotaServer = await startTestServer({ defaultQuotaBytes: 10 });
  t.after(() => quotaServer.close());
  const quotaApi = new ApiClient(quotaServer.base);
  await quotaApi.setup();

  const [file] = await uploadFiles(quotaApi, null, [{ name: 'eight.txt', content: '12345678' }]);
  // Copy would duplicate the 8 bytes and exceed the 10 byte quota.
  let res = await quotaApi.post(`/api/nodes/${file.id}/copy`, {});
  assert.equal(res.status, 413);
  assert.equal(res.json.error.code, 'quota_exceeded');
  let listing = await quotaApi.get('/api/nodes');
  assert.equal(listing.json.items.length, 1, 'failed copy creates nothing');

  // Restoring a trashed subtree above the quota is also rejected.
  await quotaApi.delete(`/api/nodes/${file.id}`);
  await uploadFiles(quotaApi, null, [{ name: 'four.txt', content: '1234' }]);
  res = await quotaApi.post(`/api/trash/${file.id}/restore`);
  assert.equal(res.status, 413);
  assert.equal(res.json.error.code, 'quota_exceeded');
  listing = await quotaApi.get('/api/trash');
  assert.equal(listing.json.items.length, 1, 'item stays in the trash');
});

test('files: path traversal looking names are rejected', async (t) => {
  const res = await api.post('/api/nodes/folder', { name: '../evil' });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'invalid_name');
  const res2 = await api.post('/api/nodes/folder', { name: 'bad:name' });
  assert.equal(res2.status, 400);
  const res3 = await api.post('/api/nodes/folder', { name: '..' });
  assert.equal(res3.status, 400);
});

test('files: macOS AppleDouble metadata files are hidden from REST listings', async () => {
  const res = await api.post('/api/nodes/folder', { name: 'Metadata Folder' });
  const folder = res.json.node;
  const [meta, visible] = await uploadFiles(api, folder.id, [
    { name: '._real-file.txt', content: 'apple-double metadata' },
    { name: 'real-file.txt', content: 'real content' },
  ]);
  assert.ok(meta);
  assert.ok(visible);

  const listing = await api.get(`/api/nodes?parentId=${folder.id}`);
  assert.deepEqual(listing.json.items.map((item) => item.name), ['real-file.txt']);
  assert.equal(listing.json.folder.childCount, 1, 'hidden companion is not counted');

  const root = await api.get('/api/nodes');
  const folderInRoot = root.json.items.find((item) => item.id === folder.id);
  assert.ok(folderInRoot);
  assert.equal(folderInRoot.childCount, 1);

  // Trash listings hide them too.
  await api.delete(`/api/nodes/${meta.id}`);
  const trash = await api.get('/api/trash');
  assert.ok(!trash.json.items.some((item) => item.name === '._real-file.txt'));
});
