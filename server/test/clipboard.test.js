import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { ApiClient, startTestServer } from './helpers.js';

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

test('clipboard: requires authentication', async () => {
  const anon = new ApiClient(server.base);
  const res = await anon.get('/api/clipboard');
  assert.equal(res.status, 401);
});

test('clipboard: initially empty, then latest text with increasing version', async () => {
  const empty = await api.get('/api/clipboard');
  assert.equal(empty.status, 200);
  assert.equal(empty.json.clipboard, null);

  const first = await api.request('PUT', '/api/clipboard', {
    body: { text: 'hello from mac', device: 'macbook' },
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.clipboard.text, 'hello from mac');
  assert.equal(first.json.clipboard.device, 'macbook');
  assert.equal(first.json.clipboard.version, 1);

  const second = await api.request('PUT', '/api/clipboard', {
    body: { text: 'hello from windows', device: 'windows' },
  });
  assert.equal(second.status, 200);
  assert.equal(second.json.clipboard.version, 2);
  assert.equal(second.json.clipboard.text, 'hello from windows');

  const latest = await api.get('/api/clipboard');
  assert.equal(latest.status, 200);
  assert.deepEqual(
    { ...latest.json.clipboard, updatedAt: undefined },
    { text: 'hello from windows', device: 'windows', version: 2, updatedAt: undefined },
  );
});

test('clipboard: rejects empty and oversized text', async () => {
  const empty = await api.request('PUT', '/api/clipboard', { body: { text: '' } });
  assert.equal(empty.status, 400);

  const oversized = await api.request('PUT', '/api/clipboard', {
    body: { text: 'x'.repeat(256 * 1024 + 1) },
  });
  assert.equal(oversized.status, 400);
});
