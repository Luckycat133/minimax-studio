# Legacy multimodal maintenance

Use only for the `index.html` experiment or a request to recover its old backend.
The voice workspace and `server/dialogue-server.mjs` do not restore that backend.

## Follow the actual mode

`App.detectMode()` in `js/app.js` probes `/api/health` and falls back to Direct
Mode. Check that path before claiming the page used a backend. An HTML load,
mock health response or stored key does not prove authenticated backend service.

- `js/api.js` calls the configured provider, stores `minimax_api_key` in
  localStorage, and decodes/downloads media.
- `js/backend-api.js` is the access/refresh/CSRF facade with reconnect queues
  and bounded retry. Confirm corresponding server routes exist before using it.
- `js/models.js` owns model request/response shapes. Verify current official
  provider documentation before changing those contracts; historical reports
  do not establish current model availability.

The root and server dependency manifests exist, but the legacy `server/server.js`
entrypoint remains absent. Root test/build scripts now serve the voice candidate;
they are not proof of a recovered multimodal backend. Older missing-manifest
findings in `REPOSITORY_AUDIT.md` are historical.

## Verify without touching user data

Inspect legacy `test_*.mjs` before execution: image/music buttons may trigger
paid calls. Use fake credentials and intercepted browser requests. Cover only
the affected behavior:

1. Backend health versus unavailability and truthful Direct Mode indication.
2. Request shape, provider `base_resp` errors versus HTTP failures, timeout,
   abort, response normalization and usable media.
3. Actual result bytes/URL, preview, download and object-URL cleanup.
4. Recovery without blind generation POST retries. Keep returned task handles;
   timeout/abort does not establish provider cancellation.

Use installed Puppeteer or an available browser tool and a local static server.
Report the exact checks performed; syntax and mocks do not prove authenticated
model availability. Real generation requires authorization for that use and cost.

Saved browser credentials, `server/.env`, and any `server/data/minimax.db` are
user data, not fixtures. Never print, copy or expose keys. Browser-held keys and
localStorage are experimental local behavior, not a secure public deployment
pattern; an ordinary UI fix does not authorize publishing Direct Mode.

For requested backend recovery, identify a trusted source revision, restore the
implementation coherently, add deterministic media-flow coverage, and verify
local auth/health plus usable downloads before calling it runnable. Do not
rewrite history, publish or alter live data merely to reconcile documentation.
