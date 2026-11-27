import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../js/backend-api.js', import.meta.url), 'utf8');
const origin = 'https://legacy-backend.invalid';
const refreshPath = '/api/auth/refresh';

function response(status, body) {
  const result = new Response(body === undefined ? null : JSON.stringify(body), { status });
  const json = result.json.bind(result);
  result.reads = 0;
  result.json = () => {
    result.reads += 1;
    return json();
  };
  return result;
}

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function fixture(handle, initialTokens = ['fixture-old-access', 'fixture-old-refresh']) {
  const [accessToken, refreshToken] = initialTokens;
  const values = new Map([['auth_token', accessToken], ['refresh_token', refreshToken]]);
  const calls = [];
  const delays = [];
  const authUI = [];
  const window = { location: { origin }, addEventListener() {} };
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const api = runInNewContext(`${source}\nbackendApi`, {
    window, localStorage, navigator: { onLine: true }, URLSearchParams, AbortController, AbortSignal,
    app: {
      updateAuthUI: signedIn => authUI.push(signedIn),
      showAuthModal: () => authUI.push('show-login')
    },
    setTimeout: (callback, delay) => {
      if (delay === 120000 || delay < 1000) return setTimeout(callback, delay);
      delays.push(delay);
      queueMicrotask(callback);
      return undefined;
    },
    clearTimeout,
    fetch: async (url, options = {}) => {
      const target = new URL(url);
      assert.equal(target.origin, origin);
      const call = {
        path: target.pathname, method: options.method || 'GET',
        authorization: options.headers?.Authorization, body: options.body
      };
      calls.push(call);
      return handle(call, calls.length, options.signal);
    }
  }, { filename: 'js/backend-api.js' });
  return { api, calls, delays, values, authUI };
}

const tokenExpired = () => response(401, { code: 'TOKEN_EXPIRED', error: 'fixture token expired' });
const refreshed = () => response(200, {
  success: true, data: { accessToken: 'fixture-fresh-access', refreshToken: 'fixture-fresh-refresh' }
});

test('generation body deadline aborts an incomplete success and dispatches once', async () => {
  const { api, calls } = fixture((_, __, signal) => ({
    ok: true,
    status: 200,
    json: () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  }));
  api._requestTimeout = 5;
  await assert.rejects(api.generateMusic({ prompt: 'fixture' }), /后台请求超时，结果未知/);
  assert.equal(calls.length, 1);
});

test('successful mutation rejects empty, scalar and malformed response bodies', async () => {
  const bodies = [null, '1', '[]', 'null', '<!doctype html>'];
  for (const body of bodies) {
    const { api, calls } = fixture(() => new Response(body, { status: 200 }));
    await assert.rejects(api.generateLyrics({ prompt: 'fixture' }), /后台返回了无效的响应数据/);
    assert.equal(calls.length, 1);
  }
});

