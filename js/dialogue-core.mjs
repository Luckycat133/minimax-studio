/** Offline-only domain layer. No network, credentials, speech synthesis or audio fabrication. */
export const SCHEMA_VERSION = 1;
export const MAX_LINES = 500;
export const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const FIELDS = ['character', 'text', 'emotion', 'direction'];
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export const OFFLINE_PROVIDER = Object.freeze({
  id: 'disabled', enabled: false,
  reason: '真实生成未开放：须先确认 Token Plan 权益、余额与自动补购风险，并取得本次调用授权。',
  async generate() { throw new Error('PROVIDER_DISABLED: No request sent; no audio generated.'); }
});
function fail(message) { throw new Error(message); }
function bounded(value, label, max, allowEmpty = false) {
  if (typeof value !== 'string') fail(`${label} 必须是文本`);
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) fail(`${label} 为空、过长或含不支持的控制字符`);
  return result;
}
export function validateId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || RESERVED.test(id)) fail('line_id 须以英文字母开头，仅含字母、数字、下划线或短横线，最长 64 位，不能使用系统保留名');
  return id;
}
function normalizeRow(row) {
  return { line_id: validateId(row.line_id), character: bounded(row.character, '角色', 40), text: bounded(row.text, '台词', 2000), emotion: bounded(row.emotion ?? '', '情绪', 40, true), direction: bounded(row.direction ?? '', '读音 / 表演备注', 500, true) };
}
function uniqueRows(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_LINES) fail(`每个项目需要 1–${MAX_LINES} 条台词`);
  const seen = new Set();
  return rows.map((raw, i) => {
    try {
      const row = normalizeRow(raw);
      const key = row.line_id.toLowerCase();
      if (seen.has(key)) fail(`重复的 line_id：${row.line_id}（不区分大小写）`);
      seen.add(key); return row;
    } catch (error) { fail(`第 ${i + 1} 条：${error.message}`); }
  });
}
function withinSize(project) {
  if (new TextEncoder().encode(JSON.stringify(project, null, 2) + '\n').length > MAX_INPUT_BYTES) fail('项目已达 2 MiB 上限；请先导出备份，再分成较小的项目');
  return project;
}
const newLine = row => ({ ...row, revision: 1, checks: 0, history: [] });
export function createProject(rows, title = '未命名台词项目') {
  return withinSize({ schema_version: SCHEMA_VERSION, mode: 'offline', title: bounded(title, '项目名', 80), lines: uniqueRows(rows).map(newLine) });
}
export function currentFilename(line) { return `audio/${validateId(line.line_id)}__r${String(line.revision).padStart(4, '0')}.wav`; }
export function editLine(project, id, changes) {
  let found = false;
  const lines = project.lines.map(line => {
    if (line.line_id !== id) return line;
    found = true;
    const updated = normalizeRow({ ...line, ...changes, line_id: id });
    if (FIELDS.every(field => updated[field] === line[field])) return line;
    if (line.history.length >= 99) fail('该台词已达 100 个版本上限，请先导出备份');
    const { history, ...previous } = line;
    return { ...updated, revision: line.revision + 1, checks: 0, history: [...history, previous] };
  });
  if (!found) fail('找不到该台词');
  return withinSize({ ...project, lines });
}
export function checkLine(project, id) {
  let found = false;
  const lines = project.lines.map(line => {
    if (line.line_id !== id) return line;
    found = true; normalizeRow(line);
    if (line.checks >= 10000) fail('该版本已达预检次数上限');
    return { ...line, checks: line.checks + 1 };
  });
  if (!found) fail('找不到该台词');
  return withinSize({ ...project, lines });
}
export function mergeRows(project, rows) {
  if (!Array.isArray(rows)) fail('导入数据必须是台词列表');
  const normalized = uniqueRows(rows.map(row => ({ ...project.lines.find(line => line.line_id === row?.line_id), ...row })));
  const existing = new Map(project.lines.map(line => [line.line_id.toLowerCase(), line.line_id]));
  let next = project;
  for (const row of normalized) {
    const actualId = existing.get(row.line_id.toLowerCase());
    if (actualId && actualId !== row.line_id) fail(`ID 大小写冲突：${row.line_id} 与 ${actualId}`);
    if (actualId) next = editLine(next, actualId, row);
    else next = { ...next, lines: [...next.lines, newLine(row)] };
  }
  if (next.lines.length > MAX_LINES) fail(`合并后超过 ${MAX_LINES} 条台词`);
  return withinSize(next);
}
/** RFC 4180-style quoted CSV with BOM, CRLF and multiline fields. */
export function parseCSV(input) {
  if (typeof input !== 'string' || new TextEncoder().encode(input).length > MAX_INPUT_BYTES) fail('CSV 文件最大 2 MiB');
  input = input.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  const pushField = () => { row.push(field); field = ''; closed = false; };
  const pushRow = () => { pushField(); if (row.some(value => value.trim())) rows.push(row); row = []; };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ',' ) pushField();
    else if (c === '\n' || c === '\r') { if (c === '\r' && input[i + 1] === '\n') i++; pushRow(); }
    else if (c === '"' && !field && !closed) quoted = true;
    else { if (closed || c === '"') fail('CSV 引号格式错误'); field += c; }
  }
  if (quoted) fail('CSV 有未闭合的引号');
  if (field || row.length || closed) pushRow();
  if (rows.length < 2) fail('CSV 需要表头与至少一条台词');
  const headers = rows.shift().map(value => value.trim());
  const allowed = ['line_id', ...FIELDS];
  if (new Set(headers).size !== headers.length || headers.some(value => !allowed.includes(value)) || ['line_id', 'character', 'text'].some(value => !headers.includes(value))) fail('表头需要 line_id,character,text；可选 emotion,direction，不支持重复或未知列');
  const parsed = rows.map((cells, index) => {
    if (cells.length !== headers.length) fail(`CSV 第 ${index + 2} 行列数不一致`);
    return Object.fromEntries(headers.map((header, i) => [header, cells[i]]));
  });
  return uniqueRows(parsed).map(row => Object.fromEntries(headers.map(header => [header, row[header]])));
}
export function parseProject(input) {
  if (typeof input !== 'string' || new TextEncoder().encode(input).length > MAX_INPUT_BYTES) fail('项目文件最大 2 MiB');
  let data; try { data = JSON.parse(input); } catch { fail('项目 JSON 格式错误'); }
  if (!data || data.schema_version !== SCHEMA_VERSION || data.mode !== 'offline') fail('仅支持本工具 schema_version=1 的离线项目');
  const base = createProject(data.lines, data.title);
  base.lines = base.lines.map((clean, index) => {
    const raw = data.lines[index];
    if (!Number.isInteger(raw.revision) || raw.revision < 1 || raw.revision > 100 || !Array.isArray(raw.history) || raw.history.length !== raw.revision - 1) fail(`${clean.line_id} 的版本记录不完整`);
    const validateSnapshot = (snapshot, revision) => {
      const row = normalizeRow(snapshot);
      if (row.line_id !== clean.line_id || snapshot.revision !== revision || !Number.isInteger(snapshot.checks) || snapshot.checks < 0 || snapshot.checks > 10000) fail(`${clean.line_id} 的版本或预检记录无效`);
      return { ...row, revision, checks: snapshot.checks };
    };
    return { ...validateSnapshot(raw, raw.revision), history: raw.history.map((entry, i) => validateSnapshot(entry, i + 1)) };
  });
  return withinSize(base);
}
export function manifest(project) {
  return {
    schema_version: SCHEMA_VERSION, project: project.title, mode: 'offline', provider: OFFLINE_PROVIDER.id,
    audio_generated: false, provider_requests: 0, deliverable_complete: false,
    summary: { total: project.lines.length, checked: project.lines.filter(line => line.checks > 0).length, missing_audio: project.lines.length },
    warnings: ['NO_AUDIO: This package contains no audio, silence or placeholder WAV files.', OFFLINE_PROVIDER.reason],
    lines: project.lines.map(line => ({
      line_id: line.line_id, character: line.character, text: line.text, emotion: line.emotion, direction: line.direction,
      revision: line.revision, expected_filename: currentFilename(line), audio: null,
      status: line.checks ? 'provider_disabled' : 'unchecked', preflight_checks: line.checks,
      missing_reason: 'PROVIDER_DISABLED', voice_id: null,
      previous_revisions: line.history.map(entry => ({ revision: entry.revision, expected_filename: currentFilename(entry), audio: null }))
    }))
  };
}
function csvCell(value) {
  // CSV is a spreadsheet-friendly view; JSON remains the exact lossless source.
  const safe = /^[\s]*[=+\-@]/.test(value) || /^[\t\r\n']/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function toCSV(project) {
  const headers = ['line_id', ...FIELDS];
  return '\uFEFF' + [headers.join(','), ...project.lines.map(line => headers.map(key => csvCell(line[key])).join(','))].join('\r\n') + '\r\n';
}
export function exportFiles(project) {
  // Revalidate before export, and strip any unrecognized imported properties.
  project = parseProject(JSON.stringify(project));
  return {
    'project.json': JSON.stringify(project, null, 2) + '\n',
    'manifest.json': JSON.stringify(manifest(project), null, 2) + '\n',
    'dialogue.csv': toCSV(project),
    'README.txt': `MiniMax Studio · 离线台词交付样例\n项目：${project.title}\n\n此包没有任何音频，包括静音或占位 WAV。所有 ${project.lines.length} 条音频均缺失。\nmanifest.json 中 expected_filename 仅为未来文件约定；audio=null，deliverable_complete=false。\n同一 ID 的文本、角色、情绪或读音备注变化会产生新版本；重试预检不会新增版本。\nproject.json 包含完整历史，是无损源文件。CSV 是便于表格查看的当前版本；危险公式前缀会加单引号，重新导入可能保留该符号。\nCSV 按 ID 合并，不删除未列出的台词。JSON 导入则整体替换项目，请保留旧导出。\n音色尚未绑定，voice_id=null。读音和表演备注不会被宣称为已验证的 API 参数。\n\n${OFFLINE_PROVIDER.reason}\n禁止将此样例视为已通过音质、发音或真实模型成功率验证。\n`
  };
}
/** Deterministic uncompressed ZIP, UTF-8 names, CRC32; no external ZIP library. */
export function zipFiles(files) {
  const encoder = new TextEncoder(), chunks = [], directory = []; let offset = 0;
  const crc32 = data => { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; };
  for (const [name, content] of Object.entries(files)) {
    if (!/^(?:(?:audio|takes)\/)?[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(name)) fail('ZIP 文件名不安全');
    if(typeof content!=='string' && !(content instanceof Uint8Array)) fail('ZIP 内容必须是文本或音频字节');
    const filename = encoder.encode(name), data = content instanceof Uint8Array ? content : encoder.encode(content), crc = crc32(data);
    const header = new Uint8Array(30 + filename.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true); view.setUint16(12, 33, true);
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, filename.length, true); header.set(filename, 30);
    const central = new Uint8Array(46 + filename.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true); cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, filename.length, true); cv.setUint32(42, offset, true); central.set(filename, 46);
    chunks.push(header, data); directory.push(central); offset += header.length + data.length;
  }
  const directoryLength = directory.reduce((sum, part) => sum + part.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, directory.length, true); ev.setUint16(10, directory.length, true); ev.setUint32(12, directoryLength, true); ev.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directoryLength + end.length); let position = 0;
  for (const part of [...chunks, ...directory, end]) { result.set(part, position); position += part.length; }
  return result;
}
const SAMPLE_ROWS = [
  ['林舟','钟停在三点一刻，可窗外的影子还在走。','疑惑','三点一刻读作十五分钟；句尾稍停'],
  ['顾青','先别碰指针。柜台底下有一封没写完的信。','谨慎','顾青：qīng'],
  ['岑伯','那封信我等了二十七年，今天总算等到了。','平静','岑：cén；二十七年自然连读'],
  ['林舟','收信人叫乐川？这个“乐”该怎么念？','好奇','乐川：Yuè Chuān'],
  ['顾青','念月亮的“月”。他的名字就在旧账簿上。','解释','“月”字清楚，勿夸张'],
  ['岑伯','账簿第三行，记着一笔三十六元五角的欠款。','回忆','行：háng；金额完整读出'],
  ['林舟','可日期是十一月三十一日，这一天根本不存在。','惊讶','数字逐段清楚'],
  ['顾青','也许写信的人，不想让我们照着日历找。','思索','后半句放慢'],
  ['岑伯','店里的每一件旧物，都有自己的年月。','温和','自然低声'],
  ['林舟','等等！这把钥匙的齿，和信纸上的缺口一样。','兴奋','“等等”短促'],
  ['顾青','先记下来：铜钥匙一把，编号 A-017。','认真','A-017：A，零，一，七'],
  ['岑伯','东墙那扇小门，已经很久没人开过了。','迟疑','门后留短停顿'],
  ['林舟','门上挂着两重锁，哪一重才是新的？','疑问','两重：liǎng chóng'],
  ['顾青','生锈的是旧锁。新锁藏在门框右上角。','笃定','右上角稍强调'],
  ['岑伯','开门之前，你们愿意答应我一件事吗？','郑重','不作威胁语气'],
  ['林舟','你说。只要不是让我把钟拨回昨天。','轻松','后半句略带笑意'],
  ['顾青','林舟，别开玩笑。先听岑伯说完。','制止','姓名间自然停顿'],
  ['岑伯','若看见一盏亮着的灯，就替我说声：我回来了。','克制','冒号后停半拍'],
  ['林舟','好，我们记住了。钥匙……现在转吗？','紧张','省略号处停半拍'],
  ['顾青','转吧。我在这里，门开的那一刻也在。','坚定','最后四字柔和收尾']
];
export function sampleProject() {
  return createProject(SAMPLE_ROWS.map(([character, text, emotion, direction], index) => ({ line_id: `SC01_L${String(index + 1).padStart(3, '0')}`, character, text, emotion, direction })), '雾灯旧物店 · 第一幕');
}
