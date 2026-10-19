import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { ApiClient, PROPFIND_ALLPROP, davRequest, startTestServer } from './helpers.js';

let server;
let api;

const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope>' +
  '<D:locktype><D:write/></D:locktype><D:owner><D:href>mailto:tester@example.com</D:href></D:owner>' +
  '</D:lockinfo>';

async function propfind(route, depth = '0', body = PROPFIND_ALLPROP) {
  return davRequest(server, 'PROPFIND', route, {
    headers: { depth, 'content-type': 'application/xml; charset=utf-8' },
    body,
  });
}

before(async () => {
  server = await startTestServer();
  api = new ApiClient(server.base);
  await api.setup();
});

after(async () => {
  await server.close();
});

test('webdav: OPTIONS advertises DAV 1,2 and requires Basic auth', async () => {
  let res = await davRequest(server, 'OPTIONS', '/CloudDisk/', { password: 'wrong-password' });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /Basic realm="CloudDisk"/);

  res = await davRequest(server, 'OPTIONS', '/CloudDisk/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('dav'), '1, 2');
  const allow = res.headers.get('allow');
  for (const method of ['OPTIONS', 'PROPFIND', 'PROPPATCH', 'GET', 'HEAD', 'PUT', 'DELETE', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK']) {
    assert.ok(allow.includes(method), `Allow advertises ${method}`);
  }
});

test('webdav: PROPFIND Depth 0 on the virtual root', async () => {
  const res = await propfind('/CloudDisk/');
  assert.equal(res.status, 207);
  assert.match(res.headers.get('content-type'), /application\/xml/);
  const xml = await res.text();
  assert.match(xml, /<D:multistatus xmlns:D="DAV:">/);
  assert.match(xml, /<D:href>\/CloudDisk\/<\/D:href>/);
  assert.match(xml, /<D:resourcetype><D:collection\/><\/D:resourcetype>/);
  assert.match(xml, /<D:getlastmodified>/);
  assert.match(xml, /<D:supportedlock>/);
  assert.match(xml, /<D:lockdiscovery\/>/);
  assert.match(xml, /HTTP\/1.1 200 OK/);

  // Requesting quota props explicitly returns them for the root collection.
  const quotaBody =
    '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop>' +
    '<D:quota-used-bytes/><D:quota-available-bytes/><D:resourcetype/></D:prop></D:propfind>';
  const quotaRes = await propfind('/CloudDisk/', '0', quotaBody);
  const quotaXml = await quotaRes.text();
  assert.match(quotaXml, /<D:quota-used-bytes>0<\/D:quota-used-bytes>/);
});

test('webdav: MKCOL, PUT, GET, HEAD and Depth 1 listing', async () => {
  let res = await davRequest(server, 'MKCOL', '/CloudDisk/Documents');
  assert.equal(res.status, 201);

  res = await davRequest(server, 'MKCOL', '/CloudDisk/Documents');
  assert.equal(res.status, 405);

  res = await davRequest(server, 'PUT', '/CloudDisk/Documents/hello.txt', {
    headers: { 'content-type': 'text/plain' },
    body: 'hello webdav',
  });
  assert.equal(res.status, 201);
  assert.ok(res.headers.get('etag'));

  res = await davRequest(server, 'GET', '/CloudDisk/Documents/hello.txt');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'hello webdav');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.match(res.headers.get('etag'), /^"/);

  res = await davRequest(server, 'HEAD', '/CloudDisk/Documents/hello.txt');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), String('hello webdav'.length));

  res = await davRequest(server, 'GET', '/CloudDisk/Documents/hello.txt', {
    headers: { range: 'bytes=0-4' },
  });
  assert.equal(res.status, 206);
  assert.equal(await res.text(), 'hello');
  assert.equal(res.headers.get('content-range'), `bytes 0-4/${'hello webdav'.length}`);

  res = await propfind('/CloudDisk/Documents/hello.txt', '0');
  const fileXml = await res.text();
  assert.match(fileXml, new RegExp(`<D:getcontentlength>${'hello webdav'.length}</D:getcontentlength>`));
  assert.match(fileXml, /<D:getcontenttype>text\/plain<\/D:getcontenttype>/);
  assert.match(fileXml, /<D:getetag>/);

  res = await propfind('/CloudDisk/', '1');
  const rootXml = await res.text();
  assert.match(rootXml, /<D:href>\/CloudDisk\/Documents\/<\/D:href>/);
  assert.ok(!rootXml.includes('hello.txt'), 'Depth 1 only lists direct children');

  res = await propfind('/CloudDisk/Documents/', '1');
  const documentsXml = await res.text();
  assert.match(documentsXml, /<D:href>\/CloudDisk\/Documents\/hello\.txt<\/D:href>/);

  // JSON uploads must be streamed to disk, not swallowed by express.json().
  res = await davRequest(server, 'PUT', '/CloudDisk/Documents/data.json', {
    headers: { 'content-type': 'application/json' },
    body: '{"hello":"world"}',
  });
  assert.equal(res.status, 201);
  res = await davRequest(server, 'GET', '/CloudDisk/Documents/data.json');
  assert.equal(await res.text(), '{"hello":"world"}');

  // Non-ASCII names are percent-encoded in hrefs and round-trip correctly.
  res = await davRequest(server, 'PUT', '/CloudDisk/Documents/%E4%B8%AD%E6%96%87.txt', { body: 'unicode' });
  assert.equal(res.status, 201);
  res = await propfind('/CloudDisk/Documents/', '1');
  const listingXml = await res.text();
  assert.ok(listingXml.includes(`<D:href>/CloudDisk/Documents/${encodeURIComponent('中文.txt')}</D:href>`));
});

