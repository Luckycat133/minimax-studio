# MiniMax Studio

[![llms.txt](https://img.shields.io/badge/llms.txt-available-blue)](llms.txt)

> **Status: Voice-production candidate with local Chromium acceptance**
>
> The local recording workflow passed Chromium import, playback, review and ZIP
> round-trip checks with synthetic WAVs. Live MiniMax entitlement, generated
> speech quality, billing and deployed Pages still need verification.

MiniMax Studio retains its original creative-workbench identity. The legacy
multimodal experiment remains separate from the new dialogue workflow.

## Legacy workbench

The browser workbench has Direct Mode for image, speech, music and lyrics. It
labels chat and video as unavailable. Saving a MiniMax API key stores it in the
browser and does not contact MiniMax until a generation request.

Backend Mode requires a same-origin `GET /api/health` returning HTTP 2xx and the
JSON service identifier `minimax-studio-backend` with status `ok`. The legacy
`server/server.js` and corresponding auth, generation and works service remain
absent. The local voice service has its own `/api/dialogue/*` routes. The legacy
media and Backend client were exercised with a loopback fixture.
[Legacy workbench acceptance](docs/LEGACY_RETRY_AUTH_ACCEPTANCE.md).

## Start the voice workspace

With Node 20+, no runtime installation or credentials:

```sh
npm run dialogue
# or directly:
node server/dialogue-server.mjs
```

Open the exact localhost URL it prints (`dialogue.html` served with `/api/dialogue/*` routes backed by `server/dialogue-server.mjs` and `server/dialogue-provider.mjs`). Generation starts disabled. Import CSV,
configure cast voices, attach real WAV recordings, listen, approve/reject takes,
and export a validated audio package. A standalone HTML build is also available:

```sh
npm run build:offline
# or with a custom output path:
python3 scripts/build_offline.py /new/path/MiniMax_Studio_Voice_Workspace.html
```

This file supports the full local-recording workflow but cannot call MiniMax.
Only an explicitly enabled, budgeted local service can make provider requests;
the key never goes in the frontend or a public deployment. See the
[documentation index](docs/README.md),
[workflow instructions](OFFLINE_WORKFLOW.md), the
[provider integration guide](docs/PROVIDER_INTEGRATION.md), and the
[browser QA runbook](docs/BROWSER_QA_RUNBOOK.md).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dialogue` | Start loopback-only voice workspace server (`node server/dialogue-server.mjs`) |
| `npm test` | Run Node unit tests (`dialogue`, `production`, `dialogue-provider`, `dialogue-server`, `backend-api`) |
| `npm run test:dom` | Run jsdom DOM tests (`tests/dialogue.dom.test.mjs`) |
| `npm run test:browser` | Run Puppeteer Chromium tests for the voice workspace (`tests/dialogue.browser.mjs`) |
| `npm run test:browser:legacy` | Run Puppeteer loopback fixture tests for the legacy workbench (`tests/legacy.browser.mjs`) |
| `npm run build` | Build allowlisted GitHub Pages artifact into `_site` (`python3 scripts/build_pages.py`) |
| `npm run build:offline` | Build standalone offline voice-workspace HTML (`python3 scripts/build_offline.py`) |
| `python3 -m unittest discover -s tests -v` | Run Python packaging, offline build, and creative helper unit tests |

## AI Search & LLM Context

Machine-readable architectural specifications and API documentation adhering to [llmstxt.org](https://llmstxt.org) standards:
- [`llms.txt`](llms.txt): Concise project context, multimodal API capabilities, architecture, and security boundaries.
- [`llms-full.txt`](llms-full.txt): Complete technical specification, request/response payload schemas, error codes, and audit references.

## Current audit status

Reconciled main `e061f760ec5218d9c0985572c4c242559f4b31d7` with voice candidate
`e1347b36a6648c27c607f901399031ce9d5b5d89` on 2026-10-07:

- root and server package manifests both exist; older audit claims that they are
  missing are stale;
- `server/server.js` and the backend business source are still absent;
- root and `server/` `node_modules` were untracked from HEAD in `7cbcc4a` (historical commits still retain earlier copies until any history cleanup);
- the recording workflow and guarded local service have synthetic-only tests that never consume quota;
- the legacy live text/image/video/speech/music flows remain unverified.

Legacy Backend Mode cannot be honestly documented as runnable. Historical context remains
in [REPOSITORY_AUDIT.md](REPOSITORY_AUDIT.md) and [issue #2](https://github.com/Luckycat133/minimax-studio/issues/2).

## Direct Mode warning

Opening `index.html` may expose the direct browser experiment, but Direct Mode is suitable only for local personal testing:

- the API key is accessible to JavaScript running in that browser origin;
- browser `localStorage` is long-lived and is not an appropriate default for a valuable production credential;
- requests are sent directly to MiniMax;
- model names and API contracts may be stale.

Do not enter a valuable key into the legacy experiment. Do not deploy Direct Mode as a public shared site. The new offline workflow does not read or use those legacy credentials.

## Remaining legacy multimodal work

1. Recover and verify the backend source from a trusted copy; the manifests already exist.
2. Commit lockfiles and verify `npm ci`.
3. Make Backend Mode the verified default.
4. Add mock tests for text/image/video/speech/music flows, timeouts, cancellation, polling backoff, and download recovery.
5. Record the MiniMax model-list source and verification date.
6. Remove tracked dependency trees and, after backup, clean them from history.

## Static Pages publication boundary

GitHub Pages packages only the 17 explicitly allowlisted frontend files listed in
`scripts/build_pages.py`. The workflow never uploads the
repository root, backend, runtime data, dependencies, screenshots, or local settings.
New public assets require an explicit allowlist change.

Validate and prepare a fresh artifact with Python 3 (no npm install or API key needed):

```sh
python3 -m unittest discover -s tests -v
python3 scripts/build_pages.py
```

The build refuses an existing `_site` directory to prevent stale files from being
published. Use a fresh checkout for each build. Pull requests validate and package
the artifact; only the protected `main` branch can deploy it. Existing review and
Pages environment protections still apply.

Runtime database files are ignored and no longer tracked in new commits. This
does **not** remove previous copies from public Git history, old artifacts, caches,
or downloads, and does not establish whether they contained sensitive data.
After the approved merge and successful Pages deployment, verify that the site
and its CSS/JavaScript still load and that a HEAD request to
`server/data/minimax.db` returns 404. Until then, the previous site remains live.
This publication fix does not resolve the Direct Mode or backend limitations above.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history (starting at `v0.1.0` through `v0.2.1`).

## License

MIT
