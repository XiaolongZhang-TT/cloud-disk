import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

import { ensureDataDirs } from './config.js';
import { openDatabase } from './db.js';
import { Store } from './store.js';
import { BasicAuthCache, hashPassword } from './auth.js';
import {
  createSecurityHeaders,
  createSessionMiddleware,
  requireAdmin,
  requireUser,
} from './middleware.js';
import { createAuthRouter } from './routes/auth.js';
import { createAdminRouter } from './routes/admin.js';
import { createCollectionsRouter, createNodesRouter } from './routes/nodes.js';
import { createSharesRouter } from './routes/shares.js';
import { createClipboardRouter } from './routes/clipboard.js';
import { createUploadsRouter } from './routes/uploads.js';
import { createPublicSharesRouter } from './routes/public-shares.js';
import { createWebdavRouter } from './webdav.js';
import { errorHandler } from './errors.js';
import { normalizeUsername, validatePassword } from './util.js';

/** Create the configured admin user on first boot, when requested by env. */
function bootstrapAdmin(store, config) {
  if (store.countUsers() > 0) return;
  if (!config.adminUsername || !config.adminPassword) return;
  try {
    const username = normalizeUsername(config.adminUsername);
    const password = validatePassword(config.adminPassword);
    if (store.getUserByUsername(username)) return;
    store.createUser({
      username,
      passwordHash: hashPassword(password),
      displayName: 'Administrator',
      role: 'admin',
      quota: config.defaultQuotaBytes,
    });
    console.log(`[bootstrap] created administrator "${username}"`);
  } catch (error) {
    console.warn(`[bootstrap] skipped administrator auto-creation: ${error.message}`);
  }
}

/**
 * Build the Express application (single process serving REST, WebDAV and the
 * compiled SPA). The database and data directories are opened as a side effect.
 *
 * @param {ReturnType<typeof loadConfig>} config
 * @returns {import('express').Express & { locals: { close: () => void } }}
 */
export function createApp(config) {
  ensureDataDirs(config);
  const db = openDatabase(config);
  const store = new Store(db, config);
  const basicCache = new BasicAuthCache();

  bootstrapAdmin(store, config);
  store.purgeExpiredSessions();
  const sessionSweeper = setInterval(() => {
    try {
      store.purgeExpiredSessions();
    } catch (error) {
      console.warn('[sessions] purge failed:', error.message);
    }
  }, 60 * 60 * 1000);
  sessionSweeper.unref();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false); // ETags on binary responses are managed explicitly
  app.locals.config = config;
  app.locals.store = store;
  app.locals.close = () => {
    clearInterval(sessionSweeper);
    store.close();
  };

  app.use(createSecurityHeaders(config));
  app.use(createSessionMiddleware({ store, config }));

  // WebDAV must be mounted before the JSON/urlencoded body parsers: a PUT of a
  // `.json` file arrives with `Content-Type: application/json` and must be
  // streamed to disk, not consumed by express.json(). It is also mounted before
  // the SPA so unknown /dav paths never fall through to index.html.
  app.use(['/dav', '/Tern'], createWebdavRouter({ store, config, basicCache }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  const api = express.Router();
  api.get('/health', (req, res) => {
    res.json({ status: 'ok', version: config.version, uptime: Math.round(process.uptime()) });
  });

  // Public auth + share endpoints.
  api.use(createAuthRouter({ store, config }));
  api.use(createPublicSharesRouter({ store, config }));

  // Everything below requires a session.
  api.use('/nodes', requireUser, createNodesRouter({ store, config }));
  api.use(requireUser);
  api.use(createCollectionsRouter({ store, config }));
  api.use('/shares', createSharesRouter({ store, config }));
  api.use('/clipboard', createClipboardRouter({ store }));
  api.use('/uploads', createUploadsRouter({ store, config }));
  api.use('/admin', requireAdmin, createAdminRouter({ store, config }));
  api.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Unknown API endpoint' } });
  });

  app.use('/api', api);

  // Compiled SPA (web/dist). Missing build is a clean 404, not a crash.
  const indexHtml = path.join(config.staticDir, 'index.html');
  app.use(
    express.static(config.staticDir, {
      index: false,
      maxAge: 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!fs.existsSync(indexHtml)) {
      return res
        .status(404)
        .json({ error: { code: 'frontend_not_built', message: 'The web frontend has not been built yet' } });
    }
    return res.sendFile(indexHtml);
  });

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
  });

  app.use(errorHandler);
  return app;
}
