import { get, all, insert, update, run, tx, nowIso, json } from './db.mjs';
import { entity, fieldDef } from './registry.mjs';
import { assertCan } from './rbac.mjs';
import { assertSeeRecord, canSeePipeline } from './rbac.mjs';
import { badRequest, notFound, forbidden } from './http.mjs';
import { validateCustomValues, applyFormulas, customFieldsFor } from './customfields.mjs';
import { audit, diff } from './audit.mjs';
import { emit } from './events.mjs';
import { scoreDeal, scoreLead } from './scoring.mjs';

/** A context object for engine-driven writes (automations, imports, jobs). */
export function systemContext(name = 'automation') {
  const admin = get('SELECT * FROM users WHERE is_admin=1 ORDER BY id LIMIT 1');
  return {
    user: admin || { id: null, name, is_admin: 1 },
    isAdmin: true,
    permissions: new Set(),
    modules: new Set(),
    groups: [], reachableGroups: [], visibleUserIds: [],
    visiblePipelines: all('SELECT id FROM pipelines').map((p) => p.id),
    system: name,
  };
}

function splitPayload(entityKey, data, opts = {}) {
  const e = entity(entityKey);
  const core = {};
  const cf = { ...(data.cf || {}) };
  const known = new Set(e.fields.map((f) => f.key));
  const cfKeys = new Set(customFieldsFor(entityKey).map((f) => f.key));
  for (const [k, v] of Object.entries(data)) {
    if (k === 'cf' || k === 'id') continue;
    if (known.has(k)) {
      const def = fieldDef(entityKey, k);
      if (def.editable === false && !opts.allowSystemFields) continue;
      core[k] = v;
    } else if (cfKeys.has(k)) {
      cf[k] = v;
    } else if (!opts.ignoreUnknown && !['products', 'tasks'].includes(k)) {
      throw badRequest(`Unknown field "${k}" for ${entityKey}`);
    }
  }
  return { core, cf };
}

function serialiseCore(entityKey, core) {
  const out = { ...core };
  for (const [k, v] of Object.entries(out)) {
    const def = fieldDef(entityKey, k);
    if (!def) continue;
    if (['labels', 'emails', 'phones'].includes(def.type) || Array.isArray(v)) out[k] = JSON.stringify(v ?? []);
    if (def.type === 'boolean') out[k] = v ? 1 : 0;
    if (v === '') out[k] = null;
  }
  // Drop explicit nulls: SQL column DEFAULTs (e.g. deals.value NOT NULL DEFAULT 0) apply only when the key is absent.
  for (const [k, v] of Object.entries(out)) {
    if (v === null || v === undefined) delete out[k];
  }
  return out;
}

function requireCore(entityKey, core, existing = null) {
  const e = entity(entityKey);
  for (const f of e.fields) {
    if (!f.required) continue;
    const val = core[f.key] !== undefined ? core[f.key] : existing?.[f.key];
    if (val === undefined || val === null || String(val).trim() === '') {
      throw badRequest(`${f.label} is required`, [{ field: f.key, message: `${f.label} is required` }]);
    }
  }
}

function dealStageCoherence(core, existing) {
  if (core.stage_id !== undefined && core.stage_id !== null) {
    const stage = get('SELECT * FROM stages WHERE id=?', core.stage_id);
    if (!stage) throw badRequest('Stage does not exist');
    core.pipeline_id = stage.pipeline_id;
    if (!existing || existing.stage_id !== stage.id) {
      core.stage_changed_at = nowIso();
      const pipeline = get('SELECT * FROM pipelines WHERE id=?', stage.pipeline_id);
      if (pipeline?.probability_enabled && core.probability === undefined) core.probability = stage.probability;
    }
  } else if (core.pipeline_id !== undefined && (!existing || existing.pipeline_id !== core.pipeline_id)) {
    const first = get('SELECT * FROM stages WHERE pipeline_id=? ORDER BY order_idx LIMIT 1', core.pipeline_id);
    if (!first) throw badRequest('Pipeline has no stages');
    core.stage_id = first.id;
    core.stage_changed_at = nowIso();
  }
}

export function getRecord(entityKey, ctx, id, { includeDeleted = false } = {}) {
  const e = entity(entityKey);
  const row = get(`SELECT * FROM ${e.table} WHERE id=?`, id);
  if (!row) throw notFound(`${e.label} ${id} not found`);
  if (e.softDelete && row[e.softDelete] && !includeDeleted) throw notFound(`${e.label} ${id} was deleted`);
  if (e.hasVisibility) assertSeeRecord(ctx, row);
  if (entityKey === 'deal' && !canSeePipeline(ctx, row.pipeline_id)) throw forbidden('Pipeline not visible to you');
  return row;
}

