import assert from 'node:assert/strict';
import test from 'node:test';
import {get} from 'node:http';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createStudioServer} from '../server/studio-server.mjs';
import * as wav from '../js/production-core.mjs';

const entries = [
  ['chat','messages'],['image','prompt'],['video','prompt'],['speech','text'],['music','prompt'],['lyrics','prompt']
];
const source = readFileSync(new URL('../js/backend-api.js',import.meta.url),'utf8');
const runClient = () => runInNewContext(`${source}\nStudioOperationAPI`,{
  window:{location:{origin:'http://127.0.0.1'},addEventListener(){}},
  navigator:{onLine:true},localStorage:{getItem(){return null;}},
  AbortSignal,AbortController,setTimeout,clearTimeout,fetch,Blob,Uint8Array
});
const payload = (id,modality,key) => ({id,modality,params:{[key]:'fixture'}});
const id = n => n.toString(16).padStart(32,'0');
const expected = {
  image:['image/png','89504e470d0a1a0a',0],video:['video/mp4','66747970',4],
  speech:['audio/wav','52494646',0],music:['audio/wav','52494646',0]
};

test('real loopback server: six fixture flows, proved media bytes and exact download recovery',async t=>{
  let now = 0;
  const server = createStudioServer({now:()=>now});
  const origin = await server.start(0);
  t.after(()=>server.close());
  const request=(path,init={})=>fetch(origin+path,init);
  const post=(data,headers={})=>request('/api/studio/operations',{method:'POST',body:JSON.stringify(data),headers:{
    Origin:origin,'Content-Type':'application/json',...headers
  }});
  const health=await request('/api/health');
  assert.equal(health.status,200);
  assert.deepEqual(await health.json(),{service:'minimax-studio-local',status:'ok',mode:'fixture',version:1});
  assert.match((await request('/')).headers.get('content-security-policy'),/connect-src 'self'/);
  assert.equal((await request('/server/studio-fixtures.mjs')).status,404);

  for (const [i,[modality,key]] of entries.entries()) {
    const opId=id(i+1), path=`/api/studio/operations/${opId}`;
    const args=payload(opId,modality,key);
    const start=await post(args);
    assert.equal(start.status,202);
    assert.equal((await start.json()).status,'pending');
    assert.equal((await request(path+'/download')).status,409);
    await (await post(args)).arrayBuffer();
    assert.equal((await post({...args,params:{[key]:'different'}})).status,409);
    now+=300;
    for(let reload=0; reload<2; reload++) {
      const state=await (await request(path)).json();
      assert.equal(state.status,'completed');
      assert.equal(state.id,opId);
      assert.equal(state.modality,modality);
      if (expected[modality]) {
        const [mime,magic,offset]=expected[modality];
        const mediaUrl=state.result.images?.[0] || state.result.audioUrl || state.result.videoUrl;
        const res=await request(mediaUrl);
        const bytes=Buffer.from(await res.arrayBuffer());
        assert.equal(res.headers.get('content-type'),mime);
        assert.equal(bytes.subarray(offset,offset+magic.length/2).toString('hex'),magic);
      } else assert.match(state.result.content || state.result.lyrics,/未调用第三方/);
    }
  }

  const cancelled=id(10), p=`/api/studio/operations/${cancelled}`;
  await (await post(payload(cancelled,'image','prompt'))).arrayBuffer();
  assert.equal((await request(p,{method:'DELETE'})).status,403);
  assert.equal((await (await request(p,{method:'DELETE',headers:{Origin:origin}})).json()).status,'cancelled');
  now+=300;
  assert.equal((await (await request(p)).json()).status,'cancelled');
  assert.equal((await request(p+'/download')).status,409);
  now+=30*60*1000;
  assert.equal((await request(p)).status,404);

  assert.equal((await post(payload(id(12),'image','prompt'),{Origin:'http://evil.invalid'})).status,403);
  assert.equal((await post(payload(id(12),'image','prompt'),{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await post(payload(id(12),'constructor','prompt'))).status,400);
  const spoofed = await new Promise((resolve,reject)=>get(origin+'/api/health',{headers:{Host:'evil.invalid'}},res=>{
    res.resume(); resolve(res.statusCode);
  }).once('error',reject));
  assert.equal(spoofed,403);
});

test('client: backoff on a failed read, timeout recovery uses retained ID without replaying POST',async ()=>{
  const StudioOperationAPI=runClient();
  const opId=id(15), calls=[], waits=[], saved = new Map();
  const storage={getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
  let reads=0;
  const request=async(path,init)=>{
    calls.push(init.method || 'GET');
    if (init.method==='POST') return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
    if(++reads===1) return Response.json({error:'fixture transient'},{status:503});
    return Response.json({id:opId,modality:'image',status:reads===2?'pending':'completed'});
  };
  // Keep the event loop alive while AbortSignal.timeout's unref'ed timer fires.
  const keepAlive=setInterval(()=>{},100);
  try {
    const api=new StudioOperationAPI({request,storage,createId:()=>opId,timeout:20});
    await assert.rejects(api.start('image',{prompt:'not stored'}),{name:'TimeoutError'});
    assert.deepEqual([...saved], [['minimax_studio_operation',opId]]);
    const reload=new StudioOperationAPI({request,storage,wait:async ms=>waits.push(ms)});
    assert.equal((await reload.poll(reload.remembered())).status,'completed');
    assert.deepEqual(waits,[300,600]);
    assert.deepEqual(calls,['POST','GET','GET','GET']);
  } finally { clearInterval(keepAlive); }
});

test('client: abort interrupts polling; DELETE cancels without a second POST',async ()=>{
  const StudioOperationAPI=runClient();
  const opId=id(16), calls=[];
  const controller=new AbortController();
  const api=new StudioOperationAPI({
    request:async(_path,{method,signal})=>{
      calls.push(method);
      if(method==='POST') return Response.json({id:opId,modality:'video',status:'pending'});
      assert.equal(method,'DELETE');
      signal.throwIfAborted();
      return Response.json({id:opId,modality:'video',status:'cancelled'});
    },
    createId:()=>opId,
    wait:async(_ms,signal)=>{controller.abort();signal.throwIfAborted();}
  });
  await assert.rejects(api.start('video',{prompt:'fixture'},controller.signal),{name:'AbortError'});
  assert.equal(api.remembered(),opId); // in-memory even without sessionStorage
  assert.equal((await api.cancel(opId)).status,'cancelled');
  assert.deepEqual(calls,['POST','DELETE']);
});

test('client classifies HTML gateway failures and honors Retry-After without repeating POST', async ()=>{
  const API = runClient();
  const opId=id(21), waits=[], calls=[];
  const statuses = [502,429,504,200];
  const now = Date.UTC(2026,10,28,0,0,0);
  const client = new API({
    createId:()=>opId, now:()=>now, wait:async ms=>waits.push(ms),
    request:async (_path,init)=>{
      const method=init.method||'GET';
      calls.push(method);
      if (method==='POST') return new Response('<b>untrusted gateway text</b>',{status:504,headers:{'content-type':'text/html'}});
      const status=statuses.shift();
      return status===200 ? Response.json({id:opId,modality:'speech',status:'completed'})
        : new Response('proxy failure',{status,headers:{'content-type':'text/html',
            ...(status===429?{'retry-after':new Date(now+2000).toUTCString()}:{})}});
    }
  });
  await assert.rejects(client.start('speech',{text:'not stored'}), e=>e.status===504&&!e.message.includes('untrusted'));
  assert.equal(client.remembered(),opId);
  assert.equal((await client.poll(opId)).status,'completed');
  assert.deepEqual(waits,[300,2000,1200]);
  assert.deepEqual(calls,['POST','GET','GET','GET','GET']);
});

test('client does not retry non-transient failures or prematurely retry long throttles', async ()=>{
  const API=runClient();
  const opId=id(23);
  for (const status of [404,429,501]) {
    let requests=0;
    const client=new API({
      wait:async()=>assert.fail('unexpected retry'),
      request:async()=>{requests++;return new Response('<html/>',{status,headers:{'retry-after':'60'}});}
    });
    await assert.rejects(client.poll(opId), e=>e.status===status);
    assert.equal(requests,1);
  }
});

test('client buffers only verified exact WAV, rejects clean chunk truncation and damaged chunks', async ()=>{
  const API=runClient(), opId=id(24), path='/api/studio/operations/'+opId+'/download';
  const fixture=new Uint8Array(readFileSync(new URL('../server/fixtures/preview.wav',import.meta.url)));
  const damaged=fixture.slice();
  // Corrupt an internal chunk length without changing the outer RIFF length.
  new DataView(damaged.buffer).setUint32(40,0xffffffff,true);
  const candidates=[fixture.subarray(0,140),damaged,fixture];
  let consumed=0;
  const client=new API({loadWav:async()=>wav,request:async (url,input)=>{
    assert.equal(url,path);
    assert.equal(input.redirect,'error');
    assert.equal(input.headers.Accept,'audio/wav');
    const bytes=candidates[consumed++];
    const body=new ReadableStream({start(c){c.enqueue(bytes.slice(0,50));c.enqueue(bytes.slice(50));c.close();}});
    return new Response(body,{headers:{'Content-Type':'audio/wav'}});
  }});
  await assert.rejects(client.downloadAudio(opId,'https://example.invalid/audio'),/地址无效/);
  assert.equal(consumed,0);
  await assert.rejects(client.downloadAudio(opId,path),/下载中断或校验失败/);
  await assert.rejects(client.downloadAudio(opId,path),/下载中断或校验失败/);
  const result = await client.downloadAudio(opId,path);
  assert.equal(result.type,'audio/wav');
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()),fixture);
});

test('client fails closed when socket truncates a length-declared audio response', async t=>{
  const API=runClient(), opId=id(25), path='/api/studio/operations/'+opId+'/download';
  const fixture=readFileSync(new URL('../server/fixtures/preview.wav',import.meta.url));
  const { createServer }=await import('node:http');
  const http=createServer((_req,res)=>{
    res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':fixture.length});
    res.write(fixture.subarray(0,140),()=>res.destroy());
  });
  await new Promise((resolve,reject)=>{http.on('error',reject);http.listen(0,'127.0.0.1',resolve);});
  t.after(()=>http.close());
  const client=new API({loadWav:async()=>wav,request:async (path,init)=>fetch('http://127.0.0.1:'+http.address().port+path,init)});
  await assert.rejects(client.downloadAudio(opId,path),e=>e.name==='TypeError'||/下载中断/.test(e.message));
});

const modeSource = readFileSync(new URL('../js/workbench-mode.js', import.meta.url), 'utf8');
const resolveMode = runInNewContext(`${modeSource}\nresolveWorkbenchMode`, {
  URLSearchParams, AbortController, setTimeout, clearTimeout, fetch,
});
const okHealth = (health, media = 'application/json') => ({
  ok: true, headers: new Headers({'content-type': media}), async json() { return health; },
});
test('workbench mode grants direct access only on explicitly opted-in HTTP loopback', async () => {
  const calls = [];
  const absent = async (...args) => { calls.push(args); throw Error('fixture offline'); };
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    assert.equal(await resolveMode(new URL(`http://${host}:4174/?mode=direct-experiment`), absent), 'direct-experiment');
  }
  assert.equal(calls.length, 0);
  for (const url of ['http://localhost/?mode=direct', 'https://localhost/?mode=direct-experiment',
    'https://example.test/?mode=direct-experiment', 'http://localhost.example.test/?mode=direct-experiment']) {
    assert.equal(await resolveMode(new URL(url), absent), 'unavailable');
  }
  assert.equal(calls.length, 4);
  for (const [path, options] of calls) {
    assert.equal(path, '/api/health');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal);
  }
});
test('workbench health classes are disjoint and never select Direct on failure', async () => {
  const page = new URL('http://127.0.0.1:4174/');
  const fixture = {service: 'minimax-studio-local', status: 'ok', mode: 'fixture', version: 1};
  const fake = (health, type) => async () => okHealth(health, type);
  assert.equal(await resolveMode(page, fake(fixture, 'application/json; charset=utf-8')), 'controlled-fixture');
  assert.equal(await resolveMode(page, fake({service: 'minimax-studio-backend', status: 'ok'})), 'legacy-backend');
  for (const health of [{...fixture, version: '1'}, {...fixture, version: 2}, {...fixture, mode: 'live'},
    {...fixture, status: 'error'}, {service: 'dialogue', status: 'ok'}, null]) {
    assert.equal(await resolveMode(page, fake(health)), 'unavailable');
  }
  assert.equal(await resolveMode(page, fake(fixture, 'text/html')), 'unavailable');
  assert.equal(await resolveMode(page, async () => ({...okHealth(fixture), ok: false})), 'unavailable');
  assert.equal(await resolveMode(page, async () => ({...okHealth(fixture), json() { throw Error('bad JSON'); }})), 'unavailable');
});
