/** DOM-level behavior tests, not a substitute for visual/real-browser acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { exportFiles, sampleProject } from '../js/dialogue-core.mjs';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
const html = readFileSync(new URL('../dialogue.html', import.meta.url), 'utf8');
const { IDBFactory } = createRequire(import.meta.url)('fake-indexeddb');
const bundlePath=join(mkdtempSync(join(tmpdir(),'minimax-dom-bundle-')),'preview.html');
execFileSync('python3',['scripts/build_offline.py',bundlePath]);
const bundleHTML=readFileSync(bundlePath,'utf8');
const bundleScript=new JSDOM(bundleHTML).window.document.querySelector('script').textContent;
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
function setup(saved, options={}) {
  const dom = new JSDOM(html, { url: 'https://offline.test/dialogue.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.TextEncoder = TextEncoder; window.TextDecoder=TextDecoder; window.indexedDB=options.indexedDB ?? new IDBFactory(); Object.defineProperty(window,'crypto',{value:webcrypto}); window.confirm = () => false;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const blobs = [], downloads = [];
  window.Blob = Blob; window.URL.createObjectURL = blob => { blobs.push(blob); return `blob:${blobs.length}`; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, blob: blobs.at(-1) }); };
  window.fetch = options.fetch ?? (() => { throw new Error('Network is forbidden in these tests'); });
  if(options.service)window.document.body.dataset.localService='true';
  if (saved) window.localStorage.setItem('minimax_studio_production_v2', saved);
  if (options.queue) window.localStorage.setItem('minimax_dialogue_queue_v2', JSON.stringify(options.queue));
  window.eval(bundleScript);
  const $ = id => window.document.getElementById(id);
  const input = (id, value) => { $(id).value = value; $(id).dispatchEvent(new window.Event('input', { bubbles: true })); };
  const click = id => $(id).click();
  const productionState = () => JSON.parse(window.localStorage.getItem('minimax_studio_production_v2'));
  const state = () => productionState()?.project;
  return { dom, window, $, input, click, state, productionState, downloads };
}
test('DOM: shows 20 lines, 3 roles, no generated audio and locked provider', () => {
  const app = setup(); assert.equal(app.window.document.querySelectorAll('.line-row').length, 20);
  assert.equal(app.$('role-count').textContent, '3'); assert.equal(app.$('count-missing').textContent, '20');
  assert.equal(app.window.document.querySelector('.locked-button').disabled, true); app.dom.window.close();
});
test('DOM: dirty edit blocks export/preflight, canceled line switch keeps edit, save/retry persists one line', () => {
  const app = setup(); app.input('text', '新改写的台词。');
  app.click('check-btn'); assert.match(app.$('notice').textContent, /请先保存/);
  app.click('export-btn'); assert.equal(app.downloads.length, 0);
  app.window.document.querySelector('[data-line-id="SC01_L002"]').click(); assert.equal(app.$('selected-id').textContent, 'SC01_L001');
  app.click('save-btn'); assert.equal(app.$('revision').textContent, 'v002');
  assert.deepEqual(app.state().lines.slice(1), sampleProject().lines.slice(1));
  app.click('check-btn'); app.click('check-btn'); assert.equal(app.state().lines[0].checks, 2);
  assert.equal(app.state().lines[0].revision, 2); assert.equal(app.$('count-missing').textContent, '20');
  const restored = setup(JSON.stringify(app.state())); assert.equal(restored.$('revision').textContent, 'v002'); assert.match(restored.$('check-count').textContent, /2 次预检/);
  app.dom.window.close(); restored.dom.window.close();
});
test('DOM: invalid/duplicate CSV never applies; Cancel and close keep original project', () => {
  const app = setup(); app.click('import-btn'); app.input('import-text', 'line_id,character,text\nDUP,甲,x\nDUP,乙,y'); app.click('preview-btn');
  assert.match(app.$('import-error').textContent, /重复/); assert.equal(app.$('apply-import').disabled, true);
  app.click('import-cancel'); assert.equal(app.$('import-dialog').open, false); assert.equal(app.$('count-total').textContent, '20');
  app.click('import-btn'); app.click('import-close'); assert.equal(app.$('import-dialog').open, false); app.dom.window.close();
});
test('DOM: CSV preview invalidates when edited; atomic merge changes only matching ID', async () => {
  const app = setup(); app.click('import-btn'); const csv = 'line_id,character,text\nSC01_L002,顾青,新台词';
  app.input('import-text', csv); app.click('preview-btn'); assert.match(app.$('import-preview').textContent, /更新 1 条/);
  app.input('import-text', csv + '改写'); assert.equal(app.$('apply-import').disabled, true);
  app.click('preview-btn'); app.click('apply-import'); await tick(); assert.equal(app.state().lines.length, 20);
  assert.equal(app.state().lines[1].revision, 2); assert.deepEqual(app.state().lines.slice(2), sampleProject().lines.slice(2));
  app.dom.window.close();
});
test('DOM: JSON replacement strips unknown audio/key fields and still shows all missing audio', async () => {
  const app = setup(), project = sampleProject(); project.lines[0].audio = 'synthetic.wav'; project.api_key = 'synthetic';
  app.click('import-btn'); app.input('import-text', JSON.stringify(project)); app.click('preview-btn'); assert.match(app.$('import-preview').textContent, /整体替换/);
  app.click('apply-import'); await tick(); assert.deepEqual(app.state(), sampleProject()); assert.equal(app.$('count-missing').textContent, '20'); app.dom.window.close();
});
test('DOM: export click produces actual ZIP bytes and JSON, with correct filenames', async () => {
  const app = setup(); app.click('export-btn'); await tick(); assert.equal(app.downloads.length,0); assert.match(app.$('notice').textContent,/无法最终交付/);
  app.click('draft-export-btn'); await tick(); app.click('project-btn');
  assert.equal(app.downloads[0].filename, 'minimax-dialogue-workspace.zip');
  const bytes = new Uint8Array(await app.downloads[0].blob.arrayBuffer()); assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4]);
  const json = JSON.parse(await app.downloads[1].blob.text()); assert.deepEqual(json.project, sampleProject());
  assert.match(app.$('notice').textContent, /不包含音频/); app.dom.window.close();
});
test('DOM: search, changed filter, canceled reset and accepted reset behave safely', () => {
  const app = setup(); app.input('text', '新版本'); app.click('save-btn');
  app.input('search', '完全不存在的测试关键词XYZ'); assert.equal(app.window.document.querySelectorAll('.line-row').length, 0);
  app.input('search', ''); app.$('filter').value = 'modified'; app.$('filter').dispatchEvent(new app.window.Event('change'));
  assert.equal(app.window.document.querySelectorAll('.line-row').length, 1);
  app.click('sample-btn'); assert.equal(app.$('revision').textContent, 'v002');
  app.window.confirm = () => true; app.click('sample-btn'); assert.equal(app.$('revision').textContent, 'v001');
  assert.deepEqual(app.state(), sampleProject()); app.dom.window.close();
});
test('DOM: hostile imported strings render as text, not executable HTML', async () => {
  const app = setup(); app.click('import-btn'); app.input('import-text', 'line_id,character,text\nXSS,甲,<img src=x onerror=alert(1)>'); app.click('preview-btn'); app.click('apply-import'); await tick();
  assert.equal(app.window.document.querySelectorAll('img').length, 0); assert.match(app.$('line-list').textContent, /<img/); app.dom.window.close();
});
test('DOM: corrupted stored draft is not overwritten on startup; storage failures stay visible', () => {
  const app = setup('not-json'); assert.match(app.$('notice').textContent, /不可读取/);
  assert.equal(app.window.localStorage.getItem('minimax_studio_production_v2'), 'not-json');
  app.window.Storage.prototype.setItem = () => { throw new Error('full'); };
  app.click('check-btn'); assert.match(app.$('storage-status').textContent, /保存失败/);
  const event = new app.window.Event('beforeunload', { cancelable: true }); app.window.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
  app.click('project-btn'); assert.equal(app.downloads.length, 1); app.dom.window.close();
});
test('DOM: slower file read cannot replace later user-edited import text', async () => {
  const app = setup(); app.click('import-btn'); let finish;
  Object.defineProperty(app.$('import-file'), 'files', { value: [{ size: 20, text: () => new Promise(resolve => { finish = resolve; }) }] });
  app.$('import-file').dispatchEvent(new app.window.Event('change'));
  app.input('import-text', 'line_id,character,text\nMANUAL,甲,手动输入');
  finish('line_id,character,text\nSTALE,乙,旧文件'); await Promise.resolve(); await Promise.resolve();
  assert.match(app.$('import-text').value, /MANUAL/); assert.doesNotMatch(app.$('import-text').value, /STALE/); app.dom.window.close();
});

test('DOM: another editing tab cannot be silently overwritten', () => {
  const app = setup();
  app.window.localStorage.setItem('minimax_studio_production_v2', 'other-tab-snapshot');
  app.input('text', '本页修改'); app.click('save-btn');
  assert.equal(app.window.localStorage.getItem('minimax_studio_production_v2'), 'other-tab-snapshot');
  assert.match(app.$('storage-status').textContent, /其他标签页/);
  assert.match(app.$('notice').textContent, /未保存到浏览器/);
  const event = new app.window.Event('beforeunload', { cancelable: true }); app.window.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
  app.click('project-btn'); assert.equal(app.downloads.length, 1); app.dom.window.close();
});

test('DOM: compiled standalone HTML initializes, edits and preflights without module imports', () => {
  const target = join(mkdtempSync(join(tmpdir(), 'minimax-bundle-dom-')), 'preview.html');
  execFileSync('python3', ['scripts/build_offline.py', target]);
  const bundled = readFileSync(target, 'utf8');
  const dom = new JSDOM(bundled, { url: 'https://offline.test/preview.html', runScripts: 'outside-only' });
  dom.window.TextEncoder = TextEncoder; dom.window.TextDecoder=TextDecoder; dom.window.eval(dom.window.document.querySelector('script').textContent);
  const doc = dom.window.document; assert.equal(doc.querySelectorAll('.line-row').length, 20);
  doc.getElementById('text').value = '编译产物验证'; doc.getElementById('text').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  doc.getElementById('save-btn').click(); doc.getElementById('check-btn').click();
  assert.equal(doc.getElementById('revision').textContent, 'v002');
  assert.match(doc.getElementById('check-count').textContent, /1 次预检/);
  assert.equal(doc.getElementById('count-missing').textContent, '20'); dom.window.close();
});

// Synthetic PCM is a test fixture only. It is never included as sample speech in the product.
function fixtureWav(){const bytes=new Uint8Array(6444),view=new DataView(bytes.buffer),tag=(at,s)=>[...s].forEach((c,i)=>bytes[at+i]=c.charCodeAt(0));tag(0,'RIFF');view.setUint32(4,bytes.length-8,true);tag(8,'WAVE');tag(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,32000,true);view.setUint32(28,64000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);tag(36,'data');view.setUint32(40,6400,true);for(let i=44;i<bytes.length;i+=2)view.setInt16(i,i%4?500:-500,true);return bytes;}
async function until(check){for(let i=0;i<60;i++){if(check())return;await tick();}assert.fail('Expected DOM state did not arrive');}
function singleProject(count=1){const source=sampleProject();source.lines=source.lines.slice(0,count);return source;}
function submitCast(app){app.click('cast-btn');app.$('cast-voice').value='male-qn-qingse';app.$('cast-form').dispatchEvent(new app.window.Event('submit',{cancelable:true,bubbles:true}));}
async function importWav(app,bytes=fixtureWav()){
  Object.defineProperty(app.$('audio-file'),'files',{configurable:true,value:[{size:bytes.length,arrayBuffer:async()=>bytes.buffer}]});
  app.$('audio-file').dispatchEvent(new app.window.Event('change'));await until(()=>app.productionState()?.takes?.length>0);await tick();
}
test('DOM v2: cast role, import actual WAV bytes, play/review/export, then restore browser audio',async()=>{
  const idb=new IDBFactory(),app=setup(JSON.stringify(singleProject()),{indexedDB:idb});
  submitCast(app);assert.equal(app.productionState().cast[0].voice_id,'male-qn-qingse');assert.equal(app.$('cast-dialog').open,false);
  await importWav(app);assert.equal(app.$('take-list').querySelectorAll('audio').length,1);assert.equal(app.$('count-approved').textContent,'0');
  app.$('take-list').querySelector('button').click();assert.equal(app.$('count-approved').textContent,'1');
  app.click('export-btn');await until(()=>app.downloads.length===1);assert.equal(app.downloads[0].filename,'minimax-dialogue-approved.zip');
  const restored=setup(JSON.stringify(app.productionState()),{indexedDB:idb});await until(()=>restored.$('take-list').querySelectorAll('audio').length===1);assert.equal(restored.$('count-approved').textContent,'1');
  app.dom.window.close();restored.dom.window.close();
});
test('DOM v2: edited text makes reviewed audio stale and blocks final export without deleting it',async()=>{
  const app=setup(JSON.stringify(singleProject()));await importWav(app);app.$('take-list').querySelector('button').click();
  app.input('text','这是一条新台词');app.click('save-btn');assert.equal(app.$('count-approved').textContent,'0');assert.match(app.$('take-list').textContent,/已过期/);assert.equal(app.productionState().takes.length,1);
  app.click('export-btn');await tick();assert.equal(app.downloads.length,0);assert.match(app.$('notice').textContent,/无法最终交付/);app.dom.window.close();
});
test('DOM v2: corrupted WAV is rejected and creates no player or take',async()=>{
  const app=setup(JSON.stringify(singleProject()));Object.defineProperty(app.$('audio-file'),'files',{value:[{size:60,arrayBuffer:async()=>new Uint8Array(60).buffer}]});
  app.$('audio-file').dispatchEvent(new app.window.Event('change'));await tick();assert.equal(app.$('take-list').querySelectorAll('audio').length,0);assert.match(app.$('notice').textContent,/WAV/);app.dom.window.close();
});
test('DOM v2: native player errors are visible, repeatable and clear after media recovery',async()=>{
  const app=setup(JSON.stringify(singleProject()));await importWav(app);
  const player=app.$('take-list').querySelector('audio'),before=JSON.stringify(app.productionState());
  player.dispatchEvent(new app.window.Event('error'));
  assert.match(app.$('take-list').textContent,/无法播放/);
  assert.match(app.$('notice').textContent,/无法播放/);
  assert.match(app.$('take-list').textContent,/工作包/);
  player.dispatchEvent(new app.window.Event('error'));
  assert.equal(app.$('take-list').querySelectorAll('[role="alert"]').length,1);
  assert.equal(JSON.stringify(app.productionState()),before);
  player.dispatchEvent(new app.window.Event('canplay'));
  assert.equal(app.$('take-list').querySelector('[role="alert"]').textContent,'');
  assert.match(app.$('notice').textContent,/已可播放/);
  assert.equal(JSON.stringify(app.productionState()),before);app.dom.window.close();
});
test('DOM v2: media recovery does not overwrite a later unrelated user notice',async()=>{
  const app=setup(JSON.stringify(singleProject()));await importWav(app);
  const player=app.$('take-list').querySelector('audio');player.dispatchEvent(new app.window.Event('error'));
  app.click('project-btn');const message=app.$('notice').textContent;
  player.dispatchEvent(new app.window.Event('canplay'));
  assert.equal(app.$('notice').textContent,message);app.dom.window.close();
});
test('DOM v2: detached players cannot overwrite feedback after line change or project reset',async()=>{
  for(const replacement of ['line','project']){
    const app=setup();await importWav(app);
    const player=app.$('take-list').querySelector('audio');
    player.dispatchEvent(new app.window.Event('error'));
    assert.match(app.$('notice').textContent,/无法播放/);
    if(replacement==='line')app.window.document.querySelector('[data-line-id="SC01_L002"]').click();
    else{app.window.confirm=()=>true;app.click('sample-btn');}
    assert.equal(player.isConnected,false);
    const message=app.$('notice').textContent,before=JSON.stringify(app.productionState());
    player.dispatchEvent(new app.window.Event('error'));player.dispatchEvent(new app.window.Event('canplay'));
    assert.equal(app.$('notice').textContent,message);
    assert.equal(JSON.stringify(app.productionState()),before);app.dom.window.close();
  }
});
test('DOM v2: failed service status never claims connection; reload recovers without generation',async()=>{
  for(const mode of ['network','http','json']){
    let requests=0;const app=setup(undefined,{service:true,fetch:async(url)=>{
      assert.equal(url,'/api/dialogue/status');requests++;
      if(mode==='network')throw new Error('offline');
      return mode==='http'?{ok:false}:{ok:true,json:async()=>{throw new Error('truncated');}};
    }});await tick();
    assert.match(app.$('provider-title').textContent,/连接失败/);
    assert.doesNotMatch(app.$('provider-title').textContent,/已连接/);
    assert.equal(app.$('provider-badge').textContent,'服务未连接');
    assert.equal(app.$('generate-line-btn').disabled,true);assert.equal(app.$('queue-start-btn').disabled,true);
    assert.equal(requests,1);app.dom.window.close();
  }
  let requests=0;const recovered=setup(undefined,{service:true,fetch:async(url)=>{
    assert.equal(url,'/api/dialogue/status');requests++;
    return{ok:true,json:async()=>({enabled:false,reason:'generation_disabled'})};
  }});await tick();assert.match(recovered.$('provider-title').textContent,/已连接/);
  assert.equal(recovered.$('provider-badge').textContent,'未授权生成');
  assert.equal(recovered.$('generate-line-btn').disabled,true);assert.equal(requests,1);recovered.dom.window.close();
});
test('DOM v2: single-line generation cannot start previously queued batch; no key enters requests',async()=>{
  const requests=[],bytes=fixtureWav(),sha=[...new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const fetch=async(url,options)=>{if(url==='/api/dialogue/status')return{ok:true,json:async()=>({enabled:true,session_id:'test-session',budget:{max_requests:3,used_requests:requests.length,max_characters:600,used_characters:0}})};
    const body=JSON.parse(options.body);requests.push(body);return{ok:true,json:async()=>({operation_id:body.operation_id,audio:{base64:Buffer.from(bytes).toString('base64'),format:'wav',sha256:sha}})};};
  const app=setup(JSON.stringify(singleProject(2)),{service:true,fetch});await tick();submitCast(app);
  app.click('queue-missing-btn');assert.equal(requests.length,0);app.click('generate-line-btn');await until(()=>app.productionState()?.takes?.length===1);await tick();
  assert.equal(requests.length,1);assert.equal(requests[0].text,singleProject(2).lines[0].text);assert.ok(!JSON.stringify(requests).includes('api_key'));assert.match(app.$('queue-summary').textContent,/1 等待/);
  app.dom.window.close();
});
test('DOM v2: truncated response recovers cached audio with GET and same operation ID, no second generation',async()=>{
  const bytes=fixtureWav(),sha=[...new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');let posts=0,gets=0,operation;
  const fetch=async(url,options)=>{
    if(url==='/api/dialogue/status')return{ok:true,json:async()=>({enabled:true,session_id:'same-session',budget:{max_requests:3,used_requests:posts,max_characters:600,used_characters:0}})};
    if(url.startsWith('/api/dialogue/result?')){gets++;assert.equal(new URL(url,'http://local').searchParams.get('operation_id'),operation);return{ok:true,json:async()=>({operation_id:operation,audio:{base64:Buffer.from(bytes).toString('base64'),format:'wav',sha256:sha}})};}
    posts++;operation=JSON.parse(options.body).operation_id;return{ok:true,json:async()=>{throw new Error('truncated json');}};
  };
  const app=setup(JSON.stringify(singleProject()),{service:true,fetch});await tick();submitCast(app);app.click('generate-line-btn');await until(()=>app.$('queue-list').textContent.includes('恢复上次结果'));
  [...app.$('queue-list').querySelectorAll('button')].find(button=>button.textContent==='恢复上次结果').click();await until(()=>app.productionState()?.takes?.length===1);await tick();assert.equal(posts,1);assert.equal(gets,1);app.dom.window.close();
});
test('DOM v2: first uncertain operation stays recoverable across a 101-line batch and reload',async()=>{
  const project=singleProject(),seed=project.lines[0];project.lines=Array.from({length:101},(_,index)=>({...seed,line_id:`LONG_${String(index+1).padStart(3,'0')}`,history:[]}));
  const bytes=fixtureWav(),sha=[...new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');let posts=0,gets=0,operation;
  const fetch=async(url,options)=>{
    if(url==='/api/dialogue/status')return{ok:true,json:async()=>({enabled:true,session_id:'long-session',budget:{max_requests:100,used_requests:posts,max_characters:10000,used_characters:0}})};
    if(url.startsWith('/api/dialogue/result?')){gets++;assert.equal(new URL(url,'http://local').searchParams.get('operation_id'),operation);return{ok:true,json:async()=>({operation_id:operation,audio:{base64:Buffer.from(bytes).toString('base64'),format:'wav',sha256:sha}})};}
    posts++;operation=JSON.parse(options.body).operation_id;return{ok:true,json:async()=>{throw new Error('truncated');}};
  };
  const first=setup(JSON.stringify(project),{service:true,fetch});await tick();submitCast(first);first.click('queue-missing-btn');first.click('queue-start-btn');
  await until(()=>first.$('queue-list').textContent.includes('恢复上次结果'));assert.equal(posts,1);assert.match(first.$('queue-summary').textContent,/1 失败/);
  const savedQueue=JSON.parse(first.window.localStorage.getItem('minimax_dialogue_queue_v2'));assert.equal(savedQueue.length,101);assert.equal(savedQueue[0].operation_id,operation);
  const savedState=JSON.stringify(first.productionState());first.dom.window.close();
  const second=setup(savedState,{service:true,fetch,queue:savedQueue});await tick();
  const restoredQueue=JSON.parse(second.window.localStorage.getItem('minimax_dialogue_queue_v2'));assert.equal(restoredQueue.length,101);assert.equal(restoredQueue[0].operation_id,operation);assert.equal(restoredQueue[0].uncertain,true);assert.equal(posts,1);
  [...second.$('queue-list').querySelectorAll('button')].find(button=>button.textContent==='恢复上次结果').click();await until(()=>second.productionState()?.takes?.length===1);await tick();
  assert.equal(posts,1);assert.equal(gets,1);assert.match(second.$('queue-summary').textContent,/1 已完成/);assert.ok(!second.$('queue-list').textContent.includes('恢复上次结果'));second.dom.window.close();
});
test('DOM v2: uncertain records survive replacement projects and queue storage failures warn before exit',async()=>{
  const saved=[{job_id:1,line_id:'OLD_LINE',revision:1,fingerprint:'{}',operation_id:'op-old',session_id:'old-session',status:'running'}];
  const app=setup(JSON.stringify(singleProject()),{queue:saved});
  assert.equal(JSON.parse(app.window.localStorage.getItem('minimax_dialogue_queue_v2'))[0].line_id,'OLD_LINE');assert.match(app.$('queue-list').textContent,/OLD_LINE/);
  app.window.Storage.prototype.setItem=()=>{throw new Error('quota');};app.click('queue-missing-btn');assert.match(app.$('queue-summary').textContent,/队列保存失败/);
  const event=new app.window.Event('beforeunload',{cancelable:true});app.window.dispatchEvent(event);assert.equal(event.defaultPrevented,true);app.dom.window.close();
});
test('DOM v2: pending manual audio import blocks new model dispatch',async()=>{
  let finish,posts=0;const fetch=async(url)=>{if(url==='/api/dialogue/status')return{ok:true,json:async()=>({enabled:true,budget:{max_requests:2,max_characters:100}})};posts++;throw new Error('must not dispatch');};
  const app=setup(JSON.stringify(singleProject()),{service:true,fetch});await tick();submitCast(app);
  Object.defineProperty(app.$('audio-file'),'files',{value:[{size:6444,arrayBuffer:()=>new Promise(resolve=>finish=resolve)}]});app.$('audio-file').dispatchEvent(new app.window.Event('change'));
  app.click('generate-line-btn');await tick();assert.equal(posts,0);assert.match(app.$('notice').textContent,/已有录音操作/);finish(fixtureWav().buffer);await until(()=>app.productionState()?.takes?.length===1);await tick();app.dom.window.close();
});

test('DOM v2: workspace ZIP restores reviewed audio in a fresh browser store',async()=>{
  const first=setup(JSON.stringify(singleProject()));await importWav(first);first.$('take-list').querySelector('button').click();first.click('draft-export-btn');await until(()=>first.downloads.length===1);const buffer=await first.downloads[0].blob.arrayBuffer();
  const second=setup();second.click('import-btn');Object.defineProperty(second.$('import-file'),'files',{value:[{name:'workspace.zip',size:buffer.byteLength,arrayBuffer:async()=>buffer}]});second.$('import-file').dispatchEvent(new second.window.Event('change'));await until(()=>!second.$('apply-import').disabled);second.click('apply-import');await until(()=>second.$('count-approved').textContent==='1');await tick();assert.equal(second.$('take-list').querySelectorAll('audio').length,1);assert.equal(second.productionState().takes[0].review,'approved');first.dom.window.close();second.dom.window.close();
});
