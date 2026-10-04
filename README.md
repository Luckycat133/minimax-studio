# MiniMax Studio

> **Status: Voice-production candidate; real MiniMax use still requires account verification**
>
> This branch provides a runnable local recording workflow and a guarded MiniMax
> adapter. Live-provider compatibility and browser visual acceptance remain open.

MiniMax Studio retains its original creative-workbench identity. The legacy
multimodal experiment remains separate from the new dialogue workflow.

## Start the voice workspace

With Node 20+, no runtime installation or credentials:

```sh
node server/dialogue-server.mjs
```

Open the exact localhost URL it prints. Generation starts disabled. Import CSV,
configure cast voices, attach real WAV recordings, listen, approve/reject takes,
and export a validated audio package. A standalone HTML build is also available:

```sh
python3 scripts/build_offline.py /new/path/MiniMax_Studio_Voice_Workspace.html
```

This file supports the full local-recording workflow but cannot call MiniMax.
Only an explicitly enabled, budgeted local service can make provider requests;
the key never goes in the frontend or a public deployment. See
[workflow instructions](OFFLINE_WORKFLOW.md) and the
[provider integration guide](docs/PROVIDER_INTEGRATION.md).

## Current audit status

Rechecked against main `4968a627135d68a2dc09b838f809db43dddfc1ba` on 2026-10-04:

- root and server package manifests both exist; older audit claims that they are
  missing are stale;
- `server/server.js` and the backend business source are still absent;
- historical dependency trees are still tracked;
- the recording workflow and guarded local service have synthetic-only tests that never consume quota;
- the legacy live text/image/video/speech/music flows remain unverified.

Backend Mode cannot be honestly documented as runnable. Historical context remains
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

## License

MIT
