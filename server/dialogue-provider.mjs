/** Guarded, process-local MiniMax adapter. Importing this module reads no credentials. */
import { createHash, randomUUID } from 'node:crypto';

export const MINIMAX_ENDPOINT = 'https://api.minimax.cn/v1/t2a_v2';
export const SUPPORTED_MODELS = Object.freeze(['speech-2.8-hd', 'speech-2.8-turbo']);
export const EMOTIONS = Object.freeze(['', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent']);
export const LIMITS = Object.freeze({ text: 2000, requests: 100, characters: 100000, audioBytes: 16 * 1024 * 1024, responseBytes: 34 * 1024 * 1024, cacheBytes: 64 * 1024 * 1024, operations: 256 });
const FIELDS = ['operation_id', 'text', 'voice_id', 'model', 'speed', 'pitch', 'emotion', 'pronunciation'];
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const OPERATION = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export class DialogueError extends Error {
  constructor(code, message, status = 400, uncertain = false) {
    super(message); this.name = 'DialogueError'; this.code = code; this.status = status; this.uncertain = uncertain;
  }
}
const invalid = message => { throw new DialogueError('invalid_request', message); };
function freeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function outcome(error, operationId) {
  const safe = error instanceof DialogueError ? error : new DialogueError('internal_error', 'The request could not be completed.', 500);
  return freeze({ status: safe.status, body: { ...(operationId ? { operation_id: operationId } : {}), error: { code: safe.code, message: safe.message, uncertain: safe.uncertain } } });
}

export function validateGenerationRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !FIELDS.includes(key))) invalid('Expected the supported generation fields only.');
  const { operation_id, text, voice_id, model = SUPPORTED_MODELS[0], speed = 1, pitch = 0, emotion = '', pronunciation = [] } = input;
  if (typeof operation_id !== 'string' || !OPERATION.test(operation_id)) invalid('operation_id must be 1–128 ASCII letters, digits, dots, colons, underscores or hyphens.');
  if (typeof text !== 'string' || !text.trim() || text.length > LIMITS.text || CONTROL.test(text)) invalid('text must contain 1–2000 characters without unsupported control characters.');
  // Official voice IDs include spaces, parentheses and non-ASCII punctuation. Never interpret them as URLs.
  if (typeof voice_id !== 'string' || !voice_id.trim() || voice_id.length > 128 || /[\u0000-\u001f\u007f]/.test(voice_id)) invalid('voice_id must be a nonempty official voice ID of at most 128 characters.');
  if (!SUPPORTED_MODELS.includes(model)) invalid('Unsupported speech model.');
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) invalid('speed must be a number from 0.5 to 2.');
  if (!Number.isInteger(pitch) || pitch < -12 || pitch > 12) invalid('pitch must be an integer from -12 to 12.');
  if (!EMOTIONS.includes(emotion)) invalid('Unsupported emotion.');
  if (!Array.isArray(pronunciation) || pronunciation.length > 32) invalid('pronunciation must be an array with at most 32 tone entries.');
  for (const entry of pronunciation) {
    if (typeof entry !== 'string' || entry.length > 200 || /[\u0000-\u001f\u007f]/.test(entry) || !/^[^/]+\/[^/]+$/.test(entry) || entry.split('/').some(part => !part.trim())) invalid('Each pronunciation entry must use the official word/replacement tone format.');
  }
  return { operation_id, text, voice_id, model, speed, pitch, emotion, pronunciation: [...pronunciation] };
}

export function buildProviderPayload(request) {
  const voice_setting = { voice_id: request.voice_id, speed: request.speed, vol: 1, pitch: request.pitch };
  if (request.emotion) voice_setting.emotion = request.emotion;
  return {
    model: request.model, text: request.text, stream: false, output_format: 'hex',
    voice_setting, ...(request.pronunciation.length ? { pronunciation_dict: { tone: [...request.pronunciation] } } : {}),
    audio_setting: { sample_rate: 32000, format: 'wav', channel: 1 }, subtitle_enable: false
  };
}

