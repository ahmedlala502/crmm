import fs from 'node:fs';
import path from 'node:path';
import { all, get, insert, run, update, nowIso, setting, json, DATA_DIR } from '../db.mjs';
import { registerJob, enqueue } from '../jobs.mjs';
import { badRequest } from '../http.mjs';
import { emit } from '../events.mjs';

const OUTBOX = path.join(DATA_DIR, 'outbox');
fs.mkdirSync(OUTBOX, { recursive: true });

/** ---- provider adapters. Core code never talks to a provider directly. ---- */
const adapters = {
  log: {
    name: 'Log / local outbox',
    async send(msg) {
      const file = path.join(OUTBOX, `${Date.now()}-${msg.id}.eml`);
      fs.writeFileSync(file,
        `From: ${msg.from_name || ''} <${msg.from_email}>\n` +
        `To: ${msg.to.join(', ')}\n` +
        (msg.cc?.length ? `Cc: ${msg.cc.join(', ')}\n` : '') +
        `Subject: ${msg.subject}\nDate: ${new Date().toUTCString()}\n` +
        `Content-Type: text/html; charset=utf-8\n\n${msg.body}\n`);
      return { messageId: path.basename(file) };
    },
  },
  smtp: {
    name: 'SMTP / IMAP',
    async send() { throw new Error('SMTP adapter is not configured. Add host/user/password in Admin → Email.'); },
  },
  gmail: {
    name: 'Gmail',
    async send() { throw new Error('Gmail is not connected. Authorise the account in Admin → Email.'); },
  },
  outlook: {
    name: 'Outlook / Microsoft 365',
    async send() { throw new Error('Outlook is not connected. Authorise the account in Admin → Email.'); },
  },
};
export function availableAdapters() {
  return Object.entries(adapters).map(([key, a]) => ({ key, name: a.name }));
}
function currentAdapter() {
  const cfg = setting('mail', { provider: 'log' });
  return adapters[cfg.provider] || adapters.log;
}

/** ---- merge fields ---- */
export function mergeContext({ dealId, leadId, personId, orgId, user, projectId } = {}) {
  const ctx = {};
  if (dealId) {
    const deal = get('SELECT * FROM deals WHERE id=?', dealId);
    if (deal) {
      ctx.deal = deal;
      personId = personId || deal.person_id;
      orgId = orgId || deal.org_id;
    }
  }
  if (leadId) {
    const lead = get('SELECT * FROM leads WHERE id=?', leadId);
    if (lead) { ctx.lead = lead; personId = personId || lead.person_id; orgId = orgId || lead.org_id; }
  }
  if (personId) {
    const p = get('SELECT * FROM persons WHERE id=?', personId);
    if (p) {
      ctx.person = { ...p, emails: json(p.emails, []), phones: json(p.phones, []) };
      ctx.person.email = ctx.person.emails[0]?.value || '';
      ctx.person.first_name = String(p.name).split(' ')[0];
      orgId = orgId || p.org_id;
    }
  }
  if (orgId) ctx.organization = get('SELECT * FROM organizations WHERE id=?', orgId);
  if (projectId) ctx.project = get('SELECT * FROM projects WHERE id=?', projectId);
  if (user) ctx.user = { name: user.name, email: user.email, signature: user.signature || '' };
  ctx.company = { name: setting('company_name', 'Our Company') };
  return ctx;
}

export function renderMerge(template, ctx) {
  if (!template) return '';
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, ref) => {
    const parts = ref.split('.');
    let cur = ctx;
    for (const p of parts) {
      if (cur === null || cur === undefined) return '';
      cur = cur[p];
    }
    if (cur === null || cur === undefined) return '';
    return String(cur);
  });
}

export function mergeFieldCatalog() {
  return [
    { group: 'Person', fields: ['person.name', 'person.first_name', 'person.email', 'person.job_title'] },
    { group: 'Organization', fields: ['organization.name', 'organization.domain', 'organization.address'] },
    { group: 'Deal', fields: ['deal.title', 'deal.value', 'deal.currency', 'deal.expected_close_date'] },
    { group: 'Lead', fields: ['lead.title', 'lead.value', 'lead.source'] },
    { group: 'Sender', fields: ['user.name', 'user.email', 'user.signature'] },
    { group: 'Company', fields: ['company.name'] },
  ];
}

