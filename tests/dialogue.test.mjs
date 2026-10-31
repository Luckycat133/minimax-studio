import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { sampleProject, createProject, parseCSV, parseProject, editLine, checkLine, mergeRows, manifest, exportFiles, zipFiles, toCSV, currentFilename, OFFLINE_PROVIDER } from '../js/dialogue-core.mjs';
const row = (line_id = 'L001', text = '你好') => ({ line_id, character: '甲', text, emotion: '', direction: '' });

test('20 original Chinese lines / 3 characters / all real audio missing', () => {
  const project = sampleProject(), result = manifest(project);
  assert.equal(project.lines.length, 20); assert.equal(new Set(project.lines.map(line => line.character)).size, 3);
  assert.equal(new Set(project.lines.map(currentFilename)).size, 20);
  assert.equal(result.audio_generated, false); assert.equal(result.deliverable_complete, false);
  assert.equal(result.provider_requests, 0); assert.equal(result.summary.missing_audio, 20);
  assert.ok(result.lines.every(line => line.audio === null && line.voice_id === null));
});
test('single-line edit changes only one revision/filename and preserves original text', () => {
  const before = sampleProject(), next = editLine(before, 'SC01_L001', { text: '钟停在三点一刻，窗外却已亮起了灯。' });
  assert.equal(next.lines[0].revision, 2); assert.equal(next.lines[0].history[0].text, before.lines[0].text);
  assert.equal(next.lines[0].history[0].revision, 1);
  for (let i = 1; i < 20; i++) { assert.equal(next.lines[i], before.lines[i]); assert.equal(currentFilename(next.lines[i]), currentFilename(before.lines[i])); }
  assert.equal(currentFilename(next.lines[0]), 'audio/SC01_L001__r0002.wav');
  assert.equal(before.lines[0].revision, 1);
});
test('no-op save adds no version; ID cannot be changed by patch', () => {
  const project = sampleProject();
  assert.equal(editLine(project, 'SC01_L001', { text: project.lines[0].text }).lines[0], project.lines[0]);
  assert.equal(editLine(project, 'SC01_L001', { line_id: 'OTHER' }).lines[0].line_id, 'SC01_L001');
});
test('repeated single-line preflight never calls provider or changes filename', () => {
  const before = sampleProject(); let next = checkLine(before, 'SC01_L003'); next = checkLine(next, 'SC01_L003');
  assert.equal(next.lines[2].checks, 2); assert.equal(next.lines[2].revision, 1);
  assert.equal(next.lines[0], before.lines[0]); assert.equal(manifest(next).lines[2].status, 'provider_disabled');
  assert.equal(manifest(next).provider_requests, 0); assert.equal(manifest(next).summary.missing_audio, 20);
  next = editLine(next, 'SC01_L003', { emotion: '惊喜' });
  assert.equal(next.lines[2].checks, 0); assert.equal(next.lines[2].history[0].checks, 2);
});
test('real provider adapter fails closed even when called directly', async () => {
  assert.equal(OFFLINE_PROVIDER.enabled, false);
  await assert.rejects(OFFLINE_PROVIDER.generate(), /PROVIDER_DISABLED/);
});
test('CSV parses BOM, CRLF, comma, escaped quotes and multiline dialogue', () => {
  const rows = parseCSV('\uFEFFline_id,character,text,emotion,direction\r\nL1,甲,"你好, \"\"旅人\"\"\n请进。",温和,"停半拍"\r\n');
  assert.equal(rows[0].text, '你好, "旅人"\n请进。'); assert.equal(rows[0].direction, '停半拍');
});
test('CSV optional fields and sample roundtrip', () => {
  assert.deepEqual(parseCSV('line_id,character,text\nL001,甲,你好')[0], { line_id: 'L001', character: '甲', text: '你好' });
  assert.deepEqual(createProject(parseCSV(toCSV(sampleProject()))).lines, sampleProject().lines);
});
test('invalid CSV never silently corrupts or partially accepts rows', () => {
  for (const source of ['line_id,character,text\nL1,甲,"未闭合', 'line_id,character,text\nL1,甲,"x"z', 'line_id,character,text\nL1,甲,extra,x', 'line_id,character,text,unknown\nL1,甲,x,z', 'line_id,character,character,text\nL1,甲,甲,x', 'line_id,character,text\nL1,甲,x\nl1,乙,y']) assert.throws(() => parseCSV(source));
});
test('safe IDs reject traversal, collisions, reserved names, whitespace and Unicode filenames', () => {
  for (const id of ['../etc/passwd', 'A/B', 'A.B', 'CON', 'nul', 'com9', '1start', 'L 1', '台词1', 'A'.repeat(65), 'L1\n']) assert.throws(() => createProject([row(id)]));
  assert.throws(() => createProject([row('Line1'), row('line1')]));
});
test('import and export enforce bounded text and safe snapshot shapes', () => {
  assert.throws(() => createProject([row('L1', 'x'.repeat(2001))]));
  assert.throws(() => createProject([row('L1', ' ')]));
  assert.throws(() => createProject(Array.from({ length: 501 }, (_, i) => row(`L${i}`))));
  assert.throws(() => parseProject('null'));
  assert.throws(() => parseProject('{"schema_version":2,"mode":"offline"}'));
  const project = sampleProject(); project.lines[0].revision = 3;
  assert.throws(() => parseProject(JSON.stringify(project)), /版本记录不完整/);
});
test('CSV merge preserves 19 unchanged lines and history; omission does not delete', () => {
  const before = sampleProject(); const next = mergeRows(before, [{ ...row('SC01_L001'), text: '改写' }]);
  assert.equal(next.lines.length, 20); assert.equal(next.lines[0].revision, 2);
  for (let i = 1; i < 20; i++) assert.equal(next.lines[i], before.lines[i]);
  assert.throws(() => mergeRows(before, [row('sc01_l001')]), /大小写冲突/);
  assert.equal(mergeRows(before, [row('NEW_LINE')]).lines.length, 21);
});
test('failed multi-row merge leaves original project entirely untouched', () => {
  const before = sampleProject(), saved = JSON.stringify(before);
  assert.throws(() => mergeRows(before, [row('SC01_L001', 'changed'), row('sc01_l002', 'bad case')]));
  assert.equal(JSON.stringify(before), saved);
});
test('JSON lossless roundtrip preserves checks and revisions; strips malicious metadata', () => {
  let project = checkLine(sampleProject(), 'SC01_L001'); project = editLine(project, 'SC01_L001', { text: '=新版本' });
  assert.deepEqual(parseProject(JSON.stringify(project)), project);
  const malicious = JSON.parse(JSON.stringify(project)); malicious.api_key = 'synthetic-do-not-preserve'; malicious.lines[0].audio = 'https://bad.invalid/audio.wav';
  malicious.lines[0].__proto__ = { polluted: true };
  const clean = parseProject(JSON.stringify(malicious)); assert.deepEqual(clean, project); assert.equal({}.polluted, undefined);
});
test('CSV spreadsheet formulas are neutralized; JSON keeps exact source text', () => {
  for (const text of ['=SUM(A1)', '+test', '-test', '@test']) {
    const project = createProject([row('L1', text)]);
    assert.ok(toCSV(project).includes(`"'${text}"`)); assert.equal(JSON.parse(exportFiles(project)['project.json']).lines[0].text, text);
  }
});
test('export manifest references expected names only, never fabricates files', () => {
  const files = exportFiles(sampleProject());
  assert.deepEqual(Object.keys(files), ['project.json', 'manifest.json', 'dialogue.csv', 'README.txt']);
  const result = JSON.parse(files['manifest.json']);
  assert.equal(result.summary.missing_audio, result.lines.length); assert.equal(result.deliverable_complete, false);
  assert.ok(result.lines.every(line => line.audio === null && line.expected_filename.endsWith('.wav')));
  assert.ok(Object.keys(files).every(name => !name.endsWith('.wav')));
});
test('ZIP opens with independent Python reader, CRC verifies, bytes are deterministic', () => {
  const files = exportFiles(sampleProject()), zip = zipFiles(files);
  assert.deepEqual(zipFiles(files), zip);
  const result = spawnSync('python3', ['-c', 'import sys,zipfile,io,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode("utf-8") for n in z.namelist()}))'], { input: zip, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), files);
  assert.throws(() => zipFiles({ '../escape.txt': 'bad' }), /不安全/);
});
test('local workflow entry point restricts network to same-origin and imports no legacy API code', () => {
  const html = readFileSync(new URL('../dialogue.html', import.meta.url), 'utf8');
  assert.ok(html.includes("connect-src 'self'")); assert.ok(html.includes("media-src 'self' blob:"));
  assert.ok(!html.includes('fonts.googleapis')); assert.ok(!html.includes('js/app.js')); assert.ok(!html.includes('js/api.js'));
  const source = readFileSync(new URL('../js/dialogue.mjs', import.meta.url), 'utf8');
  assert.ok(!/XMLHttpRequest|speechSynthesis|minimax_api_key/.test(source));
  assert.ok(source.includes("document.body.dataset.localService!=='true'"));
});

