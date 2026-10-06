# MiniMax Studio voice workspace v2

This version replaces the text-only dead end with a working **recording-to-delivery**
workflow and a separately guarded local MiniMax integration. It does not claim that
real MiniMax output, account entitlement, billing or voice quality was tested.

## Two usable entry points

### Single-file workspace, no server

```sh
python3 scripts/build_offline.py /new/path/MiniMax_Studio_Voice_Workspace.html
```

Open that HTML file in a modern browser. It contains the full editor, casting,
WAV import, real audio player, review, queue planning and ZIP restore/export.
There are no bundled fake/sample voices. The bundled CSP uses script/style hashes,
blocks connections (`connect-src 'none'`), and allows local blob audio playback.
Generation is unavailable in this mode; its buttons explain why.

### Local service, disabled by default

```sh
node server/dialogue-server.mjs
# or npm run dialogue
```

Node 20+ is required. No npm install is needed for this runtime. Open the exact
printed loopback URL, normally `http://127.0.0.1:4173/dialogue.html`.
This safe startup does not read a key, dotenv file or credential store and does
not call MiniMax. It serves only the reviewed frontend, binds 127.0.0.1 and rejects
foreign Host/Origin requests. The legacy backend/UI remain separate.

Read [the provider integration guide](docs/PROVIDER_INTEGRATION.md) before enabling
anything. Account rights, credit fallback and explicit bounded authority must be
settled first. No credential or live-generation authorization was inferred during
this work. Existing single-Token-Plan-key constraints remain unchanged.

## Production flow

1. Import UTF-8 CSV by stable `line_id`, restore a project JSON, or restore this
   tool's ZIP work package. Preview and Apply are separate. CSV merges atomically;
   omitted rows stay, omitted optional fields retain previous notes, explicit
   empty cells clear them. JSON/ZIP replace the project after review.
2. Configure each character's official system voice, model, speed, pitch,
   supported provider emotion and pronunciation dictionary. There is no implicit
   voice assignment. The sample has 20 original fictional Chinese lines / 3 roles.
3. Import a real WAV for the selected line, or explicitly generate that line once
   the local service is authorized. WAV bytes, chunk structure, sample parameters
   and SHA-256 are validated. A player appears only when real bytes exist.
4. Listen and approve or reject each take. New takes keep prior recordings.
   Editing text or casting makes old takes stale. A late provider result retains
   its original request fingerprint and cannot become a current approved take.
5. “导出审核成品” refuses any current line lacking a valid, approved take.
   “备份工作包” permits incomplete work and explicitly reports unresolved lines.
   Both include lossless project metadata, CSV, manifest and actual available WAVs.
6. Restore a work-package ZIP to another browser and recover its bytes, casting,
   versions and review state. JSON alone is metadata and cannot restore sound.

Manual recordings do not require a provider voice assignment. Assigning a new
voice afterwards changes the rendering intent and makes old takes stale; review
again by importing or generating the intended new take.

## Queue and recovery

- Adding items never starts them. The batch starts only with its own Start button.
- “生成 / 重做此条” runs that one line, even when a separate batch is waiting.
- Work is sequential. Pause finishes the active request then stops; Cancel removes
  waiting work only. It does not pretend that a sent request has been unbilled.
- Provider errors pause remaining jobs. Nothing automatically retries or starts
  after reload. Interrupted requests appear as uncertain.
- “恢复上次结果” fetches the original operation's cached result with a read-only GET;
  it never dispatches a new provider request. Session IDs prevent pretending that
  a restarted server still retains the old cache.
- A distinct new generation uses a fresh operation ID. If the old result is
  uncertain, the UI warns that a new request may incur another charge.
- Per-process idempotency and request/character budgets reset on server restart.
  They are local safeguards, not a currency cap or provider billing guarantee.
- Queue saves check the last observed browser-storage snapshot. A detected change
  from another tab, unreadable queue data, or a failed save blocks new generation
  instead of overwriting recovery records or sending an unrecorded request.
  An already-sent request may still finish; read-only recovery remains available.
  Keep that tab open, recover outstanding results and back up its audio before
  refreshing. This conflict check is not an atomic cross-tab lock: use one
  generation tab at a time. ZIP/JSON exports do not include operation-cache records.

## Files and integrity

Current approved delivery: `audio/SC01_L001__r0002__t0003.wav`.
Original takes, including stale/rejected ones: `takes/<take_id>.wav`.
Only the manifest's current non-null `audio` values are deliverables. The archive
contains no generated silence or placeholder WAVs. Every exported WAV is checked
against its take's metadata and digest; CSV and JSON do not substitute for audio.

Work packages use bounded uncompressed ZIP with verified CRC, headers, paths,
SHA-256 and WAV structure on restore. Other ZIP styles/compression are rejected
with a clear error; this is a round-trip format for this tool, not a generic unzip.
The archive preserves all available takes but reports missing files honestly.

Limits: 500 lines, 100 revisions/line, 1,000 takes, 2 MiB metadata, 20 MiB/imported
WAV, 100 MiB unique in-memory audio, 128 MiB packed audio payload, 130 MiB ZIP input.
WAV supports 8–96kHz mono/stereo PCM16/24/32 or float32; the MiniMax adapter requests
32kHz mono WAV and independently verifies its actual returned format.

Draft metadata is browser-local and unencrypted; audio uses IndexedDB. Storage
failure keeps an exit warning and an exportable in-memory copy. Another tab's
changed metadata will not be overwritten silently. Export work packages before
clearing browser data or moving to another origin. Replacing/resetting a project
releases unrelated in-memory blobs but does not delete stored recordings from
IndexedDB. Automatic storage garbage collection is intentionally not provided.

## Verification and remaining limits

```sh
npm ci --ignore-scripts
npm test
npm run test:dom
python3 -m unittest discover -s tests -v
python3 scripts/build_pages.py
python3 scripts/build_offline.py /new/path/preview.html
```

Domain and real loopback HTTP tests use **synthetic PCM fixtures and fake provider
transport only**. The compiled UI's DOM tests cover import, casting, actual binary
WAV attachment, review/staleness, IndexedDB restoration, ZIP round trip, single-line
versus batch isolation, interrupted-result recovery and persistence failures.
Synthetic fixtures are not distributed as demo voices.

Real-browser layout, native audio playback/downloads, mobile rendering and actual
CSP enforcement remain unverified: Chromium process startup and the cloud-browser
localhost route were blocked by this execution environment. The reproducible
browser suite is included (`CHROME_PATH=/path/to/chromium npm run test:browser`),
but no screenshot or browser-pass claim is made. No real-provider generation,
audio-quality, pronunciation, commercial-license or time-saved claim is made.

The candidate is intended for a draft pull request. Merging or deploying it does
not complete browser acceptance or authorize live provider use.
