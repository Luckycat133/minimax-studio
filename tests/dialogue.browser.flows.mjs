/** Additional real-browser fixtures. Prepared under restricted cloud; execution is separately reported. */
import assert from 'node:assert/strict';
import { writeFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createDialogueProvider } from '../server/dialogue-provider.mjs';
import { createDialogueServer } from '../server/dialogue-server.mjs';
import { toCSV } from '../js/dialogue-core.mjs';
import { syntheticToneWav, createBrowserFixtureProvider } from './fixtures/dialogue-browser-provider.mjs';

export async function guardTestPage(page, allowedOrigins, report) {
  page.on('pageerror', error => report.page_errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (/^(data:|blob:)/.test(url) || allowedOrigins.some(origin => url.startsWith(`${origin}/`))) void request.continue();
    else { report.external_requests.push(url); void request.abort(); }
  });
}
const state = page => page.evaluate(() => JSON.parse(localStorage.getItem('minimax_studio_production_v2')));
const queue = page => page.evaluate(() => JSON.parse(localStorage.getItem('minimax_dialogue_queue_v2')));
const text = (page, selector) => page.$eval(selector, element => element.textContent);
async function fill(page, selector, value) {
  await page.$eval(selector, (element, next) => { element.value = next; element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}
async function waitUntil(check, message) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  assert.fail(message);
}
async function uploadProject(page, filename) {
  await page.click('#import-btn'); await (await page.$('#import-file')).uploadFile(filename);
  await page.waitForFunction(() => !document.getElementById('apply-import').disabled);
  await page.click('#apply-import'); await page.waitForFunction(() => !document.getElementById('import-dialog').open);
}
async function selectLine(page, id) { await page.click(`[data-line-id="${id}"]`); }
async function takeAction(page, label, index = 0) {
  await page.$$eval('.take-card', (cards, options) => {
    const button = [...cards[options.index].querySelectorAll('button')].find(item => item.textContent === options.label);
    if (!button || button.disabled) throw new Error(`Unavailable take action: ${options.label}`); button.click();
  }, { label, index });
}
async function queueAction(page, id, status, label) {
  await page.$$eval('.queue-row', (rows, options) => {
    const row = [...rows].reverse().find(item => item.textContent.startsWith(`${options.id} · ${options.status}`));
    const button = row && [...row.querySelectorAll('button')].find(item => item.textContent === options.label);
    if (!button || button.disabled) throw new Error(`Unavailable queue action: ${options.id}/${options.status}/${options.label}`); button.click();
  }, { id, status, label });
}
async function importAudio(page, filename, expectedTakes) {
  const lineId = await text(page, '#selected-id');
  // A fresh mutation, rather than a stale "saved" label from the previous take,
  // establishes that this import reached its final feedback after IndexedDB.
  const feedback = page.$eval('#notice', (element, id) => new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); observer.disconnect(); error ? reject(error) : resolve(); };
    const observer = new MutationObserver(() => {
      if (element.textContent.includes(`${id} 已加入真实录音`)) finish();
      else if (element.classList.contains('error')) finish(new Error(element.textContent));
    });
    const timer = setTimeout(() => finish(new Error('WAV import feedback did not arrive')), 8000);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
  }), lineId);
  await Promise.all([feedback, (await page.$('#audio-file')).uploadFile(filename)]);
  await page.waitForFunction(expected => JSON.parse(localStorage.getItem('minimax_studio_production_v2')).takes.length === expected, {}, expectedTakes);
}
const waitQueueIdle = page => page.waitForFunction(() => document.getElementById('queue-pause-btn').disabled);

