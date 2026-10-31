# Guarded local MiniMax speech integration

Last contract review: **2026-10-04**. Node.js 20+; no extra runtime dependencies.

This is runnable local integration code with **synthetic-only verification**. No
MiniMax account was accessed, no credential was discovered or saved, and no paid
request was made during implementation. Provider entitlement, actual response
compatibility, voice quality, commercial suitability and billing remain unverified.
The original legacy backend and `index.html` are separate experiments.

## Start safely

From the repository root:

```sh
node server/dialogue-server.mjs
```

Open the exact printed URL, normally
`http://127.0.0.1:4173/dialogue.html`. `--port 0` selects an available loopback port.
This default does not read `MINIMAX_API_KEY`, any `.env`, browser storage or any
credential file. Generation is disabled and does not contact MiniMax. The service
uses Node's built-in HTTP server and always binds **127.0.0.1**. There is no host
flag, public listener, reverse proxy, tunnel or endpoint override.

The server serves only `dialogue.html`, two CSS files, and `js/dialogue*.mjs` /
`js/production*.mjs` frontend modules. It refuses symlinks and traversal. Backend
source, `.env`, repositories, dependency trees and legacy UI are not served.

## Deliberate activation, only after separate authorization

Before anyone enables generation, they must verify on the official MiniMax
account that the selected API key and plan allow speech synthesis, available quota
or balance, and what happens when included quota is exhausted. A local character
cap is **not a currency cap** and does not change provider billing or purchased
credit behavior. Confirm authority to send the selected script and pronunciation
entries to MiniMax. Do not use sensitive or third-party-confidential text without
appropriate authorization.

Only after those checks, an operator with an already-authorized key in their
process environment may explicitly run, for example:

```sh
node server/dialogue-server.mjs --enable-generation --entitlement-confirmed --max-requests 3 --max-characters 600
```

The key is supplied by the operator as the existing `MINIMAX_API_KEY` environment
variable, never a CLI argument or browser form. This guide does not authorize
acquiring, discovering, saving or configuring credentials. The service does not
load dotenv files or create persistent account access. It reads the key only
once, after **all three gates** pass: explicit enablement, entitlement confirmation,
and valid request/character budgets. Missing/invalid keys leave generation disabled.
No request is sent simply by starting the process or opening the page.

Allowed per-process budget ranges are 1–100 requests and 1–100,000 characters.
One request is dispatched at a time. A conservative reservation counts UTF-16
text length plus pronunciation entry lengths, and is committed before dispatch.
Failures, rate limits, invalid audio and timeouts do not refund it. If returned
usage exceeds the reservation, the larger usage is recorded before the next call.
These are local guardrails, not a guarantee about the provider's charging formula.

## API contract

All API routes are same-origin only. Use the exact `127.0.0.1:<actual-port>` Host;
`localhost`, other hosts/ports, foreign Origins and `Origin: null` are rejected.
Every generation POST also requires `Origin: http://127.0.0.1:<actual-port>`.
No CORS headers or cross-origin preflight permissions are provided. The browser
sets this header for same-origin requests automatically.

### GET /api/dialogue/status

```json
{
  "enabled": false,
  "reason": "generation_disabled",
  "session_id": "<public random ID for this process session>",
  "budget": {
    "max_requests": 0,
    "used_requests": 0,
    "max_characters": 0,
    "used_characters": 0
  },
  "endpoint": "https://api.minimax.cn/v1/t2a_v2",
  "model": "speech-2.8-hd"
}
```

`enabled` also becomes false when a budget, cache or operation-record limit is
reached or a provider outcome is uncertain. No key, request headers, account
metadata or raw provider error messages appear in this response.

### GET /api/dialogue/result?operation_id=…

This is a **read-only recovery endpoint**. It returns the exact recorded result,
including its original HTTP status and error body. If the operation is still
running, the lookup awaits that same operation. It never dispatches a request,
reserves budget, creates an operation or unlocks an uncertain session. Recovery
works even after the budget is exhausted or a transport outcome is uncertain.
An absent operation returns HTTP 404 / `operation_not_found`; invalid or duplicate
query fields return HTTP 400. Exactly one `operation_id` parameter is accepted.
Host and any supplied Origin must match the local service, as for status requests.

Keep the public `session_id` from status alongside each queued operation. It is
stable for this running service and changes on a fresh service instance. It is
not a credential. A different session ID means old results cannot be recovered
from this process. A 404 does **not** prove that the previous process never sent
or billed an operation. Do not replace a lookup with a fresh generation request.

### POST /api/dialogue/generate

Requires uncompressed `application/json` (optional UTF-8 charset), a maximum body
of 24 KiB, and these fields only:

```json
{
  "operation_id": "SC01_L001-r0001-attempt-001",
  "text": "这件旧物，似乎还留着昨天的温度。",
  "voice_id": "male-qn-qingse",
  "model": "speech-2.8-hd",
  "speed": 1,
  "pitch": 0,
  "emotion": "calm",
  "pronunciation": ["处理/(chu3)(li3)"]
}
```

- `operation_id`: 1–128 ASCII letters/digits/dots/colons/underscores/hyphens;
  first character must be alphanumeric
