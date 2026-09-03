import { all, get, insert, update, json, nowIso } from '../db.mjs';
import { badRequest } from '../http.mjs';
import { composeEmail, renderMerge, mergeContext } from './mailer.mjs';
import { createRecord, systemContext } from '../records.mjs';

export const STEP_TYPES = [
  { key: 'manual_email', label: 'Manual email (drafted for the owner to review)' },
  { key: 'automated_email', label: 'Automated email' },
  { key: 'activity', label: 'Create an activity' },
];

function ownerOf(entity, row) {
  return row.owner_id || null;
}
function loadTarget(entity, id) {
  const table = { lead: 'leads', deal: 'deals', person: 'persons' }[entity];
  if (!table) throw badRequest(`Sequences do not support ${entity}`);
  return get(`SELECT * FROM ${table} WHERE id=? AND deleted=0`, id);
}

export function enrollInSequence(sequenceId, entity, entityId, userId) {
  const seq = get('SELECT * FROM sequences WHERE id=?', sequenceId);
  if (!seq) throw badRequest('Sequence not found');
  if (seq.entity !== entity) throw badRequest(`Sequence "${seq.name}" targets ${seq.entity}, not ${entity}`);
  const existing = get(
    "SELECT * FROM sequence_enrollments WHERE sequence_id=? AND entity=? AND entity_id=? AND status='active'",
    sequenceId, entity, entityId,
  );
  if (existing) return existing; // idempotent
  const steps = json(seq.steps, []);
  const first = steps[0];
  const delay = Number(first?.delay_days || 0);
  const next = new Date(Date.now() + delay * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  const id = insert('sequence_enrollments', {
    sequence_id: sequenceId, entity, entity_id: entityId, step_idx: 0,
    status: steps.length ? 'active' : 'completed', next_run_at: next, enrolled_by: userId,
  });
  return get('SELECT * FROM sequence_enrollments WHERE id=?', id);
}

export function setEnrollmentStatus(id, status) {
  update('sequence_enrollments', id, { status });
  return get('SELECT * FROM sequence_enrollments WHERE id=?', id);
}

function runStep(enrollment, seq, step) {
  const target = loadTarget(enrollment.entity, enrollment.entity_id);
  if (!target) return { log: 'Target record missing — enrollment stopped', stop: true };
  const ownerId = ownerOf(enrollment.entity, target);
  const sysUser = get('SELECT * FROM users WHERE id=?', ownerId) || systemContext('sequence').user;
  const ctx = { user: sysUser, isAdmin: true, permissions: new Set(), visiblePipelines: [] };

  const personId = enrollment.entity === 'person' ? target.id : target.person_id;
  const person = personId ? get('SELECT * FROM persons WHERE id=?', personId) : null;
  const email = json(person?.emails, [])[0]?.value;
  const mctx = mergeContext({
    dealId: enrollment.entity === 'deal' ? target.id : null,
    leadId: enrollment.entity === 'lead' ? target.id : null,
    personId, user: sysUser,
  });

  if (step.type === 'manual_email' || step.type === 'automated_email') {
    if (!email) return { log: 'No email address on the linked person — step skipped' };
    let subject = step.subject || '';
    let body = step.body || '';
    if (step.template_id) {
      const t = get('SELECT * FROM email_templates WHERE id=?', step.template_id);
      if (t) { subject = t.subject; body = t.body; }
    }
    const mail = composeEmail(ctx, {
      to: [email],
      subject: renderMerge(subject, mctx),
      body: renderMerge(body, mctx),
      dealId: enrollment.entity === 'deal' ? target.id : null,
      leadId: enrollment.entity === 'lead' ? target.id : null,
      personId,
      status: step.type === 'manual_email' ? 'draft' : 'sent',
    });
    if (step.type === 'manual_email') {
      createRecord('activity', { ...ctx, user: sysUser }, {
        subject: `Review and send: ${mail.subject}`,
        type_key: 'email',
        assignee_id: ownerId,
        due_date: new Date().toISOString().slice(0, 10),
        [enrollment.entity === 'deal' ? 'deal_id' : enrollment.entity === 'lead' ? 'lead_id' : 'person_id']: target.id,
      }, { skipPerms: true, source: 'sequence' });
      return { log: `Draft email #${mail.id} prepared for review` };
    }
    return { log: `Automated email #${mail.id} queued to ${email}` };
  }

  if (step.type === 'activity') {
    const a = createRecord('activity', { ...ctx, user: sysUser }, {
      subject: renderMerge(step.subject || 'Sequence step', mctx),
      type_key: step.activity_type || 'call',
      assignee_id: ownerId,
      due_date: new Date(Date.now() + Number(step.due_in_days || 0) * 864e5).toISOString().slice(0, 10),
      [enrollment.entity === 'deal' ? 'deal_id' : enrollment.entity === 'lead' ? 'lead_id' : 'person_id']: target.id,
    }, { skipPerms: true, source: 'sequence' });
    return { log: `Created activity #${a.id}` };
  }
  return { log: `Unknown step type "${step.type}" — skipped` };
}

export function sequenceTick() {
  const due = all(
    "SELECT * FROM sequence_enrollments WHERE status='active' AND next_run_at <= datetime('now') LIMIT 50",
  );
  for (const en of due) {
    const seq = get('SELECT * FROM sequences WHERE id=?', en.sequence_id);
    if (!seq || !seq.active) { update('sequence_enrollments', en.id, { status: 'paused' }); continue; }
    const steps = json(seq.steps, []);
    const step = steps[en.step_idx];
    const log = json(en.log, []);
    if (!step) {
      update('sequence_enrollments', en.id, { status: 'completed', next_run_at: null, log: JSON.stringify([...log, `${nowIso()} completed`]) });
      continue;
    }
    let result;
    try {
      result = runStep(en, seq, step);
    } catch (err) {
      result = { log: `Step failed: ${err.message}` };
    }
    log.push(`${nowIso()} step ${en.step_idx + 1}: ${result.log}`);
    const nextIdx = en.step_idx + 1;
    const nextStep = steps[nextIdx];
    if (result.stop || !nextStep) {
      update('sequence_enrollments', en.id, {
        status: result.stop ? 'stopped' : 'completed', step_idx: nextIdx,
        next_run_at: null, log: JSON.stringify(log),
      });
    } else {
      const next = new Date(Date.now() + Number(nextStep.delay_days || 1) * 864e5).toISOString().slice(0, 19).replace('T', ' ');
      update('sequence_enrollments', en.id, { step_idx: nextIdx, next_run_at: next, log: JSON.stringify(log) });
    }
  }
}

export function enrollmentsFor(entity, entityId) {
  return all(
    `SELECT se.*, s.name AS sequence_name FROM sequence_enrollments se
     JOIN sequences s ON s.id = se.sequence_id
     WHERE se.entity=? AND se.entity_id=? ORDER BY se.id DESC`, entity, entityId,
  ).map((r) => ({ ...r, log: json(r.log, []) }));
}
