import { all, get, insert, update, run, json, nowIso } from '../db.mjs';
import { onEvent } from '../events.mjs';
import { registerJob, enqueue } from '../jobs.mjs';
import { createRecord, updateRecord, systemContext } from '../records.mjs';
import { renderMerge, mergeContext, composeEmail } from './mailer.mjs';
import { enrollInSequence } from './sequences.mjs';
import { resolveRelative } from '../query.mjs';

export const TRIGGERS = [
  { key: 'created', label: 'Record is created' },
  { key: 'updated', label: 'Record is updated' },
  { key: 'field_updated', label: 'A specific field changes' },
  { key: 'date', label: 'A date field is reached' },
];
export const TRIGGER_ENTITIES = ['deal', 'lead', 'person', 'organization', 'activity', 'project'];
export const ACTIONS = [
  { key: 'create_record', label: 'Create a record' },
  { key: 'update_record', label: 'Update a record' },
  { key: 'assign_owner', label: 'Assign owner' },
  { key: 'move_stage', label: 'Move deal to stage' },
  { key: 'create_activity', label: 'Create an activity' },
  { key: 'send_email', label: 'Send an email' },
  { key: 'enroll_sequence', label: 'Enrol in a sequence' },
  { key: 'create_project', label: 'Create a project' },
  { key: 'create_task', label: 'Create a project task' },
  { key: 'webhook', label: 'Call a webhook' },
];

// ---------- condition evaluation (JS mirror of the SQL filter compiler) ----------
function fieldValue(record, field) {
  if (!record) return undefined;
  if (field.startsWith('cf.')) return json(record.cf, {})[field.slice(3)];
  if (record[field] !== undefined) return record[field];
  const cf = json(record.cf, {});
  return cf[field];
}
export function evalRules(node, record, before = null) {
  if (!node || !Array.isArray(node.rules) || !node.rules.length) return true;
  const results = node.rules.map((rule) => {
    if (rule.rules) return evalRules(rule, record, before);
    const source = rule.source === 'previous' ? before : record;
    const v = fieldValue(source, rule.field);
    const target = rule.value;
    switch (rule.op) {
      case 'eq': return String(v ?? '') === String(target ?? '');
      case 'neq': return String(v ?? '') !== String(target ?? '');
      case 'contains': return String(v ?? '').toLowerCase().includes(String(target ?? '').toLowerCase());
      case 'not_contains': return !String(v ?? '').toLowerCase().includes(String(target ?? '').toLowerCase());
      case 'starts_with': return String(v ?? '').toLowerCase().startsWith(String(target ?? '').toLowerCase());
      case 'is_empty': return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
      case 'is_not_empty': return !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length));
      case 'gt': return Number(v) > Number(target);
      case 'gte': return Number(v) >= Number(target);
      case 'lt': return Number(v) < Number(target);
      case 'lte': return Number(v) <= Number(target);
      case 'between': return Number(v) >= Number(target) && Number(v) <= Number(rule.value2);
      case 'after': return String(v ?? '') > String(target ?? '');
      case 'before': return String(v ?? '') < String(target ?? '');
      case 'in': return (Array.isArray(target) ? target : String(target).split(',')).map(String).includes(String(v));
      case 'not_in': return !(Array.isArray(target) ? target : String(target).split(',')).map(String).includes(String(v));
      case 'has': return (Array.isArray(v) ? v : json(v, [])).map(String).includes(String(target));
      case 'not_has': return !(Array.isArray(v) ? v : json(v, [])).map(String).includes(String(target));
      case 'changed': return before ? JSON.stringify(fieldValue(before, rule.field)) !== JSON.stringify(v) : true;
      case 'relative': {
        const r = resolveRelative(target);
        return String(v ?? '') >= r.from && String(v ?? '') <= r.to;
      }
      default: return false;
    }
  });
  return node.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

// ---------- compile step tree -> linear program (so waits can resume) ----------
export function compile(steps) {
  const prog = [];
  function walk(list) {
    for (const step of list || []) {
      if (step.type === 'if') {
        const jz = { op: 'jz', conditions: step.config?.conditions, target: -1 };
        prog.push(jz);
        walk(step.then || []);
        const jmp = { op: 'jmp', target: -1 };
        prog.push(jmp);
        jz.target = prog.length;
        walk(step.else || []);
        jmp.target = prog.length;
      } else if (step.type === 'delay') {
        prog.push({ op: 'delay', config: step.config || {} });
      } else if (step.type === 'wait') {
        prog.push({ op: 'wait', config: step.config || {} });
      } else {
        prog.push({ op: 'action', action: step.action, config: step.config || {}, label: step.label });
      }
    }
  }
  walk(steps);
  return prog;
}

