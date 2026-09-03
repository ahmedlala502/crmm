import crypto from 'node:crypto';
import { all, insert, json } from '../db.mjs';
import { onEvent } from '../events.mjs';
import { registerJob, enqueue } from '../jobs.mjs';

function matches(pattern, eventName) {
  if (pattern === '*' || pattern === '*.*') return true;
  const [pe, pa] = pattern.split('.');
  const [ee, ea] = eventName.split('.');
  return (pe === '*' || pe === ee) && (pa === '*' || pa === ea);
}

export function initWebhooks() {
  onEvent((name, payload) => {
    const endpoints = all('SELECT * FROM webhook_endpoints WHERE active=1');
    for (const ep of endpoints) {
      if (!matches(ep.event, name)) continue;
      enqueue('webhook.deliver', {
        endpoint_id: ep.id,
        event: name,
        body: {
          event: name,
          entity: payload.entity,
          id: payload.id,
          current: payload.record ?? null,
          previous: payload.before ?? null,
          changes: payload.changes ?? {},
          actor: payload.actor ? { id: payload.actor.id, name: payload.actor.name } : null,
          at: new Date().toISOString(),
        },
      });
    }
  });

  registerJob('webhook.deliver', async ({ endpoint_id, event, body }) => {
    const ep = all('SELECT * FROM webhook_endpoints WHERE id=?', endpoint_id)[0];
    if (!ep || !ep.active) return;
    const payload = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', ...json(ep.headers, {}) };
    if (ep.secret) {
      headers['X-CRM-Signature'] = crypto.createHmac('sha256', ep.secret).update(payload).digest('hex');
    }
    let status = null; let error = null;
    try {
      const res = await fetch(ep.url, {
        method: ep.method || 'POST',
        headers,
        body: ep.method === 'DELETE' ? undefined : payload,
        signal: AbortSignal.timeout(10000),
      });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = String(err.message || err);
    }
    insert('webhook_deliveries', { endpoint_id, event, payload, status_code: status, error });
    if (error) throw new Error(`Webhook delivery failed: ${error}`);
  });

  /** Automation "call webhook" action reuses the same delivery pipeline. */
  registerJob('webhook.custom', async ({ url, method = 'POST', headers = {}, body }) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body ?? {});
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: method === 'GET' || method === 'DELETE' ? undefined : payload,
      signal: AbortSignal.timeout(10000),
    });
    insert('webhook_deliveries', {
      endpoint_id: null, event: 'automation.webhook', payload,
      status_code: res.status, error: res.ok ? null : `HTTP ${res.status}`,
    });
    if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
  });
}
