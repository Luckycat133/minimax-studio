# Fictional-only browser workflow acceptance

## Current execution status

The latest attempt on 2026-10-06 at `cdfd2881` ended **BLOCKED_BEFORE_PAGE**:
Chromium failed `socket()` with `EPERM` before opening a page. No browser scenario
passed. The earlier CUA localhost route was also blocked; its cause is unconfirmed.
Do not bypass either restriction. Queue-storage fixes at `dae040d532c609f8afcbd0de4fb6c73660e99684`
have non-browser verification only; the supplemental acceptance below is **NOT RUN**.

This test-only change must be applied on top of the reviewed player/service
feedback fix from PR #13 (`01631e2448d056afd27d65f616247689d3ad8d65` or a descendant
containing it). The simulated player-error assertions deliberately fail against
the older UI that lacks those handlers.

## Supported runner prerequisites

- An authorized cloud runner that permits the installed official Chromium to
  start and reach its own loopback servers, with writable temporary browser
  profiles, downloads and screenshots
- Node 20+, Python 3, and the project's lockfile dependencies; no API key or
  MiniMax account is required
- A fresh output directory for each run, to avoid mistaking prior downloads or
  screenshots for this run's evidence
- The existing Chromium executable at `/usr/bin/chromium`, or an explicitly
  selected official installation via `CHROME_PATH`

Never enable the real MiniMax adapter, read credentials, sign in, or use paid
generation for this suite. Its local enabled service is a strict test double
which returns a one-second 220 Hz PCM test tone. That tone is not Chinese speech
and is not a bundled product demo voice.

## Exact execution commands

From the prepared checkout on that supported cloud runner:

```sh
npm ci --ignore-scripts
node --check tests/dialogue.browser.mjs
node --check tests/dialogue.browser.flows.mjs
node --check tests/fixtures/dialogue-browser-provider.mjs
QA_OUTPUT_DIR="$(mktemp -d /tmp/minimax-browser-results-XXXXXX)" npm run test:browser
```

`npm ci --ignore-scripts` installs the lockfile test dependencies without browser
downloads. It is unnecessary when the runner already has the same dependencies.
The test launch uses the repository's existing browser flags unchanged. If the
runner rejects browser launch or loopback access, stop and return the launch log;
do not add new flags, alter security settings, use a tunnel, or move to a Mac.

## Fixtures and flow contract

All inputs are created within this run's output/temp directories:

- `fixture-20-lines-3-roles.csv`: the original fictional Chinese sample lines,
  each suffixed with “（云端测试）”, preserving their 20 stable IDs and 3 characters
- `fixture-synthetic-tone.wav`: mono 32 kHz PCM16, one second, 220 Hz
- `fixture-invalid.wav`: 60 zero bytes for deterministic parser rejection
- `fixture-cast-queue-project.json`: the imported 20-line project with 3 explicit
  system voice assignments and no takes
- Local provider plans: held completion, explicit rate-limit failure, success,
  and malformed/incomplete audio response with a cached original result

The new browser scenarios assert:

1. CSV preview/Cancel preserves the complete production state; Apply imports all 20 lines.
   Three characters are explicitly cast. Invalid speed/pronunciation and Cancel
   preserve the complete project/cast/take state. Static generation remains disabled.
2. WAV approval, rejection, repeated import, and invalid WAV rejection preserve
   prior takes. A synthetic `error` event exercises the player's visible feedback;
   a synthetic `canplay` event exercises recovery without changing metadata. The
   error alert must actually be visible and the global notice must identify the
   affected take. Recovery must hide and clear the alert. The tiny local WAV is
   explicitly loaded with `preload=auto` before injecting the synthetic events.
3. All 20 lines receive synthetic recordings and approval; the downloaded ZIP
   contains matching bytes, 20 approved current lines, and 21 takes including the
   rejected historical take. A fresh browser context restores the same project,
   cast, review state, and browser-readable media.
4. The actual default-disabled provider is injected with credential and transport
   tripwires. A rejected generation attempt and the browser's disabled service
   controls must leave both counters at zero.
5. Mock queue additions are deduplicated and never dispatch. Pause allows only
   the held active request to finish; Cancel removes waiting work. Failed work
   retries only after explicit requeue and Start, with a fresh operation ID.
6. An uncertain original result survives reload; cancelling “另发新请求” changes
   nothing. “恢复上次结果” uses only a GET lookup for the original operation ID.
   A single-line request leaves the separate batch waiting. A changed server
   session blocks old-cache recovery before either lookup or generation.

