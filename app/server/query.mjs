import { all, get, json } from './db.mjs';
import { entity, fieldDef, COMPUTED_COLUMNS } from './registry.mjs';
import { visibilityClause } from './rbac.mjs';
import { badRequest } from './http.mjs';
import { customFieldsFor } from './customfields.mjs';

const d = (dt) => dt.toISOString().slice(0, 10);
function startOfWeek(base) {
  const x = new Date(base);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
}

export function resolveRelative(name, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = (base, n) => { const x = new Date(base); x.setDate(x.getDate() + n); return x; };
  const monthStart = (y, m) => new Date(y, m, 1);
  const monthEnd = (y, m) => new Date(y, m + 1, 0);
  switch (name) {
    case 'today': return { from: d(today), to: d(today) };
    case 'yesterday': return { from: d(add(today, -1)), to: d(add(today, -1)) };
    case 'tomorrow': return { from: d(add(today, 1)), to: d(add(today, 1)) };
    case 'this_week': { const s = startOfWeek(today); return { from: d(s), to: d(add(s, 6)) }; }
    case 'last_week': { const s = add(startOfWeek(today), -7); return { from: d(s), to: d(add(s, 6)) }; }
    case 'next_week': { const s = add(startOfWeek(today), 7); return { from: d(s), to: d(add(s, 6)) }; }
    case 'this_month': return { from: d(monthStart(today.getFullYear(), today.getMonth())), to: d(monthEnd(today.getFullYear(), today.getMonth())) };
    case 'last_month': return { from: d(monthStart(today.getFullYear(), today.getMonth() - 1)), to: d(monthEnd(today.getFullYear(), today.getMonth() - 1)) };
    case 'next_month': return { from: d(monthStart(today.getFullYear(), today.getMonth() + 1)), to: d(monthEnd(today.getFullYear(), today.getMonth() + 1)) };
    case 'this_quarter': { const q = Math.floor(today.getMonth() / 3); return { from: d(monthStart(today.getFullYear(), q * 3)), to: d(monthEnd(today.getFullYear(), q * 3 + 2)) }; }
    case 'this_year': return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` };
    case 'last_7_days': return { from: d(add(today, -6)), to: d(today) };
    case 'last_30_days': return { from: d(add(today, -29)), to: d(today) };
    case 'last_90_days': return { from: d(add(today, -89)), to: d(today) };
    case 'next_7_days': return { from: d(today), to: d(add(today, 6)) };
    case 'next_30_days': return { from: d(today), to: d(add(today, 29)) };
    case 'overdue': return { from: '1900-01-01', to: d(add(today, -1)) };
    default: throw badRequest(`Unknown relative range: ${name}`);
  }
}

function columnExpr(entityKey, fieldKey, alias = 't') {
  const def = fieldDef(entityKey, fieldKey);
  if (def) return { expr: `${alias}.${fieldKey}`, type: def.type };
  const cfs = customFieldsFor(entityKey);
  const cf = cfs.find((c) => c.key === fieldKey);
  if (cf) {
    const path = `json_extract(${alias}.cf, '$."${fieldKey}"')`;
    return { expr: path, type: cf.type, custom: true };
  }
  return null;
}

/** Compile a {match:'all'|'any', rules:[...]} tree into SQL. Supports nested groups. */
export function compileConditions(entityKey, node, alias = 't') {
  if (!node || !Array.isArray(node.rules) || node.rules.length === 0) return { sql: '1=1', params: [] };
  const joiner = node.match === 'any' ? ' OR ' : ' AND ';
  const parts = [];
  const params = [];
  for (const rule of node.rules) {
    if (rule.rules) {
      const sub = compileConditions(entityKey, rule, alias);
      parts.push(`(${sub.sql})`);
      params.push(...sub.params);
      continue;
    }
    const col = columnExpr(entityKey, rule.field, alias);
    if (!col) throw badRequest(`Unknown filter field: ${rule.field}`);
    const { expr, type } = col;
    const v = rule.value;
    switch (rule.op) {
      case 'eq':
        if (type === 'boolean') { parts.push(`${expr} = ?`); params.push(v ? 1 : 0); }
        else { parts.push(`${expr} = ?`); params.push(v); }
        break;
      case 'neq': parts.push(`(${expr} IS NULL OR ${expr} <> ?)`); params.push(v); break;
      case 'contains': parts.push(`${expr} LIKE ?`); params.push(`%${v}%`); break;
      case 'not_contains': parts.push(`(${expr} IS NULL OR ${expr} NOT LIKE ?)`); params.push(`%${v}%`); break;
      case 'starts_with': parts.push(`${expr} LIKE ?`); params.push(`${v}%`); break;
      case 'is_empty': parts.push(`(${expr} IS NULL OR ${expr} = '' OR ${expr} = '[]')`); break;
      case 'is_not_empty': parts.push(`(${expr} IS NOT NULL AND ${expr} <> '' AND ${expr} <> '[]')`); break;
      case 'gt': parts.push(`CAST(${expr} AS REAL) > ?`); params.push(Number(v)); break;
      case 'gte': parts.push(`CAST(${expr} AS REAL) >= ?`); params.push(Number(v)); break;
      case 'lt': parts.push(`CAST(${expr} AS REAL) < ?`); params.push(Number(v)); break;
      case 'lte': parts.push(`CAST(${expr} AS REAL) <= ?`); params.push(Number(v)); break;
      case 'after': parts.push(`${expr} > ?`); params.push(v); break;
      case 'before': parts.push(`${expr} < ?`); params.push(v); break;
      case 'between':
        if (['date', 'datetime', 'time'].includes(type)) { parts.push(`(${expr} >= ? AND ${expr} <= ?)`); params.push(v, rule.value2); }
        else { parts.push(`(CAST(${expr} AS REAL) >= ? AND CAST(${expr} AS REAL) <= ?)`); params.push(Number(v), Number(rule.value2)); }
        break;
      case 'relative': {
        const r = resolveRelative(v);
        parts.push(`(${expr} >= ? AND ${expr} <= ?)`);
        params.push(r.from, type === 'datetime' ? `${r.to} 23:59:59` : r.to);
        break;
      }
      case 'in': {
        const arr = Array.isArray(v) ? v : String(v).split(',');
        if (!arr.length) { parts.push('0=1'); break; }
        parts.push(`${expr} IN (${arr.map(() => '?').join(',')})`);
        params.push(...arr);
        break;
      }
      case 'not_in': {
        const arr = Array.isArray(v) ? v : String(v).split(',');
        if (!arr.length) { parts.push('1=1'); break; }
        parts.push(`(${expr} IS NULL OR ${expr} NOT IN (${arr.map(() => '?').join(',')}))`);
        params.push(...arr);
        break;
      }
      case 'has':
        parts.push(`EXISTS (SELECT 1 FROM json_each(COALESCE(${expr},'[]')) je WHERE je.value = ?)`);
        params.push(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
        break;
      case 'not_has':
        parts.push(`NOT EXISTS (SELECT 1 FROM json_each(COALESCE(${expr},'[]')) je WHERE je.value = ?)`);
        params.push(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
        break;
      default:
        throw badRequest(`Unsupported operator: ${rule.op}`);
    }
  }
  return { sql: parts.join(joiner), params };
}

function searchClause(entityKey, term) {
  if (!term) return { sql: '1=1', params: [] };
  const e = entity(entityKey);
  const cols = e.fields.filter((f) => ['text', 'textarea', 'emails', 'phones'].includes(f.type)).map((f) => `t.${f.key}`);
  if (!cols.length) return { sql: '1=1', params: [] };
  const like = `%${term}%`;
  return {
    sql: '(' + cols.map((c) => `${c} LIKE ?`).join(' OR ') + ')',
    params: cols.map(() => like),
  };
}

/**
 * Core list query. Returns { rows, total, limit, offset }.
 * opts: { conditions, search, sort:{field,dir}, limit, offset, scope:{sql,params}, includeDeleted }
 */
export function queryEntity(entityKey, ctx, opts = {}) {
  const e = entity(entityKey);
  const where = [];
  const params = [];

  if (e.softDelete && !opts.includeDeleted) where.push(`t.${e.softDelete} = 0`);

  if (e.hasVisibility) {
    const v = visibilityClause(ctx, 't');
    where.push(v.sql);
    params.push(...v.params);
  } else if (e.ownerField && !ctx.isAdmin) {
    // records without an explicit visibility column are company-wide by design
    where.push('1=1');
  }

  if (entityKey === 'deal' && !ctx.isAdmin) {
    const ids = ctx.visiblePipelines;
    if (!ids.length) where.push('0=1');
    else where.push(`t.pipeline_id IN (${ids.map(() => '?').join(',')})`), params.push(...ids);
  }

  if (opts.conditions) {
    const c = compileConditions(entityKey, opts.conditions, 't');
    where.push(`(${c.sql})`);
    params.push(...c.params);
  }
  if (opts.search) {
    const s = searchClause(entityKey, opts.search);
    where.push(s.sql);
    params.push(...s.params);
  }
  if (opts.scope) {
    where.push(`(${opts.scope.sql})`);
    params.push(...(opts.scope.params || []));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) AS n FROM ${e.table} t ${whereSql}`, ...params).n;

  let orderSql = 'ORDER BY t.id DESC';
  if (opts.sort && opts.sort.field) {
    const col = columnExpr(entityKey, opts.sort.field, 't');
    if (col) orderSql = `ORDER BY ${col.expr} ${opts.sort.dir === 'asc' ? 'ASC' : 'DESC'}, t.id DESC`;
  }
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 1000);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const rows = all(`SELECT t.* FROM ${e.table} t ${whereSql} ${orderSql} LIMIT ? OFFSET ?`, ...params, limit, offset);
  return { rows, total, limit, offset };
}

