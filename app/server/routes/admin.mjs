import { all, get, insert, update, run, json, tx, nowIso, setting, setSetting } from '../db.mjs';
import { hashPassword, issueApiToken, assertPasswordPolicy } from '../auth.mjs';
import { MODULES, PERMISSIONS, VISIBILITY_LABELS, assertCan, buildContext } from '../rbac.mjs';
import { badRequest, notFound, toInt, toBool, readBody } from '../http.mjs';
import { CF_TYPES, invalidateCustomFields, slugifyKey, allCustomFields } from '../customfields.mjs';
import { audit } from '../audit.mjs';
import {
  analyseFile, runImport, listImports, importJob, revertImport,
  findDuplicates, mergeRecords, IMPORT_ENTITIES, DUPLICATE_STRATEGIES, suggestMapping,
} from '../engines/importer.mjs';
import { aiImportMapping, publicAiConfig, saveAiConfig, AI_FEATURES } from '../engines/ai.mjs';
import { scoringConfig, DEFAULT_SCORING } from '../scoring.mjs';
import { availableAdapters } from '../engines/mailer.mjs';

const uploads = new Map(); // in-memory staging for import previews

export function registerAdminRoutes(router) {
  const adminOnly = (ctx, perm = 'admin.settings') => assertCan(ctx, perm);

  // ---------- users & teams ----------
  router.get('/api/admin/users', async (req, res, { ctx }) => {
    adminOnly(ctx, 'admin.users');
    return all('SELECT id,name,email,is_admin,active,team_id,timezone,totp_enabled,last_login_at,created_at FROM users ORDER BY name')
      .map((u) => ({
        ...u,
        permission_sets: all('SELECT ps.id, ps.name FROM user_permission_sets ups JOIN permission_sets ps ON ps.id=ups.permission_set_id WHERE ups.user_id=?', u.id),
        visibility_groups: all('SELECT g.id, g.name FROM user_visibility_groups uvg JOIN visibility_groups g ON g.id=uvg.group_id WHERE uvg.user_id=?', u.id),
      }));
  });

  router.post('/api/admin/users', async (req, res, { ctx, body }) => {
    adminOnly(ctx, 'admin.users');
    if (!body.email || !body.name) throw badRequest('Name and email are required');
    if (get('SELECT id FROM users WHERE lower(email)=lower(?)', body.email)) throw badRequest('That email is already in use');
    assertPasswordPolicy(body.password);
    const id = tx(() => {
      const uid = insert('users', {
        name: body.name, email: body.email, password_hash: hashPassword(body.password),
        is_admin: body.is_admin ? 1 : 0, team_id: body.team_id || null, timezone: body.timezone || 'UTC',
      });
      for (const psId of body.permission_sets || []) insert('user_permission_sets', { user_id: uid, permission_set_id: psId });
      for (const gid of body.visibility_groups || []) insert('user_visibility_groups', { user_id: uid, group_id: gid });
      return uid;
    });
    audit({ ctx, entity: 'user', entityId: id, action: 'created', changes: { email: body.email } });
    return get('SELECT id,name,email,is_admin,active FROM users WHERE id=?', id);
  });

  router.patch('/api/admin/users/:id', async (req, res, { ctx, params, body }) => {
    adminOnly(ctx, 'admin.users');
    const uid = Number(params.id);
    const user = get('SELECT * FROM users WHERE id=?', uid);
    if (!user) throw notFound('User not found');
    tx(() => {
      update('users', uid, {
        name: body.name, email: body.email, team_id: body.team_id,
        is_admin: body.is_admin === undefined ? undefined : (body.is_admin ? 1 : 0),
        active: body.active === undefined ? undefined : (body.active ? 1 : 0),
        timezone: body.timezone,
        password_hash: body.password ? (assertPasswordPolicy(body.password), hashPassword(body.password)) : undefined,
      });
      if (body.permission_sets) {
        run('DELETE FROM user_permission_sets WHERE user_id=?', uid);
        for (const psId of body.permission_sets) insert('user_permission_sets', { user_id: uid, permission_set_id: psId });
      }
      if (body.visibility_groups) {
        run('DELETE FROM user_visibility_groups WHERE user_id=?', uid);
        for (const gid of body.visibility_groups) insert('user_visibility_groups', { user_id: uid, group_id: gid });
      }
      if (body.active === false) run('UPDATE sessions SET revoked_at=? WHERE user_id=?', nowIso(), uid);
    });
    audit({ ctx, entity: 'user', entityId: uid, action: 'updated', changes: { ...body, password: undefined } });
    return get('SELECT id,name,email,is_admin,active,team_id FROM users WHERE id=?', uid);
  });

  router.get('/api/admin/teams', async () => all('SELECT * FROM teams ORDER BY name'));
  router.post('/api/admin/teams', async (req, res, { ctx, body }) => {
    adminOnly(ctx, 'admin.users');
    const id = insert('teams', { name: body.name, manager_id: body.manager_id || null });
    return get('SELECT * FROM teams WHERE id=?', id);
  });
  router.patch('/api/admin/teams/:id', async (req, res, { ctx, params, body }) => {
    adminOnly(ctx, 'admin.users');
    update('teams', params.id, { name: body.name, manager_id: body.manager_id });
    return get('SELECT * FROM teams WHERE id=?', params.id);
  });

  // ---------- permission sets & visibility ----------
  router.get('/api/admin/permission-sets', async (req, res, { ctx }) => {
    adminOnly(ctx, 'admin.users');
    return {
      catalogue: { modules: MODULES, permissions: PERMISSIONS },
      sets: all('SELECT * FROM permission_sets ORDER BY id').map((s) => ({
        ...s,
        permissions: json(s.permissions, {}),
        user_count: get('SELECT COUNT(*) n FROM user_permission_sets WHERE permission_set_id=?', s.id).n,
      })),
    };
  });
  router.post('/api/admin/permission-sets', async (req, res, { ctx, body }) => {
    adminOnly(ctx, 'admin.users');
    const id = insert('permission_sets', {
      name: body.name, description: body.description || '',
      permissions: JSON.stringify(body.permissions || {}),
    });
    return get('SELECT * FROM permission_sets WHERE id=?', id);
  });
  router.patch('/api/admin/permission-sets/:id', async (req, res, { ctx, params, body }) => {
    adminOnly(ctx, 'admin.users');
    update('permission_sets', params.id, {
      name: body.name, description: body.description,
      permissions: body.permissions ? JSON.stringify(body.permissions) : undefined,
    });
    audit({ ctx, entity: 'permission_set', entityId: Number(params.id), action: 'updated' });
    return get('SELECT * FROM permission_sets WHERE id=?', params.id);
  });
  router.delete('/api/admin/permission-sets/:id', async (req, res, { ctx, params }) => {
    adminOnly(ctx, 'admin.users');
    const s = get('SELECT * FROM permission_sets WHERE id=?', params.id);
    if (s?.is_system) throw badRequest('System permission sets cannot be deleted');
    run('DELETE FROM permission_sets WHERE id=?', params.id);
    return { ok: true };
  });

  router.get('/api/admin/visibility-groups', async (req, res, { ctx }) => {
    adminOnly(ctx, 'admin.users');
    return all('SELECT * FROM visibility_groups ORDER BY name').map((g) => ({
      ...g,
      users: all('SELECT u.id,u.name FROM user_visibility_groups uvg JOIN users u ON u.id=uvg.user_id WHERE uvg.group_id=?', g.id),
    }));
  });
  router.post('/api/admin/visibility-groups', async (req, res, { ctx, body }) => {
    adminOnly(ctx, 'admin.users');
    const id = insert('visibility_groups', { name: body.name, parent_id: body.parent_id || null, description: body.description || '' });
    return get('SELECT * FROM visibility_groups WHERE id=?', id);
  });
  router.patch('/api/admin/visibility-groups/:id', async (req, res, { ctx, params, body }) => {
    adminOnly(ctx, 'admin.users');
    if (Number(body.parent_id) === Number(params.id)) throw badRequest('A group cannot be its own parent');
    update('visibility_groups', params.id, { name: body.name, parent_id: body.parent_id, description: body.description });
    return get('SELECT * FROM visibility_groups WHERE id=?', params.id);
  });
  router.delete('/api/admin/visibility-groups/:id', async (req, res, { ctx, params }) => {
    adminOnly(ctx, 'admin.users');
    run('DELETE FROM visibility_groups WHERE id=?', params.id);
    return { ok: true };
  });

  // ---------- pipelines & stages ----------
  router.get('/api/pipelines', async (req, res, { ctx }) => {
    const rows = all('SELECT * FROM pipelines ORDER BY order_idx, id')
      .filter((p) => ctx.isAdmin || ctx.visiblePipelines.includes(p.id));
    return rows.map((p) => ({
      ...p,
      stages: all('SELECT * FROM stages WHERE pipeline_id=? ORDER BY order_idx', p.id),
      visibility_groups: all('SELECT group_id FROM pipeline_visibility WHERE pipeline_id=?', p.id).map((r) => r.group_id),
      deal_count: get("SELECT COUNT(*) n FROM deals WHERE pipeline_id=? AND deleted=0 AND status='open'", p.id).n,
    }));
  });
  router.post('/api/pipelines', async (req, res, { ctx, body }) => {
    adminOnly(ctx, 'admin.pipelines');
    const order = get('SELECT COALESCE(MAX(order_idx),0) m FROM pipelines').m + 1;
    const id = tx(() => {
      const pid = insert('pipelines', {
        name: body.name, order_idx: order,
        probability_enabled: body.probability_enabled === false ? 0 : 1,
      });
      const stages = body.stages?.length ? body.stages : [
        { name: 'Qualified', probability: 20 }, { name: 'Contact Made', probability: 40 },
        { name: 'Proposal Sent', probability: 60 }, { name: 'Negotiation', probability: 80 },
      ];
      stages.forEach((s, i) => insert('stages', {
        pipeline_id: pid, name: s.name, order_idx: i,
        probability: s.probability ?? 100, rotten_days: s.rotten_days ?? null,
      }));
      return pid;
    });
    audit({ ctx, entity: 'pipeline', entityId: id, action: 'created', changes: { name: body.name } });
    return get('SELECT * FROM pipelines WHERE id=?', id);
  });
  router.patch('/api/pipelines/:id', async (req, res, { ctx, params, body }) => {
    adminOnly(ctx, 'admin.pipelines');
    update('pipelines', params.id, {
      name: body.name, order_idx: body.order_idx,
      probability_enabled: body.probability_enabled === undefined ? undefined : (body.probability_enabled ? 1 : 0),
      active: body.active === undefined ? undefined : (body.active ? 1 : 0),
    });
    if (body.visibility_groups) {
      run('DELETE FROM pipeline_visibility WHERE pipeline_id=?', params.id);
      for (const gid of body.visibility_groups) insert('pipeline_visibility', { pipeline_id: Number(params.id), group_id: gid });
    }
    audit({ ctx, entity: 'pipeline', entityId: Number(params.id), action: 'updated', changes: body });
    return get('SELECT * FROM pipelines WHERE id=?', params.id);
  });
  router.delete('/api/pipelines/:id', async (req, res, { ctx, params }) => {
    adminOnly(ctx, 'admin.pipelines');
    const n = get("SELECT COUNT(*) n FROM deals WHERE pipeline_id=? AND deleted=0", params.id).n;
    if (n) throw badRequest(`${n} deal(s) still use this pipeline — move them first`);
    run('DELETE FROM pipelines WHERE id=?', params.id);
    return { ok: true };
  });

  router.post('/api/pipelines/:id/stages', async (req, res, { ctx, params, body }) => {
    adminOnly(ctx, 'admin.pipelines');
    const order = get('SELECT COALESCE(MAX(order_idx),-1) m FROM stages WHERE pipeline_id=?', params.id).m + 1;
    const id = insert('stages', {
      pipeline_id: Number(params.id), name: body.name, order_idx: order,
      probability: body.probability ?? 100, rotten_days: body.rotten_days ?? null,
    });
    return get('SELECT * FROM stages WHERE id=?', id);
  });
  router.patch('/api/stages/:id', async (req, res, { ctx, params, body }) => {
    adminOnly(ctx, 'admin.pipelines');
    update('stages', params.id, {
      name: body.name, probability: body.probability,
      rotten_days: body.rotten_days, order_idx: body.order_idx,
    });
    return get('SELECT * FROM stages WHERE id=?', params.id);
  });
  router.post('/api/stages/reorder', async (req, res, { ctx, body }) => {
    adminOnly(ctx, 'admin.pipelines');
    tx(() => { (body.order || []).forEach((id, i) => update('stages', id, { order_idx: i })); });
    return { ok: true };
  });
  router.delete('/api/stages/:id', async (req, res, { ctx, params }) => {
    adminOnly(ctx, 'admin.pipelines');
    const n = get('SELECT COUNT(*) n FROM deals WHERE stage_id=? AND deleted=0', params.id).n;
    if (n) throw badRequest(`${n} deal(s) sit in this stage — move them first`);
    run('DELETE FROM stages WHERE id=?', params.id);
    return { ok: true };
  });

  // ---------- simple config lists ----------
  const configTable = (segment, table, fields, perm = 'admin.settings') => {
    router.get(`/api/config/${segment}`, async (req, res, { query }) => {
      if (table === 'labels' && query.entity) return all('SELECT * FROM labels WHERE entity=? ORDER BY name', query.entity);
      return all(`SELECT * FROM ${table} ORDER BY ${table === 'currencies' ? 'code' : 'id'}`);
    });
    router.post(`/api/config/${segment}`, async (req, res, { ctx, body }) => {
      adminOnly(ctx, perm);
      const data = {};
      for (const f of fields) if (body[f] !== undefined) data[f] = typeof body[f] === 'boolean' ? (body[f] ? 1 : 0) : body[f];
      const id = insert(table, data);
      audit({ ctx, entity: table, entityId: id, action: 'created', changes: data });
      return table === 'currencies'
        ? get('SELECT * FROM currencies WHERE code=?', data.code)
        : get(`SELECT * FROM ${table} WHERE id=?`, id);
    });
    router.patch(`/api/config/${segment}/:id`, async (req, res, { ctx, params, body }) => {
      adminOnly(ctx, perm);
      const data = {};
      for (const f of fields) if (body[f] !== undefined) data[f] = typeof body[f] === 'boolean' ? (body[f] ? 1 : 0) : body[f];
      update(table, params.id, data, table === 'currencies' ? 'code' : 'id');
      audit({ ctx, entity: table, entityId: table === 'currencies' ? null : Number(params.id), action: 'updated', changes: data });
      return get(`SELECT * FROM ${table} WHERE ${table === 'currencies' ? 'code' : 'id'}=?`, params.id);
    });
    router.delete(`/api/config/${segment}/:id`, async (req, res, { ctx, params }) => {
      adminOnly(ctx, perm);
      run(`DELETE FROM ${table} WHERE ${table === 'currencies' ? 'code' : 'id'}=?`, params.id);
      return { ok: true };
    });
  };
  configTable('labels', 'labels', ['entity', 'name', 'color']);
  configTable('lost-reasons', 'lost_reasons', ['name', 'active']);
  configTable('currencies', 'currencies', ['code', 'name', 'symbol', 'rate', 'is_default', 'active']);
  configTable('activity-types', 'activity_types', ['name', 'key_string', 'icon', 'order_idx', 'active']);
  configTable('taxes', 'taxes', ['name', 'percentage', 'is_default']);
  configTable('project-boards', 'project_boards', ['name', 'order_idx'], 'projects.edit');
  configTable('project-phases', 'project_phases', ['board_id', 'name', 'order_idx'], 'projects.edit');
  configTable('webhooks', 'webhook_endpoints', ['name', 'url', 'event', 'method', 'headers', 'secret', 'active'], 'admin.api');

  router.get('/api/config/webhooks/:id/deliveries', async (req, res, { ctx, params }) => {
    adminOnly(ctx, 'admin.api');
    return all('SELECT * FROM webhook_deliveries WHERE endpoint_id=? ORDER BY id DESC LIMIT 50', params.id);
  });

  // ---------- custom fields ----------
  router.get('/api/admin/fields', async (req, res, { query }) => ({
    types: CF_TYPES,
    fields: query.entity ? allCustomFields().filter((f) => f.entity === query.entity) : allCustomFields(),
  }));

  router.post('/api/admin/fields', async (req, res, { ctx, body }) => {
    adminOnly(ctx, 'admin.fields');
    if (!CF_TYPES.includes(body.type)) throw badRequest(`Unknown field type ${body.type}`);
    if (!body.name) throw badRequest('Field name is required');
    if (body.type === 'formula' && !body.formula) throw badRequest('Formula fields need a formula');
    const key = body.key || slugifyKey(body.name, body.entity);
    const id = insert('custom_fields', {
      entity: body.entity, key, name: body.name, type: body.type,
      options: JSON.stringify(body.options || []),
      required: body.required ? 1 : 0, important: body.important ? 1 : 0,
      read_only: body.type === 'formula' ? 1 : (body.read_only ? 1 : 0),
      formula: body.formula || null,
      pipeline_ids: JSON.stringify(body.pipeline_ids || []),
      board_ids: JSON.stringify(body.board_ids || []),
      editable_by: JSON.stringify(body.editable_by || []),
      group_name: body.group_name || null,
      order_idx: body.order_idx ?? get('SELECT COALESCE(MAX(order_idx),0) m FROM custom_fields WHERE entity=?', body.entity).m + 1,
      show_in_list: body.show_in_list ? 1 : 0,
      show_in_detail: body.show_in_detail === false ? 0 : 1,
      show_in_add: body.show_in_add ? 1 : 0,
    });
    invalidateCustomFields();
    audit({ ctx, entity: 'custom_field', entityId: id, action: 'created', changes: { entity: body.entity, key, type: body.type } });
    return get('SELECT * FROM custom_fields WHERE id=?', id);
  });

  router.patch('/api/admin/fields/:id', async (req, res, { ctx, params, body }) => {
    adminOnly(ctx, 'admin.fields');
    update('custom_fields', params.id, {
      name: body.name, formula: body.formula,
      options: body.options ? JSON.stringify(body.options) : undefined,
      required: body.required === undefined ? undefined : (body.required ? 1 : 0),
      important: body.important === undefined ? undefined : (body.important ? 1 : 0),
      read_only: body.read_only === undefined ? undefined : (body.read_only ? 1 : 0),
      pipeline_ids: body.pipeline_ids ? JSON.stringify(body.pipeline_ids) : undefined,
      board_ids: body.board_ids ? JSON.stringify(body.board_ids) : undefined,
      editable_by: body.editable_by ? JSON.stringify(body.editable_by) : undefined,
      group_name: body.group_name, order_idx: body.order_idx,
      show_in_list: body.show_in_list === undefined ? undefined : (body.show_in_list ? 1 : 0),
      show_in_detail: body.show_in_detail === undefined ? undefined : (body.show_in_detail ? 1 : 0),
      show_in_add: body.show_in_add === undefined ? undefined : (body.show_in_add ? 1 : 0),
      active: body.active === undefined ? undefined : (body.active ? 1 : 0),
    });
    invalidateCustomFields();
    return get('SELECT * FROM custom_fields WHERE id=?', params.id);
  });

  router.delete('/api/admin/fields/:id', async (req, res, { ctx, params }) => {
    adminOnly(ctx, 'admin.fields');
    update('custom_fields', params.id, { active: 0 });
    invalidateCustomFields();
    audit({ ctx, entity: 'custom_field', entityId: Number(params.id), action: 'deactivated' });
    return { ok: true, note: 'Field deactivated; stored values are preserved.' };
  });

  // ---------- import / export ----------
  router.post('/api/admin/import/analyse', async (req, res, { ctx, query }) => {
    assertCan(ctx, 'data.import');
    const entityKey = query.entity;
    if (!IMPORT_ENTITIES.includes(entityKey)) throw badRequest('Unsupported import entity');
    const filename = String(req.headers['x-filename'] || 'upload.csv');
    const buf = await readBody(req, 25 * 1024 * 1024);
    const analysis = analyseFile(entityKey, filename, buf);
    const token = `${ctx.user.id}:${Date.now()}`;
    uploads.set(token, { buf, filename, entityKey, at: Date.now() });
    for (const [k, v] of uploads) if (Date.now() - v.at > 30 * 60000) uploads.delete(k);
    const ai = await aiImportMapping(entityKey, analysis.headers, analysis.sample, analysis.fields, analysis.mapping);
    return { token, ...analysis, mapping: ai.mapping, mapping_source: ai.source };
  });

  router.post('/api/admin/import/run', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'data.import');
    const staged = uploads.get(body.token);
    if (!staged) throw badRequest('Upload expired — re-upload the file');
    const result = runImport(ctx, {
      entityKey: staged.entityKey, filename: staged.filename, buffer: staged.buf,
      mapping: body.mapping, duplicateStrategy: body.duplicate_strategy || 'create',
      createMissingLinks: body.create_missing_links !== false,
      dryRun: !!body.dry_run,
    });
    if (!body.dry_run) uploads.delete(body.token);
    return result;
  });

  router.get('/api/admin/imports', async (req, res, { ctx }) => {
    assertCan(ctx, 'data.import');
    return { jobs: listImports(), strategies: DUPLICATE_STRATEGIES, entities: IMPORT_ENTITIES };
  });
  router.get('/api/admin/imports/:id', async (req, res, { ctx, params }) => {
    assertCan(ctx, 'data.import');
    const job = importJob(Number(params.id));
    if (!job) throw notFound('Import not found');
    return job;
  });
  router.post('/api/admin/imports/:id/revert', async (req, res, { ctx, params }) => {
    assertCan(ctx, 'data.import');
    return revertImport(ctx, Number(params.id));
  });

  // ---------- data quality ----------
  router.get('/api/admin/duplicates', async (req, res, { ctx, query }) => {
    const entityKey = query.entity || 'person';
    const groups = findDuplicates(entityKey);
    const table = { person: 'persons', organization: 'organizations', deal: 'deals' }[entityKey];
    return groups.map((g) => ({
      ...g,
      records: all(`SELECT * FROM ${table} WHERE id IN (${g.ids.map(() => '?').join(',')})`, ...g.ids),
    }));
  });

  router.post('/api/admin/merge', async (req, res, { ctx, body }) => {
    assertCan(ctx, 'contacts.merge');
    return mergeRecords(ctx, body.entity, Number(body.winner_id), Number(body.loser_id));
  });

  // ---------- audit & security ----------
  router.get('/api/admin/audit', async (req, res, { ctx, query }) => {
    adminOnly(ctx, 'admin.security');
    const where = [];
    const params = [];
    if (query.entity) { where.push('entity = ?'); params.push(query.entity); }
    if (query.entity_id) { where.push('entity_id = ?'); params.push(Number(query.entity_id)); }
    if (query.user_id) { where.push('user_id = ?'); params.push(Number(query.user_id)); }
    if (query.action) { where.push('action = ?'); params.push(query.action); }
    if (query.from) { where.push('created_at >= ?'); params.push(query.from); }
    const sql = `SELECT * FROM audit_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
    return all(sql, ...params, toInt(query.limit, 200)).map((e) => ({ ...e, changes: json(e.changes, {}) }));
  });

  router.get('/api/admin/security', async (req, res, { ctx, query }) => {
    adminOnly(ctx, 'admin.security');
    return {
      policy: setting('security', {
        session_hours: 336, password_min_length: 8, require_2fa_for_admins: false,
        ip_allowlist: [], login_hours: null, sso: { enabled: false, provider: null, metadata_url: '' },
      }),
      events: all('SELECT * FROM security_events ORDER BY id DESC LIMIT ?', toInt(query.limit, 100)),
      active_sessions: all(
        `SELECT s.token, s.ip, s.user_agent, s.created_at, s.expires_at, u.name, u.email
         FROM sessions s JOIN users u ON u.id=s.user_id
         WHERE s.revoked_at IS NULL AND s.expires_at > datetime('now') ORDER BY s.created_at DESC LIMIT 100`,
      ).map((s) => ({ ...s, token: s.token.slice(0, 10) + '…' })),
      failed_logins_24h: get("SELECT COUNT(*) n FROM security_events WHERE kind='login_failed' AND created_at >= datetime('now','-1 day')").n,
      admins_without_2fa: all('SELECT id, name, email FROM users WHERE is_admin=1 AND totp_enabled=0'),
    };
  });

  router.put('/api/admin/security', async (req, res, { ctx, body }) => {
    adminOnly(ctx, 'admin.security');
    setSetting('security', body);
    audit({ ctx, entity: 'settings', entityId: null, action: 'security_policy_updated', changes: body });
    return setting('security');
  });

  // ---------- API tokens ----------
  router.get('/api/admin/tokens', async (req, res, { ctx }) => {
    adminOnly(ctx, 'admin.api');
    return all(
      `SELECT t.id, t.name, t.token_prefix, t.scopes, t.last_used_at, t.revoked_at, t.created_at, u.name AS user_name
       FROM api_tokens t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC`,
    );
  });
  router.post('/api/admin/tokens', async (req, res, { ctx, body }) => {
    adminOnly(ctx, 'admin.api');
    const { id, token } = issueApiToken(body.user_id || ctx.user.id, body.name || 'API token', body.scopes || 'read,write');
    audit({ ctx, entity: 'api_token', entityId: id, action: 'created', changes: { name: body.name } });
    return { id, token, note: 'Copy this token now — it is not shown again.' };
  });
  router.delete('/api/admin/tokens/:id', async (req, res, { ctx, params }) => {
    adminOnly(ctx, 'admin.api');
    run('UPDATE api_tokens SET revoked_at=? WHERE id=?', nowIso(), params.id);
    return { ok: true };
  });

  // ---------- integrations, AI, settings ----------
  router.get('/api/admin/integrations', async (req, res, { ctx }) => {
    adminOnly(ctx);
    return {
      email: { adapters: availableAdapters(), current: setting('mail', { provider: 'log' }) },
      calendar: setting('calendar', { provider: 'none', sync: 'one-way' }),
      storage: setting('storage', { provider: 'local' }),
      lead_gen: setting('lead_gen', { web_forms: true, chatbot: false, live_chat: false, prospector: false, web_visitors: false }),
    };
  });
  router.put('/api/admin/integrations/:key', async (req, res, { ctx, params, body }) => {
    adminOnly(ctx);
    setSetting(params.key, body);
    audit({ ctx, entity: 'settings', entityId: null, action: `integration_${params.key}_updated` });
    return setting(params.key);
  });

  router.get('/api/admin/ai', async (req, res, { ctx }) => {
    adminOnly(ctx);
    return { config: publicAiConfig(), features: AI_FEATURES };
  });
  router.put('/api/admin/ai', async (req, res, { ctx, body }) => {
    adminOnly(ctx);
    const patch = { ...body };
    if (patch.api_key && patch.api_key.startsWith('••')) delete patch.api_key;
    const out = saveAiConfig(patch);
    audit({ ctx, entity: 'settings', entityId: null, action: 'ai_updated', changes: { enabled: out.enabled, provider: out.provider } });
    return out;
  });

  router.get('/api/admin/scoring', async () => ({ config: scoringConfig(), defaults: DEFAULT_SCORING }));
  router.put('/api/admin/scoring', async (req, res, { ctx, body }) => {
    adminOnly(ctx);
    setSetting('deal_scoring', body);
    return scoringConfig();
  });

  router.get('/api/admin/settings', async (req, res, { ctx }) => {
    adminOnly(ctx);
    return {
      company_name: setting('company_name', 'Our Company'),
      public_base_url: setting('public_base_url', ''),
      default_currency: get('SELECT code FROM currencies WHERE is_default=1')?.code || 'USD',
      sandbox_mode: setting('sandbox_mode', false),
      visibility_labels: VISIBILITY_LABELS,
    };
  });
  router.put('/api/admin/settings', async (req, res, { ctx, body }) => {
    adminOnly(ctx);
    for (const [k, v] of Object.entries(body)) {
      if (['company_name', 'public_base_url', 'sandbox_mode'].includes(k)) setSetting(k, v);
    }
    if (body.default_currency) {
      run('UPDATE currencies SET is_default=0');
      run('UPDATE currencies SET is_default=1 WHERE code=?', body.default_currency);
    }
    audit({ ctx, entity: 'settings', entityId: null, action: 'updated', changes: body });
    return { ok: true };
  });

  // ---------- web forms ----------
  router.get('/api/admin/web-forms', async () =>
    all("SELECT * FROM web_forms WHERE target <> 'meeting' ORDER BY id DESC").map((f) => ({ ...f, fields: json(f.fields, []) })));
  router.post('/api/admin/web-forms', async (req, res, { ctx, body }) => {
    adminOnly(ctx);
    const token = Math.random().toString(36).slice(2, 14);
    const id = insert('web_forms', {
      name: body.name, target: body.target || 'lead',
      fields: JSON.stringify(body.fields || [{ key: 'name', label: 'Name', required: true }, { key: 'email', label: 'Email', required: true }]),
      token, pipeline_id: body.pipeline_id || null, owner_id: body.owner_id || ctx.user.id,
    });
    return get('SELECT * FROM web_forms WHERE id=?', id);
  });
  router.patch('/api/admin/web-forms/:id', async (req, res, { ctx, params, body }) => {
    adminOnly(ctx);
    update('web_forms', params.id, {
      name: body.name, target: body.target, pipeline_id: body.pipeline_id, owner_id: body.owner_id,
      fields: body.fields ? JSON.stringify(body.fields) : undefined,
      active: body.active === undefined ? undefined : (body.active ? 1 : 0),
    });
    return get('SELECT * FROM web_forms WHERE id=?', params.id);
  });

  // ---------- shared reference data for the UI ----------
  router.get('/api/reference', async (req, res, { ctx }) => ({
    users: all('SELECT id,name,email,team_id,active FROM users ORDER BY name'),
    teams: all('SELECT * FROM teams ORDER BY name'),
    pipelines: all('SELECT * FROM pipelines WHERE active=1 ORDER BY order_idx')
      .filter((p) => ctx.isAdmin || ctx.visiblePipelines.includes(p.id)),
    stages: all('SELECT * FROM stages ORDER BY pipeline_id, order_idx'),
    labels: all('SELECT * FROM labels ORDER BY entity, name'),
    lost_reasons: all('SELECT * FROM lost_reasons WHERE active=1 ORDER BY name'),
    currencies: all('SELECT * FROM currencies WHERE active=1 ORDER BY code'),
    activity_types: all('SELECT * FROM activity_types WHERE active=1 ORDER BY order_idx'),
    taxes: all('SELECT * FROM taxes ORDER BY name'),
    project_boards: all('SELECT * FROM project_boards ORDER BY order_idx'),
    project_phases: all('SELECT * FROM project_phases ORDER BY board_id, order_idx'),
    visibility_groups: all('SELECT id,name FROM visibility_groups ORDER BY name'),
    visibility_labels: VISIBILITY_LABELS,
    custom_fields: allCustomFields(),
    sequences: all('SELECT id,name,entity FROM sequences WHERE active=1'),
    company: { name: setting('company_name', 'Our Company') },
  }));
}