Expected fixture totals: 6 mock generation calls, 1 read-only result lookup,
0 credential reads, 0 real-provider transport calls, 0 external browser requests.
Every browser page is configured to abort unexpected external requests. Mock
generation has an eight-call hard cap and fails on any unplanned dispatch.

## Supplemental acceptance for the queue-storage fix

Test `dae040d532c609f8afcbd0de4fb6c73660e99684` (or record the exact later commit).
The existing browser suite above does **not** cover the storage-fault scenarios
below. Run it unchanged first, and report its result separately. Do not start CI,
change workflows, use a paid provider, or touch an existing user's browser profile,
cache, keys or account. Stop on an unsupported runner instead of changing security
flags. The instructions below are a handoff, not evidence of browser execution.

### Disposable fixture setup

On an already-authorized supported runner, start `node` from the repository root
and paste this into its REPL. It reuses the existing fake provider, not the real
adapter. Keep this REPL alive while testing; commands mentioning `fx` go here.

```js
var { createDialogueServer } = await import('./server/dialogue-server.mjs');
var { createBrowserFixtureProvider, syntheticToneWav } = await import('./tests/fixtures/dialogue-browser-provider.mjs');
var { sampleProject } = await import('./js/dialogue-core.mjs');
var fs = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
var dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minimax-storage-qa-'));
var wav = syntheticToneWav(), project = sampleProject(); project.lines = project.lines.slice(0, 1);
await fs.writeFile(path.join(dir, 'one-line.json'), JSON.stringify(project));
await fs.writeFile(path.join(dir, 'fixture-tone.wav'), wav);
var fx = createBrowserFixtureProvider(wav), srv = createDialogueServer({ provider: fx.provider });
var address = await srv.start({ port: 0 }); console.log({ ...address, dir, fixture: srv.status().reason });
```

Require `fixture: SYNTHETIC_TEST_DOUBLE_ONLY`. Open the exact printed URL in a
new disposable browser profile/context with no sync/login/extensions or prior
user data. Import `one-line.json`, Preview/Apply, assign one system voice, and
save any editor changes. Network recording must show no external requests.
Use a fresh fixture process and profile for each numbered scenario; never use
`localStorage.clear()` on an existing profile. Browser-console snippets below
are permitted only on this disposable fixture origin, and only when the tester's
environment/tool rules allow DevTools script execution; otherwise mark the affected
cases BLOCKED, because this guide does not override those rules or permissions.

1. **Storage write failure before dispatch.** In the app's DevTools console:

   ```js
   var nativeSet = Storage.prototype.setItem;
   Storage.prototype.setItem = function(key, value) {
     if (this === localStorage && key === 'minimax_dialogue_queue_v2') throw new DOMException('Fixture only', 'QuotaExceededError');
     return nativeSet.call(this, key, value);
   };
   ```

   Do not call `fx.plan`. Click “生成 / 重做此条” once. Expect a visible queue-save
   failure, disabled generation/Start, unchanged line/editor input, and an exit
   warning. `fx.calls.length` and `fx.lookups.length` must both remain **0**;
   Network must contain no generation POST. Cancel any exit dialog. Restore
   `Storage.prototype.setItem = nativeSet` before disposing of this test profile.

2. **Late status response plus a detected cross-tab change.** Queue the one line
   without starting it. In app tab A's console, delay only the next status fetch:

   ```js
   var nativeFetch = window.fetch.bind(window), releaseStatus;
   window.fetch = (input, init) => input === '/api/dialogue/status'
     ? new Promise(resolve => { releaseStatus = () => resolve(nativeFetch(input, init)); })
     : nativeFetch(input, init);
   ```

   Click the batch Start button and wait until `typeof releaseStatus === 'function'`.
   Open tab B at the printed `origin` plus `/api/dialogue/status` in the **same**
   disposable profile (not another app tab, which itself normalizes the queue).
   In B's console, set `var k = 'minimax_dialogue_queue_v2'; var q = JSON.parse(localStorage.getItem(k));`
   then `q[0].status = 'cancelled'; var peerRaw = JSON.stringify(q); localStorage.setItem(k, peerRaw);`.
   In A call `releaseStatus()`. Expect the visible “其他标签页…本页未覆盖” warning,
   generation blocked, and in B `localStorage.getItem(k) === peerRaw` still true;
   fixture POST/GET counters stay **0/0**. Repeat from fresh setup with a different
   job appended instead: copy `q[0]`, give it `job_id: 99`,
   `operation_id: 'fixture-other-tab'`, `status: 'uncertain'`, `uncertain: true`.
   Preserve that entire peer snapshot too. This tests **detected** conflicts only:
   compare/set is not an atomic lock, so use one generation tab in real work.

