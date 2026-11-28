/** Real UI and loopback HTTP faults; no MiniMax or other external network. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, request as upstreamRequest } from 'node:http';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';
import {downloadStudioAudio} from './browser-download.mjs';
import { createStudioServer } from '../server/studio-server.mjs';

const fixture = readFileSync(new URL('../server/fixtures/preview.wav', import.meta.url));
const studio = createStudioServer();
const studioOrigin = await studio.start(0);
const faults = [429, 502, 504];
const watched = [];
const credentialHeaders = [];
let firstAudio = true;
let browser;
let origin;
const proxy = createServer((req, res) => {
  const path = req.url;
  const isOperation = path.startsWith('/api/studio/operations');
  if (isOperation) {
    watched.push({ method: req.method, path, at: performance.now() });
    if (req.headers.authorization || req.headers.cookie) credentialHeaders.push(req.method);
  }
  const idRoute = /^\/api\/studio\/operations\/[0-9a-f]{32}$/;
  if (req.method === 'GET' && idRoute.test(path) && faults.length) {
    const status = faults.shift();
    res.writeHead(status, {'Content-Type':'text/html',...(status === 429 ? {'Retry-After':'1'} : {})});
    return res.end('<b>PRIVATE_PROXY_PAYLOAD</b>');
  }
  if (req.method === 'GET' && /\/download$/.test(path) && firstAudio) {
    firstAudio = false;
    // HTTP framing finishes normally, but RIFF's declared bytes never arrive.
    res.writeHead(200, {'Content-Type':'audio/wav','Transfer-Encoding':'chunked'});
    res.write(fixture.subarray(0,60));
    return setImmediate(() => res.end(fixture.subarray(60,180)));
  }
  const headers = {...req.headers, host:new URL(studioOrigin).host};
  if (headers.origin === origin) headers.origin = studioOrigin;
  const upstream = upstreamRequest(studioOrigin + path, {method:req.method,headers}, incoming => {
    res.writeHead(incoming.statusCode, incoming.headers);
    incoming.on('error', () => res.destroy());
    incoming.pipe(res);
  });
  upstream.on('error', () => { if (res.headersSent) res.destroy(); else res.writeHead(502).end(); });
  req.pipe(upstream);
});

try {
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
  origin = 'http://127.0.0.1:' + proxy.address().port;
  browser = await puppeteer.launch({
    headless:true, executablePath:process.env.CHROME_PATH, args:['--no-sandbox','--disable-background-networking']
  });
  const page = await browser.newPage();
  const external = [], errors = [];
  page.on('pageerror', error=>errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    window.__studioLocalWrites = [];
    Storage.prototype.setItem = function(key, value) {
      if (this === localStorage) window.__studioLocalWrites.push(['set', key, value]);
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function(key) {
      if (this === localStorage) window.__studioLocalWrites.push(['remove', key]);
      return remove.call(this, key);
    };
  });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return void req.continue();
    external.push(url.href); void req.abort();
  });
  await page.goto(origin);
  await page.waitForFunction(()=>document.querySelector('#api-status').textContent.includes('零额度'));
  assert.equal(await page.$eval('#apikey-modal', x => x.classList.contains('open')),false);
  await page.click('[data-model="speech"]');
  await page.type('[data-key="text"]','fixture-not-a-key');
  await page.click('#generate-btn');
  await page.waitForFunction(()=>document.querySelector('#result-content').textContent.includes('下载中断或校验失败'),{timeout:12000});
  assert.equal(await page.$('.audio-player'), null);
  assert.equal(await page.$('.audio-download'), null);
  assert.equal(await page.$eval('#result-content',x=>x.innerText.includes('PRIVATE_PROXY_PAYLOAD')),false);
  const first = watched.filter(x=>x.method==='GET' && !x.path.endsWith('/download'));
  assert.ok(first.length >= 4);
  assert.ok(first[1].at - first[0].at >= 900, '429 Retry-After was not honored');
  assert.equal(watched.filter(x=>x.method==='POST').length,1);
  const original = watched.find(x=>x.method==='GET').path;
  assert.deepEqual(await page.evaluate(()=>window.__studioLocalWrites), []);
  assert.ok(await page.evaluate(()=>/^[0-9a-f]{32}$/.test(sessionStorage.getItem('minimax_studio_operation'))));

  // Recovery after page reload uses the identical operation, GET only, and a
  // verified local Blob. Never make the raw proxy URL playable or downloadable.
  await page.reload();
  await page.waitForSelector('#studio-resume',{visible:true});
  await page.click('#studio-resume');
  await page.waitForSelector('.audio-player',{visible:true});
  const bytes = await downloadStudioAudio(page, 'minimax_speech.wav');
  assert.deepEqual(bytes, fixture);
  assert.deepEqual(watched.filter(x=>x.path.endsWith('/download')).map(x=>x.path),[original+'/download',original+'/download']);
  assert.equal(watched.filter(x=>x.method==='POST').length, 1);
  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage), writes:window.__studioLocalWrites,
    pending:sessionStorage.getItem('minimax_studio_operation'), last:sessionStorage.getItem('minimax_studio_result')
  }));
  assert.deepEqual(storage.local, []);
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.pending, null);
  assert.equal(storage.last, original.split('/').at(-1));
  assert.deepEqual(credentialHeaders, []);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log('PASS: refused truncated streamed WAV, resumed exact bytes by GET after 429/502/504, no key storage or outbound calls');
} finally {
  await browser?.close();
  if (proxy.listening) await new Promise(resolve=>proxy.close(resolve));
  await studio.close();
}
