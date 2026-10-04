/** Loopback-only local speech service. No .env loading, key discovery or external static assets. */
import http from 'node:http';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDialogueProvider, DialogueError, LIMITS } from './dialogue-provider.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MAX_BODY = 24 * 1024;
const MAX_STATIC = 2 * 1024 * 1024;
export const LOCAL_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const STATIC = /^(?:dialogue\.html|css\/(?:styles|dialogue)\.css|js\/(?:dialogue|production)[a-zA-Z0-9_-]*\.mjs)$/;

function json(res, status, body) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(encoded) }); res.end(encoded);
}
function fail(res, status, code, message) { json(res, status, { error: { code, message, uncertain: false } }); }
function uniqueHeader(req, name) { return req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === name).length === 1; }
async function bodyJSON(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '') || req.headers['content-encoding']) throw new DialogueError('unsupported_media_type', 'Use uncompressed application/json with UTF-8 encoding.', 415);
  if (Number(req.headers['content-length']) > MAX_BODY) throw new DialogueError('payload_too_large', 'Request exceeds the 24 KiB limit.', 413);
  const parts = []; let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > MAX_BODY) throw new DialogueError('payload_too_large', 'Request exceeds the 24 KiB limit.', 413);
    parts.push(part);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, size))); }
  catch { throw new DialogueError('invalid_json', 'Request must contain valid UTF-8 JSON.', 400); }
}

