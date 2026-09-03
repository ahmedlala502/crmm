import crypto from 'node:crypto';
import { all, get, insert, update, run, json, nowIso, setting } from '../db.mjs';
import { badRequest } from '../http.mjs';
import { compileConditions } from '../query.mjs';
import { registerJob, enqueue } from '../jobs.mjs';
import { renderMerge, mergeContext } from './mailer.mjs';
import { audit } from '../audit.mjs';

export const CONSENT_STATUSES = ['no_consent', 'subscribed', 'unsubscribed', 'bounced'];

/** Marketing consent is enforced here, not in the UI. */
export function resolveRecipients(campaign) {
  const conditions = json(campaign.recipient_filter, { match: 'all', rules: [] });
  const c = compileConditions('person', conditions, 't');
  return all(
    `SELECT t.id, t.name, t.emails FROM persons t
     WHERE t.deleted=0 AND t.marketing_status='subscribed' AND (${c.sql})`,
    ...c.params,
  ).map((p) => ({ id: p.id, name: p.name, email: json(p.emails, [])[0]?.value }))
    .filter((p) => !!p.email);
}

export function previewRecipients(campaign, limit = 25) {
  const list = resolveRecipients(campaign);
  return { total: list.length, sample: list.slice(0, limit) };
}

export function scheduleCampaign(ctx, id, scheduledAt = null) {
  const campaign = get('SELECT * FROM campaigns WHERE id=?', id);
  if (!campaign) throw badRequest('Campaign not found');
  if (campaign.status === 'sent') throw badRequest('Campaign has already been sent');
  if (!campaign.subject) throw badRequest('Campaign needs a subject line');
  if (!campaign.sender_email) throw badRequest('Campaign needs a sender identity');
  const recipients = resolveRecipients(campaign);
  if (!recipients.length) throw badRequest('No subscribed recipients match this filter');

  run('DELETE FROM campaign_recipients WHERE campaign_id=?', id);
  for (const r of recipients) {
    insert('campaign_recipients', { campaign_id: id, person_id: r.id, email: r.email, status: 'pending' });
  }
  update('campaigns', id, { status: scheduledAt ? 'scheduled' : 'sending', scheduled_at: scheduledAt });
  enqueue('campaign.send', { campaignId: id }, scheduledAt);
  audit({ ctx, entity: 'campaign', entityId: id, action: scheduledAt ? 'scheduled' : 'sending', changes: { recipients: recipients.length } });
  return get('SELECT * FROM campaigns WHERE id=?', id);
}

function unsubscribeToken(personId, campaignId) {
  const secret = setting('unsubscribe_secret', 'crm-unsub');
  return crypto.createHmac('sha256', secret).update(`${personId}:${campaignId}`).digest('hex').slice(0, 24);
}

export function initCampaigns() {
  registerJob('campaign.send', async ({ campaignId }) => {
    const campaign = get('SELECT * FROM campaigns WHERE id=?', campaignId);
    if (!campaign || campaign.status === 'sent') return;
    update('campaigns', campaignId, { status: 'sending' });
    const base = setting('public_base_url', '');
    const pending = all("SELECT * FROM campaign_recipients WHERE campaign_id=? AND status='pending'", campaignId);
    for (const rec of pending) {
      const person = get('SELECT * FROM persons WHERE id=?', rec.person_id);
      if (!person || person.marketing_status !== 'subscribed') {
        update('campaign_recipients', rec.id, { status: 'skipped' });
        continue;
      }
      const ctx = mergeContext({ personId: person.id });
      const token = unsubscribeToken(person.id, campaignId);
      const body = renderMerge(campaign.body, ctx) +
        `<hr><p style="font-size:12px;color:#777">You are receiving this because you subscribed. ` +
        `<a href="${base}/public/unsubscribe/${person.id}/${campaignId}/${token}">Unsubscribe</a></p>` +
        `<img src="${base}/t/campaign/${rec.id}.png" width="1" height="1" alt="">`;
      insert('emails', {
        thread_id: ensureCampaignThread(campaign, person),
        direction: 'out',
        from_email: campaign.sender_email, from_name: campaign.sender_name,
        to_emails: JSON.stringify([rec.email]),
        subject: renderMerge(campaign.subject, ctx),
        body, status: 'sent', sent_at: nowIso(), track_opens: 1, track_clicks: 1,
        user_id: campaign.owner_id,
      });
      update('campaign_recipients', rec.id, { status: 'sent', sent_at: nowIso() });
    }
    update('campaigns', campaignId, { status: 'sent', sent_at: nowIso() });
  });
}

function ensureCampaignThread(campaign, person) {
  const existing = get('SELECT id FROM email_threads WHERE person_id=? AND subject=?', person.id, campaign.name);
  if (existing) return existing.id;
  return insert('email_threads', {
    subject: campaign.name, person_id: person.id, org_id: person.org_id,
    user_id: campaign.owner_id, shared: 1, last_message_at: nowIso(),
  });
}

export function campaignStats(id) {
  const s = get(
    `SELECT COUNT(*) recipients,
            SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent,
            SUM(opened) opened, SUM(clicked) clicked, SUM(unsubscribed) unsubscribed
     FROM campaign_recipients WHERE campaign_id=?`, id,
  );
  const openRate = s.sent ? Math.round((s.opened / s.sent) * 100) : 0;
  const clickRate = s.sent ? Math.round((s.clicked / s.sent) * 100) : 0;
  const influenced = get(
    `SELECT COUNT(*) deals, COALESCE(SUM(d.value),0) value FROM deals d
     WHERE d.deleted=0 AND d.person_id IN (SELECT person_id FROM campaign_recipients WHERE campaign_id=? AND status='sent')
       AND d.created_at >= (SELECT COALESCE(sent_at, created_at) FROM campaigns WHERE id=?)`, id, id,
  );
  return { ...s, open_rate: openRate, click_rate: clickRate, influenced_deals: influenced.deals, influenced_value: influenced.value };
}

export function unsubscribe(personId, campaignId, token) {
  if (token !== unsubscribeToken(personId, campaignId)) throw badRequest('Invalid unsubscribe link');
  run("UPDATE persons SET marketing_status='unsubscribed' WHERE id=?", personId);
  run('UPDATE campaign_recipients SET unsubscribed=1 WHERE person_id=? AND campaign_id=?', personId, campaignId);
  audit({ ctx: null, entity: 'person', entityId: personId, action: 'unsubscribed', actor: 'recipient', source: 'public_link' });
  return true;
}
