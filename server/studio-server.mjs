// Controlled local multimodal workbench. This entry point never calls a provider.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MAX_BODY = 8 * 1024 * 1024;
const MAX_OPERATIONS = 128;
const MIN_TTL = 30 * 60 * 1000;
const ID = '[0-9a-f]{32}';
const ASSETS = new Set([
  'index.html','css/styles.css','css/themes.css','js/polyfills.js','js/models.js','js/utils.js',
  'js/templates.js','js/api.js','js/backend-api.js','js/workbench-mode.js','js/app.js',
  'dialogue.html','css/dialogue.css','js/dialogue.mjs','js/dialogue-core.mjs',
  'js/production-core.mjs','js/production-storage.mjs','js/production-queue.mjs',
]);
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const inputField = Object.freeze({ chat:'messages', image:'prompt', video:'prompt', speech:'text', music:'prompt', lyrics:'prompt' });
const media = Object.freeze({
  image:['preview.png','image/png'], video:['preview.mp4','video/mp4'],
  speech:['preview.wav','audio/wav'], music:['preview.wav','audio/wav'],
});

function response(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)});
  res.end(body);
}

function fail(res, status, error) { response(res, status, {error}); }

function uniqueHeader(req, header) {
  return req.rawHeaders.filter((value,i) => i % 2 === 0 && value.toLowerCase() === header).length === 1;
}

async function readJSON(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '') || req.headers['content-encoding']) {
    throw Object.assign(new Error('Use uncompressed application/json.'), {status:415});
  }
  if (Number(req.headers['content-length']) > MAX_BODY) throw Object.assign(new Error('Body too large.'), {status:413});
  const parts = [];
  let size = 0, oversized = false;
  for await (const part of req) {
    size += part.length;
    if (size > MAX_BODY) oversized = true;
    if (!oversized) parts.push(part);
  }
  if (oversized) throw Object.assign(new Error('Body too large.'), {status:413});
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts))); }
  catch { throw Object.assign(new Error('Invalid JSON.'), {status:400}); }
}

function summarize(op, now) {
  if (op.status === 'pending' && now >= op.readyAt) op.status = 'completed';
  const state = {id:op.id, modality:op.modality, status:op.status};
  if (op.status !== 'completed') return state;
  const url = `/api/studio/operations/${op.id}/download`;
  const results = {
    image:{images:[url]},video:{videoUrl:url},speech:{audioUrl:url,extraInfo:{audio_format:'wav'}},
    music:{audioUrl:url,extraInfo:{audio_format:'wav'}},chat:{content:'本地文本演示：未调用第三方模型。'},
    lyrics:{lyrics:'本地歌词演示：未调用第三方模型。',title:'本地演示'},
  };
  return {...state, result:results[op.modality]};
}

export function createStudioServer({ now = Date.now, delayMs = 300, rootDir = ROOT } = {}) {
  let canonical = '', started = false;
  const operations = new Map();
  const invalidHost = req => !uniqueHeader(req,'host') || req.headers.host !== canonical || req.socket.remoteAddress !== '127.0.0.1';
  const validOrigin = req => uniqueHeader(req,'origin') && req.headers.origin === `http://${canonical}` && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
  const server = http.createServer({maxHeaderSize:8192,requestTimeout:15000,headersTimeout:10000,keepAliveTimeout:1000},async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',CSP);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    try {
      if (invalidHost(req) || (req.headers.origin !== undefined && !validOrigin(req))) return fail(res,403,'Forbidden origin or host.');
      const path = req.url;
      if (path === '/api/health' && req.method === 'GET') return response(res,200,{service:'minimax-studio-local',status:'ok',mode:'fixture',version:1});
      if (path === '/api/studio/operations' && req.method === 'POST') {
        if (!validOrigin(req)) return fail(res,403,'Generation requires same-origin access.');
        const body = await readJSON(req);
        const {id,modality,params} = body || {};
        const key = typeof modality === 'string' && Object.hasOwn(inputField, modality) ? inputField[modality] : undefined;
        const value = key && params && !Array.isArray(params)
          ? (modality === 'lyrics' && params.mode === 'edit' ? params.lyrics || params[key] : params[key]) : undefined;
        if (typeof id !== 'string' || !new RegExp(`^${ID}$`).test(id) || typeof value !== 'string' || !value.trim() || value.length > 16000) {
          return fail(res,400,'Invalid operation ID, modality, or input.');
        }
        const current = now();
        for (const [expired,op] of operations) if (current >= op.expiresAt) operations.delete(expired);
        const hash = createHash('sha256').update(JSON.stringify([modality,params])).digest('hex');
        if (operations.has(id)) {
          const op = operations.get(id);
          return op.hash === hash ? response(res,200,summarize(op,current)) : fail(res,409,'Operation ID already exists.');
        }
        if (operations.size >= MAX_OPERATIONS) return fail(res,429,'Local operation limit reached; wait for expiration.');
        const op = {id,modality,hash,status:'pending',readyAt:current+delayMs,expiresAt:current+MIN_TTL};
        operations.set(id,op);
        return response(res,202,summarize(op,current));
      }
      const match = new RegExp(`^/api/studio/operations/(${ID})(/download)?$`).exec(path);
      if (match) {
        const [,id,download] = match, op = operations.get(id), current = now();
        if (!op || current >= op.expiresAt) return fail(res,404,'Operation not found or expired; not recreated.');
        if (req.method === 'DELETE' && !download) {
          if (!validOrigin(req)) return fail(res,403,'Cancellation requires same-origin access.');
          if (summarize(op,current).status === 'pending') op.status = 'cancelled';
          return response(res,200,summarize(op,current));
        }
        if (req.method !== 'GET') return fail(res,405,'Method not allowed.');
        const data = summarize(op,current);
        if (!download) return response(res,200,data);
        if (data.status !== 'completed' || !Object.hasOwn(media, op.modality)) return fail(res,409,'Download is not available.');
        const [name,type] = media[op.modality];
        const bytes = await readFile(join(ROOT,'server','fixtures',name));
        res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length});
        return res.end(bytes);
      }
      if (!['GET','HEAD'].includes(req.method)) return fail(res,405,'Method not allowed.');
      const relative = path === '/' ? 'index.html' : path?.slice(1);
      if (!path?.startsWith('/') || !ASSETS.has(relative)) return fail(res,404,'Not found.');
      const base = await realpath(rootDir), filename = join(base,relative);
      let body;
      try {
        if (await realpath(filename) !== filename || !(await lstat(filename)).isFile()) return fail(res,404,'Not found.');
        body = await readFile(filename);
      } catch(error) {
        if (error.code === 'ENOENT') return fail(res,404,'Not found.');
        throw error;
      }
      const type = relative.endsWith('.html') ? 'text/html' : relative.endsWith('.css') ? 'text/css' : 'text/javascript';
      res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Content-Length':body.length});
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      fail(res,error.status || 500,error.status ? error.message : 'Controlled local service failed.');
    }
  });
  server.on('clientError',(_error,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  return {
    async start(port=4174) {
      if (started || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port or service already started.');
      started=true;
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
      canonical=`127.0.0.1:${server.address().port}`;
      return `http://${canonical}`;
    },
    async close(){if(server.listening) await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.argv[2] === undefined ? 4174 : /^\d+$/.test(process.argv[2]) ? Number(process.argv[2]) : NaN;
  createStudioServer().start(port).then(origin => console.log(`Local studio: ${origin} (fixtures only; zero provider calls)`)).catch(() => {
    console.error('Could not start the loopback studio. Pass an available numeric port.'); process.exitCode=1;
  });
}