export function createDialogueServer({ rootDir = ROOT, provider = createDialogueProvider() } = {}) {
  let canonical = '', started = false;
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000, keepAliveTimeout: 1000 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'); res.setHeader('Content-Security-Policy', LOCAL_CSP);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      if (!uniqueHeader(req, 'host') || req.headers.host !== canonical || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return fail(res, 403, 'invalid_host', 'Use the exact loopback URL printed by the local service.');
      if (req.headers.origin !== undefined && (!uniqueHeader(req, 'origin') || req.headers.origin !== `http://${canonical}`)) return fail(res, 403, 'invalid_origin', 'Cross-origin access is not allowed.');
      // Only the read-only result route accepts a query string. Never normalize static paths.
      if (!req.url?.startsWith('/') || /[\\\u0000-\u001f]/.test(req.url) || req.url.includes('#')) return fail(res, 404, 'not_found', 'Resource not found.');
      const question = req.url.indexOf('?'), path = question < 0 ? req.url : req.url.slice(0, question);
      if (path.includes('%') || path.includes('..')) return fail(res, 404, 'not_found', 'Resource not found.');
      if (path === '/api/dialogue/result' && req.method === 'GET') {
        const parameters = new URLSearchParams(question < 0 ? '' : req.url.slice(question + 1));
        if ([...parameters].length !== 1 || !parameters.has('operation_id')) return fail(res, 400, 'invalid_operation_id', 'Supply exactly one operation_id query parameter.');
        const result = await provider.lookup(parameters.get('operation_id'));
        return json(res, result.status, result.body);
      }
      if (question >= 0) return fail(res, 404, 'not_found', 'Resource not found.');
      if (path === '/api/dialogue/status' && req.method === 'GET') return json(res, 200, provider.status());
      if (path === '/api/dialogue/generate' && req.method === 'POST') {
        if (!uniqueHeader(req, 'origin') || req.headers.origin !== `http://${canonical}` || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) return fail(res, 403, 'invalid_origin', 'Generation requires the exact local Origin.');
        const body = await bodyJSON(req), result = await provider.generate(body);
        return json(res, result.status, result.body);
      }
      if (path.startsWith('/api/')) return fail(res, 405, 'method_not_allowed', 'This API route or method is not supported.');
      if (!['GET', 'HEAD'].includes(req.method)) return fail(res, 405, 'method_not_allowed', 'Only GET and HEAD are allowed for frontend files.');
      const relative = path === '/' ? 'dialogue.html' : path.slice(1);
      if (!STATIC.test(relative)) return fail(res, 404, 'not_found', 'Resource not found.');
      let filename, stats;
      try {
        const base = await realpath(rootDir), candidate = join(base, relative);
        filename = await realpath(candidate); stats = await lstat(candidate);
        if (filename !== candidate || !stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_STATIC) return fail(res, 404, 'not_found', 'Resource not found.');
      } catch { return fail(res, 404, 'not_found', 'Resource not found.'); }
      let content = await readFile(filename);
      if (relative === 'dialogue.html') {
        let html = content.toString('utf8');
        // A static/offline page keeps its restrictive CSP. Only this guarded response relaxes it.
        html = html.replace(/<meta\b(?=[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'])[^>]*>/gi, '');
        html = html.replace(/<body\b([^>]*)>/i, (_, attrs) => `<body${attrs.replace(/\sdata-local-service\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')} data-local-service="true">`);
        content = Buffer.from(html);
      }
      const type = relative.endsWith('.html') ? 'text/html' : relative.endsWith('.css') ? 'text/css' : 'text/javascript';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Content-Length': content.length }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (error instanceof DialogueError) fail(res, error.status, error.code, error.message);
      else fail(res, 500, 'internal_error', 'The local service could not complete this request.');
    }
  });
  server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
  return Object.freeze({
    async start({ port = 4173 } = {}) {
      if (started || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port or service already started.');
      started = true;
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
      canonical = `127.0.0.1:${server.address().port}`;
      return { url: `http://${canonical}/dialogue.html`, origin: `http://${canonical}`, port: server.address().port };
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
    },
    status: () => provider.status()
  });
}

export function parseCLI(args) {
  const result = { port: 4173, enabled: false, entitlementConfirmed: false, maxRequests: 0, maxCharacters: 0 };
  const flags = { '--enable-generation': 'enabled', '--entitlement-confirmed': 'entitlementConfirmed', '--help': 'help' };
  const numbers = { '--port': 'port', '--max-requests': 'maxRequests', '--max-characters': 'maxCharacters' };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const pieces = args[index].split('=');
    if (pieces.length > 2) throw new Error('Malformed CLI option.');
    const [name, inline] = pieces;
    if (seen.has(name)) throw new Error('Duplicate CLI option.'); seen.add(name);
    if (flags[name] && inline === undefined) result[flags[name]] = true;
    else if (numbers[name]) {
      const value = inline ?? args[++index];
      if (!/^\d+$/.test(value || '')) throw new Error('Numeric CLI option requires a nonnegative integer.');
      result[numbers[name]] = Number(value);
    } else throw new Error('Unknown CLI option. Use --help.');
  }
  if (!Number.isSafeInteger(result.port) || result.port < 0 || result.port > 65535) throw new Error('Port must be 0–65535.');
  if (result.enabled && (!result.entitlementConfirmed || result.maxRequests < 1 || result.maxRequests > LIMITS.requests || result.maxCharacters < 1 || result.maxCharacters > LIMITS.characters)) throw new Error('Enabling requires --entitlement-confirmed and bounded --max-requests (1–100) and --max-characters (1–100000).');
  return result;
}

async function main() {
  const options = parseCLI(process.argv.slice(2));
  if (options.help) {
    console.log('Safe default: node server/dialogue-server.mjs [--port 4173]\nExplicit opt-in: --enable-generation --entitlement-confirmed --max-requests N --max-characters N\nOnly enabled, confirmed, budgeted startup reads MINIMAX_API_KEY. No .env files are loaded.\nBind address is always 127.0.0.1. No provider request occurs until a valid same-origin generation request.'); return;
  }
  const service = createDialogueServer({ provider: createDialogueProvider(options) }), address = await service.start({ port: options.port });
  console.log(`Dialogue service: ${address.url}\nGeneration: ${service.status().reason}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void service.close().then(() => { process.exitCode = 0; }); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Local service could not start. Check the port and explicit enablement flags; use --help.'); process.exitCode = 1; });
