import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { syntheticToneWav } from './fixtures/dialogue-browser-provider.mjs';

const root = new URL('../', import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), 'minimax-legacy-browser-'));
const fixture = syntheticToneWav();
const fixtureKey = 'browser-fixture-key';
const audio = fixture.toString('hex');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrpQAAAAASUVORK5CYII=';
const report = { browser: null, checks: [], pageErrors: [], unexpectedRequests: [], passed: false };
const quota = { image: { used: 0, limit: 1 }, speech: { used: 0, limit: 1 }, music: { used: 0, limit: 1 } };
const works = [
  { id: 1, title: '历史语音', work_type: 'speech', result_data: audio, params: { audio_format: 'wav' } },
  { id: 2, title: '历史音乐', work_type: 'music', result_url: '/fixture.wav', params: { audio_format: 'wav' } },
  { id: 3, title: '损坏的音频', work_type: 'music', result_data: '0z', params: { audio_format: 'wav' } }
];
const calls = [];
let health = 'html';
let directReply = 'hex';
const service = { service: 'minimax-studio-backend', status: 'ok' };
const json = (res, body) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
const data = (res, value) => json(res, { success: true, data: value });
const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://127.0.0.1');
  calls.push({ method: req.method, pathname, authorization: req.headers.authorization });
  if (pathname === '/api/health') {
    if (health === 'html') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html>');
    if (health === 'other') return json(res, { service: 'unrelated-service', status: 'ok' });
    if (health === 'redirect') return res.writeHead(302, { Location: '/fixture-health' }).end();
    if (health === 'slow') return res.writeHead(200, { 'Content-Type': 'application/json' }).write('{"service":');
    return json(res, service);
  }
  if (pathname === '/fixture-health') return json(res, service);
  if (pathname === '/api/auth/login') {
    return data(res, { accessToken: 'fixture-login', refreshToken: 'fixture-refresh', user: { username: 'fixture' } });
  }
  if (pathname === '/api/generate/quota') return data(res, quota);
  if (pathname === '/api/works') return data(res, { works });
  const work = works.find(item => pathname === `/api/works/${item.id}`);
  if (work) return data(res, work);
  if (pathname === '/fixture.wav') return res.writeHead(200, { 'Content-Type': 'audio/wav' }).end(fixture);
  if (pathname === '/v1/slow') return res.writeHead(200, { 'Content-Type': 'application/json' }).write('{');
  if (pathname === '/v1/image_generation') {
    return json(res, { base_resp: { status_code: 0 }, data: { image_base64: [png] } });
  }
  if (pathname === '/v1/t2a_v2') {
    if (directReply === 'empty') return json(res, null);
    return json(res, {
      base_resp: { status_code: 0 },
      data: { audio: directReply === 'hex' ? audio : `http://127.0.0.1:${server.address().port}/fixture.wav` },
      extra_info: { audio_format: 'wav' }
    });
  }
  if (!/^\/(?:index\.html|(?:css|js)\/[a-z-]+\.(?:css|js))$/.test(pathname)) {
    return res.writeHead(404).end();
  }
  try {
    const asset = await readFile(new URL(pathname.slice(1), root));
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
    res.writeHead(200, { 'Content-Type': types[extname(pathname)] }).end(asset);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function newPage(browser) {
  const context = await browser.createBrowserContext({ downloadBehavior: { policy: 'allow', downloadPath: temporary } });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return void request.continue();
    if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) report.unexpectedRequests.push(url.origin);
    return void request.abort();
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

async function status(page, expected) {
  await page.waitForFunction(text => document.querySelector('#api-status').textContent.includes(text)
      && !document.querySelector('#generate-btn').disabled, { timeout: 6000 }, expected);
}

async function readyAudio(page, sourcePrefix) {
  await page.waitForFunction(prefix => {
    const player = document.querySelector('.audio-player');
    return player?.src.startsWith(prefix) && player.readyState >= 2 && player.duration === 1;
  }, { timeout: 8000 }, sourcePrefix);
  assert.equal(await page.$eval('.audio-player', el => el.error), null);
}

async function downloaded(path) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      return await readFile(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await delay(50);
    }
  }
  assert.fail('browser download did not complete');
}

function passed(check) {
  report.checks.push(check);
  console.log(`PASS ${check}`);
}