/** ---- sending ---- */
export function ensureThread({ subject, dealId = null, leadId = null, personId = null, orgId = null, userId = null, threadId = null, shared = 1 }) {
  if (threadId) {
    const t = get('SELECT * FROM email_threads WHERE id=?', threadId);
    if (t) return t;
  }
  const id = insert('email_threads', {
    subject, deal_id: dealId, lead_id: leadId, person_id: personId, org_id: orgId,
    user_id: userId, shared, last_message_at: nowIso(),
  });
  return get('SELECT * FROM email_threads WHERE id=?', id);
}

export function composeEmail(ctx, opts) {
  const {
    to = [], cc = [], bcc = [], subject = '', body = '',
    dealId = null, leadId = null, personId = null, orgId = null, threadId = null,
    templateId = null, scheduledAt = null, trackOpens = true, trackClicks = true,
    status = 'sent', shared = 1, direction = 'out', fromEmail = null, fromName = null,
  } = opts;
  if (!to.length && status !== 'draft') throw badRequest('At least one recipient is required');

  const merged = mergeContext({ dealId, leadId, personId, orgId, user: ctx.user });
  const finalSubject = renderMerge(subject, merged);
  const finalBody = renderMerge(body, merged);
  const thread = ensureThread({
    subject: finalSubject || '(no subject)',
    dealId, leadId, personId, orgId, userId: ctx.user.id, threadId, shared,
  });

  const id = insert('emails', {
    thread_id: thread.id,
    direction,
    from_email: fromEmail || ctx.user.email,
    from_name: fromName || ctx.user.name,
    to_emails: JSON.stringify(to),
    cc_emails: JSON.stringify(cc),
    bcc_emails: JSON.stringify(bcc),
    subject: finalSubject,
    body: finalBody,
    status: status === 'sent' ? (scheduledAt ? 'scheduled' : 'sent') : status,
    scheduled_at: scheduledAt,
    track_opens: trackOpens ? 1 : 0,
    track_clicks: trackClicks ? 1 : 0,
    user_id: ctx.user.id,
    template_id: templateId,
  });
  run('UPDATE email_threads SET last_message_at=? WHERE id=?', nowIso(), thread.id);

  if (status === 'sent') {
    enqueue('mail.send', { emailId: id }, scheduledAt || null);
  }
  return get('SELECT * FROM emails WHERE id=?', id);
}

export function initMailer() {
  registerJob('mail.send', async ({ emailId }) => {
    const email = get('SELECT * FROM emails WHERE id=?', emailId);
    if (!email || email.status === 'failed') return;
    const msg = {
      id: email.id,
      from_email: email.from_email,
      from_name: email.from_name,
      to: json(email.to_emails, []),
      cc: json(email.cc_emails, []),
      subject: email.subject,
      body: withTracking(email),
    };
    try {
      await currentAdapter().send(msg);
      update('emails', email.id, { status: 'sent', sent_at: nowIso(), error: null });
      emit('email.sent', { entity: 'email', id: email.id, record: get('SELECT * FROM emails WHERE id=?', email.id), depth: 0 });
    } catch (err) {
      update('emails', email.id, { status: 'failed', error: String(err.message || err) });
      throw err;
    }
  });
}

function withTracking(email) {
  let body = email.body || '';
  const base = setting('public_base_url', '');
  if (email.track_clicks) {
    body = body.replace(/href="(https?:\/\/[^"]+)"/g, (m, url) =>
      `href="${base}/t/c/${email.id}?u=${encodeURIComponent(url)}"`);
  }
  if (email.track_opens) {
    body += `<img src="${base}/t/o/${email.id}.png" width="1" height="1" alt="" style="display:none">`;
  }
  return body;
}

export function threadMessages(threadId) {
  return all('SELECT * FROM emails WHERE thread_id=? ORDER BY id ASC', threadId).map((e) => ({
    ...e,
    to_emails: json(e.to_emails, []),
    cc_emails: json(e.cc_emails, []),
    bcc_emails: json(e.bcc_emails, []),
  }));
}

export function emailStats(range = 30) {
  return get(
    `SELECT COUNT(*) sent,
            SUM(CASE WHEN opens > 0 THEN 1 ELSE 0 END) opened,
            SUM(CASE WHEN clicks > 0 THEN 1 ELSE 0 END) clicked
     FROM emails WHERE direction='out' AND status='sent' AND created_at >= datetime('now', ?)`,
    `-${range} days`,
  );
}
