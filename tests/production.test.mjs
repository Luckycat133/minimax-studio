import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import { createProject, editLine, zipFiles } from '../js/dialogue-core.mjs';
import { createProduction, parseProduction, assignVoice, fingerprint, buildSpeechRequest, attachTake, reviewTake, getLineState, validateWav, buildProductionExport, syncProject, restoreProductionArchive, readStoredZip } from '../js/production-core.mjs';
import {ProductionQueue} from '../js/production-queue.mjs';
export function testWav(sample=500){const n=3200,data=new Uint8Array(44+n*2),v=new DataView(data.buffer);const text=(at,value)=>[...value].forEach((x,i)=>data[at+i]=x.charCodeAt(0));text(0,'RIFF');v.setUint32(4,data.length-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,32000,true);v.setUint32(28,64000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,n*2,true);for(let i=0;i<n;i++)v.setInt16(44+i*2,i%2?sample:-sample,true);return data;}
function one(){return createProduction(createProject([{line_id:'L1',character:'甲',text:'你好',emotion:'平静',direction:'轻声'}]));}
const cast=state=>assignVoice(state,'甲',{voice_id:'male-qn-qingse'});

test('v1 migrates and casting is explicit with strict voice/model/parameter validation',()=>{
  let state=one();assert.equal(state.cast[0].voice_id,'');assert.throws(()=>buildSpeechRequest(state,'L1','op_123456'),/分配音色/);state=cast(state);
  const request=buildSpeechRequest(state,'L1','op_123456');assert.equal(request.voice_id,'male-qn-qingse');assert.equal(request.emotion,'');assert.equal(request.direction,undefined);assert.equal(request.text,'你好');
  assert.equal(parseProduction(JSON.stringify(state.project)).schema_version,2);
  for(const invalid of [{speed:3},{pitch:1.5},{model:'made-up'},{voice_id:'missing'},{emotion:'兴奋'},{pronunciation:['invalid']}])assert.throws(()=>assignVoice(state,'甲',invalid));
});
test('WAV validator rejects bogus, truncated, contradictory, no-audio and oversized headers',()=>{
  const bytes=testWav();assert.equal(validateWav(bytes).duration_ms,100);assert.equal(validateWav(bytes).sample_rate,32000);
  for(const bad of [new Uint8Array(50),bytes.slice(0,-1),bytes.slice(0,44)])assert.throws(()=>validateWav(bad));
  const wrong=bytes.slice();new DataView(wrong.buffer).setUint32(28,123,true);assert.throws(()=>validateWav(wrong),/不一致/);
});
test('genuine imported bytes create pending take and require explicit current-version review',async()=>{
  const result=await attachTake(one(),'L1',testWav());const available=new Set([result.take.asset_id]);
  assert.equal(result.take.source,'import');assert.equal(getLineState(result.state,'L1',available).status,'pending_review');
  assert.equal(getLineState(result.state,'L1',new Set()).status,'missing_asset');
  assert.throws(()=>reviewTake(result.state,result.take.take_id,'approved',new Set()),/缺失/);
  const approved=reviewTake(result.state,result.take.take_id,'approved',available);assert.equal(getLineState(approved,'L1',available).status,'approved');
});
test('text edits and casting changes stale takes without deleting original audio metadata',async()=>{
  let result=await attachTake(cast(one()),'L1',testWav());const available=new Set([result.take.asset_id]);
  let state=reviewTake(result.state,result.take.take_id,'approved',available);const original=state.takes[0];
  state=syncProject(state,editLine(state.project,'L1',{text:'改写'}));assert.equal(getLineState(state,'L1',available).status,'stale');assert.deepEqual(state.takes[0],original);
  assert.throws(()=>reviewTake(state,original.take_id,'approved',available),/不匹配/);
  state=assignVoice(result.state,'甲',{speed:1.2});assert.equal(getLineState(state,'L1',available).status,'stale');
});
test('redo preserves takes; approving new take does not erase old version and resets prior preferred take',async()=>{
  const first=await attachTake(one(),'L1',testWav());const second=await attachTake(first.state,'L1',testWav(700));const available=new Set([first.take.asset_id,second.take.asset_id]);
  let state=reviewTake(second.state,first.take.take_id,'approved',available);state=reviewTake(state,second.take.take_id,'approved',available);
  assert.equal(state.takes.length,2);assert.equal(state.takes[0].review,'pending');assert.equal(getLineState(state,'L1',available).take.take_id,second.take.take_id);
});
test('late generation result retains request fingerprint and never overwrites newer script edits',async()=>{
  const before=cast(one()),old=fingerprint(before,'L1');let latest=syncProject(before,editLine(before.project,'L1',{text:'较新的台词'}));
  const result=await attachTake(before,'L1',testWav(),{source:'minimax',fingerprint:old,revision:1,getState:()=>latest});
  assert.equal(result.state.project.lines[0].text,'较新的台词');assert.equal(getLineState(result.state,'L1',new Set([result.take.asset_id])).status,'stale');
});
test('final export blocks incomplete, stale, missing and unreviewed recordings',async()=>{
  await assert.rejects(buildProductionExport(one(),new Map()),/无法最终交付/);
  const result=await attachTake(one(),'L1',testWav());const assets=new Map([[result.take.asset_id,result.bytes]]);
  await assert.rejects(buildProductionExport(result.state,assets),/无法最终交付/);
  const draft=await buildProductionExport(result.state,assets,{approvedOnly:false});assert.equal(draft.manifest.deliverable_complete,false);assert.equal(draft.manifest.lines[0].audio,null);assert.ok(Object.keys(draft.files).some(key=>key.startsWith('takes/')));assert.ok(!Object.keys(draft.files).some(key=>key.startsWith('audio/')));
});
test('approved export includes actual binary WAV with matching manifest and verifies ZIP using Python',async()=>{
  const result=await attachTake(one(),'L1',testWav()),assets=new Map([[result.take.asset_id,result.bytes]]);const state=reviewTake(result.state,result.take.take_id,'approved',new Set(assets.keys()));
  const output=await buildProductionExport(state,assets);assert.equal(output.manifest.deliverable_complete,true);assert.equal(output.manifest.audio_generated,false);assert.deepEqual(output.files[output.manifest.lines[0].audio],result.bytes);
  const zip=zipFiles(output.files),verified=spawnSync('python3',['-c','import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; m=json.loads(z.read("manifest.json")); assert z.read(m["lines"][0]["audio"])[:4]==b"RIFF"'],{input:zip});assert.equal(verified.status,0);
});
test('wrong audio bytes cannot inherit approved metadata; JSON roundtrip keeps takes but not byte promises',async()=>{
  const result=await attachTake(one(),'L1',testWav());const state=reviewTake(result.state,result.take.take_id,'approved',new Set([result.take.asset_id]));
  assert.deepEqual(parseProduction(JSON.stringify(state)),state);assert.equal(getLineState(parseProduction(JSON.stringify(state)),'L1',new Set()).status,'missing_asset');
  await assert.rejects(buildProductionExport(state,new Map([[result.take.asset_id,testWav(800)]])),/校验失败/);
});
test('JSON cannot inject paths, duplicate takes, API keys or remote audio references',async()=>{
  const result=await attachTake(one(),'L1',testWav());let value=JSON.parse(JSON.stringify(result.state));value.api_key='synthetic';value.takes[0].url='https://example.invalid/x';assert.deepEqual(parseProduction(JSON.stringify(value)),result.state);
  value.takes[0].filename='../unsafe.wav';assert.throws(()=>parseProduction(JSON.stringify(value)));
  value=JSON.parse(JSON.stringify(result.state));value.takes.push(value.takes[0]);assert.throws(()=>parseProduction(JSON.stringify(value)));
});
test('queue serializes, deduplicates and never starts on add',async()=>{
  const ran=[];const queue=new ProductionQueue({run:async job=>ran.push(job.line_id)});queue.add([{line_id:'L1',fingerprint:'a'},{line_id:'L1',fingerprint:'a'},{line_id:'L2',fingerprint:'b'}]);assert.equal(ran.length,0);assert.equal(queue.jobs.length,2);await queue.start();assert.deepEqual(ran,['L1','L2']);assert.ok(queue.jobs.every(job=>job.status==='done'));
});
test('queue failure pauses rest, explicit restart handles pending only; no automatic retry',async()=>{
  let count=0;const queue=new ProductionQueue({run:async()=>{if(++count===1)throw new Error('rate limit');}});queue.add([{line_id:'L1',fingerprint:'a'},{line_id:'L2',fingerprint:'b'}]);await queue.start();assert.equal(count,1);assert.equal(queue.jobs[0].status,'failed');assert.equal(queue.jobs[1].status,'queued');await queue.start();assert.equal(count,2);assert.equal(queue.jobs[0].status,'failed');
});
test('queue pause and cancel do not pretend in-flight completion or retry uncertain request',async()=>{
  let finish;const queue=new ProductionQueue({run:()=>new Promise(resolve=>finish=resolve)});queue.add([{line_id:'L1',fingerprint:'a'},{line_id:'L2',fingerprint:'b'}]);const running=queue.start();queue.pause();finish();await running;assert.equal(queue.jobs[0].status,'done');assert.equal(queue.jobs[1].status,'queued');queue.cancelPending();assert.equal(queue.jobs[1].status,'cancelled');
});