export async function runVoiceBrowserFlows({ browser, root, output, report, passed, base, snapshot }) {
  const contexts = [], services = [], wav = syntheticToneWav(), fixture = createBrowserFixtureProvider(wav);
  let keyReads = 0, providerTransportCalls = 0;
  // Guard the actual adapter in its default OFF mode with tripwires. No real key
  // loader or network transport is supplied anywhere in this test module.
  const disabledProvider = createDialogueProvider({
    enabled: false,
    loadApiKey: () => { keyReads++; throw new Error('Credential access forbidden in browser QA'); },
    fetchImpl: () => { providerTransportCalls++; throw new Error('Live provider transport forbidden in browser QA'); }
  });
  assert.equal(disabledProvider.status().enabled, false);
  assert.equal(disabledProvider.status().reason, 'generation_disabled');
  const denied = await disabledProvider.generate({ operation_id: 'fixture_disabled_guard', text: '完全虚构的配音测试。', voice_id: 'male-qn-qingse', model: 'speech-2.8-turbo', speed: 1, pitch: 0, emotion: '', pronunciation: [] });
  assert.equal(denied.body.error.code, 'generation_disabled');
  assert.equal(keyReads, 0); assert.equal(providerTransportCalls, 0);
  const newPage = async origin => {
    const context = await browser.createBrowserContext(); contexts.push(context);
    const page = await context.newPage(); await page.setViewport({ width: 1440, height: 1100 });
    await guardTestPage(page, [origin], report); return { page, context };
  };
  try {
    const wavPath = join(output, 'fixture-synthetic-tone.wav'), csvPath = join(output, 'fixture-20-lines-3-roles.csv');
    const badWavPath = join(output, 'fixture-invalid.wav');
    await writeFile(wavPath, wav); await writeFile(badWavPath, Buffer.alloc(60));
    const project = { ...snapshot, lines: snapshot.lines.map(line => ({ ...line, text: `${line.text}（云端测试）` })) };
    assert.equal(project.lines.length, 20); assert.equal(new Set(project.lines.map(line => line.character)).size, 3);
    await writeFile(csvPath, toCSV(project));
    const { page, context } = await newPage(base);
    await page.goto(`${base}/dialogue.html`, { waitUntil: 'networkidle0' });
    assert.equal(await text(page, '#role-count'), '3');
    // Establish a persisted baseline through the UI so cancellation can compare
    // the whole production state, not just one visible editor field.
    await page.click('#check-btn'); const beforeCsvCancel = await state(page);
    await page.click('#import-btn'); await (await page.$('#import-file')).uploadFile(csvPath);
    await page.waitForFunction(() => !document.getElementById('apply-import').disabled);
    assert.match(await text(page, '#import-preview'), /合计 20 条/);
    await page.click('#import-cancel'); assert.deepEqual(await state(page), beforeCsvCancel);
    assert.equal(await page.$eval('#text', element => element.value), snapshot.lines[0].text);
    await uploadProject(page, csvPath);
    assert.equal((await state(page)).project.lines.length, 20); assert.equal(await text(page, '#role-count'), '3');
    assert.deepEqual((await state(page)).project.lines.map(line => line.text), project.lines.map(line => line.text));

    const roles = [...new Set(project.lines.map(line => line.character))], voices = ['male-qn-qingse', 'female-yujie', 'Chinese (Mandarin)_Humorous_Elder'];
    for (const [index, role] of roles.entries()) {
      const beforeCast = await state(page);
      await page.$$eval('.role-item', (items, name) => items.find(item => item.getAttribute('aria-label') === `配置 ${name} 音色`).click(), role);
      if (index === 0) {
        await fill(page, '#cast-speed', '5'); await page.click('#cast-form button[type="submit"]');
        assert.equal(await page.$eval('#cast-dialog', element => element.open), true);
        assert.equal(await page.$eval('#cast-speed', element => element.validity.valid), false);
        assert.deepEqual(await state(page), beforeCast);
        await fill(page, '#cast-speed', '1'); await fill(page, '#cast-pronunciation', '缺少分隔符');
        await page.click('#cast-form button[type="submit"]'); assert.match(await text(page, '#cast-error'), /词语\/读音/);
        assert.deepEqual(await state(page), beforeCast);
        await page.click('#cast-cancel'); assert.deepEqual(await state(page), beforeCast);
        await page.click('#cast-btn');
      }
      await page.select('#cast-voice', voices[index]); await fill(page, '#cast-pronunciation', '');
      await page.click('#cast-form button[type="submit"]');
      await page.waitForFunction(() => !document.getElementById('cast-dialog').open);
    }
    const castState = await state(page);
    assert.deepEqual(castState.cast.map(item => item.voice_id), voices);
    assert.equal(await page.$eval('#generate-line-btn', element => element.disabled), true);
    await page.screenshot({ path: join(output, 'fixture-20-lines-cast-desktop.png'), fullPage: true });
    passed('20 fictional Chinese lines import atomically; three roles cast; invalid/cancelled casting changes nothing; provider remains off');

    await importAudio(page, wavPath, 1); await takeAction(page, '审核通过');
    assert.equal(await text(page, '#count-approved'), '1');
    await takeAction(page, '退回'); assert.equal(await text(page, '#count-approved'), '0');
    assert.equal((await state(page)).takes[0].review, 'rejected');
    await importAudio(page, wavPath, 2);
    assert.equal((await state(page)).takes[0].review, 'rejected');
    const beforeInvalid = JSON.stringify(await state(page));
    await (await page.$('#audio-file')).uploadFile(badWavPath);
    await page.waitForFunction(() => document.getElementById('notice').textContent.includes('WAV'));
    assert.equal(JSON.stringify(await state(page)), beforeInvalid);
    // Synthetic DOM events test failure/recovery feedback in a real renderer.
    // They do not claim that a real decoder failed or that a human heard audio.
    // Explicitly load the one-second blob; preload=metadata alone is allowed to
    // stop before canplay. This is fixture media preparation, not audio heard.
    await page.$eval('.take-card audio', player => { player.preload = 'auto'; player.load(); });
    await page.waitForFunction(() => document.querySelector('.take-card audio')?.readyState === HTMLMediaElement.HAVE_ENOUGH_DATA, { timeout: 8000 });
    await page.$eval('.take-card audio', player => { player.dispatchEvent(new Event('error')); player.dispatchEvent(new Event('error')); });
    assert.match(await text(page, '.take-card'), /无法播放/);
    assert.equal(await page.$eval('.take-card', card => card.querySelectorAll('[role="alert"]').length), 1);
    assert.equal(await page.$eval('.take-card [role="alert"]', element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    }), true);
    assert.match(await text(page, '#notice'), /无法播放/);
    assert.ok((await text(page, '#notice')).includes((await state(page)).takes.at(-1).take_id));
    assert.equal(JSON.stringify(await state(page)), beforeInvalid);
    await page.screenshot({ path: join(output, 'fixture-player-error-feedback.png'), fullPage: true });
    await page.$eval('.take-card audio', player => player.dispatchEvent(new Event('canplay')));
    assert.equal(await page.$eval('.take-card [role="alert"]', element => element.hidden), true);
    assert.equal(await text(page, '.take-card [role="alert"]'), '');
    assert.match(await text(page, '#notice'), /已可播放/);
    assert.equal(JSON.stringify(await state(page)), beforeInvalid);
    await takeAction(page, '审核通过');
    for (const [index, line] of project.lines.slice(1).entries()) {
      await selectLine(page, line.line_id); await importAudio(page, wavPath, index + 3); await takeAction(page, '审核通过');
    }
    assert.equal(await text(page, '#count-approved'), '20');
    assert.equal((await state(page)).takes.length, 21);
    await page.screenshot({ path: join(output, 'fixture-20-lines-approved.png'), fullPage: true });
    const downloadClient = await page.createCDPSession();
    const downloadDir = join(output, 'full-project-download');
    await mkdir(downloadDir, { recursive: true });
    await downloadClient.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, browserContextId: context.id });
    await page.click('#export-btn'); const zipPath = join(downloadDir, 'minimax-dialogue-approved.zip');
    await waitUntil(async () => { try { await access(zipPath); return true; } catch { return false; } }, '20-line approved ZIP not downloaded');
    execFileSync('python3', ['-c', `import zipfile,json,sys,hashlib
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
m=json.loads(z.read('manifest.json')); expected_ids=json.loads(sys.argv[3])
assert m['deliverable_complete'] and m['summary']=={'total':20,'approved':20,'unresolved':0}
assert not m['audio_generated'] and len(m['lines'])==20 and len(m['takes'])==21
ids=[line['line_id'] for line in m['lines']]
assert ids==expected_ids and len(set(ids))==20
assert sum(line['status']=='approved' for line in m['lines'])==20
b=open(sys.argv[2],'rb').read(); digest=hashlib.sha256(b).hexdigest()
for line in m['lines']:
    assert line['audio'] and z.read(line['audio'])==b and line['sha256']==digest
assert sum(take['review']=='rejected' for take in m['takes'])==1
for take in m['takes']:
    assert take['archive_audio'] and z.read(take['archive_audio'])==b and take['sha256']==digest
`, zipPath, wavPath, JSON.stringify(project.lines.map(line => line.line_id))]);
    const { page: restored } = await newPage(base); await restored.goto(`${base}/dialogue.html`, { waitUntil: 'networkidle0' });
    await uploadProject(restored, zipPath); await restored.waitForFunction(() => document.getElementById('count-approved').textContent === '20');
    await restored.waitForFunction(() => document.getElementById('notice').textContent.includes('项目已恢复'));
    assert.deepEqual((await state(restored)).cast, castState.cast);
    assert.equal((await state(restored)).takes[0].review, 'rejected');
    assert.deepEqual((await state(restored)).project.lines.map(line => line.text), project.lines.map(line => line.text));
    await restored.waitForFunction(() => document.querySelector('audio')?.readyState >= 2);
    await restored.screenshot({ path: join(output, 'fixture-restored-20-lines.png'), fullPage: true });
    passed('repeat WAV import preserves rejected take; simulated player failure recovers; 20-line approved ZIP preserves bytes, cast and review state across fresh storage');

    const disabledService = createDialogueServer({ rootDir: root, provider: disabledProvider }); services.push(disabledService);
    const disabledAddress = await disabledService.start({ port: 0 });
    const { page: offPage } = await newPage(disabledAddress.origin); await offPage.goto(disabledAddress.url, { waitUntil: 'networkidle0' });
    await offPage.waitForFunction(() => document.getElementById('provider-title').textContent.includes('已连接'));
    assert.equal(await offPage.$eval('#generate-line-btn', element => element.disabled), true);
    await offPage.click('#queue-missing-btn'); await offPage.click('#queue-missing-btn');
    assert.equal((await queue(offPage)).filter(job => job.status === 'queued').length, 20);
    assert.equal(await offPage.$eval('#queue-start-btn', element => element.disabled), true);
    assert.equal(keyReads, 0); assert.equal(providerTransportCalls, 0);
    passed('actual loopback service stays disabled: generation/queue controls locked; no credential read or provider transport');

    const mockService = createDialogueServer({ rootDir: root, provider: fixture.provider }); services.push(mockService);
    const mockAddress = await mockService.start({ port: 0 });
    const queueProjectPath = join(output, 'fixture-cast-queue-project.json'); await writeFile(queueProjectPath, JSON.stringify(castState));
    const { page: mockPage } = await newPage(mockAddress.origin); await mockPage.goto(mockAddress.url, { waitUntil: 'networkidle0' });
    await uploadProject(mockPage, queueProjectPath);
    await mockPage.click('#queue-missing-btn'); await mockPage.click('#queue-missing-btn');
    assert.equal((await queue(mockPage)).filter(job => job.status === 'queued').length, 20); assert.equal(fixture.calls.length, 0);
    fixture.plan('hold'); await mockPage.click('#queue-start-btn');
    await waitUntil(() => fixture.calls.length === 1, 'First mock dispatch missing');
    await mockPage.click('#queue-pause-btn'); fixture.release(fixture.calls[0].operation_id);
    await mockPage.waitForFunction(() => document.getElementById('queue-summary').textContent.includes('19 等待') && document.getElementById('queue-summary').textContent.includes('已暂停'));
    assert.equal(fixture.calls.length, 1);
    await mockPage.click('#queue-cancel-btn');
    assert.equal((await queue(mockPage)).filter(job => job.status === 'cancelled').length, 19);

    const secondId = project.lines[1].line_id;
    await queueAction(mockPage, secondId, '已取消', '重新排入'); assert.equal(fixture.calls.length, 1);
    fixture.plan('reject'); await mockPage.click('#queue-start-btn');
    await mockPage.waitForFunction(() => document.getElementById('queue-list').textContent.includes('Synthetic rate limit'));
    await waitQueueIdle(mockPage);
    assert.equal(fixture.calls.length, 2);
    await queueAction(mockPage, secondId, '失败', '重新排入'); assert.equal(fixture.calls.length, 2);
    fixture.plan('success'); await mockPage.click('#queue-start-btn');
    await waitUntil(async () => (await state(mockPage)).takes.length === 2, 'Explicit mock retry did not complete');
    await waitQueueIdle(mockPage);
    assert.equal(fixture.calls.length, 3); assert.notEqual(fixture.calls[1].operation_id, fixture.calls[2].operation_id);

    const thirdId = project.lines[2].line_id;
    await queueAction(mockPage, thirdId, '已取消', '重新排入');
    fixture.plan('uncertain'); await mockPage.click('#queue-start-btn');
    await mockPage.waitForFunction(() => document.getElementById('queue-list').textContent.includes('恢复上次结果'));
    await waitQueueIdle(mockPage);
    assert.equal(fixture.calls.length, 4); const uncertainOperation = fixture.calls[3].operation_id;
    const beforeCancel = JSON.stringify(await queue(mockPage));
    mockPage.once('dialog', dialog => dialog.dismiss()); await queueAction(mockPage, thirdId, '失败', '另发新请求');
    assert.equal(JSON.stringify(await queue(mockPage)), beforeCancel); assert.equal(fixture.calls.length, 4);
    await mockPage.reload({ waitUntil: 'networkidle0' });
    assert.equal(fixture.calls.length, 4);
    assert.ok((await queue(mockPage)).some(job => job.operation_id === uncertainOperation && job.uncertain));
    await queueAction(mockPage, thirdId, '失败', '恢复上次结果');
    await waitUntil(async () => (await state(mockPage)).takes.length === 3, 'Read-only mock recovery did not restore audio');
    await waitQueueIdle(mockPage);
    assert.equal(fixture.calls.length, 4); assert.deepEqual(fixture.lookups, [uncertainOperation]);
    passed('mock queue deduplicates, pauses active work safely, cancels waiting work, retries only explicitly, and recovers an uncertain original operation by GET across reload');

    await mockPage.click('#queue-missing-btn'); await selectLine(mockPage, project.lines[3].line_id);
    fixture.plan('success'); await mockPage.click('#generate-line-btn');
    await waitUntil(async () => (await state(mockPage)).takes.length === 4, 'Isolated single-line mock generation did not finish');
    await waitQueueIdle(mockPage);
    assert.equal(fixture.calls.length, 5); assert.equal((await queue(mockPage)).filter(job => job.status === 'queued').length, 19);
    await mockPage.click('#queue-cancel-btn');
    await selectLine(mockPage, project.lines[4].line_id); fixture.plan('uncertain'); await mockPage.click('#generate-line-btn');
    await waitUntil(() => fixture.calls.length === 6, 'Second uncertain fixture dispatch missing');
    await mockPage.waitForFunction(() => document.getElementById('queue-list').textContent.includes('恢复上次结果'));
    await waitQueueIdle(mockPage);
    fixture.changeSession(); await queueAction(mockPage, project.lines[4].line_id, '失败', '恢复上次结果');
    await mockPage.waitForFunction(() => document.getElementById('notice').textContent.includes('服务已重启'));
    assert.equal(fixture.calls.length, 6); assert.equal(fixture.lookups.length, 1);
    await mockPage.screenshot({ path: join(output, 'fixture-mock-queue-session-guard.png'), fullPage: true });
    fixture.assertSafe(); assert.equal(keyReads, 0); assert.equal(providerTransportCalls, 0);
    assert.deepEqual(report.external_requests, []); assert.deepEqual(report.page_errors, []);
    report.fixture_contract = { fictional_lines: 20, roles: 3, synthetic_wav_bytes: wav.length, imported_takes: 21,
      mock_generation_calls: fixture.calls.length, read_only_result_lookups: fixture.lookups.length,
      real_provider_transport_calls: providerTransportCalls, credential_reads: keyReads,
      player_error: 'synthetic DOM event in real browser, not an induced codec failure', audio_heard: 'NOT_ASSESSED' };
    passed('single-line mock request leaves batch waiting; changed server session blocks old-result recovery without dispatch or lookup');
  } finally {
    fixture.releaseAll();
    await Promise.allSettled(contexts.reverse().map(context => context.close()));
    await Promise.allSettled(services.reverse().map(service => service.close()));
  }
}
