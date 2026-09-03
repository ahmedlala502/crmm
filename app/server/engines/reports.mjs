import { all, get, json } from '../db.mjs';
import { entity, fieldDef } from '../registry.mjs';
import { visibilityClause } from '../rbac.mjs';
import { compileConditions, resolveRelative } from '../query.mjs';
import { customFieldsFor } from '../customfields.mjs';
import { badRequest } from '../http.mjs';

export const REPORT_TYPES = [
  { entity: 'deal', label: 'Deals', measures: ['count', 'sum:value', 'avg:value', 'sum:weighted_value', 'avg:days_in_stage'] },
  { entity: 'lead', label: 'Leads', measures: ['count', 'sum:value', 'avg:value'] },
  { entity: 'activity', label: 'Activities', measures: ['count'] },
  { entity: 'person', label: 'People', measures: ['count'] },
  { entity: 'organization', label: 'Organizations', measures: ['count'] },
  { entity: 'product', label: 'Products & revenue', measures: ['count'] },
  { entity: 'project', label: 'Projects', measures: ['count'] },
];

export const CHART_TYPES = ['bar', 'column', 'line', 'area', 'pie', 'number', 'table'];
export const DATE_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'];

function colExpr(entityKey, field, alias = 't') {
  if (!field) return null;
  const def = fieldDef(entityKey, field);
  if (def) return { expr: `${alias}.${field}`, type: def.type, def };
  const cf = customFieldsFor(entityKey).find((c) => c.key === field);
  if (cf) return { expr: `json_extract(${alias}.cf,'$."${field}"')`, type: cf.type, cf };
  throw badRequest(`Unknown report field: ${field}`);
}

function bucketExpr(expr, bucket) {
  switch (bucket) {
    case 'day': return `date(${expr})`;
    case 'week': return `strftime('%Y-W%W', ${expr})`;
    case 'month': return `strftime('%Y-%m', ${expr})`;
    case 'quarter': return `strftime('%Y', ${expr}) || '-Q' || ((CAST(strftime('%m', ${expr}) AS INTEGER)+2)/3)`;
    case 'year': return `strftime('%Y', ${expr})`;
    default: return expr;
  }
}