function loadRecord(entityKey, id) {
  const table = { deal: 'deals', lead: 'leads', person: 'persons', organization: 'organizations', activity: 'activities', project: 'projects' }[entityKey];
  if (!table) return null;
  return get(`SELECT * FROM ${table} WHERE id=?`, id);
}

function buildMergeCtx(entityKey, record) {
  const ids = { user: null };
  if (entityKey === 'deal') ids.dealId = record.id;
  if (entityKey === 'lead') ids.leadId = record.id;
  if (entityKey === 'person') ids.personId = record.id;
  if (entityKey === 'organization') ids.orgId = record.id;
  if (entityKey === 'project') ids.projectId = record.id;
  const ctx = mergeContext(ids);
  ctx[entityKey] = { ...record, cf: json(record.cf, {}) };
  return ctx;
}

function renderConfig(config, mctx) {
  const out = {};
  for (const [k, v] of Object.entries(config || {})) {
    if (typeof v === 'string') out[k] = renderMerge(v, mctx);
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'string' ? renderMerge(x, mctx) : x));
    else if (v && typeof v === 'object') out[k] = renderConfig(v, mctx);
    else out[k] = v;
  }
  return out;
}

function addDays(days) {
  const d = new Date(Date.now() + Number(days || 0) * 864e5);
  return d.toISOString().slice(0, 10);
}

