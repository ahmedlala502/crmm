import crypto from 'node:crypto';
import { all, get, insert, update, run, json, tx, nowIso, setting, setSetting } from '../db.mjs';
import { hydrate } from '../query.mjs';
import { createRecord, updateRecord, getRecord } from '../records.mjs';
import { assertCan } from '../rbac.mjs';
import { badRequest, notFound, toInt, toBool } from '../http.mjs';
import { audit } from '../audit.mjs';
import { aiProjectHealth } from '../engines/ai.mjs';
import { applyProjectTemplate } from '../engines/automations.mjs';

export function registerWorkRoutes(router) {
  // ---------- activities / calendar ----------
  router.get('/api/calendar', async (req, res, { ctx, query }) => {
    const from = query.from || new Date().toISOString().slice(0, 10);
    const to = query.to || new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
    const params = [from, to];
    let sql = 'SELECT * FROM activities WHERE deleted=0 AND due_date BETWEEN ? AND ?';
    if (query.assignee_id) { sql += ' AND assignee_id = ?'; params.push(Number(query.assignee_id)); }
    if (query.type_key) { sql += ' AND type_key = ?'; params.push(query.type_key); }
    if (query.done !== undefined && query.done !== '') { sql += ' AND done = ?'; params.push(toBool(query.done) ? 1 : 0); }
    sql += " ORDER BY due_date, COALESCE(due_time,'00:00')";
    const rows = hydrate('activity', all(sql, ...params), { withActivity: false });
    const byDate = {};
    for (const a of rows) (byDate[a.due_date] ||= []).push(a);
    return { from, to, activities: rows, by_date: byDate };
  });

  router.post('/api/activities/:id/done', async (req, res, { ctx, params, body }) => {
    const row = updateRecord('activity', ctx, Number(params.id), { done: body.done !== false });
    return hydrate('activity', [row], { withActivity: false })[0];
  });

  router.post('/api/activities/bulk-create', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'activities.create');
    const { subject, type_key, assignee_id, dates = [], link = {} } = body;
    if (!dates.length) throw badRequest('Provide at least one date');
    const created = [];
    for (const date of dates) {
      created.push(createRecord('activity', ctx, {
        subject, type_key: type_key || 'task', assignee_id: assignee_id || ctx.user.id,
        due_date: date, due_time: body.due_time || null, duration: body.duration || null,
        deal_id: link.deal_id || null, lead_id: link.lead_id || null,
        person_id: link.person_id || null, org_id: link.org_id || null, project_id: link.project_id || null,
      }));
    }
    return { created: created.length, activities: created };
  });

  router.get('/api/activities/summary', async (req, res, { ctx, query }) => {
    const userId = query.assignee_id ? Number(query.assignee_id) : ctx.user.id;
    const today = new Date().toISOString().slice(0, 10);
    return {
      overdue: get('SELECT COUNT(*) n FROM activities WHERE deleted=0 AND done=0 AND assignee_id=? AND due_date < ?', userId, today).n,
      today: get('SELECT COUNT(*) n FROM activities WHERE deleted=0 AND done=0 AND assignee_id=? AND due_date = ?', userId, today).n,
      upcoming: get('SELECT COUNT(*) n FROM activities WHERE deleted=0 AND done=0 AND assignee_id=? AND due_date > ?', userId, today).n,
      done_this_week: get("SELECT COUNT(*) n FROM activities WHERE deleted=0 AND done=1 AND assignee_id=? AND done_time >= date('now','-7 days')", userId).n,
    };
  });

  // ---------- meeting scheduler ----------
  router.get('/api/scheduler/links', async (req, res, { ctx }) =>
    all('SELECT * FROM web_forms WHERE target=? ORDER BY id DESC', 'meeting'));

  router.post('/api/scheduler/links', async (req, res, { ctx, body }) => {
    const token = crypto.randomBytes(8).toString('hex');
    const id = insert('web_forms', {
      name: body.name || `${ctx.user.name} — ${body.duration || 30} min`,
      target: 'meeting',
      fields: JSON.stringify({
        duration: Number(body.duration || 30),
        availability: body.availability || { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' },
        activity_type: body.activity_type || 'meeting',
        user_id: ctx.user.id,
      }),
      token, owner_id: ctx.user.id,
    });
    return get('SELECT * FROM web_forms WHERE id=?', id);
  });

  // ---------- projects ----------
  router.get('/api/project-boards', async () => {
    const boards = all('SELECT * FROM project_boards ORDER BY order_idx, id');
    return boards.map((b) => ({ ...b, phases: all('SELECT * FROM project_phases WHERE board_id=? ORDER BY order_idx', b.id) }));
  });

  router.get('/api/projects/:id/board', async (req, res, { ctx, params }) => {
    const project = getRecord('project', ctx, Number(params.id));
    const phases = all('SELECT * FROM project_phases WHERE board_id=? ORDER BY order_idx', project.board_id);
    const tasks = all('SELECT * FROM tasks WHERE project_id=? ORDER BY order_idx, id', project.id)
      .map((t) => ({ ...t, depends_on: json(t.depends_on, []) }));
    return {
      project,
      phases: phases.map((p) => ({ ...p, tasks: tasks.filter((t) => t.phase_id === p.id) })),
      unphased: tasks.filter((t) => !t.phase_id),
    };
  });

  router.get('/api/projects/board/:boardId', async (req, res, { ctx, params }) => {
    const board = get('SELECT * FROM project_boards WHERE id=?', params.boardId);
    if (!board) throw notFound('Board not found');
    const phases = all('SELECT * FROM project_phases WHERE board_id=? ORDER BY order_idx', board.id);
    const projects = hydrate('project', all(
      'SELECT * FROM projects WHERE board_id=? AND deleted=0 ORDER BY id DESC', board.id,
    ), { withActivity: false });
    return {
      board,
      phases: phases.map((p) => ({ ...p, projects: projects.filter((pr) => pr.phase_id === p.id) })),
      unphased: projects.filter((p) => !p.phase_id),
    };
  });

  router.post('/api/projects/:id/tasks', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'projects.edit');
    const project = getRecord('project', ctx, Number(params.id));
    const maxOrder = get('SELECT COALESCE(MAX(order_idx),0) m FROM tasks WHERE project_id=?', project.id).m;
    const id = insert('tasks', {
      project_id: project.id,
      phase_id: body.phase_id ?? project.phase_id ?? null,
      title: body.title, description: body.description || null,
      assignee_id: body.assignee_id || null, due_date: body.due_date || null,
      is_milestone: body.is_milestone ? 1 : 0,
      parent_task_id: body.parent_task_id || null,
      depends_on: JSON.stringify(body.depends_on || []),
      order_idx: maxOrder + 1,
    });
    audit({ ctx, entity: 'project', entityId: project.id, action: 'task_added', changes: { title: body.title } });
    return get('SELECT * FROM tasks WHERE id=?', id);
  });

  router.patch('/api/tasks/:id', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'projects.edit');
    const task = get('SELECT * FROM tasks WHERE id=?', params.id);
    if (!task) throw notFound('Task not found');
    getRecord('project', ctx, task.project_id);
    if (body.done !== undefined) {
      const blockers = json(task.depends_on, []).filter((depId) => {
        const dep = get('SELECT done FROM tasks WHERE id=?', depId);
        return dep && !dep.done;
      });
      if (body.done && blockers.length) throw badRequest(`Task depends on ${blockers.length} unfinished task(s)`);
    }
    update('tasks', task.id, {
      title: body.title, description: body.description,
      assignee_id: body.assignee_id, due_date: body.due_date,
      phase_id: body.phase_id, order_idx: body.order_idx,
      is_milestone: body.is_milestone === undefined ? undefined : (body.is_milestone ? 1 : 0),
      depends_on: body.depends_on ? JSON.stringify(body.depends_on) : undefined,
      done: body.done === undefined ? undefined : (body.done ? 1 : 0),
      done_time: body.done === undefined ? undefined : (body.done ? nowIso() : null),
      updated_at: nowIso(),
    });
    return get('SELECT * FROM tasks WHERE id=?', task.id);
  });

  router.delete('/api/tasks/:id', async (req, res, { ctx, params }) => {
    assertCan(ctx, 'projects.edit');
    const task = get('SELECT * FROM tasks WHERE id=?', params.id);
    if (!task) throw notFound('Task not found');
    getRecord('project', ctx, task.project_id);
    run('DELETE FROM tasks WHERE id=?', task.id);
    return { ok: true };
  });

  router.get('/api/projects/:id/gantt', async (req, res, { ctx, params }) => {
    const project = getRecord('project', ctx, Number(params.id));
    const tasks = all("SELECT * FROM tasks WHERE project_id=? ORDER BY COALESCE(due_date, '9999'), order_idx", project.id);
    const dates = tasks.map((t) => t.due_date).filter(Boolean).sort();
    const start = project.start_date || dates[0] || new Date().toISOString().slice(0, 10);
    const end = project.end_date || dates[dates.length - 1] || start;
    return {
      project, start, end,
      bars: tasks.map((t) => ({
        id: t.id, title: t.title, done: !!t.done, milestone: !!t.is_milestone,
        start: t.due_date || start, end: t.due_date || start,
        depends_on: json(t.depends_on, []), assignee_id: t.assignee_id,
      })),
    };
  });

  router.get('/api/projects/:id/health', async (req, res, { ctx, params }) => {
    getRecord('project', ctx, Number(params.id));
    return aiProjectHealth(Number(params.id));
  });

  router.get('/api/project-templates', async () =>
    all('SELECT * FROM project_templates ORDER BY id').map((t) => ({ ...t, payload: json(t.payload, {}) })));

  router.post('/api/project-templates', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'projects.create');
    const id = insert('project_templates', {
      name: body.name, board_id: body.board_id || null,
      payload: JSON.stringify({ tasks: body.tasks || [] }),
    });
    return get('SELECT * FROM project_templates WHERE id=?', id);
  });

  router.post('/api/projects/:id/apply-template', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'projects.edit');
    const project = getRecord('project', ctx, Number(params.id));
    applyProjectTemplate(project.id, Number(body.template_id));
    return all('SELECT * FROM tasks WHERE project_id=? ORDER BY order_idx', project.id);
  });

  router.post('/api/deals/:id/handoff', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'projects.create');
    const deal = getRecord('deal', ctx, Number(params.id));
    const existing = get('SELECT id FROM projects WHERE deal_id=? AND deleted=0', deal.id);
    if (existing) throw badRequest(`Deal already has project #${existing.id}`);
    const project = createRecord('project', ctx, {
      title: body.title || deal.title,
      board_id: body.board_id ? Number(body.board_id) : undefined,
      deal_id: deal.id, person_id: deal.person_id, org_id: deal.org_id,
      owner_id: body.owner_id || deal.owner_id,
      start_date: body.start_date || new Date().toISOString().slice(0, 10),
      end_date: body.end_date || null,
    });
    if (body.template_id) applyProjectTemplate(project.id, Number(body.template_id));
    audit({ ctx, entity: 'deal', entityId: deal.id, action: 'handoff_to_project', changes: { project_id: project.id } });
    return project;
  });
}
