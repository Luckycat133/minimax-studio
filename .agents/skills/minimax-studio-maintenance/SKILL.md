---
name: minimax-studio-maintenance
description: Maintain MiniMax Studio's legacy Direct/Backend experiment, offline voice workspace, and guarded loopback speech service. Use for source-backed delivery status, credentials, retry/recovery semantics, media integrity, tests, and publication boundaries.
---

# MiniMax Studio Maintenance

Read the current tree before using historical reports. This skill does not
activate generation, authorize paid calls, recover a missing backend, publish a
site, or decide whether to archive the legacy workbench.

## Source and evidence boundary

Reviewed 2026-11-15 against `main` at
`5d57027b4b91743e01795f7e0b00f547bd5f952a`.
Start with [maintenance facts and acceptance gates](../../../docs/MAINTENANCE.md).
Recheck changed files and the target revision on each use; this is a dated
inspection, not a perpetual runtime pass.

There are three separate execution surfaces:

| Surface | Actual implementation | Boundary |
| --- | --- | --- |
| Legacy multimodal workbench | `index.html`, `js/app.js`, `js/api.js`, `js/backend-api.js`, `js/models.js` | Direct requests and a Backend client facade exist. Legacy `server/server.js` and matching business routes remain absent. |
| Offline voice workspace | `dialogue.html`, `js/dialogue*.mjs`, `js/production*.mjs` | CSV/JSON editing, casting, WAV import, take review, stale-version checks and ZIP backup/delivery have synthetic tests. Static/standalone use cannot generate through the local provider. |
| Guarded local speech service | `server/dialogue-server.mjs`, `server/dialogue-provider.mjs` | Runnable loopback HTTP service with default-disabled speech generation; not the legacy auth/works/multimodal backend. |

Root and server manifests and lockfiles exist. The root has test/build/dialogue
scripts and development dependencies, not just Puppeteer. Do not claim that
`server/package.json` restores the missing legacy entrypoint. The root and server
`node_modules` directories are absent from the reviewed trees; this says nothing
about historical copies or a history purge.

## Verify the capability, not its label

Trace UI entry -> dispatch -> request -> normalized response -> usable result ->
preview/export before marking a feature delivered.

- Legacy image, speech, music and lyrics have dispatch/render paths, but this
  review did not verify their live-provider behavior.
- Chat has navigation, configuration and `MiniMaxAPI.generateChat()`, but lacks
  branches in `App.handleDirectGenerate()`, Backend dispatch and result rendering.
  It is partial, not an accepted chat/session-history feature.
- No video creation/polling/result flow exists in the reviewed workbench. A repo
  description or old report is not evidence of implemented video support.
- `App.detectMode()` trusts an HTTP-success `/api/health` response, then falls
  back to Direct on failure. It does not validate a health schema. A stored key,
  connected indicator or HTML 200 is not proof of credentials or backend health.

Keep source facts, CI results, browser acceptance, live-provider acceptance and
published-site checks separate. Existing CI evidence is recorded in the
maintenance document; never report it as a new local test run.

## Credentials, retry and recovery rules

Legacy Direct Mode stores `minimax_api_key` in localStorage. The Backend facade
stores access/refresh tokens there too. Neither is a production credential vault.
Never read, copy or print real keys, `.env`, runtime databases, saved browser
profiles or private recordings as test fixtures.

The legacy Backend facade currently retries every status >= 500 up to three
additional times, including generation POSTs. It has no generation idempotency
contract; token-expiry replay is recursive without an explicit replay limit.
Other 401 responses can be parsed twice. The pending-request map has a drain but
no enqueue path, and offline non-auth requests reject immediately. Do not call
this safe generation retry, durable reconnect recovery, multi-key rotation or
fully bounded credential retry. Capture these as defects, not guaranteed behavior.

For the new dialogue service, preserve all existing gates:

- Bind only `127.0.0.1`; enforce the exact Host and same-origin generation POST.
  Do not broaden static serving, add a public tunnel, or expose backend files.
- Default startup reads no key and sends no provider request. Only explicit
  enablement, entitlement confirmation and bounded request/character budgets may
  cause the server to read `MINIMAX_API_KEY`; never move it into frontend storage.
- Preserve one in-flight operation, pre-dispatch budget reservation, no automatic
  provider retries, and sanitized errors. Local character/request limits are not
  currency caps or a provider billing guarantee.
- Deduplication by `operation_id` plus normalized input and GET-only result
  recovery last for one process. Preserve `session_id`; restart or lookup 404
  does not prove that an earlier operation was unbilled. This is not upstream or
  durable cross-restart idempotency.
- Timeouts/transport uncertainty lock new dispatches in that process. Not every
  HTTP/provider/format error is marked uncertain today; `uncertain: false` is
  not proof of no charge. Local abort/pause/cancel is not provider cancellation.
- Preserve original take bytes and request fingerprints. JSON metadata is not
  audio; final delivery requires valid bytes and approval for the current version.
  Browser queue conflict detection is not an atomic cross-tab lock.

See [provider integration](../../../docs/PROVIDER_INTEGRATION.md) and
[voice workflow](../../../OFFLINE_WORKFLOW.md) for exact routes, limits and formats.
When changing provider contracts, verify official regional documentation and
record its date. A documented model name is not account entitlement or a live pass.

## Focused, mock-first verification

Inspect a script before running it. Historical root `test_*.mjs` scripts may
click paid generation; do not use real credentials. Inject fake provider transport
and block unexpected external browser requests. Use fresh isolated profiles.

Relevant commands from the current root manifest:

```sh
npm ci --ignore-scripts
npm test
npm run test:dom
python3 -m unittest discover -s tests -v
# Use a fresh checkout/output: the Pages builder refuses an existing _site.
npm run build
# Requires an available browser; no provider calls are authorized.
CHROME_PATH=/path/to/chromium npm run test:browser
# Safe local runtime, generation disabled; no runtime npm install required.
node server/dialogue-server.mjs
```

Use the smallest relevant checks for the change. Docs-only work requires link,
source-claim and diff validation, not an invented browser/provider pass. Runtime
changes must cover the affected mode, HTTP and provider errors, ambiguous results,
response-body timeout, duplicate submission, recovery and actual media integrity.
Keep standalone/offline CSP, current-version review and ZIP round-trip guarantees.

## Publication and reporting

Pages builds only the 17 files allowed by `scripts/build_pages.py`, but that list
still includes the legacy Direct-capable entrypoint. Artifact isolation does not
disable Direct Mode or make browser-held credentials safe. The dialogue service
is not deployed by Pages. Do not upload the repository root or widen the allowlist
as a documentation fix. Main pushes can deploy; use a review branch for maintenance
updates, with no merge/deployment or history rewrite inferred from a skill edit.

Report: changed files; audited source SHA; exact checks and their evidence source;
known unresolved defects; checks not run; and any real acceptance blockers.
Do not silently repair runtime behavior or mark planned fixes complete merely
because the maintenance specification describes their intended acceptance gates.
