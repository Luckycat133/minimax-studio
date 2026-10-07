# MiniMax Studio

## Current tree clarification — 2026-10-03

The root and `server/package.json` manifests now exist. The root manifest only
provides Puppeteer tooling, and `server/server.js` is still absent; no verified
backend start command has been recovered. The July audit below is historical:
its missing-manifest statements do not describe today's tree, while its backend
and live-media verification gaps remain unresolved by this documentation update.
Use the [project maintenance skill](.agents/skills/minimax-studio-maintenance/SKILL.md)
to distinguish Direct Mode, mock browser evidence and actual backend/provider
results. This check did not run a server or spend generation quota.

> **Status: Maintenance Mode — Archive decision pending**
>
> The current Git tree is not reproducibly buildable. Do not treat the Backend Mode instructions from older revisions as verified.

MiniMax Studio is a browser interface experiment for MiniMax text, image, video, speech, and music APIs.

## Current audit status

As of 2026-07-18:

- `package-lock.json` exists but the root `package.json` is missing;
- `server/package-lock.json` exists but `server/package.json` is missing;
- the previously documented `server/server.js` entry point is missing;
- historical commits include a tracked `node_modules/` tree;
- no mock API CI currently proves media-task behavior without consuming quota.

Because the exact manifests and entry point are missing, Backend Mode cannot be honestly documented as runnable. See [REPOSITORY_AUDIT.md](REPOSITORY_AUDIT.md) and [issue #2](https://github.com/Luckycat133/minimax-studio/issues/2).

## Direct Mode warning

Opening `index.html` may expose the direct browser experiment, but Direct Mode is suitable only for local personal testing:

- the API key is accessible to JavaScript running in that browser origin;
- browser `localStorage` is long-lived and is not an appropriate default for a valuable production credential;
- requests are sent directly to MiniMax;
- model names and API contracts may be stale.

Use a restricted, disposable key and remove it after testing. Do not deploy Direct Mode as a public shared site.

## Required before active use

1. Recover the exact package manifests and backend source from a trusted copy.
2. Commit lockfiles and verify `npm ci`.
3. Make Backend Mode the verified default.
4. Add mock tests for text/image/video/speech/music flows, timeouts, cancellation, polling backoff, and download recovery.
5. Record the MiniMax model-list source and verification date.
6. Remove tracked dependency trees and, after backup, clean them from history.

## Static Pages publication boundary

GitHub Pages publishes only the ten reviewed frontend files listed in
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

## Archive rule

Archive after 30–60 days if the project is unused, the backend cannot be recovered, or API changes will not be maintained.

## License

MIT
