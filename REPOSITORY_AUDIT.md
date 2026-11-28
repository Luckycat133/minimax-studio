# Repository audit: v0.3.1 fault-recovery follow-up

Reviewed baseline: [v0.3.1](https://github.com/Luckycat133/minimax-studio/releases/tag/v0.3.1), main `3fdbb37e` ([#20](https://github.com/Luckycat133/minimax-studio/pull/20)). This follows up the 2026-07-18 reproducibility findings in [#2](https://github.com/Luckycat133/minimax-studio/issues/2). The missing manifests and absent mock coverage were observations about that historical revision, not the state of this release.

| Finding | Disposition |
| --- | --- |
| Missing package manifests | Both package manifests are present with matching lockfiles and version metadata. Root `npm ci` passed in clean CI. |
| No reproducible default Backend Mode | `npm run studio` now serves a loopback-only fixture workbench. Backend Mode is the default and fails closed if the controlled server is unavailable. No provider key or paid service is used. |
| No zero-quota verification | Offline tests cover text, image, video, speech, music and lyrics, plus shared timeout, cancellation, backoff, and recovery without replaying generation. Chromium and packaging gates passed. |
| Persistent browser credentials | Direct Mode is an explicit loopback experiment; its key lives in page memory only. This does not remove any values previously stored by historical versions. |
| Current tree tracks dependencies | Root and server `node_modules` were untracked in `7cbcc4a`; ignore rules prevent recurrence. Historical trees are unchanged. |

The [main CI and Pages run](https://github.com/Luckycat133/minimax-studio/actions/runs/45964318622) and [CodeQL](https://github.com/Luckycat133/minimax-studio/actions/runs/45964318517) passed for the v0.3.0 historical release source; do not reuse these IDs as v0.3.1 receipts. Pages package only reviewed public files. The Release's standalone voice-workspace HTML is a separate, network-disabled bundle for CSV import, local WAV takes, review and ZIP export; it does not include the localhost multimodal service. Verify its downloaded bytes using the adjacent SHA-256 manifest.

## v0.3.1 controlled Backend Mode recovery

- Real loopback HTTP proxy fixtures inject HTML 429, 502 and 504 responses; polling respects a bounded `Retry-After` or stops automatic retries. An ambiguous submission retains its opaque operation ID and is never retried as a POST.
- An intentionally short chunked WAV response must not render playback or a download. The browser buffers a bounded response, checks declared lengths and WAV chunk/PCM structure, and exposes only verified bytes as a local Blob. Reload and **恢复已有结果** read the same operation without a second generation.
- Chromium instruments the default Backend Mode during faults and recovery: no localStorage writes and no credential-bearing or external requests. Only opaque operation IDs may persist in sessionStorage. Existing historical keys are not read by this controlled operation client or erased by this feature.

Use `npm test` and `npm run test:browser:studio` to replay these checks without a paid API. These are fault-injection results against the controlled fixture system, not an online provider or historical backend acceptance claim.

## Still open, outside this release

- The original `server/server.js` and its authentication/works contract remain unrecovered. The controlled fixtures and separate `/api/dialogue/*` service do not replace that historical production contract.
- The local fixture and packaging results do not validate live provider model versions, entitlements, billing or generation quality. A live validation or legacy recovery decision requires its own scope and authorization.
- Public history and any past artifacts or caches remain unchanged. Historical dependency/data cleanup would require a separately approved, coordinated recovery and rewrite plan.


## Workbench mode boundary

`js/workbench-mode.js` owns the mode decision. The default health probe rejects redirects and non-JSON or incompatible contracts. The controlled fixture adapter runs only for its exact versioned handshake. The legacy auth client runs only for its distinct service identity; the historical server is still absent. Direct is an explicit HTTP loopback experiment, never a health failure fallback. No voice-workspace or live-provider route is changed.

For historical dependency cleanup, confirm the current main has no tracked dependency paths with `git ls-files`; inspect exact paths and sizes in a separate read-only full clone before proposing any history operation. Preserve the current release and branch identity. Do not rewrite published history or change credentials in this maintenance pass.
