# syntax=docker/dockerfile:1
#
# CloudDisk — single-container image serving the REST API, WebDAV endpoint and
# the React SPA on one port.
#
# Stage 1 builds the web SPA from source, so `docker compose up -d --build`
# works on a fresh clone without requiring a host-side `npm run build`.
FROM node:24-alpine AS web-build

WORKDIR /web
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./
RUN npm run build

# Stage 2 installs the server's production dependencies only. There are no
# native modules: SQLite is node:sqlite, scrypt comes from node:crypto, so the
# final image stays small and identical on x86_64 and arm64 NAS hardware.
FROM node:24-alpine AS deps

WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Stage 3 is the runtime image.
FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    STATIC_DIR=/app/public

# su-exec is used by the entrypoint to drop from root to DATA_UID:DATA_GID
# after fixing volume ownership. tzdata keeps log timestamps and share expiry
# predictable in non-UTC timezones.
RUN apk add --no-cache su-exec tzdata \
 && mkdir -p /data /app/public

COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY --from=web-build /web/dist ./public

# Runtime files are copied from the build context with the host's modes (the
# agent/checkout may use 0600). Make them readable by ANY DATA_UID at runtime,
# not just the image's default node uid, otherwise PUID != 1000 cannot read
# /app/package.json or /app/src.
RUN chown -R node:node /app \
 && chmod -R a+rX /app

COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

# entrypoint.sh fixes /data ownership for DATA_UID/DATA_GID, then `exec`s the
# Node process through su-exec (non-root at runtime).
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
