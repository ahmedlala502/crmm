import { get, run, all, insert, nowIso } from '../db.mjs';
import {
  verifyPassword, hashPassword, createSession, revokeSession, SESSION_COOKIE,
  securityEvent, listSessions, generateTotpSecret, verifyTotp, assertPasswordPolicy,
} from '../auth.mjs';
import { badRequest, unauthorized, sendJson } from '../http.mjs';
import { buildContext, describeContext } from '../rbac.mjs';

export function registerAuthRoutes(router) {
  router.post('/api/auth/login', async (req, res, { body }) => {
    const { email, password, totp } = body;
    const user = get('SELECT * FROM users WHERE lower(email)=lower(?)', String(email || ''));
    if (!user || !user.active || !verifyPassword(String(password || ''), user.password_hash)) {
      securityEvent('login_failed', { email, req });
      throw unauthorized('Email or password is incorrect');
    }
    if (user.totp_enabled) {
      if (!totp) {
        sendJson(res, 200, { mfa_required: true });
        return { __raw: true };
      }
      if (!verifyTotp(user.totp_secret, totp)) {
        securityEvent('mfa_failed', { userId: user.id, email, req });
        throw unauthorized('Two-factor code is not valid');
      }
    }
    const session = createSession(user.id, req);
    securityEvent('login_success', { userId: user.id, email: user.email, req });
    res.setHeader('Set-Cookie',
      `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 86400}`);
    return describeContext(buildContext(user));
  });

  router.post('/api/auth/logout', async (req, res, { auth }) => {
    if (auth?.sessionToken) revokeSession(auth.sessionToken);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    return { ok: true };
  });

  router.get('/api/auth/me', async (req, res, { ctx }) => describeContext(ctx));

  router.post('/api/auth/password', async (req, res, { ctx, body }) => {
    const user = get('SELECT * FROM users WHERE id=?', ctx.user.id);
    if (!verifyPassword(String(body.current || ''), user.password_hash)) throw badRequest('Current password is incorrect');
    assertPasswordPolicy(body.next);
    run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(body.next), user.id);
    run("UPDATE sessions SET revoked_at=? WHERE user_id=? AND token<>?", nowIso(), user.id, ctx.sessionToken || '');
    securityEvent('password_changed', { userId: user.id, req });
    return { ok: true };
  });

  router.post('/api/auth/2fa/setup', async (req, res, { ctx }) => {
    const secret = generateTotpSecret();
    run('UPDATE users SET totp_secret=? WHERE id=?', secret, ctx.user.id);
    const label = encodeURIComponent(`CRM:${ctx.user.email}`);
    return { secret, otpauth_url: `otpauth://totp/${label}?secret=${secret}&issuer=CRM&period=30&digits=6` };
  });

  router.post('/api/auth/2fa/enable', async (req, res, { ctx, body }) => {
    const user = get('SELECT * FROM users WHERE id=?', ctx.user.id);
    if (!user.totp_secret) throw badRequest('Run 2FA setup first');
    if (!verifyTotp(user.totp_secret, body.code)) throw badRequest('That code is not valid');
    run('UPDATE users SET totp_enabled=1 WHERE id=?', user.id);
    securityEvent('2fa_enabled', { userId: user.id, req });
    return { ok: true, totp_enabled: true };
  });

  router.post('/api/auth/2fa/disable', async (req, res, { ctx, body }) => {
    const user = get('SELECT * FROM users WHERE id=?', ctx.user.id);
    if (!verifyPassword(String(body.password || ''), user.password_hash)) throw badRequest('Password is incorrect');
    run('UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?', user.id);
    securityEvent('2fa_disabled', { userId: user.id, req });
    return { ok: true, totp_enabled: false };
  });

  router.get('/api/auth/sessions', async (req, res, { ctx }) => listSessions(ctx.user.id));

  router.delete('/api/auth/sessions/:token', async (req, res, { ctx, params }) => {
    const s = get('SELECT * FROM sessions WHERE token LIKE ? AND user_id=?', params.token + '%', ctx.user.id);
    if (!s) throw badRequest('Session not found');
    revokeSession(s.token);
    securityEvent('session_revoked', { userId: ctx.user.id, req });
    return { ok: true };
  });

  router.get('/api/auth/security-events', async (req, res, { ctx }) =>
    all('SELECT * FROM security_events WHERE user_id=? ORDER BY id DESC LIMIT 100', ctx.user.id));

  router.patch('/api/auth/profile', async (req, res, { ctx, body }) => {
    const patch = {};
    if (body.name) patch.name = body.name;
    if (body.timezone) patch.timezone = body.timezone;
    if (body.signature !== undefined) patch.signature = body.signature;
    if (!Object.keys(patch).length) return describeContext(ctx);
    const keys = Object.keys(patch);
    run(`UPDATE users SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => patch[k]), ctx.user.id);
    return describeContext(buildContext(get('SELECT * FROM users WHERE id=?', ctx.user.id)));
  });
}
