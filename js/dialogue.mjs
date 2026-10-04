import { createProduction, parseProduction, syncProject, assignVoice, fingerprint, buildSpeechRequest, attachTake, getLineState, reviewTake, buildProductionExport, validateWav, audioDigest, restoreProductionArchive, VOICES, EMOTIONS } from './production-core.mjs';
import { AudioStore } from './production-storage.mjs';
import { ProductionQueue } from './production-queue.mjs';
import { sampleProject, parseCSV, parseProject, mergeRows, editLine, checkLine, currentFilename, exportFiles, zipFiles, MAX_INPUT_BYTES } from './dialogue-core.mjs';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'minimax_studio_production_v2';
const assets = new Map(), audioURLs = new Map(), audioStore = new AudioStore(), unpersistedAssets = new Set();
let restoreEpoch = 0;
let unsavedAudio = false, pendingAudio = false, service = { enabled:false, reason:'未连接本地生成服务' };
let production = createProduction();
let project = sampleProject(), selectedId = project.lines[0].line_id, pendingImport = null, pendingArchiveAssets = null, dirty = false;
let storageWarning = '';
let unpersisted = false, unpersistedQueue = false, storedSnapshot = null;
let fileReadSequence = 0;
try {
  const saved = localStorage.getItem(STORAGE_KEY); storedSnapshot = saved;
  if (saved) { production = parseProduction(saved); project = production.project; $('storage-status').textContent = '已恢复此浏览器的项目草稿（未加密）· 建议另存 JSON 备份'; }
  else { const old = localStorage.getItem('minimax_studio_offline_dialogue_v1'); if (old) { production = createProduction(parseProject(old)); project = production.project; } }
} catch { storageWarning = '浏览器草稿不可读取，已显示示例；原草稿未被覆盖。请先导出需要保留的内容。'; }
selectedId = project.lines[0].line_id;
const selected = () => project.lines.find(line => line.line_id === selectedId);
const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
function notify(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function persist() {
  unpersisted = true;
  try {
    if (localStorage.getItem(STORAGE_KEY) !== storedSnapshot) {
      $('storage-status').textContent = '其他标签页已修改此项目；本页未覆盖。请另存 JSON 后刷新，避免丢失修改';
      return;
    }
    const content = JSON.stringify(production);
    if (new TextEncoder().encode(content).length > MAX_INPUT_BYTES) throw new Error('草稿已超过 2 MiB，请导出备份');
    localStorage.setItem(STORAGE_KEY, content); storedSnapshot = content; unpersisted = false;
    $('storage-status').textContent = '已保存到此浏览器（未加密）· 建议另存 JSON，避免浏览器清理造成丢失';
  } catch { $('storage-status').textContent = '浏览器保存失败：本次内容仍在内存中，请立即另存项目 JSON'; }
}
function confirmDiscard() { return !dirty || window.confirm('当前台词有未保存的修改。放弃这些修改并继续？'); }
function renderList() {
  const query = $('search').value.trim().toLowerCase(), filter = $('filter').value;
  const lines = project.lines.filter(line => (!query || `${line.line_id} ${line.character} ${line.text}`.toLowerCase().includes(query)) && (filter === 'all' || (filter === 'modified' && line.revision > 1) || (filter === 'unchecked' && !line.checks) || (filter === 'checked' && line.checks) || getLineState(production,line.line_id,assets).status === filter));
  $('visible-count').textContent = `${lines.length} / ${project.lines.length} 条`;
  $('line-list').replaceChildren();
  if (!lines.length) $('line-list').append(node('p', 'empty-list', '没有符合筛选条件的台词。清空搜索或切换筛选。'));
  for (const line of lines) {
    const button = node('button', `line-row${line.line_id === selectedId ? ' selected' : ''}`);
    button.type = 'button'; button.dataset.lineId = line.line_id;
    button.setAttribute('aria-label', `${line.line_id} ${line.character} ${line.text}`);
    button.setAttribute('aria-pressed', String(line.line_id === selectedId));
    const meta = node('div', 'line-meta'); meta.append(node('strong', '', line.line_id), node('span', '', line.character));
    const badges = node('div', 'line-badges'); badges.append(node('span', line.checks ? 'checked' : '', line.checks ? '结构已预检' : '待预检'), node('span', line.revision > 1 ? 'revised' : '', `v${String(line.revision).padStart(3, '0')}${line.revision > 1 ? ' · 已修改' : ''}`));
    const state = getLineState(production,line.line_id,assets); badges.append(node('span', state.status==='approved'?'approved':state.status==='stale'?'stale':'review', statusLabel(state.status)));
    button.append(meta, node('div', 'line-text', line.text), badges);
    button.addEventListener('click', () => { if (line.line_id !== selectedId && confirmDiscard()) { selectedId = line.line_id; renderList(); renderEditor(); } });
    $('line-list').append(button);
  }
}
function renderEditor() {
  const line = selected(); dirty = false;
  $('selected-id').textContent = line.line_id; $('revision').textContent = `v${String(line.revision).padStart(3, '0')}`;
  for (const field of ['character', 'text', 'emotion', 'direction']) $(field).value = line[field];
  $('char-count').textContent = `${line.text.length} / 2000`;
  $('edit-status').textContent = '当前版本未修改'; $('save-btn').disabled = true;
  const cast = production.cast.find(item=>item.character===line.character);
  $('voice-name').textContent = cast?.voice_id ? (VOICES.find(([id])=>id===cast.voice_id)?.[1] ?? cast.voice_id) : '角色音色未分配';
  $('voice-description').textContent = `${line.character} · ${cast?.voice_id || '可先手动导入 WAV'}`;
  $('generate-line-btn').disabled = !service.enabled || !cast?.voice_id;
  $('generate-line-btn').textContent = service.enabled ? '生成 / 重做此条' : '生成此条 · 服务未启用';
  $('line-status').textContent = line.checks ? '结构预检通过' : '待预检';
  $('check-count').textContent = `${line.checks} 次预检 · 预检不调用 API`;
  $('line-explanation').textContent = line.checks ? '结构与命名有效。预检不调用模型，也不替换已导入或已生成的录音。' : '检查当前台词与文件命名。不会生成任何音频。';
  $('check-btn').textContent = line.checks ? '仅重试此条预检' : '仅预检此条';
  const current = getLineState(production,line.line_id,assets);
  $('filename').textContent = current.status==='approved' ? current.take.filename : '尚无可交付音频';
  $('filename-note').textContent = current.status==='approved' ? '真实音频 · 已审核' : '须有当前版本已通过审核的音频';
  renderTakes();
  $('history-count').textContent = `${line.history.length} 个旧版本`;
  $('history-list').replaceChildren();
  if (!line.history.length) $('history-list').append(node('p', 'history-entry', '保存改写后会保留旧文本，并仅更新这一条的版本与文件名。'));
  for (const old of [...line.history].reverse()) {
    const entry = node('article', 'history-entry');
    entry.append(node('strong', '', `v${String(old.revision).padStart(3, '0')} · ${old.character} · ${old.emotion || '未标情绪'}`), node('p', '', old.text), node('p', '', `备注：${old.direction || '无'}`), node('p', '', `v${old.revision} · ${production.takes.filter(take=>take.line_id===line.line_id&&take.revision===old.revision).length} 个保留试音版本（见试音列表）`));
    $('history-list').append(entry);
  }
}
function renderSummary() {
  $('project-title').textContent = project.title; $('count-total').textContent = project.lines.length;
  $('count-modified').textContent = project.lines.filter(line => line.revision > 1).length;
  $('count-checked').textContent = `${project.lines.filter(line => line.checks).length} 条已预检`;
  const approved=project.lines.filter(line=>getLineState(production,line.line_id,assets).status==='approved').length;
  $('count-approved').textContent=approved; $('count-missing').textContent=project.lines.length-approved;
  const roles = new Map(); project.lines.forEach(line => roles.set(line.character, (roles.get(line.character) || 0) + 1));
  $('role-count').textContent = roles.size; $('role-list').replaceChildren();
  for (const [name, count] of roles) {
    const item = node('div', 'role-item'), label = node('div', '', name);
    const cast=production.cast.find(item=>item.character===name);
    label.append(node('small', '', cast?.voice_id ? (VOICES.find(([id])=>id===cast.voice_id)?.[1] ?? cast.voice_id) : '点击分配音色'));
    item.tabIndex=0; item.setAttribute('role','button'); item.setAttribute('aria-label',`配置 ${name} 音色`); item.addEventListener('click',()=>openCast(name)); item.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openCast(name);}}); item.append(node('span', 'role-avatar', [...name][0]), label, node('span', 'role-lines', `${count} 条`)); $('role-list').append(item);
  }
}
function render() { renderSummary(); renderList(); renderEditor(); }
function changeProject(next) { production = next.schema_version===2 ? next : syncProject(production,next); project = production.project; pruneAssets(); if (!selected()) selectedId = project.lines[0].line_id; persist(); render(); restoreAssets(); }
function action(callback) { try { const result=callback(); if(result?.catch)result.catch(error=>notify(error.message,true)); } catch (error) { notify(error.message, true); } }
$('line-form').addEventListener('input', () => {
  dirty = ['character', 'text', 'emotion', 'direction'].some(field => $(field).value !== selected()[field]);
  $('save-btn').disabled = !dirty; $('char-count').textContent = `${$('text').value.length} / 2000`;
  $('edit-status').textContent = dirty ? '尚未保存 · 仅此条将新增版本' : '当前版本未修改';
});
$('line-form').addEventListener('submit', event => { event.preventDefault(); action(() => {
  const previousRevision = selected().revision;
  changeProject(editLine(project, selectedId, Object.fromEntries(['character', 'text', 'emotion', 'direction'].map(field => [field, $(field).value]))));
  notify(unpersisted ? '版本已更新，但未保存到浏览器；请立即另存项目 JSON' : selected().revision === previousRevision ? '内容未变化，未创建重复版本' : `已保存 ${selectedId} 的 v${selected().revision}，其余台词未变。旧版本已保留。`);
}); });
$('check-btn').addEventListener('click', () => action(() => {
  if (dirty) return notify('请先保存修改，再预检当前版本', true);
  changeProject(checkLine(project, selectedId)); notify(`${selectedId} 预检完成；未发送 API 请求，现有录音保持不变。`);
}));
$('search').addEventListener('input', renderList); $('filter').addEventListener('change', renderList);
function download(bytes, filename, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function requireSaved() { if (dirty) { notify('请先保存或撤销当前台词修改，再导出', true); return false; } return true; }
async function exportProduction(approvedOnly) {
  if (!requireSaved()) return;
  const result=await buildProductionExport(production,assets,{approvedOnly});
  download(zipFiles(result.files),approvedOnly?'minimax-dialogue-approved.zip':'minimax-dialogue-workspace.zip','application/zip');
  notify(approvedOnly?`已导出「${result.manifest.project}」${result.manifest.summary.approved} 条审核成品，文件与清单一致`:`已备份项目与可用录音；仍有 ${result.manifest.summary.unresolved} 条未完成，不应作为完整成品交付`);
}
$('export-btn').addEventListener('click',()=>action(()=>exportProduction(true)));
$('draft-export-btn').addEventListener('click',()=>action(()=>exportProduction(false)));
$('project-btn').addEventListener('click',()=>action(()=>{if(!requireSaved())return;
  download(JSON.stringify(production,null,2)+'\n','minimax-dialogue-project.json','application/json'); notify('已另存元数据 JSON；不包含音频。请用「备份工作包」保留录音。');
}));
function invalidateImport() { fileReadSequence++; pendingImport = null; pendingArchiveAssets = null; $('apply-import').disabled = true; $('import-preview').replaceChildren(); $('import-error').textContent = ''; }
$('import-btn').addEventListener('click', () => { if (queue.running || pendingAudio) return notify('请等待当前音频操作结束再替换项目',true); if (!confirmDiscard()) return; renderEditor(); invalidateImport(); $('import-text').value = ''; $('import-file').value = ''; $('import-dialog').showModal(); });
for (const id of ['import-close', 'import-cancel']) $(id).addEventListener('click', () => { $('import-dialog').close(); invalidateImport(); });
$('import-dialog').addEventListener('cancel', invalidateImport);
$('import-text').addEventListener('input', invalidateImport);
$('import-file').addEventListener('change', async () => {
  invalidateImport(); const sequence = ++fileReadSequence; const file = $('import-file').files[0]; if (!file) return;
  if(file.name?.toLowerCase().endsWith('.zip')){
    try{if(file.size>130*1024*1024)throw new Error('工作包最大 130 MiB');const restored=await restoreProductionArchive(new Uint8Array(await file.arrayBuffer()));if(sequence!==fileReadSequence||!$('import-dialog').open)return;pendingImport=restored.state;pendingArchiveAssets=restored.assets;$('import-text').value='';$('import-preview').append(node('p','',`工作包将替换当前项目：${restored.state.project.title}，${restored.state.project.lines.length} 条台词，恢复 ${restored.assets.size} 个已校验音频文件。`));$('apply-import').disabled=false;}catch(error){if(sequence===fileReadSequence)$('import-error').textContent=error.message;}return;
  }
  if (file.size > MAX_INPUT_BYTES) { $('import-error').textContent = 'CSV / JSON 最大 2 MiB'; return; }
  try { const text = await file.text(); if (sequence !== fileReadSequence || !$('import-dialog').open) return; $('import-text').value = text; previewImport(); }
  catch { $('import-error').textContent = '文件读取失败，请检查 UTF-8 编码或改用粘贴'; }
});
function previewImport() {
  invalidateImport();
  try {
    const raw = $('import-text').value;
    const isProject = raw.trim().startsWith('{');
    const next = isProject ? parseProduction(raw) : syncProject(production,mergeRows(project, parseCSV(raw)));
    const importedProject=next.project;
    const prior = new Map(project.lines.map(line => [line.line_id, line]));
    const added = importedProject.lines.filter(line => !prior.has(line.line_id)).length;
    const changed = importedProject.lines.filter(line => prior.has(line.line_id) && JSON.stringify(line) !== JSON.stringify(prior.get(line.line_id))).length;
    const message = isProject ? `JSON 将整体替换当前项目：${importedProject.title}，${importedProject.lines.length} 条台词。若需保留当前项目，请取消并另存 JSON。` : `CSV 将按 ID 合并：新增 ${added} 条，更新 ${changed} 条；未列出的原台词保留。合计 ${importedProject.lines.length} 条。`;
    $('import-preview').append(node('p', '', message), node('p', '', 'JSON 只带录音元数据；当前浏览器里找不到的音频仍标缺失。不会导入 API Key 或远程音频链接。'));
    pendingImport = next; $('apply-import').disabled = false;
  } catch (error) { $('import-error').textContent = error.message; }
}
$('preview-btn').addEventListener('click', previewImport);
$('apply-import').addEventListener('click', () => action(async() => {
  if(!pendingImport)return;
  if(queue.running||pendingAudio)return notify('请等待当前音频操作结束再应用导入',true);
  if((unsavedAudio||unpersisted)&&!window.confirm('当前项目有尚未可靠保存的修改或录音。请先备份工作包；仍要替换吗？'))return;
  const next=pendingImport,importedAssets=pendingArchiveAssets;pendingImport=null;pendingArchiveAssets=null;$('apply-import').disabled=true;
  if(importedAssets)for(const[id,bytes]of importedAssets){assets.set(id,bytes);unpersistedAssets.add(id);}
  changeProject(next);queue.cancelPending();$('import-dialog').close();
  if(importedAssets){pendingAudio=true;try{for(const[id,bytes]of importedAssets){try{await audioStore.put(id,bytes);unpersistedAssets.delete(id);}catch{ /* Remains available in memory; exit guard stays active. */ }}}finally{pendingAudio=false;unsavedAudio=unpersistedAssets.size>0;}}
  await restoreAssets();
  notify(unpersisted||unsavedAudio?'项目已载入，但部分数据未可靠保存；请立即备份工作包':'项目已恢复；请核对当前音频与审核状态。');
}));
$('sample-btn').addEventListener('click', () => {
  if(queue.running||pendingAudio)return notify('请等待当前音频操作结束再重置',true);
  if((unsavedAudio||unpersisted)&&!window.confirm('当前项目有未可靠保存的内容。请先备份工作包；仍要重置吗？'))return;
  if (window.confirm('重置为 20 条虚构示例会替换此浏览器的当前项目。请先另存需要的 JSON。继续重置？')) { selectedId = sampleProject().lines[0].line_id; changeProject(createProduction(sampleProject())); queue.cancelPending(); notify('已重置为 20 条原创虚构台词；未生成音频'); }
});
window.addEventListener('beforeunload', event => { if (dirty || unpersisted || unpersistedQueue || unsavedAudio || pendingAudio || queue.running) { event.preventDefault(); event.returnValue = ''; } });


function statusLabel(status) { return ({approved:'已审核',pending_review:'待试听审核',stale:'设置已变 · 旧音频',rejected:'已退回',missing_asset:'音频文件缺失',missing_audio:'无音频'})[status] ?? status; }
function updateTakeState(next){production=next;project=production.project;persist();renderSummary();renderList();renderTakes();const state=getLineState(production,selectedId,assets);$('filename').textContent=state.status==='approved'?state.take.filename:'尚无可交付音频';}
function renderTakes(){
  $('take-list').replaceChildren();const current=fingerprint(production,selectedId), takes=production.takes.filter(take=>take.line_id===selectedId);
  if(!takes.length){$('take-list').append(node('p','muted-note','还没有真实录音。可导入 WAV；不会用静音替代缺失音频。'));return;}
  for(const take of [...takes].reverse()){
    const bytes=assets.get(take.asset_id),isCurrent=take.fingerprint===current;
    const card=node('article',`take-card${take.review==='approved'&&isCurrent?' current-approved':''}${!isCurrent?' stale-take':''}`), title=node('div','take-title');
    title.append(node('strong','',`${take.take_id} · ${(take.duration_ms/1000).toFixed(1)}s`),node('span','',`${take.source==='import'?'导入录音':'MiniMax 返回'} · ${!isCurrent?'已过期':take.review==='approved'?'已通过':take.review==='rejected'?'已退回':'待审核'}`));card.append(title);
    if(bytes){
      if(!audioURLs.has(take.asset_id))audioURLs.set(take.asset_id,URL.createObjectURL(new Blob([bytes],{type:'audio/wav'})));
      const player=node('audio'),playbackError=node('p','error');
      const errorMessage=`${take.take_id} 无法播放。请重新导入支持的 WAV，或换用支持该格式的浏览器试听；原录音未删除，可用“备份工作包”保存。`;
      playbackError.setAttribute('role','alert');playbackError.hidden=true;
      player.addEventListener('error',()=>{if(!player.isConnected)return;playbackError.textContent=errorMessage;playbackError.hidden=false;notify(errorMessage,true);});
      player.addEventListener('canplay',()=>{
        if(!player.isConnected)return;
        const recovered=Boolean(playbackError.textContent);playbackError.textContent='';playbackError.hidden=true;
        if(recovered&&$('notice').textContent===errorMessage)notify(`${take.take_id} 已可播放，请重新试听后审核。`);
      });
      player.controls=true;player.preload='metadata';player.src=audioURLs.get(take.asset_id);player.setAttribute('aria-label',`试听 ${take.take_id}`);card.append(player,playbackError);
    }else card.append(node('p','muted-note','录音字节不在此浏览器中；需要重新导入 WAV，不能试听或通过审核。'));
    const buttons=node('div','take-actions'),approve=node('button','soft-button','审核通过'),reject=node('button','soft-button','退回');
    approve.disabled=!bytes||!isCurrent||take.review==='approved';reject.disabled=take.review==='rejected';
    approve.addEventListener('click',()=>action(()=>updateTakeState(reviewTake(production,take.take_id,'approved',assets))));
    reject.addEventListener('click',()=>action(()=>updateTakeState(reviewTake(production,take.take_id,'rejected',assets))));
    buttons.append(approve,reject);card.append(buttons);$('take-list').append(card);
  }
}
function pruneAssets(){
  restoreEpoch++;const needed=new Set(production.takes.map(take=>take.asset_id));
  for(const id of assets.keys())if(!needed.has(id)){assets.delete(id);if(audioURLs.has(id)){URL.revokeObjectURL(audioURLs.get(id));audioURLs.delete(id);}unpersistedAssets.delete(id);}
  unsavedAudio=unpersistedAssets.size>0;
}
async function restoreAssets(){
  const epoch=++restoreEpoch;let missing=0,limited=false;
  for(const take of production.takes){
    if(epoch!==restoreEpoch)return;if(assets.has(take.asset_id))continue;
    try{
      const bytes=await audioStore.get(take.asset_id);if(epoch!==restoreEpoch)return;
      if(!bytes){missing++;continue;}
      const info=validateWav(bytes);if(info.byte_length!==take.byte_length||info.duration_ms!==take.duration_ms||await audioDigest(bytes)!==take.sha256){missing++;continue;}
      if(epoch!==restoreEpoch)return;
      if([...assets.values()].reduce((sum,value)=>sum+value.length,0)+bytes.length>100*1024*1024){missing++;limited=true;continue;}
      assets.set(take.asset_id,bytes);
    }catch{missing++;}
  }
  if(epoch!==restoreEpoch)return;
  $('audio-storage-status').textContent=missing?`${missing} 个录音文件缺失或未通过验证${limited?'；已达到 100 MiB 内存保护上限':''}`:'录音保存在本浏览器；请用工作包备份保留全部录音';
  renderSummary();renderList();renderTakes();
}
let audioWrites=Promise.resolve();
function addAudio(...args){const result=audioWrites.then(()=>commitAudio(...args));audioWrites=result.catch(()=>{});return result;}
async function commitAudio(id,bytes,options){
  const uniqueBytes=[...assets.values()].reduce((sum,value)=>sum+value.length,0);
  const result=await attachTake(production,id,bytes,{...options,getState:()=>production});
  if(!assets.has(result.take.asset_id)&&uniqueBytes+bytes.length>100*1024*1024)throw new Error('当前工作区音频已超过 100 MiB，请先导出并拆分项目');
  assets.set(result.take.asset_id,result.bytes);
  unpersistedAssets.add(result.take.asset_id);unsavedAudio=true;updateTakeState(result.state);
  try{await audioStore.put(result.take.asset_id,result.bytes);unpersistedAssets.delete(result.take.asset_id);unsavedAudio=unpersistedAssets.size>0;$('audio-storage-status').textContent='录音已保存到浏览器；建议备份工作包';}
  catch(error){unsavedAudio=true;$('audio-storage-status').textContent=error.message;}
  notify(`${id} 已加入真实录音，等待试听审核${unsavedAudio?'；浏览器音频保存失败，请立即备份工作包':''}`);
}
$('audio-file').addEventListener('change',()=>action(async()=>{
  const file=$('audio-file').files[0];$('audio-file').value='';if(!file)return;
  if(dirty)return notify('请先保存台词修改，再导入对应录音',true);
  if(pendingAudio||queue.running)return notify('另一段录音操作仍在进行，请稍候',true);
  const id=selectedId,requestFingerprint=fingerprint(production,id),revision=selected().revision;
  pendingAudio=true;try{if(file.size>20*1024*1024)throw new Error('单个 WAV 最大 20 MiB');await addAudio(id,new Uint8Array(await file.arrayBuffer()),{source:'import',fingerprint:requestFingerprint,revision});}finally{pendingAudio=false;}
}));
function openCast(character){if(!confirmDiscard())return;renderEditor();const cast=production.cast.find(item=>item.character===character);if(!cast)return;
  $('cast-character').value=character;$('cast-voice').value=cast.voice_id;$('cast-model').value=cast.model;$('cast-speed').value=cast.speed;$('cast-pitch').value=cast.pitch;$('cast-emotion').value=cast.emotion;$('cast-pronunciation').value=cast.pronunciation.join('\n');$('cast-error').textContent='';$('cast-dialog').showModal();}
$('cast-btn').addEventListener('click',()=>openCast(selected().character));
for(const id of ['cast-close','cast-cancel'])$(id).addEventListener('click',()=>$('cast-dialog').close());
$('cast-form').addEventListener('submit',event=>{event.preventDefault();try{
  const next=assignVoice(production,$('cast-character').value,{voice_id:$('cast-voice').value,model:$('cast-model').value,speed:Number($('cast-speed').value),pitch:Number($('cast-pitch').value),emotion:$('cast-emotion').value,pronunciation:$('cast-pronunciation').value.split('\n').map(value=>value.trim()).filter(Boolean)});
  changeProject(next);$('cast-dialog').close();notify('角色配置已保存；只有设置匹配的录音才能通过最终审核');
}catch(error){$('cast-error').textContent=error.message;}});
const operationId=()=>`op_${Date.now()}_${crypto.randomUUID().replaceAll('-','')}`;
function queuedItem(id){const line=project.lines.find(item=>item.line_id===id);return{line_id:id,revision:line.revision,fingerprint:fingerprint(production,id),operation_id:operationId(),session_id:service.session_id ?? null};}
function renderQueue(jobs,meta){
  const finished=new Set(jobs.filter(job=>job.status==='done').map(job=>job.operation_id)).size, waiting=jobs.filter(job=>job.status==='queued').length;
  const failed=jobs.filter(job=>['failed','uncertain'].includes(job.status)).length;
  $('queue-summary').textContent=`${finished} 已完成 · ${waiting} 等待 · ${failed} 失败 / 结果不确定 · ${meta.running?'处理中':meta.paused?'已暂停':'未运行'} · 不会自动重试`;
  $('generate-line-btn').disabled=!service.enabled||meta.running||!production.cast.find(item=>item.character===selected().character)?.voice_id;
  $('queue-start-btn').disabled=!service.enabled||meta.running||!waiting;$('queue-pause-btn').disabled=!meta.running;
  $('queue-list').replaceChildren();
  // Failed / uncertain operations must stay visible even in a long batch. Losing
  // their IDs could turn a read-only recovery into an accidentally billed retry.
  const priority=jobs.filter(job=>job.uncertain||['failed','uncertain','running'].includes(job.status));
  const visible=[...priority,...jobs.filter(job=>!priority.includes(job)).slice(-30)];
  if(visible.length<jobs.length)$('queue-list').append(node('p','muted-note',`显示全部异常任务及最近 30 个其他任务；另有 ${jobs.length-visible.length} 个任务保留在队列中。`));
  for(const job of visible){
    const row=node('div','queue-row'),left=node('div');left.append(node('span','',`${job.line_id} · ${{queued:'等待',running:'请求中',done:'录音待审核',failed:'失败',uncertain:'结果不确定',stale:'内容已变',cancelled:'已取消'}[job.status]}`));
    if(job.error)left.append(node('p','error',job.error));row.append(left);
    if(['failed','uncertain','stale','cancelled'].includes(job.status)){
      const controls=node('div','take-actions');
      if(job.uncertain){
        const recover=node('button','soft-button','恢复上次结果');
        recover.disabled=meta.running||document.body.dataset.localService!=='true';
        recover.addEventListener('click',()=>action(async()=>{
          if(pendingAudio)throw new Error('正在导入录音，请稍后恢复');
          await refreshService();
          if(pendingAudio||queue.running)throw new Error('已有录音操作进行中，请稍后恢复');
          if(!project.lines.some(line=>line.line_id===job.line_id))throw new Error(`请先恢复包含 ${job.line_id} 的原项目，再取回旧请求；请求记录仍已保留`);
          if(job.session_id&&service.session_id!==job.session_id)throw new Error('本地服务已重启，原请求缓存已失效；不能确认旧请求是否计费，请先核查账户');
          queue.add([{...job,recover_only:true}]);
          const pending=queue.jobs.find(item=>item.operation_id===job.operation_id&&item.recover_only&&item.status==='queued');
          if(pending){await queue.start(pending.job_id);if(pending.status==='done'){for(const previous of queue.jobs.filter(item=>item.operation_id===job.operation_id)){previous.status='done';previous.uncertain=false;previous.error='';}queue.emit();}}
        }));controls.append(recover);
      }
      const retry=node('button','soft-button',job.uncertain?'另发新请求':'重新排入');retry.addEventListener('click',()=>action(()=>{
        if(job.uncertain&&!window.confirm('上次请求可能已消耗额度。请先尝试恢复结果；另发新请求可能再次计费。确认排入新的生成请求？'))return;
        if(!project.lines.some(line=>line.line_id===job.line_id))throw new Error('该台词已不在项目中');
        queue.add([queuedItem(job.line_id)]);
      }));controls.append(retry);row.append(controls);
    }$('queue-list').append(row);
  }
  try{localStorage.setItem('minimax_dialogue_queue_v2',JSON.stringify(jobs.map(job=>({...job}))));unpersistedQueue=false;}
  catch{unpersistedQueue=true;$('queue-summary').textContent+=' · 队列保存失败：请保持本页打开并先恢复未确定结果';}
}
const queue=new ProductionQueue({run:async(job,signal)=>{
  if(!job.recover_only&&job.fingerprint!==fingerprint(production,job.line_id)){const error=new Error('台词或配音参数已改变，请按新内容重新排队');error.code='STALE';throw error;}
  if(!job.recover_only&&!service.enabled)throw new Error('本地生成服务未启用，未发送模型请求');
  if(job.recover_only&&job.session_id&&service.session_id!==job.session_id){const error=new Error('服务会话已变化，不能恢复旧缓存；请先核查是否已计费');error.uncertain=true;throw error;}
  if(!job.recover_only){job.session_id=service.session_id ?? null;queue.emit();}
  const payload=job.recover_only?null:buildSpeechRequest(production,job.line_id,job.operation_id);
  let response,result;
  try{
    response=await fetch(job.recover_only?`/api/dialogue/result?operation_id=${encodeURIComponent(job.operation_id)}`:'/api/dialogue/generate',job.recover_only?{cache:'no-store',signal}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});
    result=await response.json();
  }catch{const error=new Error('服务响应未完整接收；先恢复上次结果，不要直接另发请求');error.uncertain=true;throw error;}
  if(!response.ok||result.error){const error=new Error(result.error?.message||`生成失败 (${response.status})`);error.uncertain=Boolean(result.error?.uncertain)||job.recover_only;throw error;}
  try{
    if(result.operation_id!==job.operation_id||result.audio?.format!=='wav'||typeof result.audio.base64!=='string'||result.audio.base64.length>28*1024*1024)throw new Error('服务未返回本次请求的有效 WAV');
    const bytes=Uint8Array.from(atob(result.audio.base64),character=>character.charCodeAt(0));
    if(await audioDigest(bytes)!==result.audio.sha256)throw new Error('返回音频的 SHA-256 校验失败');
    await addAudio(job.line_id,bytes,{source:'minimax',fingerprint:job.fingerprint,revision:job.revision});
  }catch(cause){const error=new Error(`${cause.message}；生成可能已完成，请恢复上次结果`);error.uncertain=true;throw error;}
  await refreshService();
},onChange:renderQueue});
$('generate-line-btn').addEventListener('click',()=>action(async()=>{if(!requireSaved())return;if(queue.running||pendingAudio)throw new Error('已有录音操作进行中，请等待它结束');buildSpeechRequest(production,selectedId,operationId());const item=queuedItem(selectedId);queue.add([item]);const job=queue.jobs.find(job=>job.line_id===item.line_id&&job.fingerprint===item.fingerprint&&job.status==='queued');if(job)await queue.start(job.job_id);}));
$('queue-missing-btn').addEventListener('click',()=>action(()=>{if(!requireSaved())return;queue.add(project.lines.filter(line=>getLineState(production,line.line_id,assets).status!=='approved').map(line=>queuedItem(line.line_id)));notify('未完成台词已排队；只有点击开始且本地服务获授权后才会生成');}));
$('queue-start-btn').addEventListener('click',()=>action(async()=>{if(!requireSaved())return;if(pendingAudio)throw new Error('正在导入录音，请稍后开始队列');await refreshService();if(pendingAudio||queue.running)throw new Error('已有录音操作进行中，请稍后开始');if(!service.enabled)throw new Error(service.reason);await queue.start();}));
$('queue-pause-btn').addEventListener('click',()=>queue.pause());$('queue-cancel-btn').addEventListener('click',()=>queue.cancelPending());
async function refreshService(){
  if(document.body.dataset.localService!=='true')return;
  let connected=false;
  try{const response=await fetch('/api/dialogue/status',{cache:'no-store'});if(!response.ok)throw new Error('状态读取失败');service=await response.json();connected=true;}
  catch{service={enabled:false,reason:'本地服务连接失败'};}
  $('provider-title').textContent=!connected?'本地服务连接失败':service.enabled?'本地生成服务已启用':'本地服务已连接，真实生成仍锁定';
  $('provider-description').textContent=service.enabled?`本次预算：${service.budget?.used_requests??0}/${service.budget?.max_requests??0} 次请求，${service.budget?.used_characters??0}/${service.budget?.max_characters??0} 字符。生成可能消耗账号额度；不会自动重试。`:service.reason||'启动服务时需明确确认权益与本次预算';
  $('provider-badge').textContent=!connected?'服务未连接':service.enabled?'受控生成':'未授权生成';
  $('generate-line-btn').disabled=!service.enabled||!production.cast.find(item=>item.character===selected().character)?.voice_id;
  $('generate-line-btn').textContent=service.enabled?'生成 / 重做此条':'生成此条 · 服务未启用';
  renderQueue(queue.jobs,{running:queue.running,paused:queue.paused});
}
function initializeProduction(){
  if(document.body.dataset.localService==='true'){const link=document.querySelector('.legacy-link');if(link){link.removeAttribute('href');link.textContent='本地配音专用服务';}}
  $('cast-voice').append(node('option','','请选择音色'));$('cast-voice').firstChild.value='';
  for(const[id,label]of VOICES){const option=node('option','',label);option.value=id;$('cast-voice').append(option);}
  const labels=['自动','高兴','悲伤','生气','害怕','厌恶','惊讶','平静','流畅'];
  EMOTIONS.forEach((value,index)=>{const option=node('option','',labels[index]);option.value=value;$('cast-emotion').append(option);});
  try{const old=JSON.parse(localStorage.getItem('minimax_dialogue_queue_v2')||'[]');if(Array.isArray(old)){queue.jobs=old.filter(job=>job&&Number.isSafeInteger(job.job_id)&&job.job_id>0&&typeof job.line_id==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(job.line_id)&&typeof job.fingerprint==='string'&&job.fingerprint.length<=16000&&typeof job.operation_id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(job.operation_id)).map(job=>({line_id:job.line_id,revision:job.revision,fingerprint:job.fingerprint,operation_id:job.operation_id,session_id:typeof job.session_id==='string'?job.session_id:null,job_id:job.job_id,status:job.status==='running'?'uncertain':job.status==='queued'?'cancelled':['done','failed','uncertain','stale','cancelled'].includes(job.status)?job.status:'cancelled',error:job.status==='running'?'页面曾中断：上次请求结果不确定，不会自动重试':String(job.error||'').slice(0,300),recover_only:Boolean(job.recover_only),uncertain:job.status==='running'||Boolean(job.uncertain)}));queue.serial=queue.jobs.reduce((max,job)=>Math.max(max,job.job_id),0);queue.paused=queue.jobs.length>0;}}
  catch{ /* Malformed queue cannot authorize or trigger requests. */ }
  renderQueue(queue.jobs,{running:false,paused:queue.paused});restoreAssets();refreshService();
}

initializeProduction();
render(); if (storageWarning) notify(storageWarning, true);
