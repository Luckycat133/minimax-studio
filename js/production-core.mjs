import { parseProject, sampleProject, toCSV, validateId, MAX_INPUT_BYTES } from './dialogue-core.mjs';

export const VOICES = Object.freeze([
  ['male-qn-qingse','青涩青年'], ['male-qn-jingying','精英青年'], ['male-qn-daxuesheng','青年大学生'],
  ['female-shaonv','少女'], ['female-yujie','御姐'], ['female-chengshu','成熟女性'],
  ['Chinese (Mandarin)_Gentleman','温润男声'], ['Chinese (Mandarin)_Humorous_Elder','搞笑大爷']
]);
export const MODELS = ['speech-2.8-turbo','speech-2.8-hd'];
export const EMOTIONS = ['', 'happy','sad','angry','fearful','disgusted','surprised','calm','fluent'];
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 130 * 1024 * 1024;
const fail = message => { throw new Error(message); };
const clone = value => JSON.parse(JSON.stringify(value));
const freshCast = character => ({ character, voice_id:'', model:'speech-2.8-turbo', speed:1, pitch:0, emotion:'', pronunciation:[] });
function normalizeCast(value) {
  const result = freshCast(String(value.character ?? '').trim());
  if (!result.character || result.character.length > 40) fail('角色名无效');
  result.voice_id = String(value.voice_id ?? '').trim();
  if (result.voice_id && !VOICES.some(([id]) => id === result.voice_id)) fail('请选择已核对的系统音色');
  result.model = value.model ?? result.model;
  if (!MODELS.includes(result.model)) fail('不支持的语音模型');
  result.speed = value.speed ?? 1; result.pitch = value.pitch ?? 0; result.emotion = value.emotion ?? '';
  if (typeof result.speed !== 'number' || !Number.isFinite(result.speed) || result.speed < .5 || result.speed > 2) fail('语速须为 0.5–2');
  if (!Number.isInteger(result.pitch) || result.pitch < -12 || result.pitch > 12) fail('音调须为 -12–12 的整数');
  if (!EMOTIONS.includes(result.emotion)) fail('不支持的 Provider 情绪值');
  result.pronunciation = value.pronunciation ?? [];
  if (!Array.isArray(result.pronunciation) || result.pronunciation.length > 32 || result.pronunciation.some(rule => typeof rule !== 'string' || rule.length > 200 || !/^[^/]+\/[^/]+$/.test(rule) || rule.split('/').some(part=>!part.trim()) || /[\u0000-\u001f]/.test(rule))) fail('读音词典每行使用 词语/读音，最多 32 行');
  result.pronunciation = result.pronunciation.map(rule => rule.trim()).filter(Boolean);
  return result;
}
function sizeBound(state) { if (new TextEncoder().encode(JSON.stringify(state, null, 2)).length > MAX_INPUT_BYTES) fail('项目元数据已达 2 MiB，请导出备份并拆分项目'); return state; }
export function createProduction(project = sampleProject()) {
  project = parseProject(JSON.stringify(project));
  return { schema_version:2, project, cast:[...new Set(project.lines.map(line => line.character))].map(freshCast), takes:[] };
}
export function syncProject(state, project) {
  project = parseProject(JSON.stringify(project));
  const roles = [...new Set(project.lines.map(line => line.character))];
  return sizeBound({ ...state, project, cast:roles.map(role => state.cast.find(item => item.character === role) ?? freshCast(role)) });
}
export function assignVoice(state, character, settings) {
  if (!state.cast.some(item => item.character === character)) fail('角色不存在');
  return sizeBound({ ...state, cast:state.cast.map(item => item.character === character ? normalizeCast({ ...item, ...settings, character }) : item) });
}
export function fingerprint(state, id) {
  const line = state.project.lines.find(item => item.line_id === id); if (!line) fail('台词不存在');
  const cast = state.cast.find(item => item.character === line.character) ?? freshCast(line.character);
  return JSON.stringify({ line_id:id, revision:line.revision, text:line.text, character:line.character, emotion_note:line.emotion, direction_note:line.direction, cast:normalizeCast(cast) });
}
export function buildSpeechRequest(state, id, operation_id) {
  const line = state.project.lines.find(item => item.line_id === id); if (!line) fail('台词不存在');
  const cast = normalizeCast(state.cast.find(item => item.character === line.character) ?? freshCast(line.character));
  if (!cast.voice_id) fail(`请先为 ${line.character} 分配音色`);
  if (typeof operation_id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(operation_id)) fail('操作 ID 无效');
  return { operation_id, text:line.text, voice_id:cast.voice_id, model:cast.model, speed:cast.speed, pitch:cast.pitch, emotion:cast.emotion, pronunciation:[...cast.pronunciation] };
}
export function validateWav(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 44 || bytes.length > MAX_AUDIO_BYTES) fail('需要有效 WAV，单文件最大 20 MiB');
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const tag = offset => String.fromCharCode(...bytes.subarray(offset,offset+4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4,true)+8 !== bytes.length) fail('WAV 头或 RIFF 长度无效');
  let format=null, dataLength=0, dataChunks=0;
  for (let at=12; at<bytes.length;) {
    if (at+8>bytes.length) fail('WAV 区块被截断');
    const length=view.getUint32(at+4,true), start=at+8, end=start+length;
    if (end>bytes.length) fail('WAV 数据被截断');
    const kind=tag(at);
    if (kind==='fmt ') {
      if (format || length<16) fail('WAV 格式区块无效');
      format={ encoding:view.getUint16(start,true),channels:view.getUint16(start+2,true),sample_rate:view.getUint32(start+4,true),byte_rate:view.getUint32(start+8,true),block_align:view.getUint16(start+12,true),bits:view.getUint16(start+14,true) };
    }
    if (kind==='data') { dataLength+=length; dataChunks++; }
    at=end+(length%2); if (at>bytes.length) fail('WAV 填充字节缺失');
  }
  if (!format || dataChunks!==1 || !dataLength) fail('WAV 缺少唯一有效音频区块');
  if (![1,3].includes(format.encoding) || ![1,2].includes(format.channels) || format.sample_rate<8000 || format.sample_rate>96000 || (format.encoding===1 ? ![16,24,32].includes(format.bits) : format.bits!==32)) fail('只支持 8–96kHz 单/双声道 PCM16/24/32 或 float32 WAV');
  const align=format.channels*format.bits/8;
  if (format.block_align!==align || format.byte_rate!==format.sample_rate*align || dataLength%align) fail('WAV 采样参数不一致');
  const duration_ms=Math.max(1,Math.round(dataLength/format.byte_rate*1000));
  if (duration_ms<1 || duration_ms>600000) fail('WAV 长度须为 非空且不超过 10 分钟');
  return { ...format,duration_ms,byte_length:bytes.length };
}
export async function audioDigest(bytes) {
  if (!globalThis.crypto?.subtle) fail('浏览器缺少安全摘要能力，请使用现代浏览器的本地文件或 localhost');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export async function attachTake(state, id, bytes, options={}) {
  const info=validateWav(bytes), sha256=await audioDigest(bytes);
  state=options.getState ? options.getState() : state;
  const line=state.project.lines.find(item=>item.line_id===id); if (!line) fail('台词不存在');
  if (state.takes.length>=1000) fail('项目已达 1000 个试音版本，请先导出备份');
  const number=Math.max(0,...state.takes.filter(take=>take.line_id===id).map(take=>Number(take.take_id.match(/__t(\d{4})$/)?.[1] ?? 0)))+1;
  if(number>9999)fail('该台词试音编号已达上限，请另建台词 ID');
  const revision=options.revision ?? line.revision;
  if (!Number.isInteger(revision)||revision<1||revision>100) fail('试音版本号无效');
  const take_id=`${validateId(id)}__r${String(revision).padStart(4,'0')}__t${String(number).padStart(4,'0')}`;
  const take={take_id,line_id:id,revision,fingerprint:options.fingerprint ?? fingerprint(state,id),source:options.source==='minimax'?'minimax':'import',asset_id:sha256,filename:`audio/${take_id}.wav`,byte_length:info.byte_length,duration_ms:info.duration_ms,sha256,review:'pending'};
  return {state:sizeBound({...state,takes:[...state.takes,take]}),take,bytes:new Uint8Array(bytes)};
}
function hasAsset(available,take){
  if(!available.has(take.asset_id))return false;
  if(typeof available.get!=='function')return true;
  try{const info=validateWav(available.get(take.asset_id));return info.byte_length===take.byte_length&&info.duration_ms===take.duration_ms;}catch{return false;}
}
export function getLineState(state,id,available=new Set()) {
  const current=fingerprint(state,id), takes=state.takes.filter(take=>take.line_id===id), matches=takes.filter(take=>take.fingerprint===current);
  const approved=[...matches].reverse().find(take=>take.review==='approved'&&hasAsset(available,take));
  if (approved) return {status:'approved',take:approved};
  const pending=[...matches].reverse().find(take=>take.review==='pending'&&hasAsset(available,take));
  if (pending) return {status:'pending_review',take:pending};
  if (matches.some(take=>!hasAsset(available,take))) return {status:'missing_asset',take:matches.at(-1)};
  if (matches.some(take=>take.review==='rejected')) return {status:'rejected',take:matches.at(-1)};
  if (takes.length) return {status:'stale',take:takes.at(-1)};
  return {status:'missing_audio',take:null};
}
export function reviewTake(state,take_id,decision,available=new Set()) {
  if (!['approved','rejected','pending'].includes(decision)) fail('审核状态无效');
  const selected=state.takes.find(take=>take.take_id===take_id); if (!selected) fail('试音版本不存在');
  if (decision==='approved'&&(!hasAsset(available,selected)||selected.fingerprint!==fingerprint(state,selected.line_id))) fail('音频缺失或与当前台词/配音设置不匹配，不能通过审核');
  return {...state,takes:state.takes.map(take=>take.take_id===take_id?{...take,review:decision}:decision==='approved'&&take.line_id===selected.line_id&&take.fingerprint===selected.fingerprint&&take.review==='approved'?{...take,review:'pending'}:take)};
}
export function parseProduction(input) {
  if (typeof input!=='string'||new TextEncoder().encode(input).length>MAX_INPUT_BYTES) fail('项目 JSON 最大 2 MiB');
  let data;try{data=JSON.parse(input);}catch{fail('项目 JSON 格式错误');}
  if (data?.schema_version===1) return createProduction(parseProject(input));
  if (!data||data.schema_version!==2) fail('不支持的项目版本');
  let state=createProduction(data.project);
  if (!Array.isArray(data.cast)||data.cast.length!==state.cast.length||new Set(data.cast.map(item=>item.character)).size!==data.cast.length) fail('角色配置不完整或重复');
  state.cast=state.cast.map(item=>normalizeCast(data.cast.find(value=>value.character===item.character)??fail('角色配置缺失')));
  if (!Array.isArray(data.takes)||data.takes.length>1000) fail('试音记录无效');
  const ids=new Set();
  state.takes=data.takes.map(raw=>{
    if (!raw||typeof raw.take_id!=='string'||!/^([A-Za-z][A-Za-z0-9_-]{0,63})__r\d{4}__t\d{4}$/.test(raw.take_id)||ids.has(raw.take_id)) fail('试音 ID 无效或重复');
    ids.add(raw.take_id);validateId(raw.line_id);
    if (!state.project.lines.some(line=>line.line_id===raw.line_id)||!Number.isInteger(raw.revision)||raw.revision<1||raw.revision>100||!raw.take_id.startsWith(`${raw.line_id}__r${String(raw.revision).padStart(4,'0')}__t`)) fail('试音台词引用无效');
    if (typeof raw.fingerprint!=='string'||raw.fingerprint.length>16000||!['minimax','import'].includes(raw.source)||!['pending','approved','rejected'].includes(raw.review)||!/^[a-f0-9]{64}$/.test(raw.sha256)||raw.asset_id!==raw.sha256||raw.filename!==`audio/${raw.take_id}.wav`||!Number.isInteger(raw.byte_length)||raw.byte_length<44||raw.byte_length>MAX_AUDIO_BYTES||!Number.isInteger(raw.duration_ms)||raw.duration_ms<1||raw.duration_ms>600000) fail('试音元数据无效');
    return Object.fromEntries(['take_id','line_id','revision','fingerprint','source','asset_id','filename','byte_length','duration_ms','sha256','review'].map(key=>[key,raw[key]]));
  });
  return sizeBound(state);
}
export async function buildProductionExport(state,assets,options={}) {
  state=parseProduction(JSON.stringify(state));
  assets=new Map([...assets].map(([id,bytes])=>{if(!(bytes instanceof Uint8Array))fail('音频缓存类型无效');return[id,new Uint8Array(bytes)];}));
  const available=assets, statuses=state.project.lines.map(line=>({line,...getLineState(state,line.line_id,available)}));
  const missing=statuses.filter(item=>item.status!=='approved');
  if (options.approvedOnly!==false&&missing.length) fail(`无法最终交付：${missing.length} 条尚未通过当前版本审核（${missing.slice(0,5).map(item=>item.line.line_id).join('、')}）`);
  const estimatedBytes=state.takes.reduce((sum,take)=>sum+(assets.has(take.asset_id)?take.byte_length:0),0)+statuses.reduce((sum,item)=>sum+(item.status==='approved'?item.take.byte_length:0),0);
  if(estimatedBytes>128*1024*1024)fail('工作包音频超过 128 MiB，请拆分项目后导出');
  const files={},verified=new Set();
  for (const take of state.takes) {
    const bytes=assets.get(take.asset_id); if (!bytes) continue;
    const info=validateWav(bytes);
    if (info.byte_length!==take.byte_length||info.duration_ms!==take.duration_ms||await audioDigest(bytes)!==take.sha256) fail(`音频校验失败：${take.take_id}`);
    verified.add(take.asset_id);
    // Archive every take under an explicit history path, preserve redo/rejected evidence.
    files[`takes/${take.take_id}.wav`]=bytes;
  }
  const manifest={schema_version:2,project:state.project.title,deliverable_complete:missing.length===0,audio_generated:state.takes.some(take=>take.source==='minimax'&&verified.has(take.asset_id)),summary:{total:statuses.length,approved:statuses.length-missing.length,unresolved:missing.length},lines:statuses.map(({line,status,take})=>{
    if (status==='approved') files[take.filename]=assets.get(take.asset_id);
    return {line_id:line.line_id,revision:line.revision,character:line.character,text:line.text,status,audio:status==='approved'?take.filename:null,take_id:status==='approved'?take.take_id:null,sha256:status==='approved'?take.sha256:null};
  }),takes:state.takes.map(take=>({...take,archive_audio:verified.has(take.asset_id)?`takes/${take.take_id}.wav`:null})),warnings:missing.length?['DRAFT_INCOMPLETE: unresolved current lines are not included as deliverable audio.']:[]};
  files['project.json']=JSON.stringify(state,null,2)+'\n';files['manifest.json']=JSON.stringify(manifest,null,2)+'\n';files['dialogue.csv']=toCSV(state.project);
  files['README.txt']=`MiniMax Studio · 配音制作包\n${state.project.title}\n${missing.length?'草稿：仍有 '+missing.length+' 条未通过当前版本审核。':'全部当前台词已有通过审核的音频。'}\naudio/ 仅包含通过审核且哈希校验一致的当前交付音频。\ntakes/ 保留已找到的全部原始试音版本，包括过期和退回版本，不应直接用作交付。\nmanifest.json 的 audio=null 表示不能交付。JSON 是元数据备份，不内嵌音频。\n若恢复项目，请同时保留 ZIP 中音频；可重新导入 WAV 形成新的待审核版本。\n来源 import 为手动导入，minimax 为服务返回；不会使用静音替代缺失音频。\n`;
  // Match zipFiles exactly: end record, both headers/names, and every payload.
  // Audio alone can fit its cap while duplicated metadata makes the ZIP unrestorable.
  const encoder=new TextEncoder();
  const archiveBytes=22+Object.entries(files).reduce((sum,[name,content])=>sum+76+2*encoder.encode(name).length+(typeof content==='string'?encoder.encode(content).length:content.byteLength),0);
  if(archiveBytes>MAX_ARCHIVE_BYTES)fail('工作包总大小超过 130 MiB（含录音、元数据与 ZIP 目录），请拆分项目后导出');
  return {files,manifest};
}

/** Restore only this tool's uncompressed ZIPs. No extraction to disk or remote references. */
export function readStoredZip(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>MAX_ARCHIVE_BYTES)fail('工作包无效或超过 130 MiB');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=bytes.length-22;
  if(view.getUint32(end,true)!==0x06054b50||view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+20,true))fail('仅支持本工具导出的标准无压缩 ZIP');
  const count=view.getUint16(end+10,true),directorySize=view.getUint32(end+12,true),directoryOffset=view.getUint32(end+16,true);
  if(count<1||count>2504||view.getUint16(end+8,true)!==count||directoryOffset+directorySize!==end)fail('ZIP 目录无效');
  const decoder=new TextDecoder('utf-8',{fatal:true}),files={};let at=directoryOffset,nextLocal=0;
  const crc32=data=>{let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}return(crc^0xffffffff)>>>0;};
  for(let i=0;i<count;i++){
    if(at+46>end||view.getUint32(at,true)!==0x02014b50)fail('ZIP 目录被截断');
    const flags=view.getUint16(at+8,true),method=view.getUint16(at+10,true),crc=view.getUint32(at+16,true),size=view.getUint32(at+20,true),uncompressed=view.getUint32(at+24,true),nameLen=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true),local=view.getUint32(at+42,true);
    if(![0,0x800].includes(flags)||method!==0||size!==uncompressed||extra||comment||view.getUint16(at+34,true)||at+46+nameLen>end||local!==nextLocal||local+30>directoryOffset)fail('ZIP 使用不支持的编码、压缩或重叠区块');
    const name=decoder.decode(bytes.subarray(at+46,at+46+nameLen));
    if(!/^(?:(?:audio|takes)\/)?[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(name)||Object.hasOwn(files,name))fail('ZIP 文件名无效或重复');
    if(view.getUint32(local,true)!==0x04034b50||view.getUint16(local+6,true)!==flags||view.getUint16(local+8,true)!==0||view.getUint32(local+14,true)!==crc||view.getUint32(local+18,true)!==size||view.getUint32(local+22,true)!==size||view.getUint16(local+26,true)!==nameLen||view.getUint16(local+28,true)!==0)fail('ZIP 本地头不一致');
    const start=local+30+nameLen,stop=start+size;if(stop>directoryOffset||decoder.decode(bytes.subarray(local+30,start))!==name)fail('ZIP 内容范围无效');
    const data=bytes.slice(start,stop);if(crc32(data)!==crc)fail('ZIP 内容 CRC 校验失败');files[name]=data;nextLocal=stop;at+=46+nameLen;
  }
  if(at!==end||nextLocal!==directoryOffset)fail('ZIP 含未知尾部或区块');return files;
}
export async function restoreProductionArchive(bytes){
  const files=readStoredZip(bytes),decoder=new TextDecoder('utf-8',{fatal:true});
  if(!files['project.json'])fail('工作包缺少 project.json');
  const state=parseProduction(decoder.decode(files['project.json'])),assets=new Map();let total=0;
  for(const take of state.takes){
    const data=files[`takes/${take.take_id}.wav`]??files[take.filename];if(!data)continue;
    const info=validateWav(data);if(info.byte_length!==take.byte_length||info.duration_ms!==take.duration_ms||await audioDigest(data)!==take.sha256)fail(`工作包音频校验失败：${take.take_id}`);
    if(!assets.has(take.asset_id)){total+=data.length;if(total>100*1024*1024)fail('工作包独立录音超过 100 MiB，请拆分项目');assets.set(take.asset_id,data);}
  }
  return {state,assets};
}