export function createRecord(entityKey, ctx, data, opts = {}) {
  const e = entity(entityKey);
  if (!opts.skipPerms) assertCan(ctx, e.perms.create);
  const { core, cf } = splitPayload(entityKey, data, opts);

  if (entityKey === 'deal') {
    if (core.pipeline_id === undefined && core.stage_id === undefined) {
      const p = get('SELECT id FROM pipelines WHERE active=1 ORDER BY order_idx LIMIT 1');
      if (!p) throw badRequest('No active pipeline configured');
      core.pipeline_id = p.id;
    }
    dealStageCoherence(core, null);
    if (!canSeePipeline(ctx, core.pipeline_id)) throw forbidden('Pipeline not visible to you');
  }
  if (entityKey === 'project' && core.board_id === undefined) {
    const b = get('SELECT id FROM project_boards ORDER BY order_idx LIMIT 1');
    if (b) core.board_id = b.id;
  }
  const ownerField = e.ownerField || (e.fields.some((f) => f.key === 'owner_id') ? 'owner_id' : null);
  if (ownerField && (core[ownerField] === undefined || core[ownerField] === null)) core[ownerField] = ctx.user.id;
  if (e.hasVisibility && core.visible_to === undefined) core.visible_to = 3;
  if (entityKey === 'activity' && core.created_by === undefined) core.created_by = ctx.user.id;

  requireCore(entityKey, core);
  const validatedCf = validateCustomValues(entityKey, cf, {}, { pipelineId: core.pipeline_id, boardId: core.board_id });

  const row = tx(() => {
    const payload = serialiseCore(entityKey, core);
    payload.cf = JSON.stringify(applyFormulas(entityKey, { ...core, cf: validatedCf }));
    const id = insert(e.table, payload);
    const created = get(`SELECT * FROM ${e.table} WHERE id=?`, id);
    if (entityKey === 'deal') refreshScore('deal', id);
    if (entityKey === 'lead') refreshScore('lead', id);
    audit({ ctx, entity: entityKey, entityId: id, action: 'created', changes: diff({}, created), source: opts.source || 'app' });
    return get(`SELECT * FROM ${e.table} WHERE id=?`, id);
  });

  emit(`${entityKey}.created`, {
    entity: entityKey, id: row.id, record: row, before: null,
    changes: {}, actor: ctx.user, depth: opts.depth ?? 0, source: opts.source || 'app',
  });
  return row;
}

export function updateRecord(entityKey, ctx, id, data, opts = {}) {
  const e = entity(entityKey);
  if (!opts.skipPerms) assertCan(ctx, e.perms.edit);
  const before = getRecord(entityKey, ctx, id);
  const { core, cf } = splitPayload(entityKey, data, opts);

  if (entityKey === 'deal') {
    dealStageCoherence(core, before);
    if (core.pipeline_id !== undefined && !canSeePipeline(ctx, core.pipeline_id)) throw forbidden('Pipeline not visible to you');
    if (core.status !== undefined) applyDealStatus(core, before);
  }
  if (entityKey === 'activity' && core.done !== undefined) {
    core.done = core.done ? 1 : 0;
    core.done_time = core.done ? nowIso() : null;
  }
  if (entityKey === 'project' && core.status !== undefined && core.status !== before.status) {
    // completion timestamp lives in updated_at + audit trail
  }

  requireCore(entityKey, core, before);
  const existingCf = json(before.cf, {});
  const validatedCf = validateCustomValues(entityKey, cf, existingCf, {
    partial: true,
    pipelineId: core.pipeline_id ?? before.pipeline_id,
    boardId: core.board_id ?? before.board_id,
    allowReadOnly: opts.allowReadOnly,
  });

  const after = tx(() => {
    const payload = serialiseCore(entityKey, core);
    payload.updated_at = nowIso();
    payload.cf = JSON.stringify(applyFormulas(entityKey, { ...before, ...core, cf: validatedCf }));
    update(e.table, id, payload);
    if (entityKey === 'deal' || entityKey === 'lead') refreshScore(entityKey, id);
    const row = get(`SELECT * FROM ${e.table} WHERE id=?`, id);
    const changes = diff(before, row);
    if (Object.keys(changes).length) {
      audit({ ctx, entity: entityKey, entityId: id, action: 'updated', changes, source: opts.source || 'app' });
    }
    return row;
  });

  const changes = diff(before, after);
  if (Object.keys(changes).length) {
    emit(`${entityKey}.updated`, {
      entity: entityKey, id, record: after, before, changes,
      actor: ctx.user, depth: opts.depth ?? 0, source: opts.source || 'app',
    });
    if (entityKey === 'deal' && changes.stage_id) {
      emit('deal.stage_changed', { entity: 'deal', id, record: after, before, changes, actor: ctx.user, depth: opts.depth ?? 0 });
    }
    if (entityKey === 'deal' && changes.status) {
      emit(`deal.${after.status}`, { entity: 'deal', id, record: after, before, changes, actor: ctx.user, depth: opts.depth ?? 0 });
    }
    if (entityKey === 'activity' && changes.done && after.done) {
      emit('activity.completed', { entity: 'activity', id, record: after, before, changes, actor: ctx.user, depth: opts.depth ?? 0 });
    }
  }
  return after;
}