test('omitted CSV optional columns preserve existing notes; explicit empty cells clear', () => {
  const project = sampleProject();
  const updated = mergeRows(project, parseCSV('line_id,character,text\nSC01_L001,林舟,改写'));
  assert.equal(updated.lines[0].emotion, project.lines[0].emotion);
  assert.equal(updated.lines[0].direction, project.lines[0].direction);
  const cleared = mergeRows(project, parseCSV('line_id,character,text,emotion,direction\nSC01_L001,林舟,改写,,'));
  assert.equal(cleared.lines[0].emotion, ''); assert.equal(cleared.lines[0].direction, '');
});
test('hydrated JSON must fit its own lossless export, not just compact import', () => {
  const project = createProject(Array.from({length: 500}, (_, i) => row(`L${i}`)));
  project.lines = project.lines.map(line => ({...line, revision:21, history:Array.from({length:20}, (_, i) => { const { history, ...snapshot } = line; return {...snapshot, revision:i+1}; })}));
  assert.ok(new TextEncoder().encode(JSON.stringify(project)).length < 2 * 1024 * 1024);
  assert.throws(() => parseProject(JSON.stringify(project)), /2 MiB/);
  project.lines = project.lines.slice(0, 300);
  assert.deepEqual(parseProject(exportFiles(parseProject(JSON.stringify(project)))['project.json']), project);
});
