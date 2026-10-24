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

test('backup: admin can download a zip containing the database', async () => {
  await uploadFiles(api, null, [{ name: 'backup.txt', content: 'backup' }]);
  const response = await api.get('/api/admin/backup', { raw: true });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /application\/zip/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.ok(bytes.length > 100);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});
