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

test('versions: overwrite snapshots previous content and can restore it', async () => {
  const items = await uploadFiles(api, null, [{ name: 'history.txt', content: 'one' }]);
  const node = items[0];
  assert.equal(node.sha256?.length, 64);

  const first = await api.request('PUT', `/api/nodes/${node.id}/content`, {
    body: 'two',
    headers: { 'if-match': node.etag },
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.node.sha256?.length, 64);

  const second = await api.request('PUT', `/api/nodes/${node.id}/content`, {
    body: 'three',
    headers: { 'if-match': first.json.node.etag },
  });
  assert.equal(second.status, 200);

  const list = await api.get(`/api/nodes/${node.id}/versions`);
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 2);
  assert.deepEqual(list.json.items.map((item) => item.size), [3, 3]);

  const oldest = list.json.items.find((item) => item.version === 1);
  const content = await api.get(`/api/nodes/${node.id}/versions/${oldest.id}/content`);
  assert.equal(content.status, 200);
  assert.equal(content.text, 'one');

  const restored = await api.post(`/api/nodes/${node.id}/versions/${oldest.id}/restore`, {});
  assert.equal(restored.status, 200);
  assert.equal(restored.json.node.size, 3);
  const current = await api.get(`/api/nodes/${node.id}/content`);
  assert.equal(current.text, 'one');
});

test('versions: non-file nodes have no versions', async () => {
  const folder = await api.post('/api/nodes/folder', { name: 'history-folder' });
  assert.equal(folder.status, 201);
  const res = await api.get(`/api/nodes/${folder.json.node.id}/versions`);
  assert.equal(res.status, 400);
});
