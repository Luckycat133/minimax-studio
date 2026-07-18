# Repository Audit — 2026-07-18

## Reproducibility blockers

| Check | Result |
| --- | --- |
| Root lockfile | Present |
| Root package manifest | Missing |
| Server lockfile | Present |
| Server package manifest | Missing |
| Documented server entry point | Missing |
| Automated mock tests | Missing |
| Historical tracked dependencies | Present |

A lockfile without its matching manifest is not a sufficient basis for reconstructing author intent. Do not synthesize a new production manifest merely from transitive lock data.

## Recovery evidence required

- trusted local source copy or a reviewed historical revision;
- exact root and server manifests;
- exact backend entry point;
- successful clean `npm ci`;
- no real MiniMax key in CI;
- mock success, timeout, cancellation, polling, error, and download-recovery tests.

## Security notes

Backend Mode should be the recommended deployment once recovered. Direct Mode must remain explicitly experimental, and long-lived API keys should not be stored in browser `localStorage` by default.

## History cleanup

The current `.gitignore` prevents new dependency directories, but it does not remove tracked `node_modules/` content from existing commits. Any history rewrite requires a verified backup and coordinated re-clone.
