# Maintenance boundaries and delivery ledger

Review date: **2026-11-15**. Audited source: `main` at
[`5d57027b4b91743e01795f7e0b00f547bd5f952a`](https://github.com/Luckycat133/minimax-studio/commit/5d57027b4b91743e01795f7e0b00f547bd5f952a).

This review used GitHub source inspection and existing Actions logs. The reviewer
did not rerun the full checkout locally, launch a real browser, access an account,
read credentials or make a paid generation request. Documentation corrections do
not implement the open fixes below. Re-evaluate this ledger when source changes.

## 1. Actual product surfaces

| Surface / capability | Delivered source | Evidence and remaining boundary |
| --- | --- | --- |
| Legacy image, speech, music, lyrics | `index.html`; `js/app.js`, `api.js`, `models.js`, `templates.js` | Direct dispatch/render paths exist. Live generation, playable/downloadable outputs and current account access were not verified by this review. |
| Legacy Chat | Navigation, `MODEL_CONFIGS.chat`, `MiniMaxAPI.generateChat()` | Partial only: `App.handleDirectGenerate()`, Backend dispatch and result renderers have no Chat branch. No accepted conversation/history/streaming workflow. |
| Legacy video | No corresponding UI/config/API/task-polling/result flow found in the reviewed workbench | Not delivered in this tree. The repository description is a scope statement, not evidence of a working video feature. |
| Legacy Backend Mode | Browser-side auth/CSRF/works/generation facade | `server/server.js` and matching legacy business routes are absent. Neither the server manifest nor the dialogue service supplies them. |
| Offline voice production | `dialogue.html`; `js/dialogue-core.mjs`, `dialogue.mjs`, `production-core.mjs`, `production-queue.mjs`, `production-storage.mjs` | CSV/JSON, casting, real WAV import, take review/staleness, browser storage and ZIP backup/delivery are implemented and fixture/DOM-tested. Browser-native acceptance remains open. |
| Local speech integration | `server/dialogue-server.mjs`, `server/dialogue-provider.mjs` | Real loopback HTTP implementation with injected-provider tests. Default-disabled generation; real MiniMax responses, entitlement, sound quality and billing remain unverified. |
| Static publication | `scripts/build_pages.py`, `.github/workflows/static.yml` | Exact-head build and Pages deploy succeeded on 2026-11-11. No new public-site visual or HEAD check was performed in this review. |

The legacy experiment remains in maintenance mode with its archive decision open.
The voice workspace is a separate production candidate, not evidence that the
original all-modal/backend product has been completed. Keep these identities
separate unless an explicit product decision changes them.

Both root/server manifests and lockfiles exist. The reviewed root and server
trees no longer contain their `node_modules` directories; runtime database files
are absent from the current tracked tree. Neither fact establishes historical
purging, credential rotation or incident closure. Do not inspect old databases or
local settings to manufacture fixtures. See [the historical audit](../REPOSITORY_AUDIT.md).

## 2. Credential and request contracts

### Legacy experiment: current behavior is not the target guarantee

`App.detectMode()` checks only HTTP success from `/api/health`, then calls
`checkAuth()` or falls back to Direct Mode. It does not check a health response
schema or service identity. A static fallback returning HTML 200 can therefore
misclassify the mode. Saving a nonempty Direct key updates the UI without proving
that MiniMax accepted it.

Direct Mode reads/writes `minimax_api_key` in localStorage. The Backend facade
reads/writes `auth_token` and `refresh_token` there. These are browser-accessible,
long-lived credentials, not a secure public multi-user deployment design. Do not
confuse token refresh with provider-key rotation or a validated multi-key pool.

In `js/backend-api.js`:

- `_requestWithRetry()` permits three additional attempts after status >= 500,
  with 1/2/4-second waits. This applies to generation POSTs as well as reads and
  has no generation idempotency proof. The base request plus three retries can
  dispatch four times; token-expiry replay is a separate mechanism.
- `TOKEN_EXPIRED` calls `_tryRefreshToken()` and recursively repeats
  `_executeRequest()` without a per-request refresh/replay limit. Shared refresh
  subscribers do not make that recursion bounded.
- An otherwise unhandled 401 consumes `response.json()` in the auth branch and
  then reads it again, potentially hiding the real error with a consumed-body
  exception.
- `_pendingRequests` is created and drained but never populated in this class.
  Offline non-auth requests reject immediately. There is no implemented durable
  reconnect queue.

In `js/api.js`, the timeout is cleared after headers arrive, before
`response.json()`. It is not a complete response-body deadline. These findings
are source-review results, not newly executed legacy regression tests.

### Dialogue service: narrower, independently guarded behavior

The local service binds `127.0.0.1` and enforces exact Host/Origin checks. Its API
is limited to `/api/dialogue/status`, `/api/dialogue/generate` and the read-only
`/api/dialogue/result?operation_id=...`. It does not provide `/api/health`, legacy
login, works, image, music, chat or video routes. Static serving excludes the
legacy UI, backend code, credentials and runtime data.

Safe startup is `node server/dialogue-server.mjs` (Node 20+, no runtime npm
installation). It does not load dotenv, inspect browser keys or read
`MINIMAX_API_KEY`. Generation requires explicit enablement, entitlement
confirmation and valid budgets before the environment key is read. A ready
status means local gates passed, not that account entitlement was independently
validated by the service.

Keep the implemented limits: one in-flight request; 1–100 requests and
1–100,000 character units per process; 2,000 UTF-16 units per text; 24 KiB local
JSON request; 16 MiB returned audio; 34 MiB provider JSON; a 64 MiB cache threshold
and 256 operation records. Budgets reserve before dispatch and are not refunded
on failure. Actual returned usage may exceed a reservation and is reconciled;
the cache is checked before dispatch and can cross its threshold on a successful
result. Do not describe either as an exact monetary or peak-memory cap.

The adapter uses no automatic provider retries. The same normalized input and
`operation_id` reuse the recorded promise/outcome; changed input with the same ID
conflicts. These records, audio cache and budgets are process-local. GET recovery
never dispatches a new generation. Preserve `session_id`; a restarted process or
404 cannot establish that an earlier attempt was never billed. This is not a
provider-side idempotency guarantee.

Timeouts and transport exceptions mark uncertainty and lock new dispatches for
the rest of the process. HTTP/provider/format failures do not all carry that flag
today; `uncertain: false` must not be interpreted as a billing guarantee. Browser
pause/cancel affects local queueing, not the provider's billing or cancellation.
The queue's browser-storage conflict check is not an atomic multi-tab lock.

The adapter's fixed CN endpoint and `speech-2.8-hd` / `speech-2.8-turbo` model
names were compared with the [official synchronous speech documentation](https://platform.minimax.cn/docs/api-reference/speech-t2a-http)
on 2026-11-15. This is documentation alignment only, not a live-provider pass or
permission to change region, model, account or credentials. The 2,000-unit limit
is a local guardrail, not a claim about the provider's maximum input length.
See [PROVIDER_INTEGRATION.md](PROVIDER_INTEGRATION.md) for the detailed contract.

## 3. Media and persistence acceptance

Manual import accepts validated WAV bytes; provider output is more narrowly
checked as complete 32 kHz mono 16-bit PCM WAV. Do not substitute a successful
HTTP status, URL, metadata object or task handle for actual media validation.

A take is bound to its script/cast fingerprint. Text or casting edits make an old
take stale without deleting it. A late response must retain its original input
fingerprint. Final delivery requires current-version approved takes and matching
WAV bytes/digests. Incomplete work-package backup is a different operation and
must disclose missing audio. JSON alone cannot restore recordings; ZIP round-trip
must restore real audio bytes, not invent placeholders.

Audio uses browser-local IndexedDB; project metadata is browser-local and
unencrypted. Preserve exportable in-memory state and visible warnings on storage
failure. Do not silently overwrite another tab, clear user recordings during a
maintenance task, or claim automatic storage garbage collection. See
[OFFLINE_WORKFLOW.md](../OFFLINE_WORKFLOW.md) for format and capacity boundaries.

## 4. Verified checks and explicit gaps

Evidence: [Pages run 43038517951](https://github.com/Luckycat133/minimax-studio/actions/runs/43038517951),
[build job 130583721261](https://github.com/Luckycat133/minimax-studio/actions/runs/43038517951/job/130583721261),
for the audited SHA on **2026-11-11**. The logged Node version was 22.23.4.
These are observed existing CI results, not commands rerun by this reviewer.

| Check | Observed result | What it establishes |
| --- | --- | --- |
| `npm ci --ignore-scripts` | Passed | Root lockfile installation in that CI environment, not recovered legacy server installation. |
| `npm test` | 81 passed, 0 failed/skipped | 63 top-level tests plus 18 nested cases across dialogue, production, fake-provider and real loopback HTTP suites. No paid MiniMax request. |
| `npm run test:dom` | 33 passed, 0 failed/skipped | jsdom/fixture UI behavior and persistence/recovery checks, not native browser playback or visual acceptance. |
| `python3 -m unittest discover -s tests -v` | 10 passed | Offline bundle and Pages isolation checks, including isolated HTTP tests. Not a live public-site scan. |
| Pages build/upload | Passed; 17 assets | Allowlisted artifact prepared and uploaded. |
| Pages deploy job 130583945145 | Passed | Existing audited-main deployment completed, not feature acceptance. |
| [CodeQL run 43038517810](https://github.com/Luckycat133/minimax-studio/actions/runs/43038517810) | Success | Workflow completion, not proof of no vulnerabilities. |
| `npm run test:browser` | Not invoked by this workflow; not run in this review | Real-browser layout, native audio/download behavior and runtime CSP enforcement remain open. |
| Live provider / account / public-site smoke | Not performed in this review | Entitlement, sound quality, actual charges and current deployed-page behavior remain open. |

The same install log reported **4 high-severity dependency vulnerabilities**.
This is the dated npm summary, not a fresh advisory assessment or proof of an
exploitable production path. Triage package/advisory identity and reachability
with a fresh scoped audit; do not silently run `npm audit fix` or claim CI success
means a clean dependency audit.

For relevant runtime changes, run the commands above in an isolated checkout.
Use a fresh `_site` output; the builder intentionally rejects an existing one.
The browser suite requires an available executable, for example
`CHROME_PATH=/path/to/chromium npm run test:browser`; inspect its external-request
guards and use a fresh profile. A test script's existence is not a pass.
Historical root `test_*.mjs` scripts must be inspected before use because they may
invoke paid generation. Do not use saved browser profiles, real keys or recordings
as fixtures. Docs-only changes need source/link/diff checks, not a fictional
product-wide test run. Browser QA procedures are in
[BROWSER_QA_RUNBOOK.md](BROWSER_QA_RUNBOOK.md).

## 5. Open work and completion gates

All items below remain **open**, not implemented by this documentation update.
Priority expresses review recommendations, not authorization to broaden scope.

| Priority | Work item | Required acceptance before closure |
| --- | --- | --- |
| P0 before promoting legacy generation | Safe retry and auth error handling | Mock an accepted-but-failed POST; no blind second generation. Bound token replay, share concurrent refresh, preserve ordinary 401 errors and verify one-read response handling. Separate safe read retry from generation. |
| P0 before claiming all-modal delivery | Honest capability/mode UI | Connect and test Chat end to end or visibly disable it; label video unavailable. Validate health identity and fail with a clear mode indication. Do not mark a saved key as verified. |
| P0 for voice candidate acceptance | Real-browser fixture workflow | On supported browsers, import/preview WAV, review, edit-to-stale, export and restore actual ZIP bytes, recover interrupted results without a second POST, check layout/accessibility and CSP. Record exact revision and results; assess audible output separately. |
| P1 | Legacy media integrity | Fix `renderStoredWork()` passing `audioHex` to `renderAudioResult()` which reads `audio`; test usable restored audio. Cover response-body deadlines, empty/malformed successful responses and download normalization/cleanup. |
| P1 before dependency confidence claim | Triage logged high-severity findings | Capture a fresh audit, affected dependency paths, runtime versus tooling exposure, reviewed update and focused regressions. Do not infer resolution from Dependabot or CodeQL status. |
| P1 if broader generation is pursued | Durable operation ledger and conservative ambiguity handling | Explicitly design restart reconciliation, retention/privacy, uncertain 5xx/invalid-result handling and single-writer dispatch. Never turn lookup failure into silent generation. Current in-memory deduplication is insufficient for that claim. |
| Separate authorized acceptance | Bounded live speech trial | Confirm account/model/voice entitlement, permission to send the text and budget; record actual validated/playable output and usage without secrets. No live trial is authorized by this review. |
| Product decision required | Legacy backend recovery versus a new local multimodal service | Select scope explicitly. Recover trusted source coherently or design a reviewed replacement; do not relabel the dialogue server as recovered legacy Backend Mode. Add video only with create/poll/recover/download acceptance. |

## 6. Publication and truthful completion reports

`build_pages.py` publishes 17 explicitly allowlisted files. That artifact still
includes `index.html`, `js/api.js` and the legacy Direct-capable workbench. The
allowlist prevents repository/data exposure; it does **not** disable browser-held
keys or make Direct Mode safe for shared public use. Deciding to disable/remove
that entrypoint is a separate runtime/publication change, not a completed fix.
The local speech service is not part of Pages.

PRs build/package; pushes to protected `main` can deploy. Submit maintenance edits
on a review branch without inferring merge, deployment, credential setup, account
access or history-rewrite authority. The known 2026-11-11 deployment supersedes
old statements that initial publication is still waiting, but today's live site
and `HEAD server/data/minimax.db` still need a separately recorded smoke check.
Do not confuse an isolated test's 404 with public-site evidence.

Every handoff must state: changed files; source SHA/date; exact new checks versus
existing CI evidence; unresolved findings; browser/provider/site checks not run;
and proposed next gates. Historical `BROWSER_TEST_REPORT.md`, July audit findings
and machine-readable summaries do not override current source or dated evidence.