let browser;
try {
  browser = await puppeteer.launch({
    headless: true, executablePath: process.env.CHROME_PATH, userDataDir: join(temporary, 'profile'),
    args: ['--disable-background-networking', '--no-sandbox']
  });
  report.browser = await browser.version();
  let { context, page } = await newPage(browser);
  await status(page, '直连 · 未配置密钥');
  assert.equal(await page.$eval('#apikey-modal', el => el.classList.contains('open')), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'apikey-input');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'generate-btn');
  await page.click('#generate-btn');
  await page.type('#apikey-input', fixtureKey);
  await page.click('#apikey-form button[type=submit]');
  await status(page, '直连 · 密钥已保存');
  assert.equal(await page.$eval('#api-status .status-dot', el => el.classList.contains('connected')), false);
  assert.equal(await page.$eval('#my-works-btn', el => getComputedStyle(el).display), 'none');
  assert.equal(calls.filter(call => call.authorization).length, 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await status(page, '直连 · 密钥已保存');
  assert.equal(await page.$eval('#apikey-modal', el => el.classList.contains('open')), false);
  for (const model of ['chat', 'video']) {
    const button = `[data-model="${model}"]`;
    assert.equal(await page.$eval(button, el => el.disabled && el.textContent.includes('暂不可用')), true);
    await page.$eval(button, el => el.click());
  }
  assert.equal(await page.$eval('.nav-item.active', el => el.dataset.model), 'image');
  passed('HTML 200 selects Direct Mode; key form saves across reload, without auth or a verified badge; Chat and video are disabled');

  await page.evaluate(url => api.setBaseUrl(url), base);
  await page.click('[data-model="speech"]');
  await page.type('[data-key="text"]', '合成测试');
  await page.click('#generate-btn');
  await readyAudio(page, 'blob:');
  const directBlobUrl = await page.$eval('.audio-player', el => el.src);
  await page.select('[data-key="output_format"]', 'url');
  await page.click('.audio-download');
  assert.deepEqual(await downloaded(join(temporary, 'minimax_speech.wav')), fixture);
  directReply = 'url';
  await page.click('#generate-btn');
  await readyAudio(page, `${base}/fixture.wav`);
  assert.equal(await page.$eval('.audio-download', el => el.textContent), '打开音频');
  assert.equal(await page.evaluate(async url => {
    try { await fetch(url); return false; } catch { return true; }
  }, directBlobUrl), true);
  assert.deepEqual(calls.filter(call => call.pathname === '/v1/t2a_v2').map(call => call.authorization), [
    `Bearer ${fixtureKey}`, `Bearer ${fixtureKey}`
  ]);
  passed('Direct speech plays synthetic WAV from hex and URL; native download matches original bytes; replaced blob is revoked');

  directReply = 'empty';
  await page.click('#generate-btn');
  await page.waitForSelector('.error-result');
  assert.match(await page.$eval('.error-result', el => el.textContent), /无效的响应数据/);
  assert.equal(await page.$('.audio-player'), null);
  const timeoutMessage = await page.evaluate(async () => {
    try {
      await api.request('/v1/slow', { text: 'fixture' }, { timeout: 400 });
      return '';
    } catch (error) { return error.message; }
  });
  assert.equal(timeoutMessage, '请求超时，生成结果未知');
  assert.equal(calls.filter(call => call.pathname === '/v1/slow').length, 1);
  passed('empty success is rejected and the response-body deadline aborts a partial POST without retrying');

  await page.click('[data-model="image"]');
  await page.type('[data-key="prompt"]', 'fixture image');
  await page.select('[data-key="response_format"]', 'base64');
  await page.click('#generate-btn');
  await page.waitForFunction(() => document.querySelector('.image-card img')?.naturalWidth === 1);
  passed('base64 image bytes render through the real image generation UI');
  await context.close();

  for (const mode of ['other', 'redirect', 'slow']) {
    health = mode;
    ({ context, page } = await newPage(browser));
    await status(page, '直连 · 未配置密钥');
    await context.close();
  }
  assert.equal(calls.some(call => call.pathname === '/fixture-health'), false);
  passed('wrong JSON identity, redirects and incomplete health bodies select Direct Mode');

  health = 'valid';
  ({ context, page } = await newPage(browser));
  await status(page, '后台模式 · 未登录');
  await page.type('#auth-email', 'fixture@example.invalid');
  await page.type('#auth-password', 'fixture-pass');
  await page.click('#auth-submit-btn');
  await status(page, '后台模式 · 已登录');
  for (const [id, prefix] of [[1, 'blob:'], [2, `${base}/fixture.wav`], [3, null]]) {
    await page.click('#user-menu-toggle');
    await page.waitForFunction(() => {
      const item = document.querySelector('#my-works-btn');
      const rect = item.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit && item.contains(hit);
    }, { timeout: 4000 });
    await page.click('#my-works-btn');
    assert.equal(await page.$eval('#works-modal', el => el.classList.contains('open')), true);
    const viewButton = `[data-id="${id}"] [data-work-action="view"]`;
    await page.waitForSelector(viewButton, { timeout: 5000 }).catch(async error => {
      error.message += ` — ${await page.$eval('#works-content', el => el.textContent.trim().slice(0, 160))}`;
      throw error;
    });
    await page.click(viewButton);
    if (prefix) await readyAudio(page, prefix);
    else {
      await page.waitForSelector('.error-result');
      assert.equal(await page.$('.audio-player'), null);
    }
  }
  assert.ok(calls.some(call => call.pathname === '/api/works/1' && call.authorization === 'Bearer fixture-login'));
  passed('identified backend routes to sign-in; historical WAV and URL audio open through My Works; invalid hex fails visibly');
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.unexpectedRequests, []);
  report.passed = true;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
  if (process.env.LEGACY_QA_REPORT) {
    await writeFile(process.env.LEGACY_QA_REPORT, JSON.stringify(report, null, 2) + '\n');
  }
}
