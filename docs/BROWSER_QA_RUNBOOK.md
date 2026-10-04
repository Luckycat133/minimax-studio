# Fictional-only browser workflow acceptance

## Current execution status

The expanded browser suite is **PREPARED, NOT RUN** as of 2026-10-04. Syntax, diff,
module-import and pure fixture smoke checks passed; no server or browser was
started for those checks. The current cloud runner blocks
the CUA localhost route and denies Chromium's required IPC socket creation.
Do not bypass those restrictions or report this preparation as a browser pass.

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