- `text`: nonblank, at most 2,000 UTF-16 units, without unsupported controls
- `voice_id`: a bounded provider ID; official IDs can contain spaces and parentheses
- `model`: `speech-2.8-hd` or `speech-2.8-turbo`, default HD
- `speed`: numeric 0.5–2, default 1; `pitch`: integer −12–12, default 0
- `emotion`: empty/default or `happy`, `sad`, `angry`, `fearful`, `disgusted`,
  `surprised`, `calm`, `fluent`
- `pronunciation`: up to 32 `word/replacement` tone strings, each at most 200 units

Optional fields normalize to the documented defaults. Tone entries are passed to
`pronunciation_dict.tone`; they are not arbitrary performance notes. Voice IDs are
never interpreted as URLs. The adapter does not clone voices, create voices or
verify rights to any custom voice ID. Use the UI's reviewed system voice choices.

The adapter fixes the destination to MiniMax's CN T2A endpoint and requests
non-streaming, hex-encoded WAV, mono, 32,000 Hz. It uses Bearer authentication only
server-side, disables redirects, and never retries automatically. The response
must contain successful provider status, completed audio, valid hex and usage.
Bytes are checked for a complete RIFF/WAVE structure, 16-bit PCM, mono, 32 kHz,
consistent size/rates and nonempty aligned sample data. No silence, placeholder
or fabricated production audio is generated if the provider fails.

A verified success has HTTP 200 and this shape:

```json
{
  "operation_id": "SC01_L001-r0001-attempt-001",
  "audio": {
    "base64": "<verified WAV bytes encoded as base64>",
    "mime": "audio/wav",
    "format": "wav",
    "sha256": "<64 lowercase hex digits>",
    "duration_ms": 1000
  },
  "usage_characters": 20
}
```

The digest and duration are derived from the actual WAV bytes, not trusted provider
labels. Provider audio is capped at 16 MiB and provider response JSON at 34 MiB.
Errors have `{ "operation_id": "…", "error": { "code": "…", "message": "…",
"uncertain": false } }`; pre-validation errors may omit the operation ID.
HTTP 400/413/415 indicates bad input; 409 indicates conflict/busy/local budget;
429 indicates provider rate limiting; 502 indicates provider/transport/format
failure; 503 indicates disabled service; 504 indicates timeout.

## Duplicate operations and uncertain outcomes

Within one process, a repeated valid `operation_id` with equivalent normalized
input gets the exact original result, including failed and uncertain outcomes.
If the first call is still running, duplicates await it. Reusing the ID with
changed input returns `operation_conflict`; it never creates another call.
A busy/budget-rejected operation is also remembered. An explicit new user action
requires a new operation ID; the server never silently turns a failed attempt
into a newly charged attempt.

A 60-second timeout covers connection and response-body reading. It aborts the
local fetch and marks the result **uncertain**, because MiniMax may already have
processed or billed it. Transport exceptions are also uncertain. New dispatches
are then locked for the rest of that process. Inspect account usage and the failed
operation before deciding whether a new session or intentional retry is appropriate.
An abort is not proof that the provider canceled billing.

Budgets, verified audio and up to 256 operation records exist **in memory only**.
The audio cache has a 64 MiB guard, with at most one bounded response beyond that
threshold. No server-side audio, script, key or idempotency record is written to
disk. Restarting resets counters and **loses duplicate protection**; never use a
restart as an automatic retry or to bypass an agreed budget. Recover an existing
result through the read-only result endpoint with the same operation ID and
session ID while that process is still alive. Save/export
accepted audio in the frontend before closing the session.

## Frontend isolation

Only this local server's HTML response gets `data-local-service="true"` on the
body. It removes the offline-only meta CSP from that response and sends a response
CSP allowing `connect-src 'self'` and `media-src 'self' blob:`. Scripts/styles must
remain same-origin; framing, objects, base overrides and form submission are
blocked. All responses are noncacheable and nosniff. Static/offline builds retain
their own restrictive policy and must not attempt provider requests.

This is a single-user loopback tool, not an authenticated multi-user service.
Host/Origin/CSP checks protect browser cross-site/rebinding paths; they do not
protect against malicious local software with access to the same machine. Do not
expose it through port forwarding or public hosting.

## Verification

```sh
node --test tests/dialogue-provider.test.mjs tests/dialogue-server.test.mjs
node server/dialogue-server.mjs --help
```

Tests inject a fake key loader and fake transport. Synthetic WAV fixtures are only
parser/transport test inputs; they are not user-deliverable speech. Tests cover
credential non-reading, all enablement gates, exact outbound payload, reservation
before dispatch, duplicate success/error/timeout outcomes, one in-flight call,
limits, provider error sanitization, malformed JSON/hex/WAV, timeout uncertainty,
loopback HTTP, CSRF/rebinding guards, static isolation and the default disabled
state. The real provider path remains intentionally untested with an actual account.

## Official sources

- [MiniMax synchronous speech API](https://platform.minimax.cn/docs/api-reference/speech-t2a-http):
  request/response fields, supported models, authentication, output encoding
- [MiniMax system voice IDs](https://platform.minimax.cn/docs/faq/system-voice-id):
  source for system voice selection; a voice listing is not an entitlement check
- [MiniMax Token Plan](https://platform.minimax.cn/subscribe/token-plan):
  check the current plan, usage limits and purchased-credit behavior before enabling

Provider behavior and plan rules can change. Recheck these sources and account
state before activating real generation; this file is not proof of authorization.
