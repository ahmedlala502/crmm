import { insert, all, json } from './db.mjs';

const IGNORE = new Set(['updated_at', 'cf']);

export function diff(before, after) {
  const changes = {};
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (IGNORE.has(k)) continue;
    const a = before ? before[k] : undefined;
    const b = after ? after[k] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = { from: a ?? null, to: b ?? null };
  }
  // custom fields are diffed field-by-field so history stays readable
  const cfa = json(before?.cf, {}) || {};
  const cfb = json(after?.cf, {}) || {};
  for (const k of new Set([...Object.keys(cfa), ...Object.keys(cfb)])) {
    if (JSON.stringify(cfa[k]) !== JSON.stringify(cfb[k])) {
      changes[`cf.${k}`] = { from: cfa[k] ?? null, to: cfb[k] ?? null };
    }
  }
  return changes;
}

export function audit({ ctx, entity, entityId, action, changes = {}, source = 'app', ip = null, actor = null }) {
  insert('audit_events', {
    user_id: ctx?.user?.id ?? null,
    actor: actor ?? ctx?.user?.name ?? 'system',
    entity,
    entity_id: entityId,
    action,
    changes: JSON.stringify(changes),
    ip,
    source,
  });
}

export function historyFor(entity, entityId, limit = 200) {
  return all(
    'SELECT * FROM audit_events WHERE entity=? AND entity_id=? ORDER BY id DESC LIMIT ?',
    entity, entityId, limit,
  ).map((r) => ({ ...r, changes: json(r.changes, {}) }));
}
