import assert from 'node:assert/strict';
import test from 'node:test';
import {get} from 'node:http';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createStudioServer} from '../server/studio-server.mjs';

const entries = [
  ['chat','messages'],['image','prompt'],['video','prompt'],['speech','text'],['music','prompt'],['lyrics','prompt']
];
const source = readFileSync(new URL('../js/backend-api.js',import.meta.url),'utf8');
const runClient = () => runInNewContext(`${source}\nStudioOperationAPI`,{
  window:{location:{origin:'http://127.0.0.1'},addEventListener(){}},
  navigator:{onLine:true},localStorage:{getItem(){return null;}},
  AbortSignal,AbortController,setTimeout,clearTimeout,fetch
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