3. **Damaged queue plus GET-only recovery.** In the fresh fixture REPL call
   `fx.plan('uncertain')`, then click single-line Generate once. Wait for “恢复上次结果”
   and record `fx.calls[0].operation_id`; expect exactly **1** fixture POST. In the
   browser console create a mixed-validity queue while preserving the valid record:

   ```js
   var k = 'minimax_dialogue_queue_v2', q = JSON.parse(localStorage.getItem(k));
   var damaged = { ...q[0], job_id: 99, operation_id: 'fixture-incomplete' }; delete damaged.fingerprint;
   var raw = JSON.stringify([...q, damaged]); localStorage.setItem(k, raw);
   ```

   Save `raw` to the evidence before reload. Reload without restarting the fixture
   server. Expect a partial-read warning, new generation disabled, and the **exact
   original raw string** unchanged. Click the valid record's “恢复上次结果” once:
   expect a playable take, still **1 total POST**, **1 GET** whose operation ID
   equals the recorded original, and unchanged raw storage. Do not click “另发新请求”.
   In separate fresh profiles also try invalid JSON and a non-array JSON object:
   preserve their exact raw strings, show a read warning, and allow **0 POSTs**.
   Missing fields must not be guessed; real uncertain requests must never be
   recreated or automatically retried to manufacture this failure.

4. **Audio and actual delivery, continuing scenario 3.** While generation stays
   locked, play the recovered one-second tone; record native `currentTime`
   advancing and whether a human actually heard it as separate observations.
   Approve the take and download “导出审核成品”; retain the real downloaded ZIP.
   Verify ZIP CRC, one approved current line, and WAV bytes/SHA-256 equal to
   `fixture-tone.wav`. In another fresh browser context import that ZIP and reload:
   the one-line project, approval, filename and playable bytes must remain. Do not
   infer real MiniMax speech from the fixture take's “MiniMax 返回” source label.

After each case record `fx.calls`, `fx.lookups`, and run `fx.assertSafe()` in the
fixture REPL; finish with `await srv.close()`. Discard only these temporary test
profiles/files. This supplement has separate per-case counters; do not add them
to the original suite's expected 6 POST / 1 GET fixture totals.

For each case return: commit, browser/Node versions, fresh-profile identifier,
steps, expected versus actual result, PASS/FAIL/BLOCKED/NOT_RUN, warning screenshot,
fixture POST/GET counts and operation IDs, raw-queue equality before/after, and
relevant Network evidence. For case 4 include the downloaded ZIP and WAV digest.
Return the first failure and remaining unrun cases honestly. No account data or
secrets belong in screenshots/logs. Native browser evidence, synthetic faults,
non-atomic-lock limits, and **real provider NOT VERIFIED** must remain distinct.

## Result and evidence contract

Return the tested Git commit and uncommitted-diff status, exact command, exit code,
browser/Node versions, full output log, and `browser-qa.json`. On a pass it must
contain `success: true`, `browser_execution: "PASS"`, empty `external_requests`
and `page_errors`, and the exact `fixture_contract` counts above.

Expected new screenshots:

- `fixture-20-lines-cast-desktop.png`
- `fixture-player-error-feedback.png`
- `fixture-20-lines-approved.png`
- `fixture-restored-20-lines.png`
- `fixture-mock-queue-session-guard.png`

Also return the original suite's desktop/mobile screenshots and independently
verified downloaded ZIPs. Inspect actual pixels before claiming visual acceptance.
If a check fails, report the first failed scenario and preserve partial artifacts;
never relabel a partial run as a pass. Browser launch failures produce
`BLOCKED_BEFORE_PAGE`; later assertion failures produce `FAIL`.

Native playback time advancing is automated playback evidence only. The player
error scenario uses a synthetic event, not a demonstrated codec failure. Neither
one proves anyone heard audio, subjective speech quality, pronunciation, real
MiniMax compatibility, account rights, quota behavior, billing, or currency costs.
Those remain separate, explicitly authorized acceptance work.