test('single-line request never drains an already queued batch',async()=>{
  const ran=[];const queue=new ProductionQueue({run:async job=>ran.push(job.line_id)});queue.add([{line_id:'L1',fingerprint:'a'},{line_id:'L2',fingerprint:'b'},{line_id:'L3',fingerprint:'c'}]);
  await queue.start(queue.jobs[2].job_id);assert.deepEqual(ran,['L3']);assert.equal(queue.jobs[0].status,'queued');assert.equal(queue.jobs[1].status,'queued');assert.equal(queue.paused,true);
});

test('sparse imported take suffixes never collide with a newly recorded take',async()=>{
  const first=await attachTake(one(),'L1',testWav());const imported=JSON.parse(JSON.stringify(first.state));imported.takes[0].take_id='L1__r0001__t0002';imported.takes[0].filename='audio/L1__r0001__t0002.wav';
  const next=await attachTake(parseProduction(JSON.stringify(imported)),'L1',testWav(750));assert.equal(next.take.take_id,'L1__r0001__t0003');assert.doesNotThrow(()=>parseProduction(JSON.stringify(next.state)));
});

test('workspace ZIP restores actual audio and review state without fabrication; malformed ZIP fails',async()=>{
  const result=await attachTake(one(),'L1',testWav()),assets=new Map([[result.take.asset_id,result.bytes]]),state=reviewTake(result.state,result.take.take_id,'approved',assets);
  const output=await buildProductionExport(state,assets),zip=zipFiles(output.files),restored=await restoreProductionArchive(zip);assert.deepEqual(restored.state,state);assert.deepEqual(restored.assets.get(result.take.asset_id),result.bytes);assert.equal(getLineState(restored.state,'L1',restored.assets).status,'approved');
  const corrupt=zip.slice();corrupt[60]^=1;assert.throws(()=>readStoredZip(corrupt));assert.throws(()=>readStoredZip(zip.slice(0,-1)));
});