/** Returns every id matching a filter (used by bulk operations + exports). */
export function queryIds(entityKey, ctx, opts = {}) {
  const res = queryEntity(entityKey, ctx, { ...opts, limit: 100000, offset: 0 });
  return res.rows.map((r) => r.id);
}

// ---------- hydration ----------
let cache = { at: 0, users: null, labels: null, stages: null, pipelines: null };
function lookups() {
  if (Date.now() - cache.at < 1500 && cache.users) return cache;
  cache = {
    at: Date.now(),
    users: Object.fromEntries(all('SELECT id,name,email FROM users').map((u) => [u.id, u])),
    labels: Object.fromEntries(all('SELECT id,name,color,entity FROM labels').map((l) => [l.id, l])),
    stages: Object.fromEntries(all('SELECT id,name,pipeline_id,probability,order_idx FROM stages').map((s) => [s.id, s])),
    pipelines: Object.fromEntries(all('SELECT id,name FROM pipelines').map((p) => [p.id, p])),
  };
  return cache;
}

export function activitySummary(entityKey, id) {
  const col = { deal: 'deal_id', lead: 'lead_id', person: 'person_id', organization: 'org_id', project: 'project_id' }[entityKey];
  if (!col) return {};
  const next = get(
    `SELECT id, subject, due_date, due_time, type_key FROM activities
     WHERE ${col}=? AND done=0 AND deleted=0 AND due_date IS NOT NULL
     ORDER BY due_date ASC, COALESCE(due_time,'00:00') ASC LIMIT 1`, id,
  );
  const last = get(
    `SELECT id, subject, due_date, type_key FROM activities
     WHERE ${col}=? AND done=1 AND deleted=0 ORDER BY done_time DESC LIMIT 1`, id,
  );
  const openCount = get(`SELECT COUNT(*) n FROM activities WHERE ${col}=? AND done=0 AND deleted=0`, id).n;
  return { next_activity: next, last_activity: last, open_activities: openCount };
}

