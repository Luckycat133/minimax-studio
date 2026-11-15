# Repository Audit

## Current reconciliation — 2026-11-15

Source: `main` at `5d57027b4b91743e01795f7e0b00f547bd5f952a`.
The July snapshot below is preserved as history, not the current delivery status.
See [the maintenance ledger](docs/MAINTENANCE.md) for acceptance gates and evidence.

| Check | Current result |
| --- | --- |
| Root/server manifests and lockfiles | All present. Root has test/build/dialogue scripts. |
| Legacy `server/server.js` and matching business routes | Still absent. Do not claim a recovered legacy Backend Mode. |
| New local service | `server/dialogue-server.mjs` and `dialogue-provider.mjs` exist; loopback-only, default-disabled generation. Not the legacy backend. |
| Legacy capabilities | Image/speech/music/lyrics have frontend dispatch paths. Chat is partially wired; video flow is not implemented in the reviewed workbench. Live generation remains unverified. |
| Automated synthetic checks | Existing exact-head CI: 81 Node tests, 33 DOM tests and 10 Python tests passed on 2026-11-11. This review inspected logs; it did not rerun these locally. |
| Real-browser / live-provider acceptance | Not established by that CI or this review. |
| Current dependency trees | Root `node_modules/` and `server/node_modules/` are absent from the reviewed trees. No historical purge is established. |
| Current runtime databases | Absent from the current tracked tree; this does not establish that historical copies were sanitized. |
| Pages publication | Exact-head build and deploy succeeded in run 43038517951; current public-site visual/HEAD checks were not repeated. |
| Dependency security | The same install log reported 4 high-severity vulnerabilities; packages and reachability still require scoped triage. |

Evidence: [build and deployment run](https://github.com/Luckycat133/minimax-studio/actions/runs/43038517951).
The legacy retry/reconnect implementation is not a safe generation guarantee;
see the source-backed defects in [MAINTENANCE.md](docs/MAINTENANCE.md).
No runtime fixes, paid calls, credentials, publishing changes or history rewrites
are authorized or completed by this reconciliation.

---

## Historical snapshot — 2026-07-18 (superseded where noted above)

### Reproducibility blockers recorded then

| Check | Historical result |
| --- | --- |
| Root lockfile | Present |
| Root package manifest | Missing |
| Server lockfile | Present |
| Server package manifest | Missing |
| Documented server entry point | Missing |
| Automated mock tests | Missing |
| Historical tracked dependencies | Present |

A lockfile without its matching manifest is not a sufficient basis for reconstructing author intent. Do not synthesize a new production manifest merely from transitive lock data.

### Recovery evidence required

- trusted local source copy or a reviewed historical revision;
- exact root and server manifests;
- exact backend entry point;
- successful clean `npm ci`;
- no real MiniMax key in CI;
- mock success, timeout, cancellation, polling, error, and download-recovery tests.

### Security notes

Backend Mode should be the recommended deployment once recovered. Direct Mode must remain explicitly experimental, and long-lived API keys should not be stored in browser `localStorage` by default.

### History cleanup

The historical `.gitignore` change prevented new dependency directories, but did
not itself remove tracked `node_modules/` from old commits. Current-tree cleanup
and history sanitization are different tasks. Any history rewrite requires a
verified backup and coordinated re-clone; no such rewrite was performed here.
