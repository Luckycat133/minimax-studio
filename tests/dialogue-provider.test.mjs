import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDialogueProvider, validateGenerationRequest, inspectWave, MINIMAX_ENDPOINT } from '../server/dialogue-provider.mjs';

// Synthetic PCM fixtures for parser tests only. Never written as production audio.
function wave({ rate = 32000, channels = 1, frames = 320, bits = 16 } = {}) {
  const block = channels * bits / 8, buffer = Buffer.alloc(44 + frames * block);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * block, 28);
  buffer.writeUInt16LE(block, 32); buffer.writeUInt16LE(bits, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * block, 40);
  for (let i = 44; i < buffer.length; i++) buffer[i] = i % 255;
  return buffer;
}
const request = (id = 'operation-001', overrides = {}) => ({ operation_id: id, text: '这是一条原创测试台词。', voice_id: 'male-qn-qingse', model: 'speech-2.8-hd', speed: 1, pitch: 0, emotion: '', pronunciation: [], ...overrides });
function payload(bytes = wave(), overrides = {}) { return { base_resp: { status_code: 0, status_msg: 'success' }, data: { status: 2, audio: bytes.toString('hex') }, extra_info: { usage_characters: 11, audio_format: 'wav', audio_channel: 1, audio_sample_rate: 32000 }, ...overrides }; }
const response = (body = payload(), status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function enabled(fetchImpl = async () => response(), extra = {}) { return createDialogueProvider({ enabled: true, entitlementConfirmed: true, maxRequests: 5, maxCharacters: 2000, loadApiKey: () => 'SYNTHETIC_TEST_ONLY', fetchImpl, ...extra }); }

test('disabled, unconfirmed and invalid-budget modes never read credentials or call fetch', async () => {
  let reads = 0, calls = 0;
  for (const options of [{}, { enabled: true }, { enabled: true, entitlementConfirmed: true }, { enabled: true, entitlementConfirmed: true, maxRequests: 101, maxCharacters: 10 }]) {
    const adapter = createDialogueProvider({ ...options, loadApiKey: () => { reads++; throw new Error('never'); }, fetchImpl: () => { calls++; throw new Error('never'); } });
    assert.equal(adapter.status().enabled, false);
    assert.equal((await adapter.generate(request())).status, 503);
  }
  assert.equal(reads, 0); assert.equal(calls, 0);
});
test('missing credentials produce a safe disabled status without fetch', async () => {
  const adapter = enabled(() => assert.fail('No call expected'), { loadApiKey: () => { throw new Error('PRIVATE_KEY_DETAILS'); } });
  assert.equal(adapter.status().reason, 'credential_unavailable');
  assert.doesNotMatch(JSON.stringify(await adapter.generate(request())), /PRIVATE_KEY/);
});
test('successful fake transport uses exact official request contract and returns verified WAV', async () => {
  let calls = 0;
  const adapter = enabled(async (url, init) => {
    calls++; assert.equal(url, MINIMAX_ENDPOINT); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer SYNTHETIC_TEST_ONLY');
    const sent = JSON.parse(init.body);
    assert.deepEqual(sent, { model: 'speech-2.8-turbo', text: request().text, stream: false, output_format: 'hex', voice_setting: { voice_id: 'Chinese (Mandarin)_Gentleman', speed: 0.9, vol: 1, pitch: -1, emotion: 'fluent' }, pronunciation_dict: { tone: ['处理/(chu3)(li3)'] }, audio_setting: { sample_rate: 32000, format: 'wav', channel: 1 }, subtitle_enable: false });
    return response();
  });
  const result = await adapter.generate(request('tone', { model: 'speech-2.8-turbo', voice_id: 'Chinese (Mandarin)_Gentleman', speed: 0.9, pitch: -1, emotion: 'fluent', pronunciation: ['处理/(chu3)(li3)'] }));
  assert.equal(result.status, 200); assert.equal(calls, 1);
  assert.equal(result.body.audio.sha256, createHash('sha256').update(wave()).digest('hex'));
  assert.deepEqual(Buffer.from(result.body.audio.base64, 'base64'), wave());
  assert.equal(result.body.audio.duration_ms, 10); assert.equal(result.body.audio.format, 'wav');
  assert.equal(result.body.audio.mime, 'audio/wav'); assert.equal(result.body.usage_characters, 11);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_TEST_ONLY|Authorization|headers/);
});
test('budget is reserved before dispatch and failures never refund it', async () => {
  let adapter; adapter = enabled(async () => { assert.equal(adapter.status().budget.used_requests, 1); assert.equal(adapter.status().budget.used_characters, 11); return response({}, 429); }, { maxRequests: 1, maxCharacters: 11 });
  assert.equal((await adapter.generate(request())).status, 429);
  assert.equal(adapter.status().budget.used_requests, 1); assert.equal(adapter.status().budget.used_characters, 11);
  assert.equal((await adapter.generate(request('next'))).body.error.code, 'budget_exhausted');
});
test('character overshoot is rejected before dispatch and pronunciation is reserved', async () => {
  let calls = 0; const adapter = enabled(async () => { calls++; return response(); }, { maxCharacters: 11 });
  const result = await adapter.generate(request('overshoot', { pronunciation: ['处理/(chu3)(li3)'] }));
  assert.equal(result.body.error.code, 'budget_exhausted'); assert.equal(calls, 0); assert.equal(adapter.status().budget.used_requests, 0);
});
test('one operation in flight; matching duplicate shares outcome; conflicting reuse is denied', async () => {
  let resolveFetch, calls = 0;
  const adapter = enabled(() => { calls++; return new Promise(resolve => { resolveFetch = resolve; }); });
  const first = adapter.generate(request()), duplicate = adapter.generate(request());
  assert.equal((await adapter.generate(request('other'))).body.error.code, 'generation_busy');
  assert.equal((await adapter.generate(request('operation-001', { text: 'changed' }))).body.error.code, 'operation_conflict');
  resolveFetch(response());
  const result = await first; assert.deepEqual(await duplicate, result); assert.deepEqual(await adapter.generate(request()), result); assert.equal(calls, 1);
  // A busy request is a remembered failed operation; a new user action needs a fresh ID.
  assert.equal((await adapter.generate(request('other'))).body.error.code, 'generation_busy');
});
test('duplicate failed operation preserves exact safe outcome without retry', async () => {
  let calls = 0; const adapter = enabled(async () => { calls++; return response({ base_resp: { status_code: 1008, status_msg: 'SECRET account balance' } }); });
  const first = await adapter.generate(request()); assert.deepEqual(await adapter.generate(request()), first);
  assert.equal(first.body.error.code, 'provider_error'); assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(first), /SECRET/);
});
test('timeout is uncertain, cached, budgeted, aborts and blocks subsequent dispatch', async () => {
  let calls = 0, signal;
  const adapter = enabled(async (_url, init) => { calls++; signal = init.signal; return new Promise(() => {}); }, { timeoutMs: 10 });
  const result = await adapter.generate(request());
  assert.equal(result.status, 504); assert.equal(result.body.error.uncertain, true); assert.equal(signal.aborted, true);
  assert.deepEqual(await adapter.generate(request()), result);
  assert.equal((await adapter.generate(request('next'))).body.error.code, 'uncertain_provider_outcome');
  assert.equal(adapter.status().reason, 'uncertain_provider_outcome'); assert.equal(calls, 1);
});
test('transport exception is sanitized and marked uncertain without retry', async () => {
  let calls = 0; const adapter = enabled(async () => { calls++; throw new Error('Authorization Bearer SECRET'); });
  const result = await adapter.generate(request()); assert.equal(result.body.error.code, 'provider_transport_error'); assert.equal(result.body.error.uncertain, true);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|Authorization/); assert.equal(calls, 1);
});
test('timeout includes streamed response-body consumption', async () => {
  const adapter = enabled(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } }), { headers: { 'Content-Type': 'application/json' } }), { timeoutMs: 10 });
  assert.equal((await adapter.generate(request())).status, 504);
});
test('provider HTTP errors, rate limits, malformed JSON and misleading metadata reject', async t => {
  const cases = [
    ['http 401', () => response({}, 401), 'provider_authentication'], ['http 500', () => response({}, 500), 'provider_http_error'],
    ['http 429', () => response({}, 429), 'provider_rate_limit'], ['base rate limit', () => response({ base_resp: { status_code: 1002 } }), 'provider_rate_limit'],
    ['no base status', () => response({}), 'invalid_provider_response'], ['invalid JSON', () => new Response('not json', { headers: { 'Content-Type': 'application/json' } }), 'invalid_provider_response'],
    ['wrong MIME', () => new Response('<html>'), 'invalid_provider_response'], ['missing usage', () => response(payload(wave(), { extra_info: {} })), 'invalid_provider_response'],
    ['wrong format', () => response(payload(wave(), { extra_info: { usage_characters: 11, audio_format: 'mp3' } })), 'invalid_provider_response'],
    ['claimed huge body', () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(50 * 1024 * 1024) } }), 'provider_response_too_large']
  ];
  for (const [name, make, code] of cases) await t.test(name, async () => { let calls = 0; const adapter = enabled(async () => { calls++; return make(); }); const result = await adapter.generate(request()); assert.equal(result.body.error.code, code); assert.equal(calls, 1); assert.equal(result.body.audio, undefined); });
});
test('invalid hex, unfinished audio, wrong WAV rate/channels/bit depth, corrupt RIFF reject', async t => {
  const corrupt = wave(); corrupt.writeUInt32LE(99999, 4);
  const variants = ['0', 'not-hex', '', wave({ rate: 44100 }).toString('hex'), wave({ channels: 2 }).toString('hex'), wave({ bits: 8 }).toString('hex'), Buffer.from('not WAV audio').toString('hex'), corrupt.toString('hex')];
  for (let index = 0; index < variants.length; index++) await t.test(String(index), async () => { const adapter = enabled(async () => response(payload(wave(), { data: { audio: variants[index], status: 2 } }))); assert.equal((await adapter.generate(request())).body.error.code, 'invalid_audio'); });
  const adapter = enabled(async () => response(payload(wave(), { data: { audio: wave().toString('hex'), status: 1 } })));
  assert.equal((await adapter.generate(request())).body.error.code, 'invalid_audio');
});
test('strict WAV parser rejects truncated chunks, no audio and inconsistent byte rate', () => {
  assert.throws(() => inspectWave(wave().subarray(0, 43)));
  assert.throws(() => inspectWave(wave({ frames: 0 })));
  const bytes = wave(); bytes.writeUInt32LE(64001, 28); assert.throws(() => inspectWave(bytes));
});
test('unsupported parameters never dispatch; valid official voice punctuation works', async () => {
  let calls = 0; const adapter = enabled(async () => { calls++; return response(); });
  for (const override of [{ operation_id: '../key' }, { text: '' }, { text: 'x'.repeat(2001) }, { text: 'x\0' }, { model: 'speech-legacy' }, { speed: '1' }, { speed: 2.1 }, { pitch: 1.5 }, { pitch: 13 }, { emotion: 'excited' }, { pronunciation: ['wrong'] }, { pronunciation: ['a/b/c'] }, { voice_id: '' }, { endpoint: 'https://evil.test' }, { api_key: 'secret' }]) assert.equal((await adapter.generate(request('invalid', override))).status, 400);
  assert.equal(calls, 0);
  assert.equal(validateGenerationRequest(request('valid', { voice_id: 'Cantonese_ProfessionalHost（F)' })).voice_id, 'Cantonese_ProfessionalHost（F)');
});

