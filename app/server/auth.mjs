import crypto from 'node:crypto';
import { get, run, insert, all, nowIso } from './db.mjs';
import { unauthorized, badRequest, parseCookies } from './http.mjs';

export const SESSION_COOKIE = 'crm_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const calc = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return calc.length === known.length && crypto.timingSafeEqual(calc, known);
}

// ---- TOTP (RFC 6238, SHA1/6 digits/30s) ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function generateTotpSecret(len = 20) {
  const bytes = crypto.randomBytes(len);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function b32decode(s) {
  const clean = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = '';
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    bits += i.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totpCode(secret, counter) {
  const key = b32decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  return String(bin % 1000000).padStart(6, '0');
}
export function verifyTotp(secret, code, window = 1) {
  if (!secret || !code) return false;
  const counter = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i++) {
    if (totpCode(secret, counter + i) === String(code).trim()) return true;
  }
  return false;
}

// ---- sessions ----
export function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const days = 14;
  const expires = new Date(Date.now() + days * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  insert('sessions', {
    token,
    user_id: userId,
    ip: clientIp(req),
    user_agent: (req.headers['user-agent'] || '').slice(0, 250),
    expires_at: expires,
  });
  run('UPDATE users SET last_login_at=? WHERE id=?', nowIso(), userId);
  return { token, expires };
}
export function revokeSession(token) {
  run('UPDATE sessions SET revoked_at=? WHERE token=?', nowIso(), token);
}
export function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
}

export function securityEvent(kind, { userId = null, email = null, req = null, detail = null } = {}) {
  insert('security_events', {
    user_id: userId, email, kind,
    ip: req ? clientIp(req) : null,
    user_agent: req ? (req.headers['user-agent'] || '').slice(0, 250) : null,
    detail: detail ? JSON.stringify(detail) : null,
  });
}

export function userFromRequest(req) {
  // 1) API token
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const raw = authHeader.slice(7).trim();
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const tok = get('SELECT * FROM api_tokens WHERE token_hash=? AND revoked_at IS NULL', hash);
    if (!tok) throw unauthorized('Invalid API token');
    run('UPDATE api_tokens SET last_used_at=? WHERE id=?', nowIso(), tok.id);
    const user = get('SELECT * FROM users WHERE id=? AND active=1', tok.user_id);
    if (!user) throw unauthorized('Token owner inactive');
    return { user, via: 'token', scopes: tok.scopes.split(','), sessionToken: null };
  }
  // 2) session cookie
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const s = get(
    "SELECT * FROM sessions WHERE token=? AND revoked_at IS NULL AND expires_at > datetime('now')",
    token,
  );
  if (!s) return null;
  const user = get('SELECT * FROM users WHERE id=? AND active=1', s.user_id);
  if (!user) return null;
  return { user, via: 'session', scopes: ['read', 'write'], sessionToken: token };
}

export function issueApiToken(userId, name, scopes = 'read,write') {
  const raw = 'crm_' + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const id = insert('api_tokens', {
    user_id: userId, name, token_prefix: raw.slice(0, 12), token_hash: hash, scopes,
  });
  return { id, token: raw };
}

export function listSessions(userId) {
  return all(
    "SELECT token, ip, user_agent, created_at, expires_at, revoked_at FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
    userId,
  ).map((s) => ({ ...s, token: s.token.slice(0, 8) + '…', full: s.token }));
}

export function assertPasswordPolicy(pw) {
  if (!pw || pw.length < 8) throw badRequest('Password must be at least 8 characters');
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) throw badRequest('Password must contain letters and numbers');
}