// ---------- action execution ----------
async function runAction(instr, state, logLine) {
  const { entityKey, record, depth, testMode } = state;
  const sys = systemContext(`automation:${state.automationId}`);
  const mctx = buildMergeCtx(entityKey, record);
  const cfg = renderConfig(instr.config, mctx);
  const opts = { depth: depth + 1, source: 'automation', skipPerms: true, ignoreUnknown: true, allowSystemFields: true };

  if (testMode) {
    logLine(`TEST: would run ${instr.action} with ${JSON.stringify(cfg)}`);
    return;
  }

  switch (instr.action) {
    case 'create_record': {
      const target = cfg.entity || 'activity';
      const values = { ...(cfg.values || {}) };
      if (target === 'deal' && !values.title) values.title = record.title || record.name || 'New deal';
      const created = createRecord(target, sys, values, opts);
      logLine(`Created ${target} #${created.id}`);
      break;
    }
    case 'update_record': {
      const targetEntity = cfg.target_entity || entityKey;
      const targetId = resolveTargetId(cfg.target || 'trigger', entityKey, record, targetEntity);
      if (!targetId) { logLine(`Skipped update — no ${targetEntity} linked`); break; }
      updateRecord(targetEntity, sys, targetId, cfg.values || {}, opts);
      logLine(`Updated ${targetEntity} #${targetId}`);
      break;
    }
    case 'assign_owner': {
      let userId = cfg.user_id;
      if (cfg.mode === 'round_robin') userId = roundRobinUser(cfg.team_id);
      if (!userId) { logLine('Skipped assign_owner — no user resolved'); break; }
      const field = entityKey === 'activity' ? 'assignee_id' : 'owner_id';
      updateRecord(entityKey, sys, record.id, { [field]: Number(userId) }, opts);
      logLine(`Assigned ${entityKey} #${record.id} to user ${userId}`);
      break;
    }
    case 'move_stage': {
      if (entityKey !== 'deal') { logLine('move_stage only applies to deals'); break; }
      updateRecord('deal', sys, record.id, { stage_id: Number(cfg.stage_id) }, opts);
      logLine(`Moved deal #${record.id} to stage ${cfg.stage_id}`);
      break;
    }
    case 'create_activity': {
      const values = {
        subject: cfg.subject || 'Follow up',
        type_key: cfg.type_key || 'call',
        assignee_id: cfg.assignee_id ? Number(cfg.assignee_id) : record.owner_id,
        due_date: cfg.due_date || addDays(cfg.due_in_days ?? 1),
        due_time: cfg.due_time || null,
        note: cfg.note || null,
      };
      if (entityKey === 'deal') { values.deal_id = record.id; values.person_id = record.person_id; values.org_id = record.org_id; }
      if (entityKey === 'lead') { values.lead_id = record.id; values.person_id = record.person_id; }
      if (entityKey === 'person') values.person_id = record.id;
      if (entityKey === 'organization') values.org_id = record.id;
      if (entityKey === 'project') values.project_id = record.id;
      const a = createRecord('activity', sys, values, opts);
      logLine(`Created activity #${a.id} "${values.subject}"`);
      break;
    }
    case 'send_email': {
      const person = record.person_id ? get('SELECT * FROM persons WHERE id=?', record.person_id) : (entityKey === 'person' ? record : null);
      const to = cfg.to ? [cfg.to] : (json(person?.emails, [])[0]?.value ? [json(person.emails, [])[0].value] : []);
      if (!to.length) { logLine('Skipped send_email — no recipient address'); break; }
      let subject = cfg.subject || '';
      let body = cfg.body || '';
      if (cfg.template_id) {
        const t = get('SELECT * FROM email_templates WHERE id=?', cfg.template_id);
        if (t) { subject = renderMerge(t.subject, mctx); body = renderMerge(t.body, mctx); }
      }
      const sender = { ...sys, user: get('SELECT * FROM users WHERE id=?', record.owner_id) || sys.user };
      const mail = composeEmail(sender, {
        to, subject, body,
        dealId: entityKey === 'deal' ? record.id : null,
        leadId: entityKey === 'lead' ? record.id : null,
        personId: person?.id || null,
      });
      logLine(`Queued email #${mail.id} to ${to.join(', ')}`);
      break;
    }
    case 'enroll_sequence': {
      const r = enrollInSequence(Number(cfg.sequence_id), entityKey, record.id, sys.user.id);
      logLine(`Enrolled ${entityKey} #${record.id} in sequence ${cfg.sequence_id} (enrollment ${r.id})`);
      break;
    }
    case 'create_project': {
      const values = {
        title: cfg.title || record.title || 'New project',
        board_id: cfg.board_id ? Number(cfg.board_id) : undefined,
        deal_id: entityKey === 'deal' ? record.id : null,
        person_id: record.person_id || null,
        org_id: record.org_id || null,
        owner_id: record.owner_id || null,
      };
      const p = createRecord('project', sys, values, opts);
      if (cfg.template_id) applyProjectTemplate(p.id, Number(cfg.template_id));
      logLine(`Created project #${p.id}`);
      break;
    }
    case 'create_task': {
      const projectId = cfg.project_id ? Number(cfg.project_id) : (entityKey === 'project' ? record.id : get('SELECT id FROM projects WHERE deal_id=? ORDER BY id DESC LIMIT 1', record.id)?.id);
      if (!projectId) { logLine('Skipped create_task — no project resolved'); break; }
      const id = insert('tasks', {
        project_id: projectId, title: cfg.title || 'Task',
        assignee_id: cfg.assignee_id || null, due_date: cfg.due_date || addDays(cfg.due_in_days ?? 3),
      });
      logLine(`Created task #${id} in project #${projectId}`);
      break;
    }
    case 'webhook': {
      let body = cfg.body;
      if (cfg.body_mode === 'kv' && Array.isArray(cfg.pairs)) {
        body = Object.fromEntries(cfg.pairs.map((p) => [p.key, p.value]));
      } else if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { /* send as raw string */ }
      }
      enqueue('webhook.custom', {
        url: cfg.url, method: cfg.method || 'POST',
        headers: cfg.headers || {}, body: body ?? { entity: entityKey, id: record.id },
      });
      logLine(`Queued webhook ${cfg.method || 'POST'} ${cfg.url}`);
      break;
    }
    default:
      logLine(`Unknown action "${instr.action}" — skipped`);
  }
}

function resolveTargetId(target, entityKey, record, targetEntity) {
  if (target === 'trigger') return entityKey === targetEntity ? record.id : null;
  if (target === 'person') return record.person_id;
  if (target === 'organization') return record.org_id;
  if (target === 'deal') return record.deal_id || (entityKey === 'deal' ? record.id : null);
  return null;
}

function roundRobinUser(teamId) {
  const users = teamId
    ? all('SELECT id FROM users WHERE active=1 AND team_id=? ORDER BY id', teamId)
    : all('SELECT id FROM users WHERE active=1 ORDER BY id');
  if (!users.length) return null;
  const key = 'rr_' + (teamId || 'all');
  const last = get('SELECT value FROM settings WHERE key=?', key);
  const lastId = last ? Number(JSON.parse(last.value)) : 0;
  const next = users.find((u) => u.id > lastId) || users[0];
  run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(next.id));
  return next.id;
}

export function applyProjectTemplate(projectId, templateId) {
  const t = get('SELECT * FROM project_templates WHERE id=?', templateId);
  if (!t) return;
  const payload = json(t.payload, { tasks: [] });
  for (const [i, task] of (payload.tasks || []).entries()) {
    insert('tasks', {
      project_id: projectId, title: task.title, order_idx: i,
      is_milestone: task.milestone ? 1 : 0,
      due_date: task.due_in_days !== undefined ? addDays(task.due_in_days) : null,
    });
  }
}

