import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDialogueServer, parseCLI } from '../server/dialogue-server.mjs';
import { createDialogueProvider } from '../server/dialogue-provider.mjs';

function request(address, { path = '/api/dialogue/status', method = 'GET', headers = {}, body, chunks } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: address.port, method, path, headers }, res => {
      const pieces = []; res.on('data', piece => pieces.push(piece)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(pieces).toString('utf8') }));
    }); req.on('error', reject);
    if (chunks) for (const chunk of chunks) req.write(chunk);
    req.end(body);
  });
}
async function fixture(t, provider) {
  const rootDir = await mkdtemp(join(tmpdir(), 'minimax-service-test-'));
  await mkdir(join(rootDir, 'css')); await mkdir(join(rootDir, 'js'));
  await writeFile(join(rootDir, 'dialogue.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'"><body class="dialogue-app">Fixture</body>');
  for (const file of ['css/styles.css', 'css/dialogue.css', 'js/dialogue.mjs', 'js/dialogue-core.mjs', 'js/production-store.mjs']) await writeFile(join(rootDir, file), '/* synthetic frontend fixture */');
  await writeFile(join(rootDir, '.env'), 'SYNTHETIC_NOT_A_KEY');
  await symlink(join(rootDir, '.env'), join(rootDir, 'js/dialogue-secret.mjs'));
  const service = createDialogueServer({ rootDir, ...(provider ? { provider } : {}) });
  let address;
  try { address = await service.start({ port: 0 }); }
  catch (error) { await rm(rootDir, { recursive: true, force: true }); if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('Environment does not permit loopback listening.'); return null; } throw error; }
  t.after(async () => { await service.close(); await rm(rootDir, { recursive: true, force: true }); });
  return { service, address };
}
const body = JSON.stringify({ operation_id: 'test-http-1', text: '原创台词', voice_id: 'male-qn-qingse', model: 'speech-2.8-hd', speed: 1, pitch: 0, emotion: '', pronunciation: [] });
const post = (address, overrides = {}) => ({ path: '/api/dialogue/generate', method: 'POST', headers: { Origin: address.origin, 'Content-Type': 'application/json' }, body, ...overrides });

test('actual loopback HTTP server defaults disabled, status has no secrets, static CSP is scoped', async t => {
  let reads = 0; const provider = createDialogueProvider({ loadApiKey: () => { reads++; throw new Error('must not read'); } });
  const f = await fixture(t, provider); if (!f) return;
  const status = await request(f.address), parsed = JSON.parse(status.text);
  assert.equal(parsed.enabled, false); assert.equal(parsed.reason, 'generation_disabled');
  assert.deepEqual(parsed.budget, { max_requests: 0, used_requests: 0, max_characters: 0, used_characters: 0 });
  assert.equal((await request(f.address, post(f.address))).status, 503); assert.equal(reads, 0);
  const html = await request(f.address, { path: '/dialogue.html' });
  assert.equal(html.status, 200); assert.match(html.text, /data-local-service="true"/); assert.doesNotMatch(html.text, /connect-src 'none'/);
  assert.match(html.headers['content-security-policy'], /connect-src 'self'/); assert.match(html.headers['content-security-policy'], /media-src 'self' blob:/);
  assert.equal(html.headers['access-control-allow-origin'], undefined); assert.equal(html.headers['cache-control'], 'no-store');
  assert.equal(html.headers['x-content-type-options'], 'nosniff'); assert.equal(html.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal((await request(f.address, { path: '/', method: 'HEAD' })).text, '');
});
test('static allowlist denies backend, settings, legacy page, traversal, query paths and symlinks', async t => {
  const f = await fixture(t); if (!f) return;
  for (const path of ['/css/styles.css', '/css/dialogue.css', '/js/dialogue-core.mjs', '/js/production-store.mjs']) assert.equal((await request(f.address, { path })).status, 200, path);
  for (const path of ['/.env', '/server/dialogue-server.mjs', '/package.json', '/index.html', '/js/api.js', '/../dialogue.html', '/%2e%2e/.env', '/js/dialogue-secret.mjs', '/dialogue.html?unsafe', '//dialogue.html', '/js\\dialogue.mjs']) assert.equal((await request(f.address, { path })).status, 404, path);
});
test('exact Host and same-Origin checks reject CSRF, DNS rebinding, missing Origin and CORS preflight', async t => {
  let calls = 0; const provider = { status: () => ({ enabled: true }), generate: async () => { calls++; return { status: 200, body: {} }; } };
  const f = await fixture(t, provider); if (!f) return;
  for (const headers of [
    { Host: `evil.example:${f.address.port}` }, { Host: `localhost:${f.address.port}` }, { Host: '127.0.0.1:1' },
    { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, { Origin: 'null', 'Content-Type': 'application/json' },
    { Origin: `${f.address.origin}/`, 'Content-Type': 'application/json' }, { 'Content-Type': 'application/json' },
    { Origin: f.address.origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }
  ]) assert.equal((await request(f.address, post(f.address, { headers }))).status, 403);
  assert.equal((await request(f.address, { path: '/api/dialogue/generate', method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal(calls, 0);
});
test('content type, payload limit, invalid JSON and unsupported methods reject before provider dispatch', async t => {
  let calls = 0; const provider = { status: () => ({ enabled: true }), generate: async () => { calls++; return { status: 200, body: {} }; } };
  const f = await fixture(t, provider); if (!f) return;
  const send = args => request(f.address, post(f.address, args));
  assert.equal((await send({ headers: { Origin: f.address.origin, 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await send({ headers: { Origin: f.address.origin, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } })).status, 415);
  assert.equal((await send({ body: 'not JSON' })).status, 400);
  assert.equal((await send({ body: 'x'.repeat(25000) })).status, 413);
  assert.equal((await send({ body: undefined, chunks: ['x'.repeat(13000), 'x'.repeat(13000)] })).status, 413);
  assert.equal((await send({ method: 'PUT' })).status, 405); assert.equal(calls, 0);
});
test('HTTP integration returns provider errors safely and replays accepted generation once', async t => {
  let calls = 0;
  const provider = createDialogueProvider({ enabled: true, entitlementConfirmed: true, maxRequests: 2, maxCharacters: 100, loadApiKey: () => 'SYNTHETIC_NO_NETWORK', fetchImpl: async () => { calls++; return new Response(JSON.stringify({ base_resp: { status_code: 1008, status_msg: 'PRIVATE details' } }), { headers: { 'Content-Type': 'application/json' } }); } });
  const f = await fixture(t, provider); if (!f) return;
  const first = await request(f.address, post(f.address)), second = await request(f.address, post(f.address));
  assert.equal(first.status, 502); assert.equal(first.text, second.text); assert.equal(calls, 1); assert.doesNotMatch(first.text, /PRIVATE|SYNTHETIC/);
  const conflict = await request(f.address, post(f.address, { body: body.replace('原创台词', '改变台词') }));
  assert.equal(conflict.status, 409);
  assert.equal(JSON.parse((await request(f.address)).text).budget.used_requests, 1);
});
test('CLI cannot enable without all gates and cannot choose external host or credentials', () => {
  assert.equal(parseCLI([]).enabled, false);
  assert.throws(() => parseCLI(['--enable-generation']));
  assert.throws(() => parseCLI(['--enable-generation', '--entitlement-confirmed', '--max-requests', '101', '--max-characters', '100']));
  assert.throws(() => parseCLI(['--max-requests=2=3']));
  assert.throws(() => parseCLI(['--host', '0.0.0.0'])); assert.throws(() => parseCLI(['--api-key', 'synthetic']));
  assert.throws(() => parseCLI(['--port', '65536'])); assert.throws(() => parseCLI(['--port', '1', '--port', '2']));
  assert.deepEqual(parseCLI(['--enable-generation', '--entitlement-confirmed', '--max-requests=2', '--max-characters', '100', '--port=0']), { enabled: true, entitlementConfirmed: true, maxRequests: 2, maxCharacters: 100, port: 0 });
});


test('successful HTTP generation returns real validated fixture bytes and exact duplicate outcome', async t => {
  // Synthetic transport fixture; no MiniMax endpoint is contacted.
  const wav = Buffer.alloc(44 + 640);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(32000, 24); wav.writeUInt32LE(64000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(640, 40); wav.fill(42, 44);
  let calls = 0;
  const provider = createDialogueProvider({ enabled: true, entitlementConfirmed: true, maxRequests: 1, maxCharacters: 100, loadApiKey: () => 'SYNTHETIC_NO_NETWORK', fetchImpl: async () => {
    calls++; return new Response(JSON.stringify({ base_resp: { status_code: 0 }, data: { status: 2, audio: wav.toString('hex') }, extra_info: { usage_characters: 4 } }), { headers: { 'Content-Type': 'application/json' } });
  } });
  const f = await fixture(t, provider); if (!f) return;
  const first = await request(f.address, post(f.address)), second = await request(f.address, post(f.address));
  assert.equal(first.status, 200); assert.equal(first.text, second.text); assert.equal(calls, 1);
  const result = JSON.parse(first.text); assert.deepEqual(Buffer.from(result.audio.base64, 'base64'), wav);
  assert.equal(result.audio.duration_ms, 10); assert.equal(result.audio.sha256.length, 64);
  assert.equal(JSON.parse((await request(f.address)).text).reason, 'request_budget_exhausted');
});

test('HTTP result lookup is read-only, same-origin guarded and can recover exhausted-session outcomes', async t => {
  let calls = 0;
  const provider = createDialogueProvider({ enabled: true, entitlementConfirmed: true, maxRequests: 1, maxCharacters: 100, loadApiKey: () => 'SYNTHETIC_NO_NETWORK', fetchImpl: async () => { calls++; return new Response('{}', { status: 429, headers: { 'Content-Type': 'application/json' } }); } });
  const f = await fixture(t, provider); if (!f) return;
  const path = '/api/dialogue/result?operation_id=test-http-1';
  assert.equal((await request(f.address, { path })).status, 404); assert.equal(calls, 0);
  const first = await request(f.address, post(f.address));
  const budget = provider.status().budget;
  const replay = await request(f.address, { path });
  assert.equal(replay.status, first.status); assert.equal(replay.text, first.text); assert.equal(calls, 1);
  assert.deepEqual(provider.status().budget, budget);
  assert.equal((await request(f.address, { path, headers: { Origin: 'https://evil.example' } })).status, 403);
  for (const bad of ['/api/dialogue/result', '/api/dialogue/result?operation_id=a&operation_id=b', '/api/dialogue/result?operation_id=a&extra=x', '/api/dialogue/result?operation_id=..%2Fsecret']) assert.equal((await request(f.address, { path: bad })).status, 400);
  assert.match(JSON.parse((await request(f.address)).text).session_id, /^[a-f0-9-]{36}$/);
});
test('HTTP result lookup awaits one in-flight request and recovers an uncertain outcome', async t => {
  let calls = 0, release;
  const provider = createDialogueProvider({ enabled: true, entitlementConfirmed: true, maxRequests: 1, maxCharacters: 100, loadApiKey: () => 'SYNTHETIC_NO_NETWORK', fetchImpl: async () => { calls++; return new Promise((_resolve, reject) => { release = () => reject(new Error('synthetic transport failure')); }); } });
  const f = await fixture(t, provider); if (!f) return;
  const first = request(f.address, post(f.address));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const replay = request(f.address, { path: '/api/dialogue/result?operation_id=test-http-1' });
  release();
  const initial = await first, recovered = await replay;
  assert.equal(initial.status, 502); assert.equal(initial.text, recovered.text);
  assert.equal(JSON.parse(recovered.text).error.uncertain, true); assert.equal(calls, 1);
  assert.equal(provider.status().reason, 'uncertain_provider_outcome');
});
