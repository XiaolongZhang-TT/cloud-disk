import { parseCookies } from '../util.js';

/** User shape documented in docs/API.md. */
export function serializeUser(store, user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    role: user.role,
    quota: user.quota,
    used: store.usedBytes(user.id),
    createdAt: user.created_at,
  };
}

/** Convert `quotaGb` (0 = unlimited) to bytes. */
export function quotaBytesFromGb(gb) {
  const value = Number(gb);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 1024 ** 3);
}

/** Public config subset shared by /api/config and /api/auth/status. */
export function publicConfig(config) {
  return {
    serverName: config.serverName,
    version: config.version,
    allowRegistration: config.allowRegistration,
    maxUploadBytes: config.maxUploadBytes,
  };
}