test('an accepted generation POST reaching a 502 is dispatched only once', async () => {
  let accepted = 0;
  const failure = { code: 'UPSTREAM_FAILURE', error: 'outcome unknown' };
  const result = response(502, failure);
  const { api, calls, delays } = fixture((call, attempt) => {
    assert.equal(call.path, '/api/generate/image');
    assert.equal(call.method, 'POST');
    accepted++;
    return attempt === 1 ? result : response(502, failure);
  });
  await assert.rejects(api.generateImage({ prompt: 'fixture' }), {
    status: 502, code: 'UPSTREAM_FAILURE', message: 'outcome unknown'
  });
  assert.equal(accepted, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
  assert.equal(result.reads, 1);
});

test('a generation request with a lost connection never dispatches twice', async () => {
  let accepted = 0;
  const networkFailure = new TypeError('Load failed');
  const { api, calls, delays } = fixture(() => { accepted++; throw networkFailure; });
  await assert.rejects(api.generateSpeech({ text: 'fixture' }), error => {
    assert.equal(error.message, '网络连接失败，请检查网络设置');
    assert.equal(error.cause, networkFailure);
    return true;
  });
  assert.equal(accepted, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
});

test('safe reads retry transport and 5xx failures with bounded backoff', async () => {
  const unavailable = response(503, { error: 'temporarily unavailable' });
  const { api, calls, delays } = fixture((_, attempt) => {
    if (attempt === 1) throw new TypeError('Failed to fetch');
    if (attempt === 2) return unavailable;
    return response(200, { data: ['fixture work'] });
  });
  assert.deepEqual(await api.getWorks(), { data: ['fixture work'] });
  assert.deepEqual(calls.map(c => c.method), ['GET', 'GET', 'GET']);
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(unavailable.reads, 1);

  const exhausted = fixture(() => response(503, { code: 'UNAVAILABLE' }));
  await assert.rejects(exhausted.api.getQuota(), { status: 503, code: 'UNAVAILABLE' });
  assert.equal(exhausted.calls.length, 4);
  assert.deepEqual(exhausted.delays, [1000, 2000, 4000]);

  const head = fixture((_, attempt) => attempt === 1 ? response(502) : response(200));
  assert.equal(await head.api.request('/api/works', { method: 'head' }), null);
  assert.deepEqual(head.calls.map(c => c.method), ['HEAD', 'HEAD']);
});

test('ordinary 401 preserves status, code, quota and message with one body read', async () => {
  const quota = { remaining: 0 };
  const result = response(401, { code: 'TOKEN_INVALID', error: 'fixture original message', quota });
  const { api, calls, values } = fixture(() => result);
  await assert.rejects(api.getWorks(), error => {
    assert.equal(error.status, 401);
    assert.equal(error.code, 'TOKEN_INVALID');
    assert.equal(error.message, 'fixture original message');
    assert.deepEqual(error.quota, quota);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(result.reads, 1);
  assert.equal(values.get('auth_token'), 'fixture-old-access');

  const empty401 = response(401);
  const empty = fixture(() => empty401);
  await assert.rejects(empty.api.getWorks(), { status: 401, message: '请求失败' });
  assert.equal(empty401.reads, 1);
});

test('concurrent and late expiry responses reuse one refresh and replay each request once', { timeout: 2000 }, async () => {
  const refreshStarted = deferred();
  const finishRefresh = deferred();
  const lateExpiry = deferred();
  const oldResponses = [];
  const { api, calls, values } = fixture(async call => {
    if (call.path === refreshPath) {
      assert.deepEqual(JSON.parse(call.body), { refreshToken: 'fixture-old-refresh' });
      refreshStarted.resolve();
      return finishRefresh.promise;
    }
    if (call.authorization === 'Bearer fixture-old-access') {
      const expired = tokenExpired();
      oldResponses.push(expired);
      if (call.path === '/api/generate/lyrics') await lateExpiry.promise;
      return expired;
    }
    assert.equal(call.authorization, 'Bearer fixture-fresh-access');
    return response(200, { success: true });
  });
  const image = api.generateImage({ prompt: 'fixture image' });
  const speech = api.generateSpeech({ text: 'fixture speech' });
  const lyrics = api.generateLyrics({ prompt: 'fixture lyrics' });
  await refreshStarted.promise;
  finishRefresh.resolve(refreshed());
  await Promise.all([image, speech]);
  lateExpiry.resolve();
  await lyrics;

  assert.equal(calls.filter(c => c.path === refreshPath).length, 1);
  for (const path of ['/api/generate/image', '/api/generate/speech', '/api/generate/lyrics']) {
    const attempts = calls.filter(c => c.path === path);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].body, attempts[1].body);
  }
  assert.deepEqual(oldResponses.map(result => result.reads), [1, 1, 1]);
  assert.equal(values.get('refresh_token'), 'fixture-fresh-refresh');
});

test('one token-expiry replay remains the limit across transient read retries', async () => {
  const failures = [tokenExpired(), response(503, { error: 'temporary' }), tokenExpired()];
  let reads = 0;
  const { api, calls, delays } = fixture(call => {
    if (call.path === refreshPath) return refreshed();
    return failures[reads++] || response(200, { success: true });
  });
  await assert.rejects(api.getWorks(), { status: 401, code: 'TOKEN_EXPIRED', message: 'fixture token expired' });
  assert.equal(reads, 3);
  assert.equal(calls.filter(c => c.path === refreshPath).length, 1);
  assert.deepEqual(failures.map(result => result.reads), [1, 1, 1]);
  assert.deepEqual(delays, [1000]);
});

test('concurrent expiry does not repeat an ambiguously failed refresh', async () => {
  const refreshFailed = deferred();
  const { api, calls, values, authUI } = fixture(call => {
    if (call.path === refreshPath) return refreshFailed.promise;
    return tokenExpired();
  });
  const outcomes = Promise.allSettled([api.getWorks(), api.generateMusic({ text: 'fixture' })]);
  // A lost response after a refresh POST can mean the server rotated the token.
  refreshFailed.resolve(response(503, { error: 'refresh result unknown' }));
  for (const outcome of await outcomes) {
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.reason.status, 401);
    assert.equal(outcome.reason.code, 'TOKEN_EXPIRED');
  }
  assert.equal(calls.filter(c => c.path === refreshPath).length, 1);
  assert.equal(calls.length, 3);
  assert.equal(values.has('auth_token'), false);
  assert.equal(values.has('refresh_token'), false);
  assert.deepEqual(authUI, [false, 'show-login']);
});

test('a refresh response from an old session cannot overwrite or replay into a new login', { timeout: 2000 }, async () => {
  const refreshStarted = deferred();
  const finishRefresh = deferred();
  const { api, calls, values } = fixture(call => {
    if (call.path === refreshPath) {
      refreshStarted.resolve();
      return finishRefresh.promise;
    }
    return tokenExpired();
  });
  const pending = api.generateImage({ prompt: 'first account' });
  const rejection = assert.rejects(pending, { status: 401, code: 'TOKEN_EXPIRED' });
  await refreshStarted.promise;
  api.setToken('fixture-second-access', 'fixture-second-refresh');
  finishRefresh.resolve(refreshed());
  await rejection;
  assert.equal(calls.length, 2);
  assert.equal(values.get('auth_token'), 'fixture-second-access');
  assert.equal(values.get('refresh_token'), 'fixture-second-refresh');
});
