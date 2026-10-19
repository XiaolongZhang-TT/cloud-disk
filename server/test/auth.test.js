import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { ApiClient, ADMIN, startTestServer, uploadForm } from './helpers.js';

test('auth: setup, status, login, logout and session guards', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const api = new ApiClient(server.base);

  let res = await api.get('/api/auth/status');
  assert.equal(res.status, 200);
  assert.equal(res.json.setupRequired, true);
  assert.equal(res.json.authenticated, false);
  assert.equal(res.json.version, server.config.version);
  assert.equal(res.json.serverName, '云屿 CloudDisk');
  assert.equal(res.json.allowRegistration, false);
  assert.equal(res.json.maxUploadBytes, server.config.maxUploadBytes);

  res = await api.get('/api/nodes');
  assert.equal(res.status, 401);
  assert.equal(res.json.error.code, 'unauthenticated');

  res = await api.post('/api/auth/setup', { username: 'alice', password: 'short' });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'invalid_password');

  res = await api.post('/api/auth/setup', { username: 'alice', password: 'secret123', displayName: 'Alice' });
  assert.equal(res.status, 201);
  assert.equal(res.json.user.username, 'alice');
  assert.equal(res.json.user.role, 'admin');
  assert.equal(res.json.user.quota, 0);
  assert.equal(res.json.user.used, 0);
  assert.match(api.cookie, /^cd_session=/);

  res = await api.get('/api/auth/status');
  assert.equal(res.json.authenticated, true);
  assert.equal(res.json.setupRequired, false);
  assert.equal(res.json.user.username, 'alice');

  res = await api.get('/api/me');
  assert.equal(res.status, 200);
  assert.equal(res.json.user.displayName, 'Alice');

  res = await api.get('/api/config');
  assert.equal(res.status, 200);
  assert.equal(res.json.serverName, '云屿 CloudDisk');

  res = await api.post('/api/auth/setup', { username: 'bob', password: 'secret123' });
  assert.equal(res.status, 403);
  assert.equal(res.json.error.code, 'setup_not_allowed');

  res = await api.post('/api/auth/register', { username: 'bob', password: 'secret123' });
  assert.equal(res.status, 403);
  assert.equal(res.json.error.code, 'registration_disabled');

  res = await api.post('/api/auth/login', { username: 'alice', password: 'wrong-password' });
  assert.equal(res.status, 401);
  assert.equal(res.json.error.code, 'invalid_credentials');

  res = await api.post('/api/auth/logout');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
  res = await api.get('/api/me');
  assert.equal(res.status, 401);

  res = await api.post('/api/auth/login', { username: 'ALICE', password: 'secret123' });
  assert.equal(res.status, 200);
  assert.equal(res.json.user.username, 'alice');
  res = await api.get('/api/me');
  assert.equal(res.status, 200);

  res = await api.post('/api/auth/login', { username: 'alice', password: 'secret123', remember: false });
  assert.equal(res.status, 200);
});

test('auth: profile update and password change', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const api = new ApiClient(server.base);
  await api.setup();

  let res = await api.patch('/api/me', { displayName: 'Main Admin' });
  assert.equal(res.status, 200);
  assert.equal(res.json.user.displayName, 'Main Admin');

  res = await api.patch('/api/me', { currentPassword: 'nope', newPassword: 'brand-new-pass' });
  assert.equal(res.status, 401);
  assert.equal(res.json.error.code, 'invalid_password');

  res = await api.patch('/api/me', { currentPassword: ADMIN.password, newPassword: 'brand-new-pass' });
  assert.equal(res.status, 200);
  assert.equal(res.json.user.username, ADMIN.username);

  const fresh = new ApiClient(server.base);
  res = await fresh.post('/api/auth/login', { username: ADMIN.username, password: ADMIN.password });
  assert.equal(res.status, 401);
  res = await fresh.post('/api/auth/login', { username: ADMIN.username, password: 'brand-new-pass' });
  assert.equal(res.status, 200);
});

