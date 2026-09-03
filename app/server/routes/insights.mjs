import crypto from 'node:crypto';
import { all, get, insert, update, run, json } from '../db.mjs';
import { assertCan, can } from '../rbac.mjs';
import { badRequest, notFound, sendText, toInt } from '../http.mjs';
import { runReport, reportDetail, goalProgress, REPORT_TYPES, CHART_TYPES, DATE_BUCKETS } from '../engines/reports.mjs';
import { columnsFor } from '../query.mjs';
import { hydrate } from '../query.mjs';
import { entity } from '../registry.mjs';
import { toCsv } from '../engines/tabular.mjs';
import { aiReportConfig } from '../engines/ai.mjs';

export function registerInsightsRoutes(router) {
  router.get('/api/insights/meta', async () => ({
    report_types: REPORT_TYPES,
    chart_types: CHART_TYPES,
    date_buckets: DATE_BUCKETS,
    fields: Object.fromEntries(REPORT_TYPES.map((t) => [t.entity, columnsFor(t.entity)])),
  }));

  router.post('/api/insights/run', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'insights.view');
    return runReport(ctx, body);
  });

  router.post('/api/insights/detail', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'insights.view');
    const rows = reportDetail(ctx, body.config, body.group_key, toInt(body.limit, 200));
    return { data: hydrate(body.config.entity, rows, { withActivity: false }) };
  });

  router.post('/api/insights/export.csv', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'insights.export');
    const result = runReport(ctx, body.config || body);
    const rows = result.type === 'segmented'
      ? result.categories.map((c, i) => Object.fromEntries([['group', c], ...result.series.map((s) => [s.name, s.data[i]])]))
      : result.rows;
    const columns = Object.keys(rows[0] || { label: '', value: '' }).map((k) => ({ key: k, label: k }));
    sendText(res, 200, toCsv(rows, columns), 'text/csv; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="report.csv"',
    });
    return { __raw: true };
  });

  router.post('/api/insights/ai', async (req, res, { ctx, body }) => {
    const fields = columnsFor(body.entity || 'deal').map((c) => ({ key: c.key, label: c.label, type: c.type }));
    return aiReportConfig(body.prompt, fields);
  });

  // ---------- saved reports ----------
  router.get('/api/reports', async (req, res, { ctx }) =>
    all('SELECT * FROM reports WHERE shared=1 OR owner_id=? ORDER BY name', ctx.user.id)
      .map((r) => ({ ...r, config: json(r.config, {}) })));

  router.post('/api/reports', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'insights.create');
    const id = insert('reports', {
      name: body.name, entity: body.entity || body.config?.entity,
      config: JSON.stringify(body.config || {}), owner_id: ctx.user.id,
      shared: body.shared === false ? 0 : 1,
    });
    return get('SELECT * FROM reports WHERE id=?', id);
  });

  router.get('/api/reports/:id', async (req, res, { ctx, params }) => {
    const r = get('SELECT * FROM reports WHERE id=?', params.id);
    if (!r) throw notFound('Report not found');
    const config = json(r.config, {});
    return { ...r, config, result: runReport(ctx, config) };
  });

  router.patch('/api/reports/:id', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'insights.create');
    update('reports', params.id, {
      name: body.name, entity: body.entity,
      config: body.config ? JSON.stringify(body.config) : undefined,
      shared: body.shared === undefined ? undefined : (body.shared ? 1 : 0),
    });
    return get('SELECT * FROM reports WHERE id=?', params.id);
  });

  router.delete('/api/reports/:id', async (req, res, { ctx, params }) => {
    assertCan(ctx, 'insights.create');
    run('DELETE FROM reports WHERE id=?', params.id);
    return { ok: true };
  });

  // ---------- dashboards ----------
  router.get('/api/dashboards', async (req, res, { ctx }) =>
    all('SELECT * FROM dashboards WHERE shared=1 OR owner_id=? ORDER BY name', ctx.user.id)
      .map((d) => ({ ...d, layout: json(d.layout, []) })));

  router.post('/api/dashboards', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'insights.create');
    const id = insert('dashboards', {
      name: body.name, layout: JSON.stringify(body.layout || []),
      owner_id: ctx.user.id, shared: body.shared === false ? 0 : 1,
    });
    return get('SELECT * FROM dashboards WHERE id=?', id);
  });

  router.get('/api/dashboards/:id', async (req, res, { ctx, params }) => {
    const d = get('SELECT * FROM dashboards WHERE id=?', params.id);
    if (!d) throw notFound('Dashboard not found');
    const layout = json(d.layout, []);
    const tiles = layout.map((tile) => {
      try {
        if (tile.type === 'goal') {
          const goal = get('SELECT * FROM goals WHERE id=?', tile.goal_id);
          return { ...tile, data: goal ? goalProgress(ctx, goal) : null };
        }
        const report = get('SELECT * FROM reports WHERE id=?', tile.report_id);
        if (!report) return { ...tile, error: 'Report was deleted' };
        return { ...tile, name: report.name, data: runReport(ctx, json(report.config, {})) };
      } catch (err) {
        return { ...tile, error: err.message };
      }
    });
    return { ...d, layout, tiles };
  });

  router.patch('/api/dashboards/:id', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'insights.create');
    update('dashboards', params.id, {
      name: body.name,
      layout: body.layout ? JSON.stringify(body.layout) : undefined,
      shared: body.shared === undefined ? undefined : (body.shared ? 1 : 0),
    });
    return get('SELECT * FROM dashboards WHERE id=?', params.id);
  });

  router.delete('/api/dashboards/:id', async (req, res, { ctx, params }) => {
    assertCan(ctx, 'insights.create');
    run('DELETE FROM dashboards WHERE id=?', params.id);
    return { ok: true };
  });

  router.post('/api/dashboards/:id/share', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'insights.share');
    const token = body.enabled === false ? null : crypto.randomBytes(12).toString('hex');
    update('dashboards', params.id, { public_token: token });
    return { public_token: token, url: token ? `/public/dashboards/${token}` : null };
  });

  // ---------- goals ----------
  router.get('/api/goals', async (req, res, { ctx }) =>
    all('SELECT * FROM goals ORDER BY id DESC').map((g) => goalProgress(ctx, g)));

  router.post('/api/goals', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'goals.manage');
    const id = insert('goals', {
      name: body.name, metric: body.metric, target: Number(body.target || 0),
      interval: body.interval || 'monthly', assignee_type: body.assignee_type || 'company',
      assignee_id: body.assignee_id || null, pipeline_id: body.pipeline_id || null,
      currency: body.currency || 'USD', start_date: body.start_date || null, end_date: body.end_date || null,
    });
    return goalProgress(ctx, get('SELECT * FROM goals WHERE id=?', id));
  });

  router.patch('/api/goals/:id', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'goals.manage');
    update('goals', params.id, {
      name: body.name, metric: body.metric, target: body.target,
      interval: body.interval, assignee_type: body.assignee_type, assignee_id: body.assignee_id,
      pipeline_id: body.pipeline_id, start_date: body.start_date, end_date: body.end_date,
    });
    return goalProgress(ctx, get('SELECT * FROM goals WHERE id=?', params.id));
  });

  router.delete('/api/goals/:id', async (req, res, { ctx, params }) => {
    assertCan(ctx, 'goals.manage');
    run('DELETE FROM goals WHERE id=?', params.id);
    return { ok: true };
  });
}