function measureExpr(entityKey, measure) {
  if (!measure || measure === 'count') return { sql: 'COUNT(*)', label: 'Count' };
  const [fn, field] = measure.split(':');
  if (field === 'weighted_value') {
    return { sql: 'SUM(t.value * COALESCE(t.probability, 100) / 100.0)', label: 'Weighted value' };
  }
  if (field === 'days_in_stage') {
    return { sql: "AVG(julianday('now') - julianday(t.stage_changed_at))", label: 'Avg days in stage' };
  }
  const c = colExpr(entityKey, field);
  const map = { sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX' };
  if (!map[fn]) throw badRequest(`Unknown measure ${measure}`);
  return { sql: `${map[fn]}(CAST(${c.expr} AS REAL))`, label: `${fn.toUpperCase()} of ${field}` };
}

const LABEL_RESOLVERS = {
  owner_id: (v) => get('SELECT name FROM users WHERE id=?', v)?.name ?? 'Unassigned',
  assignee_id: (v) => get('SELECT name FROM users WHERE id=?', v)?.name ?? 'Unassigned',
  stage_id: (v) => get('SELECT name FROM stages WHERE id=?', v)?.name ?? '—',
  pipeline_id: (v) => get('SELECT name FROM pipelines WHERE id=?', v)?.name ?? '—',
  org_id: (v) => get('SELECT name FROM organizations WHERE id=?', v)?.name ?? '—',
  person_id: (v) => get('SELECT name FROM persons WHERE id=?', v)?.name ?? '—',
  lost_reason_id: (v) => get('SELECT name FROM lost_reasons WHERE id=?', v)?.name ?? '—',
  board_id: (v) => get('SELECT name FROM project_boards WHERE id=?', v)?.name ?? '—',
  phase_id: (v) => get('SELECT name FROM project_phases WHERE id=?', v)?.name ?? '—',
};
function labelFor(field, value) {
  if (value === null || value === undefined || value === '') return '(empty)';
  const r = LABEL_RESOLVERS[field];
  return r ? r(value) : String(value);
}

/**
 * Executes a saved or ad-hoc report definition against live records.
 * config: { entity, conditions, measure, group_by, bucket, segment_by, chart, limit, sort }
 */
export function runReport(ctx, config) {
  const entityKey = config.entity;
  const e = entity(entityKey);
  const where = [];
  const params = [];

  if (e.softDelete) where.push(`t.${e.softDelete} = 0`);
  if (e.hasVisibility) {
    const v = visibilityClause(ctx, 't');
    where.push(v.sql);
    params.push(...v.params);
  }
  if (entityKey === 'deal' && !ctx.isAdmin && ctx.visiblePipelines.length) {
    where.push(`t.pipeline_id IN (${ctx.visiblePipelines.map(() => '?').join(',')})`);
    params.push(...ctx.visiblePipelines);
  }
  if (config.conditions) {
    const c = compileConditions(entityKey, config.conditions, 't');
    where.push(`(${c.sql})`);
    params.push(...c.params);
  }
  if (config.date_range && config.date_field) {
    const r = typeof config.date_range === 'string' ? resolveRelative(config.date_range) : config.date_range;
    const c = colExpr(entityKey, config.date_field);
    where.push(`(${c.expr} >= ? AND ${c.expr} <= ?)`);
    params.push(r.from, `${r.to} 23:59:59`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const measure = measureExpr(entityKey, config.measure);

  if (!config.group_by) {
    const row = get(`SELECT ${measure.sql} AS value FROM ${e.table} t ${whereSql}`, ...params);
    return { type: 'number', measure: measure.label, value: row?.value ?? 0, rows: [{ label: measure.label, value: row?.value ?? 0 }] };
  }

  const g = colExpr(entityKey, config.group_by);
  const gExpr = ['date', 'datetime'].includes(g.type) ? bucketExpr(g.expr, config.bucket || 'month') : g.expr;

  if (config.segment_by) {
    const s = colExpr(entityKey, config.segment_by);
    const rows = all(
      `SELECT ${gExpr} AS grp, ${s.expr} AS seg, ${measure.sql} AS value
       FROM ${e.table} t ${whereSql} GROUP BY grp, seg ORDER BY grp`,
      ...params,
    );
    const groups = [...new Set(rows.map((r) => r.grp))];
    const segments = [...new Set(rows.map((r) => r.seg))];
    const series = segments.map((seg) => ({
      name: labelFor(config.segment_by, seg),
      key: seg,
      data: groups.map((grp) => rows.find((r) => r.grp === grp && r.seg === seg)?.value ?? 0),
    }));
    return {
      type: 'segmented',
      measure: measure.label,
      categories: groups.map((v) => labelFor(config.group_by, v)),
      raw_categories: groups,
      series,
    };
  }

  const rows = all(
    `SELECT ${gExpr} AS grp, ${measure.sql} AS value, COUNT(*) AS records
     FROM ${e.table} t ${whereSql} GROUP BY grp ORDER BY ${config.sort === 'value' ? 'value DESC' : 'grp ASC'} LIMIT ?`,
    ...params, Math.min(config.limit || 100, 500),
  );
  return {
    type: 'grouped',
    measure: measure.label,
    rows: rows.map((r) => ({ key: r.grp, label: labelFor(config.group_by, r.grp), value: r.value ?? 0, records: r.records })),
  };
}

/** Rows behind one bar/slice — the "detailed table view". */
export function reportDetail(ctx, config, groupKey, limit = 200) {
  const entityKey = config.entity;
  const e = entity(entityKey);
  const conditions = { match: 'all', rules: [...(config.conditions?.rules || [])] };
  const g = colExpr(entityKey, config.group_by);
  const where = [];
  const params = [];
  if (e.softDelete) where.push(`t.${e.softDelete} = 0`);
  if (e.hasVisibility) {
    const v = visibilityClause(ctx, 't');
    where.push(v.sql); params.push(...v.params);
  }
  const c = compileConditions(entityKey, conditions, 't');
  where.push(`(${c.sql})`); params.push(...c.params);
  const gExpr = ['date', 'datetime'].includes(g.type) ? bucketExpr(g.expr, config.bucket || 'month') : g.expr;
  if (groupKey === '(empty)' || groupKey === null) where.push(`${gExpr} IS NULL`);
  else { where.push(`${gExpr} = ?`); params.push(groupKey); }
  return all(`SELECT t.* FROM ${e.table} t WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT ?`, ...params, limit);
}

// ---------- goals ----------
export function goalProgress(ctx, goal) {
  const period = goalPeriod(goal);
  const params = [];
  let sql;
  const ownerFilter = goal.assignee_type === 'user' ? ' AND owner_id = ?' :
    goal.assignee_type === 'team' ? ' AND owner_id IN (SELECT id FROM users WHERE team_id = ?)' : '';
  const pipeFilter = goal.pipeline_id ? ' AND pipeline_id = ?' : '';

  switch (goal.metric) {
    case 'deals_won_count':
      sql = `SELECT COUNT(*) v FROM deals WHERE deleted=0 AND status='won' AND won_time BETWEEN ? AND ?${ownerFilter}${pipeFilter}`;
      break;
    case 'deals_won_value':
      sql = `SELECT COALESCE(SUM(value),0) v FROM deals WHERE deleted=0 AND status='won' AND won_time BETWEEN ? AND ?${ownerFilter}${pipeFilter}`;
      break;
    case 'deals_started':
      sql = `SELECT COUNT(*) v FROM deals WHERE deleted=0 AND created_at BETWEEN ? AND ?${ownerFilter}${pipeFilter}`;
      break;
    case 'deals_progressed':
      sql = `SELECT COUNT(*) v FROM deals WHERE deleted=0 AND stage_changed_at BETWEEN ? AND ?${ownerFilter}${pipeFilter}`;
      break;
    case 'expected_revenue':
      sql = `SELECT COALESCE(SUM(value * COALESCE(probability,100)/100.0),0) v FROM deals WHERE deleted=0 AND status='open' AND expected_close_date BETWEEN ? AND ?${ownerFilter}${pipeFilter}`;
      break;
    case 'activities_done':
      sql = `SELECT COUNT(*) v FROM activities WHERE deleted=0 AND done=1 AND done_time BETWEEN ? AND ?${goal.assignee_type === 'user' ? ' AND assignee_id = ?' : goal.assignee_type === 'team' ? ' AND assignee_id IN (SELECT id FROM users WHERE team_id = ?)' : ''}`;
      break;
    case 'leads_created':
      sql = `SELECT COUNT(*) v FROM leads WHERE deleted=0 AND created_at BETWEEN ? AND ?${ownerFilter}`;
      break;
    default:
      throw badRequest(`Unknown goal metric ${goal.metric}`);
  }
  params.push(period.from, period.to + ' 23:59:59');
  if (goal.assignee_type !== 'company') params.push(goal.assignee_id);
  if (goal.pipeline_id && !['activities_done', 'leads_created'].includes(goal.metric)) params.push(goal.pipeline_id);
  const actual = get(sql, ...params)?.v ?? 0;
  return {
    ...goal,
    period,
    actual,
    progress: goal.target ? Math.round((actual / goal.target) * 100) : 0,
  };
}

export function goalPeriod(goal) {
  if (goal.start_date && goal.end_date) return { from: goal.start_date, to: goal.end_date };
  const map = { weekly: 'this_week', monthly: 'this_month', quarterly: 'this_quarter', yearly: 'this_year' };
  return resolveRelative(map[goal.interval] || 'this_month');
}

/** Forecast view: open deals grouped by expected close month. */
export function forecast(ctx, { pipelineId = null, months = 6 } = {}) {
  const where = ["d.deleted=0", "d.status='open'"];
  const params = [];
  if (pipelineId) { where.push('d.pipeline_id = ?'); params.push(pipelineId); }
  if (!ctx.isAdmin) {
    const v = visibilityClause(ctx, 'd');
    where.push(v.sql); params.push(...v.params);
  }
  const rows = all(
    `SELECT strftime('%Y-%m', d.expected_close_date) AS period,
            COUNT(*) AS deals,
            COALESCE(SUM(d.value),0) AS value,
            COALESCE(SUM(d.value * COALESCE(d.probability,100)/100.0),0) AS weighted
     FROM deals d WHERE ${where.join(' AND ')} AND d.expected_close_date IS NOT NULL
     GROUP BY period ORDER BY period LIMIT ?`,
    ...params, months,
  );
  const won = all(
    `SELECT strftime('%Y-%m', won_time) AS period, COALESCE(SUM(value),0) AS value
     FROM deals WHERE deleted=0 AND status='won' GROUP BY period ORDER BY period DESC LIMIT 12`,
  );
  return { open: rows, won };
}
