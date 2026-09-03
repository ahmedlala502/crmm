import { all, get, insert, update, run, json } from '../db.mjs';
import { assertCan, can } from '../rbac.mjs';
import { badRequest, notFound, toInt } from '../http.mjs';
import { TRIGGERS, TRIGGER_ENTITIES, ACTIONS, compile, testAutomation, evalRules } from '../engines/automations.mjs';
import { columnsFor } from '../query.mjs';
import { audit } from '../audit.mjs';
import { jobStats } from '../jobs.mjs';

export function registerAutomationRoutes(router) {
  router.get('/api/automations/meta', async () => ({
    triggers: TRIGGERS,
    entities: TRIGGER_ENTITIES,
    actions: ACTIONS,
    fields: Object.fromEntries(TRIGGER_ENTITIES.map((e) => [e, columnsFor(e)])),
    stages: all('SELECT s.id, s.name, s.pipeline_id, p.name AS pipeline_name FROM stages s JOIN pipelines p ON p.id=s.pipeline_id ORDER BY p.order_idx, s.order_idx'),
    users: all('SELECT id, name, email, team_id FROM users WHERE active=1'),
    sequences: all('SELECT id, name, entity FROM sequences WHERE active=1'),
    templates: all('SELECT id, name FROM email_templates'),
    activity_types: all('SELECT key_string, name FROM activity_types WHERE active=1'),
    project_boards: all('SELECT id, name FROM project_boards'),
    project_templates: all('SELECT id, name FROM project_templates'),
  }));

  router.get('/api/automations', async (req, res, { ctx }) => {
    assertCan(ctx, 'automations.view');
    return all('SELECT * FROM automations ORDER BY id DESC').map((a) => ({
      ...a,
      trigger_config: json(a.trigger_config, {}),
      conditions: json(a.conditions, {}),
      steps: json(a.steps, []),
      owner: a.owner_id ? get('SELECT id,name FROM users WHERE id=?', a.owner_id) : null,
      recent: all(
        "SELECT status, COUNT(*) n FROM automation_executions WHERE automation_id=? AND started_at >= datetime('now','-7 days') GROUP BY status",
        a.id,
      ),
    }));
  });

  router.get('/api/automations/:id', async (req, res, { ctx, params }) => {
    assertCan(ctx, 'automations.view');
    const a = get('SELECT * FROM automations WHERE id=?', params.id);
    if (!a) throw notFound('Automation not found');
    return {
      ...a,
      trigger_config: json(a.trigger_config, {}),
      conditions: json(a.conditions, {}),
      steps: json(a.steps, []),
      compiled: compile(json(a.steps, [])),
    };
  });

  router.post('/api/automations', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'automations.manage');
    validateDefinition(body);
    const id = insert('automations', {
      name: body.name, owner_id: ctx.user.id,
      enabled: body.enabled ? 1 : 0, test_mode: body.test_mode ? 1 : 0,
      trigger_config: JSON.stringify(body.trigger_config || {}),
      conditions: JSON.stringify(body.conditions || { match: 'all', rules: [] }),
      steps: JSON.stringify(body.steps || []),
    });
    audit({ ctx, entity: 'automation', entityId: id, action: 'created', changes: { name: body.name } });
    return get('SELECT * FROM automations WHERE id=?', id);
  });

  router.patch('/api/automations/:id', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'automations.manage');
    const before = get('SELECT * FROM automations WHERE id=?', params.id);
    if (!before) throw notFound('Automation not found');
    if (body.trigger_config || body.steps) validateDefinition({ ...before, ...body });
    update('automations', params.id, {
      name: body.name,
      enabled: body.enabled === undefined ? undefined : (body.enabled ? 1 : 0),
      test_mode: body.test_mode === undefined ? undefined : (body.test_mode ? 1 : 0),
      trigger_config: body.trigger_config ? JSON.stringify(body.trigger_config) : undefined,
      conditions: body.conditions ? JSON.stringify(body.conditions) : undefined,
      steps: body.steps ? JSON.stringify(body.steps) : undefined,
      updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
    audit({ ctx, entity: 'automation', entityId: Number(params.id), action: 'updated', changes: body });
    return get('SELECT * FROM automations WHERE id=?', params.id);
  });

  router.delete('/api/automations/:id', async (req, res, { ctx, params }) => {
    assertCan(ctx, 'automations.manage');
    run('DELETE FROM automations WHERE id=?', params.id);
    audit({ ctx, entity: 'automation', entityId: Number(params.id), action: 'deleted' });
    return { ok: true };
  });

  router.get('/api/automations/:id/executions', async (req, res, { ctx, params, query }) => {
    assertCan(ctx, 'automations.view');
    return all(
      'SELECT * FROM automation_executions WHERE automation_id=? ORDER BY id DESC LIMIT ?',
      params.id, toInt(query.limit, 50),
    ).map((e) => ({ ...e, log: json(e.log, []) }));
  });

  router.post('/api/automations/:id/test', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'automations.manage');
    const result = await testAutomation(Number(params.id), body.entity, Number(body.record_id));
    return { ...result, execution: { ...result.execution, log: json(result.execution.log, []) } };
  });

  router.post('/api/automations/:id/evaluate', async (req, res, { ctx, params, body }) => {
    const a = get('SELECT * FROM automations WHERE id=?', params.id);
    if (!a) throw notFound('Automation not found');
    const table = { deal: 'deals', lead: 'leads', person: 'persons', organization: 'organizations', activity: 'activities', project: 'projects' }[body.entity];
    const record = get(`SELECT * FROM ${table} WHERE id=?`, body.record_id);
    if (!record) throw badRequest('Record not found');
    return { matches: evalRules(json(a.conditions, {}), record) };
  });

  router.get('/api/automations/:id/waits', async (req, res, { params }) =>
    all("SELECT * FROM automation_waits WHERE automation_id=? AND status='pending' ORDER BY resume_at", params.id));

  router.get('/api/ops/jobs', async (req, res, { ctx }) => {
    if (!ctx.isAdmin) throw badRequest('Admin only');
    return jobStats();
  });
}

function validateDefinition(def) {
  const t = def.trigger_config || {};
  if (!t.event) throw badRequest('Choose a trigger event');
  if (!TRIGGERS.some((x) => x.key === t.event)) throw badRequest(`Unknown trigger "${t.event}"`);
  if (!t.entity || !TRIGGER_ENTITIES.includes(t.entity)) throw badRequest('Choose a valid trigger entity');
  if (t.event === 'field_updated' && !t.field) throw badRequest('Choose the field to watch');
  if (t.event === 'date' && !t.date_field) throw badRequest('Choose the date field to watch');
  const steps = typeof def.steps === 'string' ? json(def.steps, []) : (def.steps || []);
  if (!steps.length) throw badRequest('Add at least one action');
  const walk = (list) => {
    for (const s of list) {
      if (s.type === 'if') { walk(s.then || []); walk(s.else || []); continue; }
      if (s.type === 'delay' || s.type === 'wait') continue;
      if (!ACTIONS.some((a) => a.key === s.action)) throw badRequest(`Unknown action "${s.action}"`);
      if (s.action === 'webhook' && !s.config?.url) throw badRequest('Webhook action needs a URL');
      if (s.action === 'move_stage' && !s.config?.stage_id) throw badRequest('Move stage action needs a stage');
      if (s.action === 'enroll_sequence' && !s.config?.sequence_id) throw badRequest('Sequence action needs a sequence');
    }
  };
  walk(steps);
}
