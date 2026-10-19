import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export const ADMIN = { username: 'admin', password: 'clouddisk123' };

/** Start the real HTTP stack against a throwaway data directory. */
export async function startTestServer(overrides = {}) {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'clouddisk-test-'));
  const config = loadConfig({ dataDir, port: 0, ...overrides });
  const app = createApp(config);
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    base: `http://127.0.0.1:${address.port}`,
    config,
    app,
    dataDir,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      app.locals.close();
      await fsp.rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Minimal browser-like client with a cookie jar. */
export class ApiClient {
  constructor(base) {
    this.base = base;
    this.cookie = null;
  }

  async request(method, route, { body, headers = {}, raw = false } = {}) {
    const requestHeaders = { ...headers };
    if (this.cookie) requestHeaders.cookie = this.cookie;
    let payload = body;
    const isForm = body instanceof FormData;
    if (body !== undefined && !isForm && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      requestHeaders['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetch(this.base + route, {
      method,
      headers: requestHeaders,
      body: payload,
      redirect: 'manual',
    });
    for (const setCookie of response.headers.getSetCookie?.() ?? []) {
      const match = /^cd_session=([^;]*)/.exec(setCookie);
      if (match) this.cookie = match[1] ? `cd_session=${match[1]}` : null;
    }
    if (raw) return response;
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, headers: response.headers, text, json };
  }

  get(route, options) {
    return this.request('GET', route, options);
  }

  post(route, body, options = {}) {
    return this.request('POST', route, { ...options, body });
  }

  patch(route, body, options = {}) {
    return this.request('PATCH', route, { ...options, body });
  }

  delete(route, options) {
    return this.request('DELETE', route, options);
  }

  async setup(username = ADMIN.username, password = ADMIN.password) {
    const result = await this.post('/api/auth/setup', { username, password, displayName: 'Administrator' });
    if (result.status !== 201) throw new Error(`setup failed: ${result.status} ${result.text}`);
    return result;
  }

  async login(username = ADMIN.username, password = ADMIN.password) {
    const result = await this.post('/api/auth/login', { username, password });
    if (result.status !== 200) throw new Error(`login failed: ${result.status} ${result.text}`);
    return result;
  }
}

/** Build a multipart upload body from `[{ name, content }]`. */
export function uploadForm(files) {
  const form = new FormData();
  for (const file of files) {
    form.append('files', new Blob([file.content]), file.name);
  }
  return form;
}

export async function uploadFiles(client, parentId, files) {
  const query = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
  const result = await client.request('POST', `/api/nodes/upload${query}`, { body: uploadForm(files) });
  if (result.status !== 201) throw new Error(`upload failed: ${result.status} ${result.text}`);
  return result.json.items;
}

/** Raw WebDAV request with HTTP Basic auth. */
export async function davRequest(server, method, route, options = {}) {
  const { body, headers = {}, username = ADMIN.username, password = ADMIN.password } = options;
  return fetch(server.base + route, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      ...headers,
    },
    body,
    redirect: 'manual',
  });
}

export const PROPFIND_ALLPROP =
  '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';
