---
name: minimax-studio-maintenance
description: Inspect, recover, or maintain MiniMax Studio's direct/backend modes and media request flows. Use for this repository's missing backend, mock browser testing, credentials, retries, model configuration, and generation/download status.
---

# MiniMax Studio Maintenance

Check the current tree before following historical Backend Mode instructions.
The project is in maintenance mode; a skill update does not activate deployment
or authorize paid generation.

## Verified source boundary (2026-10-03; recheck on use)

- Root `package.json` exists and only declares Puppeteer development tooling.
- `server/package.json` exists and declares backend dependencies, but the
  documented `server/server.js` entrypoint is absent. Dependency manifests do
  not recover the missing backend implementation or establish runnable scripts.
- `README.md` / `REPOSITORY_AUDIT.md` contain older missing-manifest findings.
  Retain their historical context, but report current files and unresolved
  entrypoint separately. Never invent `npm start` or a backend health result.
- The browser implementation is `index.html`, `js/app.js`, `js/api.js`,
  `js/backend-api.js`, `js/models.js`, plus `css/`. `server/data/minimax.db`,
  `server/.env`, and saved browser credentials are user data, not fixtures.

## Route changes through the actual mode

`App.detectMode()` probes `/api/health` then falls back to Direct Mode. Inspect
that path before claiming a page used the backend. A successful HTML load, a
mock health response or a key saved in storage does not prove authenticated
backend service.

- Direct API: `js/api.js` performs requests to the configured provider, stores
  `minimax_api_key` in localStorage, and decodes/downloads audio/media.
- Backend facade: `js/backend-api.js` handles access/refresh/CSRF state,
  reconnect queues and bounded retry. Confirm matching server routes actually
  exist before adding features that rely on them.
- Model request/response shape: `js/models.js`. Verify current official provider
  documentation when changing a model or API contract; do not copy model names
  from historical browser reports as current availability.

Browser-held keys and long-lived localStorage are the current experimental
implementation, not a secure public deployment pattern. Do not expose Direct
Mode publicly as part of an ordinary UI fix. Do not read, print or copy real keys
into test scripts, screenshots, source records or generated reports.

## Mock-first media verification

Inspect any `test_*.mjs` script before executing it: image/music buttons may
perform real paid calls. Use fake credentials and browser network interception
for local regressions. Cover only the affected flow:

1. Backend healthy versus unavailable, plus truthful Direct Mode indication.
2. Request construction, provider-level `base_resp` errors versus HTTP failures,
   timeout/abort, response normalization and usable output.
3. Image/video/audio result bytes or URL, preview, download, and object-URL
   cleanup. A click, task ID or queued response is not generated media.
4. Retry/reconnect: a generation POST may have been accepted before timeout;
   do not repeat it blindly or claim cancellation unless provider cancellation
   is observed. Preserve an actual returned task handle for recovery.

Use the already installed Puppeteer or available native browser tool, a local
static server and intercepted requests. Root package.json does not currently
provide test/build scripts; report the exact command that was actually run.
Syntax checks and mock success do not prove live model availability or a recovered
backend. Only perform a bounded live generation when that use and cost are in scope.

Before any requested backend recovery, identify the trusted source revision,
restore the missing entrypoint coherently, add deterministic media-flow tests,
and verify real local auth/health and download behavior before making runnable
claims. This skill does not itself restore files, rewrite Git history or publish.