export function activityState(next) {
  if (!next) return 'none';
  const today = new Date().toISOString().slice(0, 10);
  if (next.due_date < today) return 'overdue';
  if (next.due_date === today) return 'today';
  return 'future';
}

export function hydrate(entityKey, rows, { withActivity = true } = {}) {
  const L = lookups();
  return rows.map((r) => {
    const out = { ...r };
    out.cf = json(r.cf, {});
    if (r.label_ids !== undefined) {
      out.label_ids = json(r.label_ids, []);
      out.labels = out.label_ids.map((id) => L.labels[id]).filter(Boolean);
    }
    if (r.emails !== undefined) out.emails = json(r.emails, []);
    if (r.phones !== undefined) out.phones = json(r.phones, []);
    if (r.guests !== undefined) out.guests = json(r.guests, []);
    if (r.depends_on !== undefined) out.depends_on = json(r.depends_on, []);
    if (r.owner_id) out.owner = L.users[r.owner_id] || null;
    if (r.assignee_id) out.assignee = L.users[r.assignee_id] || null;
    if (r.stage_id) out.stage = L.stages[r.stage_id] || null;
    if (r.pipeline_id) out.pipeline = L.pipelines[r.pipeline_id] || null;
    if (r.org_id) out.organization = get('SELECT id,name FROM organizations WHERE id=?', r.org_id);
    if (r.person_id) out.person = get('SELECT id,name,emails,phones FROM persons WHERE id=?', r.person_id);
    if (entityKey === 'deal' && r.probability !== null && r.probability !== undefined) {
      out.weighted_value = Math.round((r.value || 0) * (r.probability / 100));
    } else if (entityKey === 'deal' && out.stage) {
      out.weighted_value = Math.round((r.value || 0) * ((out.stage.probability ?? 100) / 100));
    }
    if (entityKey === 'organization') {
      out.people_count = get('SELECT COUNT(*) n FROM persons WHERE org_id=? AND deleted=0', r.id).n;
      out.open_deals = get("SELECT COUNT(*) n FROM deals WHERE org_id=? AND status='open' AND deleted=0", r.id).n;
    }
    if (entityKey === 'person') {
      out.open_deals = get("SELECT COUNT(*) n FROM deals WHERE person_id=? AND status='open' AND deleted=0", r.id).n;
    }
    if (entityKey === 'product') {
      out.prices = all('SELECT currency, price, cost FROM product_prices WHERE product_id=?', r.id);
      out.price = out.prices[0]?.price ?? 0;
    }
    if (entityKey === 'project') {
      const t = get('SELECT COUNT(*) n, SUM(done) d FROM tasks WHERE project_id=?', r.id);
      out.task_count = t.n;
      out.tasks_done = t.d || 0;
      out.progress = t.n ? Math.round(((t.d || 0) / t.n) * 100) : 0;
    }
    if (withActivity && ['deal', 'lead', 'person', 'organization'].includes(entityKey)) {
      Object.assign(out, activitySummary(entityKey, r.id));
      out.activity_state = activityState(out.next_activity);
    }
    return out;
  });
}

export function columnsFor(entityKey) {
  const e = entity(entityKey);
  const cols = e.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, computed: false }));
  for (const [key, def] of Object.entries(COMPUTED_COLUMNS)) {
    if (def.entities.includes(entityKey)) cols.push({ key, label: def.label, type: 'computed', computed: true });
  }
  for (const cf of customFieldsFor(entityKey)) {
    cols.push({ key: cf.key, label: cf.name, type: cf.type, custom: true });
  }
  return cols;
}