function applyDealStatus(core, before) {
  if (core.status === 'won') {
    core.won_time = nowIso();
    core.close_time = nowIso();
    core.lost_time = null;
    core.probability = 100;
  } else if (core.status === 'lost') {
    core.lost_time = nowIso();
    core.close_time = nowIso();
    core.won_time = null;
    core.probability = 0;
  } else if (core.status === 'open' && before.status !== 'open') {
    core.won_time = null; core.lost_time = null; core.close_time = null;
    core.lost_reason_id = null;
  }
}

export function deleteRecord(entityKey, ctx, id, opts = {}) {
  const e = entity(entityKey);
  if (!opts.skipPerms) assertCan(ctx, e.perms.delete);
  const before = getRecord(entityKey, ctx, id);
  tx(() => {
    if (e.softDelete) update(e.table, id, { [e.softDelete]: 1, updated_at: nowIso() });
    else run(`DELETE FROM ${e.table} WHERE id=?`, id);
    audit({ ctx, entity: entityKey, entityId: id, action: 'deleted', changes: {}, source: opts.source || 'app' });
  });
  emit(`${entityKey}.deleted`, { entity: entityKey, id, record: before, before, changes: {}, actor: ctx.user, depth: opts.depth ?? 0 });
  return { id, deleted: true };
}

export function restoreRecord(entityKey, ctx, id) {
  const e = entity(entityKey);
  assertCan(ctx, e.perms.delete);
  update(e.table, id, { [e.softDelete]: 0, updated_at: nowIso() });
  audit({ ctx, entity: entityKey, entityId: id, action: 'restored' });
  return get(`SELECT * FROM ${e.table} WHERE id=?`, id);
}

export function setArchived(entityKey, ctx, id, archived) {
  const e = entity(entityKey);
  if (!e.archiveField) throw badRequest(`${e.label} cannot be archived`);
  assertCan(ctx, e.perms.edit);
  getRecord(entityKey, ctx, id);
  update(e.table, id, { [e.archiveField]: archived ? 1 : 0, updated_at: nowIso() });
  audit({ ctx, entity: entityKey, entityId: id, action: archived ? 'archived' : 'unarchived' });
  return get(`SELECT * FROM ${e.table} WHERE id=?`, id);
}

export function refreshScore(entityKey, id) {
  const table = entityKey === 'deal' ? 'deals' : 'leads';
  const row = get(`SELECT * FROM ${table} WHERE id=?`, id);
  if (!row) return;
  const score = entityKey === 'deal' ? scoreDeal(row) : scoreLead(row);
  run(`UPDATE ${table} SET score=? WHERE id=?`, score, id);
}

/** Followers, notes and files are shared sub-resources across entities. */
export function addFollower(entityKey, id, userId) {
  run('INSERT OR IGNORE INTO followers (entity, entity_id, user_id) VALUES (?,?,?)', entityKey, id, userId);
  return listFollowers(entityKey, id);
}
export function removeFollower(entityKey, id, userId) {
  run('DELETE FROM followers WHERE entity=? AND entity_id=? AND user_id=?', entityKey, id, userId);
  return listFollowers(entityKey, id);
}
export function listFollowers(entityKey, id) {
  return all(
    `SELECT u.id, u.name, u.email FROM followers f JOIN users u ON u.id=f.user_id
     WHERE f.entity=? AND f.entity_id=?`, entityKey, id,
  );
}
