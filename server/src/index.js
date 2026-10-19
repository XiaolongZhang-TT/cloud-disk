import http from 'node:http';

import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);
const server = http.createServer(app);

server.on('error', (error) => {
  console.error(`[fatal] ${error.message}`);
  process.exitCode = 1;
});

server.listen(config.port, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  console.log(`Tern v${config.version} listening on http://0.0.0.0:${port}`);
  console.log(`  REST API : http://127.0.0.1:${port}/api`);
  console.log(`  WebDAV   : http://127.0.0.1:${port}/Tern (alias /dav)`);
  console.log(`  Data dir : ${config.dataDir}`);
  if (config.allowRegistration) console.log('  Registration is OPEN');
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}, closing server`);
  server.close(() => {
    try {
      app.locals.close?.();
    } catch (error) {
      console.error('[shutdown] close failed:', error.message);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