/** Strictly verify the bytes, not merely a provider format label or RIFF prefix. */
export function inspectWave(bytes) {
  const reject = () => { throw new DialogueError('invalid_audio', 'Provider audio is not valid 32 kHz mono 16-bit PCM WAV.', 502); };
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.length > LIMITS.audioBytes || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) !== bytes.length - 8) reject();
  let offset = 12, format = null, dataBytes = null;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) reject();
    const name = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + size;
    if (end > bytes.length || end + (size % 2) > bytes.length) reject();
    if (name === 'fmt ') {
      if (format || size < 16) reject();
      format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8), blockAlign: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) };
    } else if (name === 'data') {
      if (dataBytes !== null) reject();
      dataBytes = size;
    }
    offset = end + (size % 2);
  }
  if (!format || format.encoding !== 1 || format.channels !== 1 || format.sampleRate !== 32000 || format.bits !== 16 || format.blockAlign !== 2 || format.byteRate !== 64000 || !dataBytes || dataBytes % 2 || offset !== bytes.length) reject();
  return { duration_ms: Number((dataBytes / 64).toFixed(3)), sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function readResponseJSON(response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > LIMITS.responseBytes) throw new DialogueError('provider_response_too_large', 'Provider response exceeded the local size limit.', 502);
  const contentType = response.headers.get('content-type') || '';
  if (!/^application\/json(?:;|$)/i.test(contentType)) throw new DialogueError('invalid_provider_response', 'Provider did not return JSON.', 502);
  if (!response.body) throw new DialogueError('invalid_provider_response', 'Provider returned no response body.', 502);
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > LIMITS.responseBytes) { await reader.cancel(); throw new DialogueError('provider_response_too_large', 'Provider response exceeded the local size limit.', 502); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks, total).toString('utf8')); }
  catch { throw new DialogueError('invalid_provider_response', 'Provider returned invalid JSON.', 502); }
}

async function synthesize(request, key, fetchImpl, signal) {
  const response = await fetchImpl(MINIMAX_ENDPOINT, {
    method: 'POST', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildProviderPayload(request))
  });
  if (!response.ok) {
    // Do not forward remote headers or messages: either may include account data.
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) throw new DialogueError('provider_rate_limit', 'MiniMax rate-limited this operation. No automatic retry was made.', 429);
    if (response.status === 401 || response.status === 403) throw new DialogueError('provider_authentication', 'MiniMax rejected authentication or access.', 502);
    throw new DialogueError('provider_http_error', 'MiniMax returned an unsuccessful HTTP response.', 502);
  }
  const data = await readResponseJSON(response);
  if (!data || typeof data !== 'object' || !Number.isInteger(data.base_resp?.status_code)) throw new DialogueError('invalid_provider_response', 'Provider response did not contain a valid status.', 502);
  if (data.base_resp.status_code !== 0) {
    if (data.base_resp.status_code === 1002) throw new DialogueError('provider_rate_limit', 'MiniMax rate-limited this operation. No automatic retry was made.', 429);
    throw new DialogueError('provider_error', 'MiniMax rejected this operation. No automatic retry was made.', 502);
  }
  const hex = data.data?.audio;
  if (data.data?.status !== 2 || typeof hex !== 'string' || !hex.length || hex.length > LIMITS.audioBytes * 2 || hex.length % 2 || !/^[a-fA-F0-9]+$/.test(hex)) throw new DialogueError('invalid_audio', 'Provider did not return complete, valid hex-encoded audio.', 502);
  const extra = data.extra_info;
  if (!extra || !Number.isSafeInteger(extra.usage_characters) || extra.usage_characters < 0 || extra.usage_characters > LIMITS.characters || (extra.audio_format !== undefined && extra.audio_format !== 'wav') || (extra.audio_sample_rate !== undefined && extra.audio_sample_rate !== 32000) || (extra.audio_channel !== undefined && extra.audio_channel !== 1)) throw new DialogueError('invalid_provider_response', 'Provider audio or usage metadata did not match the requested contract.', 502);
  const bytes = Buffer.from(hex, 'hex'), inspected = inspectWave(bytes);
  return { operation_id: request.operation_id, audio: { base64: bytes.toString('base64'), mime: 'audio/wav', format: 'wav', ...inspected }, usage_characters: extra.usage_characters };
}

/**
 * Credentials are loaded only after every explicit opt-in gate has passed.
 * Tests MUST inject fetchImpl and loadApiKey; no mock credentials reach the network.
 * Budgets and idempotency records last for this process only. Errors are never retried.
 */
