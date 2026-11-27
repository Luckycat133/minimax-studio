# Legacy Backend retry and auth acceptance

Local verification on 2026-11-15 used Node 26.13.1 and the working tree based on
`5d57027b4b91743e01795f7e0b00f547bd5f952a`. The tests load the actual browser
facade with synthetic storage and a mocked `fetch`. All requests use a fixture
origin.

In a disposable copy of the base revision, the mock accepted a generation POST
and returned 502. The original client dispatched the request four times. The
same fixture received it once with the fix. A simulated connection loss after
receipt also produced one dispatch. GET and HEAD have up to three retries after
transport or HTTP 5xx failures, with delays of 1, 2 and 4 seconds.

An ordinary 401 now keeps its original HTTP status, code, message and quota after
one response-body read. Parallel requests and late 401 responses for the same
token version share one refresh. Each request replays at most once after an
explicit `TOKEN_EXPIRED` response, with the same body. A failed refresh expires
the current session once. A refresh response from an older session cannot replace
credentials or replay a request into the new session.

| Command or check | Result |
| --- | --- |
| `node --check js/backend-api.js` | Passed |
| `node --test tests/backend-api.test.mjs` | 10 passed |
| `npm test` | 91 passed |
| `npm run test:dom` | 33 passed |
| `python3 -m unittest discover -s tests -v` | 10 passed |
| `build_pages()` into a temporary directory | 17 allowlisted assets, with the facade copied byte-for-byte |
| `CHROME_PATH=<installed Chrome> npm run test:browser:legacy` | Six end-to-end checks in Chrome 157.0.8103.51 |

All test counts have zero failures and skips on the patched tree. Both request
clients keep the deadline active while reading the body. A timed-out
generation reports an unknown result and issues one POST. A malformed or empty
successful response shows an error. Backend Mode admits a same-origin
`application/json` response to `/api/health` with
`{"service":"minimax-studio-backend","status":"ok"}`. A redirect, wrong
identifier or stalled body falls back to Direct Mode.

The Chromium fixture exercised key save and reload, disabled chat and video,
image rendering from Base64, native audio playback from both hex and URL,
byte-identical WAV download, object URL revocation, and saved works through a
mock login. URLs supplied by the backend open as media links. Inline bytes use
a local download. Corrupt saved hex shows a visible load error. The official
voice and music APIs document both URL and hex result formats.
[Speech API](https://platform.minimax.cn/docs/api-reference/speech-t2a-http),
[Music API](https://platform.minimax.io/docs/api-reference/music-generation).

The initial npm audit reported four high-severity entries in the browser test
dependency tree. The revised lockfile resolves Puppeteer and Puppeteer Core
25.17.0, Chromium BiDi 157.0.8090-0 and Zod 4.6.7. A fresh lockfile install,
both Chromium suites, and the audit passed. The current audit returned zero
known advisories for this lockfile on 2026-11-15.

The repository still lacks the legacy service entry point. Real authentication,
MiniMax generation and billing, and deployed Pages behavior remain open.
