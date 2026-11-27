# MiniMax Studio

[![llms.txt](https://img.shields.io/badge/llms.txt-available-blue)](llms.txt)

> **Status: Voice-production candidate with local Chromium acceptance**
>
> The local recording workflow passed Chromium import, playback, review and ZIP
> round-trip checks with synthetic WAVs. Live MiniMax entitlement, generated
> speech quality and billing were not tested. The reviewed static Pages build
> and deployment passed on v0.3.0.

MiniMax Studio retains its original creative-workbench identity. The legacy
multimodal experiment remains separate from the new dialogue workflow.

## Start the controlled local workbench

With Node 22+:

```sh
npm run studio
```

Open the printed `http://127.0.0.1:4174` URL. Text, image, video, speech, music
and lyrics use deterministic local fixtures. This server does not read a provider
credential, allow external network requests, or send any paid requests. Media are
synthetic previews, not genuine model generations. Starting or canceling an operation requires exact same-origin access.
An unavailable backend disables generation; the page never falls back to Direct Mode.

Use **恢复已有结果** to retrieve an existing operation after a browser timeout
or reload; polling uses bounded backoff and never resubmits generation. Session
storage holds opaque operation IDs, not prompts or credentials. Download recovery
is limited to the same running local server and the operation's 30-minute lifetime.
Cancellation prevents a pending local operation from completing; it does not
represent paid-provider cancellation.

The controlled service deliberately does not restore the historical
`server/server.js` authentication/works implementation. Its routes are separate
from the voice service's `/api/dialogue/*` routes.
[Legacy fixture acceptance](docs/LEGACY_RETRY_AUTH_ACCEPTANCE.md).

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

You can also download the standalone HTML and SHA-256 manifest from the
[v0.3.0 Release](https://github.com/Luckycat133/minimax-studio/releases/tag/v0.3.0).
This file supports the local-recording workflow but cannot call MiniMax.
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

The [historical repository audit](REPOSITORY_AUDIT.md) documents the missing
historical auth/works backend. The new controlled multimodal entry point does not
claim to restore that service or validate live provider model contracts.

## Explicit Direct Mode experiment

A separately served loopback static copy can opt in using
`http://127.0.0.1:<port>/index.html?mode=direct-experiment`. Public Pages never
enable this mode. The controlled localhost server intentionally blocks outbound
connections even with the experiment flag.

Do not use a valuable key; Direct Mode sends requests to MiniMax and may incur
charges. The key is held only in page memory and cleared by reload; this code
neither reads nor writes the historical `minimax_api_key` localStorage key.
If you previously used that experiment, clear old site data separately when
appropriate. Text and video in this project are available only as backend fixtures.

## Static Pages publication boundary

GitHub Pages packages only the 19 explicitly allowlisted frontend and documentation files listed in
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
The controlled localhost server and fixtures are not published to Pages.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and the
[repository audit](REPOSITORY_AUDIT.md) for resolved and remaining findings.

## License

MIT