test('lookup is read-only for absent operations, pending operations, success and exhausted budgets', async () => {
  let calls = 0, finish;
  const adapter = enabled(async () => { calls++; return new Promise(resolve => { finish = resolve; }); }, { maxRequests: 1 });
  const before = adapter.status();
  assert.equal((await adapter.lookup('never-started')).status, 404);
  assert.equal((await adapter.lookup('../invalid')).status, 400);
  assert.deepEqual(adapter.status(), before); assert.equal(calls, 0);
  const first = adapter.generate(request()), replay = adapter.lookup('operation-001');
  const reserved = adapter.status(); assert.equal(reserved.reason, 'request_budget_exhausted');
  finish(response());
  const result = await first; assert.deepEqual(await replay, result); assert.deepEqual(await adapter.lookup('operation-001'), result);
  assert.equal(calls, 1); assert.deepEqual(adapter.status().budget, reserved.budget);
});
test('lookup replays uncertain and provider-error outcomes without unlocking or charging', async () => {
  for (const make of [async () => { throw new Error('synthetic disconnect'); }, async () => response({}, 429)]) {
    let calls = 0; const adapter = enabled(async (...args) => { calls++; return make(...args); });
    const result = await adapter.generate(request()), status = adapter.status();
    assert.deepEqual(await adapter.lookup('operation-001'), result);
    assert.equal((await adapter.lookup('not-recorded')).status, 404);
    assert.deepEqual(adapter.status(), status); assert.equal(calls, 1);
  }
});
test('session_id is stable, public, changes for a fresh adapter and contains no credential', () => {
  const first = enabled(), second = enabled();
  assert.match(first.status().session_id, /^[a-f0-9-]{36}$/);
  assert.equal(first.status().session_id, first.status().session_id);
  assert.notEqual(first.status().session_id, second.status().session_id);
  assert.doesNotMatch(JSON.stringify(first.status()), /SYNTHETIC_TEST_ONLY/);
});