test('auth: login attempts are rate limited', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const api = new ApiClient(server.base);
  await api.setup();

  let limited = false;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const res = await api.post('/api/auth/login', { username: ADMIN.username, password: `wrong-${attempt}` });
    if (res.status === 429) {
      assert.equal(res.json.error.code, 'rate_limited');
      limited = true;
      break;
    }
    assert.equal(res.status, 401);
  }
  assert.equal(limited, true, 'login should be rate limited after repeated failures');
});

test('auth: registration can be enabled', async (t) => {
  const server = await startTestServer({ allowRegistration: true });
  t.after(() => server.close());
  const api = new ApiClient(server.base);
  await api.setup();

  const res = await api.post('/api/auth/register', {
    username: 'member1',
    password: 'memberpass1',
    displayName: 'Member One',
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.user.role, 'member');
  const me = await api.get('/api/me');
  assert.equal(me.json.user.username, 'member1');
});

test('auth: admin auto-created from environment on first boot', async (t) => {
  const server = await startTestServer({ adminUsername: 'root', adminPassword: 'rootpass123' });
  t.after(() => server.close());

  const api = new ApiClient(server.base);
  let res = await api.get('/api/auth/status');
  assert.equal(res.json.setupRequired, false);

  res = await api.post('/api/auth/login', { username: 'root', password: 'rootpass123' });
  assert.equal(res.status, 200);
  assert.equal(res.json.user.role, 'admin');
});

test('auth: admin user management', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const admin = new ApiClient(server.base);
  await admin.setup();

  let res = await admin.post('/api/admin/users', {
    username: 'bob',
    password: 'bobpass123',
    displayName: 'Bob',
    quotaGb: 1,
    role: 'member',
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.user.quota, 1024 ** 3);
  assert.equal(res.json.user.role, 'member');
  const bobId = res.json.user.id;

  res = await admin.post('/api/admin/users', { username: 'bob', password: 'bobpass123' });
  assert.equal(res.status, 409);
  assert.equal(res.json.error.code, 'username_taken');

  res = await admin.get('/api/admin/users');
  assert.equal(res.status, 200);
  assert.equal(res.json.items.length, 2);
  assert.ok(res.json.items.every((user) => typeof user.used === 'number'));

  res = await admin.patch(`/api/admin/users/${bobId}`, { quotaGb: 2, displayName: 'Bobby' });
  assert.equal(res.status, 200);
  assert.equal(res.json.user.quota, 2 * 1024 ** 3);
  assert.equal(res.json.user.displayName, 'Bobby');

  res = await admin.patch(`/api/admin/users/${bobId}`, { password: 'newbobpass' });
  assert.equal(res.status, 200);
  const bob = new ApiClient(server.base);
  res = await bob.post('/api/auth/login', { username: 'bob', password: 'newbobpass' });
  assert.equal(res.status, 200);
  res = await bob.get('/api/admin/users');
  assert.equal(res.status, 403);
  assert.equal(res.json.error.code, 'forbidden');

  // Give bob some data, then deleting him must remove the tree and the blobs.
  res = await bob.request('POST', '/api/nodes/upload', {
    body: uploadForm([{ name: 'bob.txt', content: 'bob data' }]),
  });
  assert.equal(res.status, 201);
  const bobStorage = path.join(server.config.storageDir, bobId);
  await assert.doesNotReject(() => fsp.access(bobStorage));

  const adminId = (await admin.get('/api/me')).json.user.id;
  res = await admin.delete(`/api/admin/users/${adminId}`);
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'cannot_delete_self');

  res = await admin.patch(`/api/admin/users/${adminId}`, { role: 'member' });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'last_admin');

  res = await admin.delete(`/api/admin/users/${bobId}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
  await assert.rejects(() => fsp.access(bobStorage), 'deleted user blobs are removed');
  res = await admin.get('/api/admin/users');
  assert.equal(res.json.items.length, 1);
  res = await new ApiClient(server.base).post('/api/auth/login', { username: 'bob', password: 'newbobpass' });
  assert.equal(res.status, 401);
});
