import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { ApiClient, startTestServer } from './helpers.js';

let server;
let api;

before(async () => {
  server = await startTestServer({ uploadChunkBytes: 256 * 1024 });
  api = new ApiClient(server.base);
  await api.setup();
});

after(async () => {
  await server.close();
});

test('uploads: chunked upload completes and keeps SHA-256', async () => {
  const body = Buffer.alloc(300 * 1024, 7);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const created = await api.post('/api/uploads', {
    name: 'large.bin',
    size: body.length,
    sha256,
  });
  assert.equal(created.status, 201);
  const upload = created.json.upload;
  assert.equal(upload.chunksTotal, 2);

  const chunk0 = await api.request('PUT', `/api/uploads/${upload.id}/chunks/0`, {
    body: body.subarray(0, upload.chunkSize),
    headers: { 'content-type': 'application/octet-stream' },
  });
  assert.equal(chunk0.status, 200);
  assert.equal(chunk0.json.upload.received, 1);

  const chunk1 = await api.request('PUT', `/api/uploads/${upload.id}/chunks/1`, {
    body: body.subarray(upload.chunkSize),
    headers: { 'content-type': 'application/octet-stream' },
  });
  assert.equal(chunk1.status, 200);
  assert.equal(chunk1.json.upload.received, 2);

  const completed = await api.post(`/api/uploads/${upload.id}/complete`, {});
  assert.equal(completed.status, 201);
  assert.equal(completed.json.node.size, body.length);
  assert.equal(completed.json.node.sha256, sha256);

  const download = await api.get(`/api/nodes/${completed.json.node.id}/content`, { raw: true });
  assert.equal(download.status, 200);
  assert.equal((await download.arrayBuffer()).byteLength, body.length);
});

test('uploads: rejects incomplete and bad checksum uploads', async () => {
  const created = await api.post('/api/uploads', { name: 'bad.bin', size: 3, sha256: '0'.repeat(64) });
  const upload = created.json.upload;
  const chunk = await api.request('PUT', `/api/uploads/${upload.id}/chunks/0`, {
    body: Buffer.from('abc'),
    headers: { 'content-type': 'application/octet-stream' },
  });
  assert.equal(chunk.status, 200);
  const completed = await api.post(`/api/uploads/${upload.id}/complete`, {});
  assert.equal(completed.status, 400);
  assert.equal(completed.json.error.code, 'upload_checksum_mismatch');
});