// ---------- engine ----------
async function runProgram(automation, execId, entityKey, recordId, startPc, depth, logLines) {
  const prog = compile(json(automation.steps, []));
  const logLine = (msg) => { logLines.push(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); };
  let pc = startPc;
  while (pc < prog.length) {
    const instr = prog[pc];
    const record = loadRecord(entityKey, recordId);
    if (!record) { logLine('Record no longer exists — stopping'); break; }
    const state = { entityKey, record, depth, automationId: automation.id, testMode: !!automation.test_mode };
    if (instr.op === 'jz') {
      const ok = evalRules(instr.conditions, record);
      logLine(`Branch condition ${ok ? 'true' : 'false'}`);
      pc = ok ? pc + 1 : instr.target;
      continue;
    }
    if (instr.op === 'jmp') { pc = instr.target; continue; }
    if (instr.op === 'delay') {
      const mins = Number(instr.config.minutes || 0) + Number(instr.config.hours || 0) * 60 + Number(instr.config.days || 0) * 1440;
      const resume = new Date(Date.now() + mins * 60000).toISOString().slice(0, 19).replace('T', ' ');
      insert('automation_waits', {
        automation_id: automation.id, execution_id: execId, entity: entityKey, entity_id: recordId,
        step_index: pc + 1, resume_at: resume, kind: 'delay', ctx: JSON.stringify({ depth }),
      });
      logLine(`Waiting ${mins} minute(s) until ${resume}`);
      return { status: 'waiting' };
    }
    if (instr.op === 'wait') {
      const hours = Number(instr.config.timeout_hours || 24);
      const resume = new Date(Date.now() + 60000).toISOString().slice(0, 19).replace('T', ' ');
      insert('automation_waits', {
        automation_id: automation.id, execution_id: execId, entity: entityKey, entity_id: recordId,
        step_index: pc + 1, resume_at: resume, kind: 'condition',
        wait_condition: JSON.stringify(instr.config.conditions || {}),
        expires_at: new Date(Date.now() + hours * 3600000).toISOString().slice(0, 19).replace('T', ' '),
        ctx: JSON.stringify({ depth }),
      });
      logLine(`Waiting for condition (timeout ${hours}h)`);
      return { status: 'waiting' };
    }
    await runAction(instr, state, logLine);
    pc++;
  }
  return { status: 'success' };
}

async function startExecution(automation, entityKey, record, depth, { isTest = false } = {}) {
  const execId = insert('automation_executions', {
    automation_id: automation.id, entity: entityKey, entity_id: record.id,
    status: isTest || automation.test_mode ? 'test' : 'running',
  });
  const logLines = [`Triggered on ${entityKey} #${record.id}`];
  try {
    const res = await runProgram(automation, execId, entityKey, record.id, 0, depth, logLines);
    update('automation_executions', execId, {
      status: res.status === 'waiting' ? 'waiting' : (automation.test_mode || isTest ? 'test' : 'success'),
      log: JSON.stringify(logLines),
      finished_at: res.status === 'waiting' ? null : nowIso(),
    });
    run('UPDATE automations SET exec_count = exec_count + 1, last_run_at=?, last_error=NULL WHERE id=?', nowIso(), automation.id);
  } catch (err) {
    logLines.push(`ERROR: ${err.message}`);
    update('automation_executions', execId, {
      status: 'failed', error: String(err.message || err), log: JSON.stringify(logLines), finished_at: nowIso(),
    });
    run('UPDATE automations SET last_error=?, last_run_at=? WHERE id=?', String(err.message || err), nowIso(), automation.id);
  }
  return execId;
}

function triggerMatches(automation, eventName, payload) {
  const t = json(automation.trigger_config, {});
  const [entityKey, action] = eventName.split('.');
  if (t.entity && t.entity !== entityKey) return false;
  if (t.event === 'created') return action === 'created';
  if (t.event === 'updated') return action === 'updated';
  if (t.event === 'field_updated') {
    if (action !== 'updated') return false;
    if (!t.field) return false;
    return Object.prototype.hasOwnProperty.call(payload.changes || {}, t.field);
  }
  return false;
}