test('export snapshots audio so concurrent project reset cannot create empty approved WAVs',async()=>{
  const result=await attachTake(one(),'L1',testWav()),assets=new Map([[result.take.asset_id,result.bytes]]),state=reviewTake(result.state,result.take.take_id,'approved',assets);
  const pending=buildProductionExport(state,assets);assets.clear();result.bytes.fill(0);const output=await pending;assert.equal(output.manifest.deliverable_complete,true);assert.deepEqual(output.files[output.manifest.lines[0].audio],testWav());
  assert.throws(()=>zipFiles({'audio/L1.wav':undefined}),/字节/);
});

test('export refuses total ZIP above restore cap even when audio and metadata individually fit',async()=>{
  // A single real fixture reused by many takes stays far below the unique-audio cap.
  // Its archive copies approach 128 MiB; valid project/manifest text pushes total past 130 MiB.
  const count=600,length=Math.floor(128*1024*1024/(count+1)/2)*2,bytes=new Uint8Array(length);
  bytes.set(testWav().subarray(0,44));const view=new DataView(bytes.buffer);
  view.setUint32(4,length-8,true);view.setUint32(40,length-44,true);
  const result=await attachTake(createProduction(createProject([{line_id:'L1',character:'甲',text:'x'.repeat(1500)}])),'L1',bytes);
  result.state.takes=Array.from({length:count},(_,i)=>{
    const take_id=`L1__r0001__t${String(i+1).padStart(4,'0')}`;
    return {...result.take,take_id,filename:`audio/${take_id}.wav`,review:i===count-1?'approved':'pending'};
  });
  assert.ok(length*(count+1)<=128*1024*1024);
  assert.doesNotThrow(()=>parseProduction(JSON.stringify(result.state)));
  await assert.rejects(buildProductionExport(result.state,new Map([[result.take.asset_id,bytes]])),/总大小超过 130 MiB/);
});
