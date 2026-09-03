import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
export const badRequest = (m, d) => new HttpError(400, m, d);
export const unauthorized = (m = 'Not authenticated') => new HttpError(401, m);
export const forbidden = (m = 'Not permitted') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);

export function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body ?? null));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}
export function sendText(res, status, text, type = 'text/plain; charset=utf-8', extra = {}) {
  const buf = Buffer.from(text);
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length, ...extra });
  res.end(buf);
}

export async function readBody(req, limit = 40 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw badRequest('Payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw badRequest('Invalid JSON body');
  }
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
};

export function serveStatic(res, rootDir, urlPath) {
  const rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  const full = path.resolve(rootDir, rel === '' ? 'index.html' : rel);
  if (!full.startsWith(path.resolve(rootDir))) {
    sendText(res, 403, 'Forbidden');
    return true;
  }
  let stat;
  try { stat = fs.statSync(full); } catch { return false; }
  if (stat.isDirectory()) return false;
  const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
  return true;
}

/** Tiny router with :param segments. */
export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const parts = pattern.split('/').filter(Boolean);
    this.routes.push({ method, parts, handler, pattern });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  /** Matches the most specific route: literal segments beat `:param` segments. */
  match(method, pathname) {
    const segs = pathname.split('/').filter(Boolean);
    let best = null;
    let bestScore = -1;
    for (const r of this.routes) {
      if (r.method !== method) continue;
      if (r.parts.length !== segs.length) continue;
      const params = {};
      let ok = true;
      let score = 0;
      for (let i = 0; i < r.parts.length; i++) {
        const p = r.parts[i];
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) { ok = false; break; }
        else score++;
      }
      if (ok && score > bestScore) {
        best = { handler: r.handler, params };
        bestScore = score;
      }
    }
    return best;
  }
}

export function toBool(v, dflt = false) {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}
export function toInt(v, dflt = null) {
  if (v === undefined || v === null || v === '') return dflt;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? dflt : n;
}
export function toNum(v, dflt = null) {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  return Number.isNaN(n) ? dflt : n;
}
