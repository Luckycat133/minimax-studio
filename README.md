# MiniMax Studio

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

## Archive rule

Archive after 30–60 days if the project is unused, the backend cannot be recovered, or API changes will not be maintained.

## License

MIT