export function createDialogueProvider(options = {}) {
  const { enabled = false, entitlementConfirmed = false, maxRequests = 0, maxCharacters = 0, timeoutMs = 60000, fetchImpl = globalThis.fetch, loadApiKey = () => process.env.MINIMAX_API_KEY } = options;
  const validBudget = Number.isSafeInteger(maxRequests) && maxRequests >= 1 && maxRequests <= LIMITS.requests && Number.isSafeInteger(maxCharacters) && maxCharacters >= 1 && maxCharacters <= LIMITS.characters;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new DialogueError('invalid_configuration', 'timeoutMs must be between 1 and 120000.', 500);
  let disabledReason = enabled !== true ? 'generation_disabled' : entitlementConfirmed !== true ? 'entitlement_unconfirmed' : !validBudget ? 'budget_not_configured' : '';
  let key = '';
  if (!disabledReason) {
    try { key = loadApiKey(); } catch { disabledReason = 'credential_unavailable'; }
    if (!disabledReason && (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\r\n]/.test(key))) disabledReason = 'credential_unavailable';
  }
  let usedRequests = 0, usedCharacters = 0, inFlight = false, uncertain = false, cacheBytes = 0;
  const operations = new Map(), sessionId = randomUUID();
  const reason = () => disabledReason || (uncertain ? 'uncertain_provider_outcome' : usedRequests >= maxRequests ? 'request_budget_exhausted' : usedCharacters >= maxCharacters ? 'character_budget_exhausted' : cacheBytes >= LIMITS.cacheBytes ? 'session_cache_full' : operations.size >= LIMITS.operations ? 'session_operation_limit' : '');
  return Object.freeze({
    status() {
      const current = reason();
      return { enabled: !current, reason: current || 'ready', session_id: sessionId, budget: { max_requests: validBudget ? maxRequests : 0, used_requests: usedRequests, max_characters: validBudget ? maxCharacters : 0, used_characters: usedCharacters }, endpoint: MINIMAX_ENDPOINT, model: SUPPORTED_MODELS[0] };
    },
    async lookup(operationId) {
      if (typeof operationId !== 'string' || !OPERATION.test(operationId)) return outcome(new DialogueError('invalid_operation_id', 'Supply a valid operation_id.', 400));
      const existing = operations.get(operationId);
      return existing ? existing.promise : outcome(new DialogueError('operation_not_found', 'No result is recorded for this operation in the current process session. This does not establish whether an earlier session was billed.', 404), operationId);
    },
    async generate(input) {
      let request;
      try { request = validateGenerationRequest(input); }
      catch (error) { return outcome(error, typeof input?.operation_id === 'string' && OPERATION.test(input.operation_id) ? input.operation_id : undefined); }
      const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
      const previous = operations.get(request.operation_id);
      if (previous) return previous.fingerprint === fingerprint ? previous.promise : outcome(new DialogueError('operation_conflict', 'This operation_id was already used for different input.', 409), request.operation_id);
      if (operations.size >= LIMITS.operations) return outcome(new DialogueError('session_operation_limit', 'Restart only after reviewing the completed session; the operation record limit was reached.', 409), request.operation_id);
      // Reserve conservatively using UTF-16 text and pronunciation characters, never refund after dispatch.
      const reservation = request.text.length + request.pronunciation.reduce((sum, entry) => sum + entry.length, 0);
      let early;
      if (disabledReason) early = new DialogueError(disabledReason, 'Generation is disabled. Confirm entitlement and configure explicit session budgets before enabling.', 503);
      else if (uncertain) early = new DialogueError('uncertain_provider_outcome', 'A prior operation may have been billed. Review it before starting another session.', 409, true);
      else if (inFlight) early = new DialogueError('generation_busy', 'One operation is already in flight. No provider request was sent for this operation.', 409);
      else if (usedRequests >= maxRequests || usedCharacters + reservation > maxCharacters) early = new DialogueError('budget_exhausted', 'This operation exceeds the local session request or character budget.', 409);
      else if (cacheBytes >= LIMITS.cacheBytes) early = new DialogueError('session_cache_full', 'The in-memory audio cache is full. Export and review this session before restarting.', 409);
      if (early) {
        const result = outcome(early, request.operation_id);
        operations.set(request.operation_id, { fingerprint, promise: Promise.resolve(result) });
        return result;
      }
      usedRequests++; usedCharacters += reservation; inFlight = true;
      const controller = new AbortController(); let timer;
      const expired = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new DialogueError('provider_timeout', 'The provider timed out; this operation may have been billed. Do not retry automatically.', 504, true)); }, timeoutMs); });
      const promise = (async () => {
        try {
          const body = await Promise.race([synthesize(request, key, fetchImpl, controller.signal), expired]);
          usedCharacters += Math.max(0, body.usage_characters - reservation);
          cacheBytes += Buffer.byteLength(body.audio.base64);
          return freeze({ status: 200, body });
        } catch (error) {
          const safe = error instanceof DialogueError ? error : new DialogueError('provider_transport_error', 'The provider connection failed; this operation may have been billed. No automatic retry was made.', 502, true);
          if (safe.uncertain) uncertain = true;
          controller.abort();
          return outcome(safe, request.operation_id);
        } finally { clearTimeout(timer); inFlight = false; }
      })();
      operations.set(request.operation_id, { fingerprint, promise });
      return promise;
    }
  });
}