export function initAutomations() {
  onEvent((name, payload) => {
    if (!payload.entity || !payload.record) return;
    const automations = all('SELECT * FROM automations WHERE enabled=1');
    for (const a of automations) {
      if (!triggerMatches(a, name, payload)) continue;
      if (!evalRules(json(a.conditions, {}), payload.record, payload.before)) continue;
      enqueue('automation.run', {
        automationId: a.id, entity: payload.entity, id: payload.id, depth: (payload.depth ?? 0) + 1,
      });
    }
  });

  registerJob('automation.run', async ({ automationId, entity, id, depth }) => {
    const a = get('SELECT * FROM automations WHERE id=?', automationId);
    if (!a || !a.enabled) return;
    const record = loadRecord(entity, id);
    if (!record) return;
    await startExecution(a, entity, record, depth ?? 1);
  });

  registerJob('automation.resume', async ({ waitId }) => {
    const w = get('SELECT * FROM automation_waits WHERE id=?', waitId);
    if (!w || w.status !== 'pending') return;
    const a = get('SELECT * FROM automations WHERE id=?', w.automation_id);
    if (!a || !a.enabled) { update('automation_waits', waitId, { status: 'canceled' }); return; }
    update('automation_waits', waitId, { status: 'resumed' });
    const logLines = [`Resumed at step ${w.step_index}`];
    const depth = json(w.ctx, {}).depth ?? 1;
    try {
      const res = await runProgram(a, w.execution_id, w.entity, w.entity_id, w.step_index, depth, logLines);
      const prev = json(get('SELECT log FROM automation_executions WHERE id=?', w.execution_id)?.log, []);
      update('automation_executions', w.execution_id, {
        status: res.status === 'waiting' ? 'waiting' : 'success',
        log: JSON.stringify([...prev, ...logLines]),
        finished_at: res.status === 'waiting' ? null : nowIso(),
      });
    } catch (err) {
      update('automation_executions', w.execution_id, { status: 'failed', error: String(err.message), finished_at: nowIso() });
    }
  });
}

/** Called on every worker cycle: resume delays, evaluate waits, fire date triggers. */
export async function automationTick() {
  const dueDelays = all("SELECT * FROM automation_waits WHERE status='pending' AND kind='delay' AND resume_at <= datetime('now')");
  for (const w of dueDelays) enqueue('automation.resume', { waitId: w.id });

  const waits = all("SELECT * FROM automation_waits WHERE status='pending' AND kind='condition'");
  for (const w of waits) {
    const record = loadRecord(w.entity, w.entity_id);
    if (!record) { update('automation_waits', w.id, { status: 'canceled' }); continue; }
    if (evalRules(json(w.wait_condition, {}), record)) {
      enqueue('automation.resume', { waitId: w.id });
    } else if (w.expires_at && w.expires_at <= nowIso()) {
      update('automation_waits', w.id, { status: 'expired' });
      const prev = json(get('SELECT log FROM automation_executions WHERE id=?', w.execution_id)?.log, []);
      update('automation_executions', w.execution_id, {
        status: 'success', finished_at: nowIso(),
        log: JSON.stringify([...prev, 'Wait timed out — automation stopped']),
      });
    }
  }

  // date-based triggers, evaluated once per day per record
  const dateAutomations = all("SELECT * FROM automations WHERE enabled=1").filter((a) => json(a.trigger_config, {}).event === 'date');
  for (const a of dateAutomations) {
    const t = json(a.trigger_config, {});
    if (!t.entity || !t.date_field) continue;
    const table = { deal: 'deals', lead: 'leads', activity: 'activities', project: 'projects' }[t.entity];
    if (!table) continue;
    const offset = Number(t.offset_days || 0);
    const target = new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);
    const rows = all(`SELECT * FROM ${table} WHERE ${t.date_field} = ?`, target);
    for (const row of rows) {
      const already = get(
        "SELECT id FROM automation_executions WHERE automation_id=? AND entity=? AND entity_id=? AND date(started_at)=date('now')",
        a.id, t.entity, row.id,
      );
      if (already) continue;
      if (!evalRules(json(a.conditions, {}), row)) continue;
      enqueue('automation.run', { automationId: a.id, entity: t.entity, id: row.id, depth: 1 });
    }
  }
}

/** Dry run used by the "Test" button in the automation editor. */
export async function testAutomation(automationId, entityKey, recordId) {
  const a = get('SELECT * FROM automations WHERE id=?', automationId);
  if (!a) throw new Error('Automation not found');
  const record = loadRecord(entityKey, recordId);
  if (!record) throw new Error('Test record not found');
  const conditionsPass = evalRules(json(a.conditions, {}), record);
  const execId = await startExecution({ ...a, test_mode: 1 }, entityKey, record, 1, { isTest: true });
  return {
    conditions_pass: conditionsPass,
    execution: get('SELECT * FROM automation_executions WHERE id=?', execId),
  };
}