test('webdav: PUT to a missing parent conflicts and missing resources 404', async () => {
  let res = await davRequest(server, 'PUT', '/CloudDisk/NoSuchFolder/file.txt', { body: 'x' });
  assert.equal(res.status, 409);

  res = await davRequest(server, 'GET', '/CloudDisk/NoSuchFolder/file.txt');
  assert.equal(res.status, 404);

  res = await propfind('/CloudDisk/NoSuchFolder', '0');
  assert.equal(res.status, 404);

  res = await davRequest(server, 'MKCOL', '/CloudDisk/NoSuchParent/Child');
  assert.equal(res.status, 409);
});

test('webdav: MOVE renames and relocates resources', async () => {
  let res = await davRequest(server, 'MOVE', '/CloudDisk/Documents/hello.txt', {
    headers: { destination: `${server.base}/CloudDisk/Documents/renamed.txt` },
  });
  assert.equal(res.status, 201);

  res = await davRequest(server, 'GET', '/CloudDisk/Documents/hello.txt');
  assert.equal(res.status, 404);
  res = await davRequest(server, 'GET', '/CloudDisk/Documents/renamed.txt');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'hello webdav');

  // MOVE a collection.
  res = await davRequest(server, 'MOVE', '/CloudDisk/Documents', {
    headers: { destination: `${server.base}/CloudDisk/Archive` },
  });
  assert.equal(res.status, 201);
  res = await davRequest(server, 'GET', '/CloudDisk/Archive/renamed.txt');
  assert.equal(res.status, 200);
});

test('webdav: COPY copies files and collections recursively', async () => {
  let res = await davRequest(server, 'COPY', '/CloudDisk/Archive/renamed.txt', {
    headers: { destination: `${server.base}/CloudDisk/Archive/copy.txt` },
  });
  assert.equal(res.status, 201);
  res = await davRequest(server, 'GET', '/CloudDisk/Archive/copy.txt');
  assert.equal(await res.text(), 'hello webdav');

  // COPY onto an existing resource obeys Overwrite: F.
  res = await davRequest(server, 'COPY', '/CloudDisk/Archive/renamed.txt', {
    headers: {
      destination: `${server.base}/CloudDisk/Archive/copy.txt`,
      overwrite: 'F',
    },
  });
  assert.equal(res.status, 412);

  res = await davRequest(server, 'COPY', '/CloudDisk/Archive', {
    headers: { destination: `${server.base}/CloudDisk/Archive%20Copy` },
  });
  assert.equal(res.status, 201);
  res = await davRequest(server, 'GET', '/CloudDisk/Archive%20Copy/renamed.txt');
  assert.equal(res.status, 200);
  res = await propfind('/CloudDisk/Archive%20Copy/', '1');
  const xml = await res.text();
  assert.match(xml, /<D:collection\/>/);
  assert.match(xml, /renamed\.txt/);
});

