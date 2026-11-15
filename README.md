# MiniMax Studio

[![llms.txt](https://img.shields.io/badge/llms.txt-available-blue)](llms.txt)

> **Status: Voice-production candidate; legacy multimodal workbench remains partial**
>
> The local recording workflow and guarded speech adapter are implemented and
> synthetic-tested. Real-browser and live-provider acceptance remain open.

MiniMax Studio retains its original creative-workbench identity. The legacy
multimodal experiment remains separate from the new dialogue workflow.

## Current tree clarification — 2026-11-15

Reviewed `main` at `5d57027b4b91743e01795f7e0b00f547bd5f952a`.
Root and server manifests and lockfiles exist. The root manifest provides fixture,
DOM and browser test scripts, builds and a local dialogue-service command.
The legacy `server/server.js` entrypoint and corresponding business routes remain
absent. The new `server/dialogue-server.mjs` does not recover that backend.

The legacy image, speech, music and lyrics frontend dispatch/render paths exist,
but were not live-provider-verified by this review. Chat has navigation,
configuration and an API helper but is not connected through the application's
generation/result branches. Video has no implemented create/poll/result flow in
the reviewed workbench. Do not treat the repository description as a feature pass.
The legacy experiment remains in maintenance mode, with its archive decision open.

Use the [project maintenance skill](.agents/skills/minimax-studio-maintenance/SKILL.md)
and [maintenance ledger](docs/MAINTENANCE.md) to distinguish the legacy Direct/Backend
experiment, offline voice workspace and guarded local speech service. Source,
fixture/CI, browser, live-provider and publication evidence are separate.

## Start the voice workspace

With Node 20+, no runtime installation or credentials:

```sh
node server/dialogue-server.mjs
```

Open the exact loopback URL it prints (`127.0.0.1`, not an interchangeable host).
Generation starts disabled. Import CSV, configure cast voices, attach real WAV
recordings, listen, approve/reject takes, and export a validated audio package.
A standalone HTML build is also available:

```sh
python3 scripts/build_offline.py /new/path/MiniMax_Studio_Voice_Workspace.html
```

This file supports the full local-recording workflow but cannot call MiniMax.
Only an explicitly enabled, budgeted local service can make provider requests;
the key never goes in the frontend or a public deployment. See
[workflow instructions](OFFLINE_WORKFLOW.md) and the
[provider integration guide](docs/PROVIDER_INTEGRATION.md).

## AI Search & LLM Context

Machine-readable project context is available in [`llms.txt`](llms.txt) and
[`llms-full.txt`](llms-full.txt). Historical capability/API descriptions in these
summaries are not delivery evidence; current source and the dated
[maintenance ledger](docs/MAINTENANCE.md) take precedence.

## Current audit status

The existing [2026-11-11 CI run](https://github.com/Luckycat133/minimax-studio/actions/runs/43038517951)
for the reviewed SHA passed root `npm ci --ignore-scripts`, 81 Node tests,
33 DOM tests, 10 Python tests, the 17-asset build, and Pages deployment.
These are inspected existing CI results, not new local runs by this reviewer.
The workflow does not invoke `npm run test:browser`; real-browser layout,
playback/downloads and live MiniMax use remain unverified by this review.
The install log also reported four high-severity dependency vulnerabilities,
which need scoped triage rather than an assumption that successful CI is clean.

Both manifests and lockfiles are present. Root/server dependency directories and
runtime databases are absent from the reviewed current trees; this is not a
history purge. The guarded local service has synthetic provider and actual
loopback HTTP tests, but is not the missing legacy business backend. Historical
context is retained in [REPOSITORY_AUDIT.md](REPOSITORY_AUDIT.md) and
[issue #2](https://github.com/Luckycat133/minimax-studio/issues/2).

## Direct Mode warning

Opening `index.html` may expose the direct browser experiment, but Direct Mode is suitable only for local personal testing:

- the API key is accessible to JavaScript running in that browser origin;
- browser `localStorage` is long-lived and is not an appropriate default for a valuable production credential;
- requests are sent directly to MiniMax;
- model names and API contracts may be stale.

Do not enter a valuable key into the legacy experiment. Do not deploy Direct Mode
as a public shared service. The current Pages artifact still includes the legacy
entrypoint: its file allowlist does not disable Direct Mode or secure browser-held
keys. The new offline workflow does not read or use those legacy credentials.

## Remaining development work

The detailed priorities and closure criteria are in [MAINTENANCE.md](docs/MAINTENANCE.md).

1. Complete real-browser fixture acceptance of the voice workflow, then perform a separately authorized, bounded live speech trial if in scope.
2. Make legacy capability/mode reporting truthful; wire and test Chat or visibly disable it, and do not advertise video as delivered.
3. Separate safe read retries from generation POSTs, bound token-expiry replay and fix 401 response parsing. The existing reconnect map is not a working recovery queue.
4. Fix legacy restored-audio and response-body timeout handling, with fake-key media and download regressions.
5. Decide explicitly whether to recover trusted legacy backend source or build a reviewed local multimodal service. Existing lockfiles and the dialogue service do not settle that decision.
6. Triage the logged dependency findings. Keep current-tree hygiene separate from any separately authorized, backed-up history cleanup.

## Static Pages publication boundary

GitHub Pages packages only the 17 explicitly allowlisted frontend files listed in
`scripts/build_pages.py`. The workflow never uploads the repository root, backend,
runtime data, dependencies, screenshots, or local settings. New public assets
require an explicit allowlist change. The local dialogue service is not deployed
by Pages.

Validate and prepare a fresh artifact with Python 3 (no npm install or API key needed):

```sh
python3 -m unittest discover -s tests -v
python3 scripts/build_pages.py
```

The build refuses an existing `_site` directory to prevent stale files from being
published. Use a fresh checkout for each build. Pull requests validate and package
the artifact; only the protected `main` branch can deploy it. Existing review and
Pages environment protections still apply.

The audited main revision's build and deployment succeeded on 2026-11-11. This
review did not repeat live-site checks: loading the published HTML/CSS/JavaScript
and checking that `HEAD server/data/minimax.db` returns 404 remain separate smoke
steps. An isolated CI server's 404 is not evidence about the current public site.

Runtime database files are ignored and absent from the current tracked tree.
This does **not** remove copies from public Git history, old artifacts, caches or
downloads, or establish whether they contained sensitive data. Artifact isolation
does not resolve the Direct Mode, legacy backend or feature limitations above.

## License

MIT
