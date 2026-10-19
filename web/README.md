# 云屿 CloudDisk · Web

React 19 + TypeScript + Vite single-page app for 云屿 CloudDisk. Chinese UI, no UI
framework, no external fonts/CDNs — everything is bundled and works offline behind a
NAS reverse proxy.

## Commands

```bash
# install (sandboxed cache lives in ../.npm-cache)
npm install

# dev server on http://127.0.0.1:5173 with /api, /dav and /CloudDisk proxied to :18080
npm run dev

# production build → web/dist (served by the Node server at /)
npm run build

# built app on http://127.0.0.1:15173 with the same proxy
npm run preview -- --port 15173
```

`vite.config.ts` proxies `/api`, `/dav` and `/CloudDisk` to `http://127.0.0.1:18080`.
The API contract lives in `../docs/API.md`.

## Structure

```
src/
  lib/        API client, types, auth/theme/toast/app-data providers, node actions,
              upload queue (XHR progress), formatters, shortcuts
  components/ shell (sidebar, topbar), file grid/list, preview modal, dialogs,
              upload panel, design-system primitives
  pages/      login/setup, drive, recent/starred/search, shares, trash,
              settings + admin members, public share, 404
  styles/     tokens.css (light/dark design tokens), base, layout, components, pages
```

Design tokens are hand-written in `src/styles/tokens.css`; the accent is iris violet on
warm paper in light mode and deep ink in dark mode. Theme is persisted under
`cd.theme` (system / light / dark) and bootstrapped by `public/theme-init.js` so there is
no theme flash — the server CSP only allows same-origin scripts.

## Visual smoke tests

`scripts/screenshot.mjs` logs in against a running server, exercises the main flows
(preview, rename, move, trash/restore, keyboard delete, share creation, admin member
creation, public password gate) and writes screenshots to `screenshots/`.

```bash
npm install --no-save playwright-core   # uses the local Google Chrome
node scripts/screenshot.mjs http://127.0.0.1:18080
```

Test seed data is created through the API (see the script's session notes in the repo
history); the script cleans up the nodes it creates.