test('webdav: LOCK, locked writes require the token, UNLOCK releases', async () => {
  let res = await davRequest(server, 'LOCK', '/CloudDisk/Archive/renamed.txt', {
    headers: { 'content-type': 'application/xml; charset=utf-8', timeout: 'Second-600' },
    body: LOCK_BODY,
  });
  assert.equal(res.status, 200);
  const lockToken = res.headers.get('lock-token');
  assert.match(lockToken, /^<opaquelocktoken:/);
  const token = lockToken.slice(1, -1);
  const lockXml = await res.text();
  assert.match(lockXml, /<D:lockdiscovery>/);
  assert.match(lockXml, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // The lock is visible in PROPFIND lockdiscovery.
  res = await propfind('/CloudDisk/Archive/renamed.txt', '0');
  const lockedXml = await res.text();
  assert.match(lockedXml, /<D:activelock>/);

  res = await davRequest(server, 'PUT', '/CloudDisk/Archive/renamed.txt', { body: 'without token' });
  assert.equal(res.status, 423);

  res = await davRequest(server, 'PUT', '/CloudDisk/Archive/renamed.txt', {
    headers: { if: `(<${token}>)` },
    body: 'with token',
  });
  assert.equal(res.status, 204);
  res = await davRequest(server, 'GET', '/CloudDisk/Archive/renamed.txt');
  assert.equal(await res.text(), 'with token');

  res = await davRequest(server, 'UNLOCK', '/CloudDisk/Archive/renamed.txt', {
    headers: { 'lock-token': `<${token}>` },
  });
  assert.equal(res.status, 204);

  res = await davRequest(server, 'PUT', '/CloudDisk/Archive/renamed.txt', { body: 'after unlock' });
  assert.equal(res.status, 204);
});

test('webdav: DELETE removes resources and they land in the app trash', async () => {
  let res = await davRequest(server, 'DELETE', '/CloudDisk/Archive/copy.txt');
  assert.equal(res.status, 204);

  res = await propfind('/CloudDisk/Archive/copy.txt', '0');
  assert.equal(res.status, 404);

  res = await api.get('/api/trash');
  assert.ok(res.json.items.some((item) => item.name === 'copy.txt'), 'WebDAV DELETE is restorable');

  res = await davRequest(server, 'DELETE', '/CloudDisk/');
  assert.equal(res.status, 403);
});

test('webdav: /dav alias serves the same tree', async () => {
  const res = await davRequest(server, 'PROPFIND', '/dav/', {
    headers: { depth: '0', 'content-type': 'application/xml' },
    body: PROPFIND_ALLPROP,
  });
  assert.equal(res.status, 207);
  const xml = await res.text();
  assert.match(xml, /<D:href>\/dav\/<\/D:href>/);
});

test('webdav: oversized PUT returns 413, creates nothing and leaves no temp files', async (t) => {
  const smallServer = await startTestServer({ maxUploadBytes: 8 });
  t.after(() => smallServer.close());
  const smallApi = new ApiClient(smallServer.base);
  await smallApi.setup();

  const res = await davRequest(smallServer, 'PUT', '/CloudDisk/big.bin', { body: 'more than eight bytes' });
  assert.equal(res.status, 413);

  const lookup = await davRequest(smallServer, 'PROPFIND', '/CloudDisk/big.bin', {
    headers: { depth: '0', 'content-type': 'application/xml' },
    body: PROPFIND_ALLPROP,
  });
  assert.equal(lookup.status, 404);

  const tempFiles = await fsp.readdir(path.join(smallServer.config.tmpDir));
  assert.deepEqual(tempFiles, [], 'aborted PUT must not leave temp files');

  // The tree still works after the aborted upload.
  const mkcol = await davRequest(smallServer, 'MKCOL', '/CloudDisk/after-abort');
  assert.equal(mkcol.status, 201);
});
