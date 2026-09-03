import { all, get, insert, update, run, json, nowIso, setting } from '../db.mjs';
import { assertCan } from '../rbac.mjs';
import { badRequest, notFound, toInt, toBool } from '../http.mjs';
import {
  composeEmail, threadMessages, mergeFieldCatalog, availableAdapters, emailStats,
} from '../engines/mailer.mjs';
import {
  enrollInSequence, setEnrollmentStatus, enrollmentsFor, STEP_TYPES,
} from '../engines/sequences.mjs';
import {
  scheduleCampaign, previewRecipients, campaignStats, CONSENT_STATUSES,
} from '../engines/campaigns.mjs';
import {
  createDocument, updateDocument, documentsFor, STORAGE_ADAPTERS, ESIGN_ADAPTERS, renderDocument,
} from '../engines/documents.mjs';
import { aiEmailDraft, aiThreadSummary, aiSuggestedReply } from '../engines/ai.mjs';
import { audit } from '../audit.mjs';

export function registerCommsRoutes(router) {
  // ---------- mail ----------
  router.get('/api/mail/threads', async (req, res, { ctx, query }) => {
    const params = [];
    const where = ['1=1'];
    if (!toBool(query.all, false)) {
      where.push('(t.user_id = ? OR t.shared = 1)');
      params.push(ctx.user.id);
    }
    if (query.deal_id) { where.push('t.deal_id = ?'); params.push(Number(query.deal_id)); }
    if (query.person_id) { where.push('t.person_id = ?'); params.push(Number(query.person_id)); }
    if (query.lead_id) { where.push('t.lead_id = ?'); params.push(Number(query.lead_id)); }
    if (query.search) { where.push('t.subject LIKE ?'); params.push(`%${query.search}%`); }
    where.push(`t.archived = ${toBool(query.archived, false) ? 1 : 0}`);
    const rows = all(
      `SELECT t.*, (SELECT COUNT(*) FROM emails e WHERE e.thread_id=t.id) AS message_count,
              (SELECT body FROM emails e WHERE e.thread_id=t.id ORDER BY e.id DESC LIMIT 1) AS last_body,
              (SELECT direction FROM emails e WHERE e.thread_id=t.id ORDER BY e.id DESC LIMIT 1) AS last_direction
       FROM email_threads t WHERE ${where.join(' AND ')} ORDER BY t.last_message_at DESC LIMIT ?`,
      ...params, toInt(query.limit, 50),
    );
    return rows.map((r) => ({
      ...r,
      preview: String(r.last_body || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 140),
      person: r.person_id ? get('SELECT id,name FROM persons WHERE id=?', r.person_id) : null,
      deal: r.deal_id ? get('SELECT id,title FROM deals WHERE id=?', r.deal_id) : null,
    }));
  });

  router.get('/api/mail/threads/:id', async (req, res, { ctx, params }) => {
    const thread = get('SELECT * FROM email_threads WHERE id=?', params.id);
    if (!thread) throw notFound('Thread not found');
    if (!thread.shared && thread.user_id !== ctx.user.id && !ctx.isAdmin) throw notFound('Thread is private');
    run('UPDATE email_threads SET read=1 WHERE id=?', thread.id);
    return { thread, messages: threadMessages(thread.id) };
  });

  router.patch('/api/mail/threads/:id', async (req, res, { ctx, params, body }) => {
    const thread = get('SELECT * FROM email_threads WHERE id=?', params.id);
    if (!thread) throw notFound('Thread not found');
    update('email_threads', thread.id, {
      deal_id: body.deal_id, lead_id: body.lead_id, person_id: body.person_id, org_id: body.org_id,
      shared: body.shared === undefined ? undefined : (body.shared ? 1 : 0),
      archived: body.archived === undefined ? undefined : (body.archived ? 1 : 0),
    });
    audit({ ctx, entity: 'email_thread', entityId: thread.id, action: 'linked', changes: body });
    return get('SELECT * FROM email_threads WHERE id=?', thread.id);
  });

  router.post('/api/mail/send', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'mail.send');
    const mail = composeEmail(ctx, {
      to: body.to || [], cc: body.cc || [], bcc: body.bcc || [],
      subject: body.subject || '', body: body.body || '',
      dealId: body.deal_id || null, leadId: body.lead_id || null,
      personId: body.person_id || null, orgId: body.org_id || null,
      threadId: body.thread_id || null, templateId: body.template_id || null,
      scheduledAt: body.scheduled_at || null,
      trackOpens: body.track_opens !== false, trackClicks: body.track_clicks !== false,
      status: body.draft ? 'draft' : 'sent',
      shared: body.shared === false ? 0 : 1,
    });
    return mail;
  });

  router.post('/api/mail/log-incoming', async (req, res, { ctx, body }) => {
    // Inbound webhook/provider hook: records a received message against CRM records.
    const mail = composeEmail(ctx, {
      to: body.to || [ctx.user.email], subject: body.subject || '(no subject)', body: body.body || '',
      dealId: body.deal_id || null, personId: body.person_id || null, threadId: body.thread_id || null,
      direction: 'in', status: 'sent', fromEmail: body.from || 'unknown@example.com', fromName: body.from_name,
      trackOpens: false, trackClicks: false,
    });
    return mail;
  });

  router.get('/api/mail/templates', async (req, res, { ctx }) =>
    all('SELECT * FROM email_templates WHERE shared=1 OR owner_id=? ORDER BY name', ctx.user.id));

  router.post('/api/mail/templates', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'mail.templates');
    const id = insert('email_templates', {
      name: body.name, subject: body.subject || '', body: body.body || '',
      shared: body.shared === false ? 0 : 1, owner_id: ctx.user.id,
    });
    return get('SELECT * FROM email_templates WHERE id=?', id);
  });
  router.patch('/api/mail/templates/:id', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'mail.templates');
    update('email_templates', params.id, {
      name: body.name, subject: body.subject, body: body.body,
      shared: body.shared === undefined ? undefined : (body.shared ? 1 : 0),
    });
    return get('SELECT * FROM email_templates WHERE id=?', params.id);
  });
  router.delete('/api/mail/templates/:id', async (req, res, { ctx, params }) => {
    assertCan(ctx, 'mail.templates');
    run('DELETE FROM email_templates WHERE id=?', params.id);
    return { ok: true };
  });

  router.get('/api/mail/merge-fields', async () => mergeFieldCatalog());
  router.get('/api/mail/providers', async () => ({ adapters: availableAdapters(), current: setting('mail', { provider: 'log' }) }));
  router.get('/api/mail/stats', async (req, res, { query }) => emailStats(toInt(query.days, 30)));

  router.post('/api/mail/ai/draft', async (req, res, { ctx, body }) =>
    aiEmailDraft({ intent: body.intent, tone: body.tone, context: body.context }));
  router.get('/api/mail/threads/:id/ai-summary', async (req, res, { params }) => aiThreadSummary(Number(params.id)));
  router.post('/api/mail/threads/:id/ai-reply', async (req, res, { params }) => aiSuggestedReply(Number(params.id)));

  // ---------- sequences ----------
  router.get('/api/sequences', async () =>
    all('SELECT * FROM sequences ORDER BY id DESC').map((s) => ({
      ...s,
      steps: json(s.steps, []),
      active_enrollments: get("SELECT COUNT(*) n FROM sequence_enrollments WHERE sequence_id=? AND status='active'", s.id).n,
    })));

  router.get('/api/sequences/meta', async () => ({ step_types: STEP_TYPES }));

  router.post('/api/sequences', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'sequences.manage');
    const id = insert('sequences', {
      name: body.name, entity: body.entity || 'lead',
      steps: JSON.stringify(body.steps || []), active: body.active === false ? 0 : 1,
      owner_id: ctx.user.id,
    });
    return get('SELECT * FROM sequences WHERE id=?', id);
  });
  router.patch('/api/sequences/:id', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'sequences.manage');
    update('sequences', params.id, {
      name: body.name, entity: body.entity,
      steps: body.steps ? JSON.stringify(body.steps) : undefined,
      active: body.active === undefined ? undefined : (body.active ? 1 : 0),
    });
    return get('SELECT * FROM sequences WHERE id=?', params.id);
  });
  router.delete('/api/sequences/:id', async (req, res, { ctx, params }) => {
    assertCan(ctx, 'sequences.manage');
    run('DELETE FROM sequences WHERE id=?', params.id);
    return { ok: true };
  });

  router.post('/api/sequences/:id/enroll', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'sequences.manage');
    const ids = body.ids || [body.entity_id];
    const out = ids.map((id) => enrollInSequence(Number(params.id), body.entity, Number(id), ctx.user.id));
    return { enrolled: out.length, enrollments: out };
  });

  router.get('/api/sequences/:id/enrollments', async (req, res, { params }) =>
    all(
      `SELECT se.*, s.name AS sequence_name FROM sequence_enrollments se JOIN sequences s ON s.id=se.sequence_id
       WHERE se.sequence_id=? ORDER BY se.id DESC LIMIT 200`, params.id,
    ).map((r) => ({ ...r, log: json(r.log, []) })));

  router.post('/api/enrollments/:id/status', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'sequences.manage');
    return setEnrollmentStatus(Number(params.id), body.status);
  });

  // ---------- campaigns ----------
  router.get('/api/campaigns', async () =>
    all('SELECT * FROM campaigns ORDER BY id DESC').map((c) => ({ ...c, stats: campaignStats(c.id) })));

  router.get('/api/campaigns/:id', async (req, res, { params }) => {
    const c = get('SELECT * FROM campaigns WHERE id=?', params.id);
    if (!c) throw notFound('Campaign not found');
    return {
      ...c,
      recipient_filter: json(c.recipient_filter, { match: 'all', rules: [] }),
      stats: campaignStats(c.id),
      recipients: all('SELECT * FROM campaign_recipients WHERE campaign_id=? LIMIT 200', c.id),
    };
  });

  router.post('/api/campaigns', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'campaigns.manage');
    const id = insert('campaigns', {
      name: body.name, subject: body.subject || '', preview_text: body.preview_text || '',
      body: body.body || '', sender_name: body.sender_name || ctx.user.name,
      sender_email: body.sender_email || ctx.user.email,
      recipient_filter: JSON.stringify(body.recipient_filter || { match: 'all', rules: [] }),
      owner_id: ctx.user.id,
    });
    return get('SELECT * FROM campaigns WHERE id=?', id);
  });

  router.patch('/api/campaigns/:id', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'campaigns.manage');
    const c = get('SELECT * FROM campaigns WHERE id=?', params.id);
    if (!c) throw notFound('Campaign not found');
    if (c.status === 'sent') throw badRequest('A sent campaign cannot be edited');
    update('campaigns', c.id, {
      name: body.name, subject: body.subject, preview_text: body.preview_text, body: body.body,
      sender_name: body.sender_name, sender_email: body.sender_email,
      recipient_filter: body.recipient_filter ? JSON.stringify(body.recipient_filter) : undefined,
    });
    return get('SELECT * FROM campaigns WHERE id=?', c.id);
  });

  router.post('/api/campaigns/:id/preview-recipients', async (req, res, { params }) => {
    const c = get('SELECT * FROM campaigns WHERE id=?', params.id);
    if (!c) throw notFound('Campaign not found');
    return previewRecipients(c);
  });

  router.post('/api/campaigns/:id/send', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'campaigns.send');
    return scheduleCampaign(ctx, Number(params.id), body.scheduled_at || null);
  });

  router.get('/api/campaigns/meta/consent', async () => ({
    statuses: CONSENT_STATUSES,
    counts: all('SELECT marketing_status, COUNT(*) n FROM persons WHERE deleted=0 GROUP BY marketing_status'),
  }));

  // ---------- documents ----------
  router.get('/api/document-templates', async () => all('SELECT * FROM document_templates ORDER BY id'));
  router.post('/api/document-templates', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'documents.create');
    const id = insert('document_templates', { name: body.name, kind: body.kind || 'quote', content: body.content || '' });
    return get('SELECT * FROM document_templates WHERE id=?', id);
  });
  router.patch('/api/document-templates/:id', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'documents.create');
    update('document_templates', params.id, { name: body.name, kind: body.kind, content: body.content });
    return get('SELECT * FROM document_templates WHERE id=?', params.id);
  });

  router.get('/api/documents', async (req, res, { query }) => {
    if (query.entity && query.entity_id) return documentsFor(query.entity, Number(query.entity_id));
    return all('SELECT id,name,entity,entity_id,status,version,views,created_at FROM documents ORDER BY id DESC LIMIT 100');
  });

  router.post('/api/documents', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'documents.create');
    return createDocument(ctx, {
      templateId: body.template_id ? Number(body.template_id) : null,
      entity: body.entity, entityId: Number(body.entity_id), name: body.name,
    });
  });

  router.get('/api/documents/:id', async (req, res, { params }) => {
    const doc = get('SELECT * FROM documents WHERE id=?', params.id);
    if (!doc) throw notFound('Document not found');
    return doc;
  });

  router.patch('/api/documents/:id', async (req, res, { ctx, params, body }) =>
    updateDocument(ctx, Number(params.id), {
      name: body.name, content: body.content, status: body.status,
    }));

  router.post('/api/documents/:id/preview', async (req, res, { ctx, body }) => ({
    html: renderDocument(body.content || '', { entity: body.entity, entityId: Number(body.entity_id), user: ctx.user }),
  }));

  router.get('/api/documents/meta/adapters', async () => ({ storage: STORAGE_ADAPTERS, esign: ESIGN_ADAPTERS }));
}
