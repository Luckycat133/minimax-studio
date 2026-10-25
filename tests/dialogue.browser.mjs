/** Headless, isolated browser QA. Uses local static assets; all external requests are blocked. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { guardTestPage, runVoiceBrowserFlows } from './dialogue.browser.flows.mjs';
const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'minimax-offline-qa-'));
const output = process.env.QA_OUTPUT_DIR || temp; await mkdir(output, { recursive: true });
const site = join(temp, 'site');
execFileSync('python3', ['-c', 'from scripts.build_pages import build_pages; from pathlib import Path; import sys; build_pages(Path.cwd(), Path(sys.argv[1]))', site], { cwd: root });
const portable = join(temp, 'MiniMax_Studio_Offline.html'); execFileSync('python3', ['scripts/build_offline.py', portable], { cwd: root });
const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!/^\/(dialogue\.html|css\/[a-z-]+\.css|js\/[a-z-]+\.mjs)$/.test(pathname)) { res.writeHead(404); res.end(); return; }
  try { const body = await readFile(join(site, pathname)); res.setHeader('Content-Type', types[extname(pathname)]); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const report = { success: false, browser_execution: 'NOT_RUN', failure_stage: null, node_version: process.version, external_requests: [], page_errors: [], checks: [], live_provider: 'FORBIDDEN', audio_heard: 'NOT_ASSESSED' };
function passed(message) { report.checks.push(message); console.log(`PASS ${message}`); }
try {
  report.failure_stage = 'browser_launch';
  browser = await puppeteer.launch({ headless: true, userDataDir: join(temp, 'browser-profile'), env: { ...process.env, HOME: temp, XDG_CONFIG_HOME: join(temp, 'config'), XDG_CACHE_HOME: join(temp, 'cache') }, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  report.browser_version = await browser.version();
  report.browser_execution = 'RUNNING'; report.failure_stage = 'browser_workflows';
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1100 });
  await guardTestPage(page, [base], report);
  await page.goto(`${base}/dialogue.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.line-row');
  assert.equal(await page.$$eval('.line-row', rows => rows.length), 20);
  assert.equal(await page.$eval('#role-count', el => el.textContent), '3');
  assert.equal(await page.$eval('#count-missing', el => el.textContent), '20');
  assert.equal(await page.$eval('.locked-button', el => el.disabled), true);
  await page.screenshot({ path: join(output, 'desktop-offline-workspace.png'), fullPage: true });
  passed('initial 20-line, 3-role offline workspace renders with locked generation');
  const snapshot = await page.evaluate(() => import('./js/dialogue-core.mjs').then(module => module.sampleProject()));
  await page.$eval('#text', el => { el.value = '钟停在三点一刻，窗外却已亮起了灯。'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#check-btn'); assert.ok((await page.$eval('#notice', el => el.textContent)).includes('请先保存'));
  await page.click('#export-btn'); assert.ok((await page.$eval('#notice', el => el.textContent)).includes('请先保存'));
  page.once('dialog', dialog => dialog.dismiss()); await page.click('[data-line-id="SC01_L002"]');
  assert.equal(await page.$eval('#selected-id', el => el.textContent), 'SC01_L001');
  await page.click('#save-btn');
  assert.equal(await page.$eval('#revision', el => el.textContent), 'v002');
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('minimax_studio_production_v2')).project);
  assert.deepEqual(saved.lines.slice(1), snapshot.lines.slice(1)); assert.equal(saved.lines[0].history[0].text, snapshot.lines[0].text);
  passed('dirty edit blocks preflight/export; cancel navigation preserves it; saving changes only one of 20 lines');
  await page.click('#check-btn'); await page.click('#check-btn');
  assert.ok((await page.$eval('#check-count', el => el.textContent)).startsWith('2 次预检'));
  assert.equal(await page.$eval('#count-missing', el => el.textContent), '20');
  await page.reload({ waitUntil: 'networkidle0' }); assert.equal(await page.$eval('#revision', el => el.textContent), 'v002');
  passed('single-line retry is repeatable; revision and missing-audio state survive reload');
  await page.click('#import-btn'); await page.type('#import-text', 'line_id,character,text\nDUP,甲,x\nDUP,乙,y'); await page.click('#preview-btn');
  assert.ok((await page.$eval('#import-error', el => el.textContent)).includes('重复'));
  assert.equal(await page.$eval('#apply-import', el => el.disabled), true);
  await page.click('#import-cancel');
  assert.equal(await page.$eval('#count-total', el => el.textContent), '20');
  await page.click('#import-btn'); await page.type('#import-text', 'line_id,character,text,emotion,direction\nSC01_L002,顾青,先别碰指针。让我再看一眼那封信。,谨慎,轻声'); await page.click('#preview-btn');
  assert.ok((await page.$eval('#import-preview', el => el.textContent)).includes('更新 1 条'));
  await page.click('#apply-import'); saved = await page.evaluate(() => JSON.parse(localStorage.getItem('minimax_studio_production_v2')).project);
  assert.equal(saved.lines[1].revision, 2); assert.equal(saved.lines.length, 20); assert.deepEqual(saved.lines.slice(2), snapshot.lines.slice(2));
  passed('invalid import is atomic; CSV merge changes one matching ID and keeps 19 lines');
  await page.click('#import-btn'); await page.type('#import-text', 'line_id,character,text\nNEW,甲,你好'); await page.click('#preview-btn');
  assert.equal(await page.$eval('#apply-import', el => el.disabled), false);
  await page.type('#import-text', 'x'); assert.equal(await page.$eval('#apply-import', el => el.disabled), true);
  await page.keyboard.press('Escape'); assert.equal(await page.$eval('#import-dialog', el => el.open), false);
  passed('editing a preview invalidates Apply; Escape dismisses without side effects');
  const client = await page.createCDPSession(); await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: temp });
  await page.click('#draft-export-btn'); const zipPath = join(temp, 'minimax-dialogue-workspace.zip');
  for (let i = 0; i < 100; i++) { try { await access(zipPath); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
  const zipReport = JSON.parse(execFileSync('python3', ['-c', 'import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({"files":z.namelist(),"manifest":json.loads(z.read("manifest.json"))}))', zipPath], { encoding: 'utf8' }));
  assert.equal(zipReport.manifest.lines.length, 20); assert.equal(zipReport.manifest.deliverable_complete, false); assert.equal(zipReport.manifest.lines[0].audio, null);
  assert.ok(zipReport.files.every(name => !name.endsWith('.wav')));
  await writeFile(join(output, 'browser-export-no-audio.zip'), await readFile(zipPath));
  passed('actual downloaded ZIP passes CRC and manifest checks, with no pretend audio');
  await page.click('#import-btn');
  const jsonPath = join(temp, 'project.json'); await writeFile(jsonPath, JSON.stringify(saved));
  const input = await page.$('#import-file'); await input.uploadFile(jsonPath); await page.waitForFunction(() => !document.getElementById('apply-import').disabled);
  await page.click('#apply-import'); assert.equal(await page.$eval('#count-total', el => el.textContent), '20');
  await page.goto(`${base}/dialogue.html?return=1`, { waitUntil: 'networkidle0' }); await page.goBack({ waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('#revision', el => el.textContent), 'v002'); assert.equal(await page.$eval('#import-dialog', el => el.open), false);
  passed('JSON file import, reload and browser Back restore revisions without a stale dialog');
  await page.type('#search', '不存在的关键词'); assert.equal(await page.$$eval('.line-row', rows => rows.length), 0);
  await page.$eval('#search', el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }); await page.select('#filter', 'modified');
  assert.equal(await page.$$eval('.line-row', rows => rows.length), 2); await page.select('#filter', 'all');
  page.once('dialog', dialog => dialog.dismiss()); await page.click('#sample-btn'); assert.equal(await page.$eval('#revision', el => el.textContent), 'v002');
  passed('search/modified filters work; canceled reset leaves project intact');
  await page.setViewport({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: join(output, 'mobile-offline-workspace.png'), fullPage: true });
  passed('390px mobile layout has no horizontal overflow');
  assert.deepEqual(report.external_requests, []); assert.deepEqual(report.page_errors, []);
  // This tone is only a parser/native-player fixture, never a bundled demo voice.
  const wav = Buffer.alloc(44 + 32000 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(32000, 24); wav.writeUInt32LE(64000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 32000; i++) wav.writeInt16LE(Math.round(1000 * Math.sin(i * 2 * Math.PI * 220 / 32000)), 44 + i * 2);
  const wavPath = join(temp, 'synthetic-test-tone.wav'); await writeFile(wavPath, wav);
  const oneLinePath = join(temp, 'one-line.json'); await writeFile(oneLinePath, JSON.stringify({ ...snapshot, lines: [snapshot.lines[0]] }));
  const productionContext = await browser.createBrowserContext(), productionPage = await productionContext.newPage();
  await guardTestPage(productionPage, [base], report);
  await productionPage.goto(`${base}/dialogue.html`, { waitUntil: 'networkidle0' });
  await productionPage.click('#import-btn'); await (await productionPage.$('#import-file')).uploadFile(oneLinePath);
  await productionPage.waitForFunction(() => !document.getElementById('apply-import').disabled); await productionPage.click('#apply-import');
  await productionPage.waitForFunction(() => document.getElementById('count-total').textContent === '1');
  await (await productionPage.$('#audio-file')).uploadFile(wavPath);
  await productionPage.waitForFunction(() => document.querySelector('audio')?.readyState >= 2);
  await productionPage.$eval('audio', async element => { await element.play(); });
  await productionPage.waitForFunction(() => document.querySelector('audio').currentTime > 0);
  await productionPage.$eval('audio', element => element.pause());
  await productionPage.$$eval('.take-card button', buttons => buttons.find(button => button.textContent.includes('通过')).click());
  await productionPage.waitForFunction(() => document.getElementById('count-approved').textContent === '1');
  await productionPage.reload({ waitUntil: 'networkidle0' });
  await productionPage.waitForFunction(() => document.querySelector('audio')?.readyState >= 2 && document.getElementById('count-approved').textContent === '1');
  const productionClient = await productionPage.createCDPSession(); await productionClient.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: temp, browserContextId: productionContext.id });
  await productionPage.click('#export-btn'); const approvedZipPath = join(temp, 'minimax-dialogue-approved.zip');
  for (let i = 0; i < 100; i++) { try { await access(approvedZipPath); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
  execFileSync('python3', ['-c', 'import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; m=json.loads(z.read("manifest.json")); assert m["deliverable_complete"]; assert m["audio_generated"] is False; assert z.read(m["lines"][0]["audio"]) == open(sys.argv[2],"rb").read()', approvedZipPath, wavPath]);
  passed('real browser imports a synthetic WAV, advances native playback, persists reviewed bytes and downloads a verified audio ZIP');
  await productionContext.close();
  const restoreContext = await browser.createBrowserContext(), restorePage = await restoreContext.newPage();
  await guardTestPage(restorePage, [base], report);
  await restorePage.goto(`${base}/dialogue.html`, { waitUntil: 'networkidle0' });
  await restorePage.click('#import-btn'); await (await restorePage.$('#import-file')).uploadFile(approvedZipPath);
  await restorePage.waitForFunction(() => !document.getElementById('apply-import').disabled); await restorePage.click('#apply-import');
  await restorePage.waitForFunction(() => document.querySelector('audio')?.readyState >= 2 && document.getElementById('count-approved').textContent === '1');
  assert.equal(await restorePage.$eval('#count-total', element => element.textContent), '1');
  await restoreContext.close(); passed('work ZIP restores real audio and approved state in a fresh browser storage context');
  assert.deepEqual(report.external_requests, []); assert.deepEqual(report.page_errors, []);
  await runVoiceBrowserFlows({ browser, root, output, report, passed, base, snapshot });
  const portablePage = await browser.newPage(); const portableRequests = [], portableErrors = [];
  portablePage.on('pageerror', error => portableErrors.push(error.message)); portablePage.on('request', request => portableRequests.push(request.url()));
  await portablePage.setRequestInterception(true);
  portablePage.on('request', request => {
    if (request.url() === pathToFileURL(portable).href || /^(data:|blob:)/.test(request.url())) void request.continue();
    else { report.external_requests.push(request.url()); void request.abort(); }
  });
  await portablePage.goto(pathToFileURL(portable).href, { waitUntil: 'load' }); await portablePage.waitForSelector('.line-row');
  assert.equal(await portablePage.$$eval('.line-row', rows => rows.length), 20);
  await portablePage.click('#check-btn'); assert.ok((await portablePage.$eval('#check-count', el => el.textContent)).includes('1 次预检'));
  assert.ok(portableRequests.every(url => url.startsWith('file:') || url.startsWith('data:'))); assert.deepEqual(portableErrors, []);
  passed('standalone HTML works from file:// with hashed CSP and no server/network');
  assert.deepEqual(report.external_requests, []); assert.deepEqual(report.page_errors, []);
  report.success = true; report.browser_execution = 'PASS'; report.failure_stage = null;
  console.log(`QA artifacts: ${output}`);
} catch (error) {
  report.browser_execution = report.failure_stage === 'browser_launch' ? 'BLOCKED_BEFORE_PAGE' : 'FAIL';
  report.failure = String(error.stack || error); throw error;
} finally {
  try { await writeFile(join(output, 'browser-qa.json'), JSON.stringify(report, null, 2)); }
  finally { try { await browser?.close(); } finally { await new Promise(resolve => server.close(resolve)); } }
}
