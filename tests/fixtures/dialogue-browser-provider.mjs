/** Deterministic synthetic-audio transport. No network, credentials, environment or account access. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function syntheticToneWav() {
  const sampleRate = 32000, samples = sampleRate, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(1000 * Math.sin(i * 2 * Math.PI * 220 / sampleRate)), 44 + i * 2);
  return bytes;
}

export function createBrowserFixtureProvider(bytes) {
  const calls = [], lookups = [], plans = [], results = new Map(), held = new Map(), violations = [];
  let sessionId = 'browser-fixture-session-1';
  const audio = { base64: bytes.toString('base64'), format: 'wav', mime: 'audio/wav', sha256: createHash('sha256').update(bytes).digest('hex') };
  const unexpected = message => { violations.push(message); throw new Error(message); };
  const provider = Object.freeze({
    status() {
      return { enabled: true, reason: 'SYNTHETIC_TEST_DOUBLE_ONLY', session_id: sessionId,
        budget: { max_requests: 8, used_requests: calls.length, max_characters: 20000, used_characters: calls.reduce((sum, call) => sum + call.text.length, 0) } };
    },
    async generate(input) {
      if (!plans.length || calls.length >= 8) return unexpected('Unplanned fixture dispatch; no real provider exists in this fixture');
      assert.deepEqual(Object.keys(input).sort(), ['operation_id', 'text', 'voice_id', 'model', 'speed', 'pitch', 'emotion', 'pronunciation'].sort());
      assert.equal(typeof input.operation_id, 'string'); assert.ok(input.text.length > 0);
      if (results.has(input.operation_id)) return unexpected('UI reused a generation operation ID unexpectedly');
      const mode = plans.shift(); calls.push(structuredClone(input));
      const success = { status: 200, body: { operation_id: input.operation_id, audio, usage_characters: input.text.length } };
      results.set(input.operation_id, success);
      if (mode === 'hold') return new Promise(resolve => held.set(input.operation_id, () => { held.delete(input.operation_id); resolve(success); }));
      if (mode === 'reject') {
        const rejected = { status: 429, body: { operation_id: input.operation_id, error: { code: 'fixture_rate_limit', message: 'Synthetic rate limit; explicit retry required', uncertain: false } } };
        results.set(input.operation_id, rejected); return rejected;
      }
      // A malformed audio response simulates an incomplete/uncertain result while
      // the original operation's complete bytes remain retrievable by GET.
      if (mode === 'uncertain') return { status: 200, body: { operation_id: input.operation_id, audio: null } };
      assert.equal(mode, 'success'); return success;
    },
    async lookup(operationId) {
      lookups.push(operationId);
      return results.get(operationId) ?? { status: 404, body: { error: { code: 'fixture_missing', message: 'Fixture result unavailable', uncertain: true } } };
    }
  });
  return {
    provider, calls, lookups,
    plan(mode) { assert.ok(['success', 'hold', 'reject', 'uncertain'].includes(mode)); plans.push(mode); },
    release(operationId) { assert.ok(held.has(operationId), 'Expected held fixture operation'); held.get(operationId)(); },
    changeSession() { sessionId = 'browser-fixture-session-2'; },
    assertSafe() { assert.deepEqual(violations, []); assert.equal(held.size, 0); assert.equal(plans.length, 0); assert.ok(calls.length <= 8); },
    releaseAll() { for (const release of [...held.values()]) release(); }
  };
}
