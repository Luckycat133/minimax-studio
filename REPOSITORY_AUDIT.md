# Repository audit: v0.3.0 follow-up

Baseline: [v0.3.0](https://github.com/Luckycat133/minimax-studio/releases/tag/v0.3.0) at `ea36ba68`, merged in [#18](https://github.com/Luckycat133/minimax-studio/pull/18). This follows up the 2026-07-18 reproducibility findings in [#2](https://github.com/Luckycat133/minimax-studio/issues/2). The missing manifests and absent mock coverage were observations about that historical revision, not the state of this release.

| Finding | v0.3.0 disposition |
| --- | --- |
| Missing package manifests | Both package manifests are present with matching lockfiles and version metadata. Root `npm ci` passed in clean CI. |
| No reproducible default Backend Mode | `npm run studio` now serves a loopback-only fixture workbench. Backend Mode is the default and fails closed if the controlled server is unavailable. No provider key or paid service is used. |
| No zero-quota verification | Offline tests cover text, image, video, speech, music and lyrics, plus shared timeout, cancellation, backoff, and recovery without replaying generation. Chromium and packaging gates passed. |
| Persistent browser credentials | Direct Mode is an explicit loopback experiment; its key lives in page memory only. This does not remove any values previously stored by historical versions. |
| Current tree tracks dependencies | Root and server `node_modules` were untracked in `7cbcc4a`; ignore rules prevent recurrence. Historical trees are unchanged. |

The [main CI and Pages run](https://github.com/Luckycat133/minimax-studio/actions/runs/45964318622) and [CodeQL](https://github.com/Luckycat133/minimax-studio/actions/runs/45964318517) passed for the release source. Pages package only reviewed public files. The Release's standalone voice-workspace HTML is a separate, network-disabled bundle for CSV import, local WAV takes, review and ZIP export; it does not include the localhost multimodal service. Verify its downloaded bytes using the adjacent SHA-256 manifest.

## Still open, outside this release

- The original `server/server.js` and its authentication/works contract remain unrecovered. The controlled fixtures and separate `/api/dialogue/*` service do not replace that historical production contract.
- The local fixture and packaging results do not validate live provider model versions, entitlements, billing or generation quality. A live validation or legacy recovery decision requires its own scope and authorization.
- Public history and any past artifacts or caches remain unchanged. Historical dependency/data cleanup would require a separately approved, coordinated recovery and rewrite plan.
