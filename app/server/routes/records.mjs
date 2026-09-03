import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, insert, update, run, json, tx, nowIso, DATA_DIR } from '../db.mjs';
import { ENTITIES, entity, OPERATORS, OPERATOR_LABELS, RELATIVE_RANGES, COMPUTED_COLUMNS } from '../registry.mjs';
import { queryEntity, queryIds, hydrate, columnsFor, activitySummary, activityState } from '../query.mjs';
import {
  createRecord, updateRecord, deleteRecord, restoreRecord, setArchived, getRecord,
  addFollower, removeFollower, listFollowers,
} from '../records.mjs';
import { can, assertCan, VISIBILITY_LABELS } from '../rbac.mjs';
import { historyFor } from '../audit.mjs';
import { customFieldsFor } from '../customfields.mjs';
import { badRequest, notFound, sendText, readBody, toInt, toBool } from '../http.mjs';
import { toCsv } from '../engines/tabular.mjs';
import { enrollInSequence, enrollmentsFor } from '../engines/sequences.mjs';
import { documentsFor } from '../engines/documents.mjs';

export const SEGMENTS = {
  leads: 'lead', deals: 'deal', persons: 'person', organizations: 'organization',
  activities: 'activity', products: 'product', projects: 'project',
};
export const SEGMENT_OF = Object.fromEntries(Object.entries(SEGMENTS).map(([s, e]) => [e, s]));

function parseListOptions(query, entityKey) {
  let conditions = null;
  if (query.filter_id) {
    const f = get('SELECT * FROM filters WHERE id=?', query.filter_id);
    if (!f) throw notFound('Filter not found');
    conditions = json(f.conditions, null);
  }
  if (query.conditions) {
    try { conditions = JSON.parse(query.conditions); } catch { throw badRequest('conditions must be JSON'); }
  }
  const limit = Math.min(toInt(query.limit, 50), 500);
  const page = Math.max(toInt(query.page, 1), 1);
  return {
    conditions,
    search: query.search || '',
    sort: query.sort ? { field: query.sort, dir: query.dir === 'asc' ? 'asc' : 'desc' } : null,
    limit,
    offset: (page - 1) * limit,
    page,
    includeDeleted: toBool(query.include_deleted, false),
  };
}

function scopeFromQuery(entityKey, query) {
  const rules = [];
  const params = [];
  const parts = [];
  if (entityKey === 'deal') {
    if (query.status) { parts.push('t.status = ?'); params.push(query.status); }
    if (query.pipeline_id) { parts.push('t.pipeline_id = ?'); params.push(Number(query.pipeline_id)); }
    if (query.stage_id) { parts.push('t.stage_id = ?'); params.push(Number(query.stage_id)); }
    parts.push(`t.archived = ${toBool(query.archived, false) ? 1 : 0}`);
  }
  if (entityKey === 'lead') {
    parts.push('t.status = ?');
    params.push(query.status || 'open');
  }
  if (entityKey === 'activity') {
    if (query.done !== undefined && query.done !== '') { parts.push('t.done = ?'); params.push(toBool(query.done) ? 1 : 0); }
    if (query.assignee_id) { parts.push('t.assignee_id = ?'); params.push(Number(query.assignee_id)); }
    if (query.from) { parts.push('t.due_date >= ?'); params.push(query.from); }
    if (query.to) { parts.push('t.due_date <= ?'); params.push(query.to); }
  }
  if (entityKey === 'project') {
    if (query.board_id) { parts.push('t.board_id = ?'); params.push(Number(query.board_id)); }
    if (query.status) { parts.push('t.status = ?'); params.push(query.status); }
  }
  if (entityKey === 'person' || entityKey === 'organization') {
    parts.push(`t.archived = ${toBool(query.archived, false) ? 1 : 0}`);
    if (query.org_id) { parts.push('t.org_id = ?'); params.push(Number(query.org_id)); }
  }
  if (entityKey === 'product' && query.active !== undefined && query.active !== '') {
    parts.push('t.active = ?'); params.push(toBool(query.active) ? 1 : 0);
  }
  if (!parts.length) return null;
  return { sql: parts.join(' AND '), params };
}

export function registerRecordRoutes(router) {
  // ---- metadata ----
  router.get('/api/meta/entities', async () => ({
    entities: Object.values(ENTITIES).map((e) => ({
      key: e.key, label: e.label, plural: e.plural, module: e.module, segment: SEGMENT_OF[e.key],
      title_field: e.titleField, has_visibility: !!e.hasVisibility,
      fields: e.fields, default_columns: e.defaultColumns, perms: e.perms,
    })),
    operators: OPERATORS,
    operator_labels: OPERATOR_LABELS,
    relative_ranges: RELATIVE_RANGES,
    computed_columns: COMPUTED_COLUMNS,
    visibility_labels: VISIBILITY_LABELS,
  }));

  router.get('/api/meta/columns/:entity', async (req, res, { params }) => {
    const key = SEGMENTS[params.entity] || params.entity;
    return { columns: columnsFor(key), custom_fields: customFieldsFor(key) };
  });

  // ---- per-entity CRUD ----
  for (const [segment, entityKey] of Object.entries(SEGMENTS)) {
    const e = entity(entityKey);

    router.get(`/api/${segment}`, async (req, res, { ctx, query }) => {
      const opts = parseListOptions(query, entityKey);
      const scope = scopeFromQuery(entityKey, query);
      const result = queryEntity(entityKey, ctx, { ...opts, scope });
      return {
        data: hydrate(entityKey, result.rows),
        meta: { total: result.total, page: opts.page, limit: opts.limit, entity: entityKey },
      };
    });

    router.post(`/api/${segment}`, async (req, res, { ctx, body }) => {
      const row = createRecord(entityKey, ctx, body);
      return hydrate(entityKey, [row])[0];
    });

    router.get(`/api/${segment}/:id`, async (req, res, { ctx, params }) => {
      const row = getRecord(entityKey, ctx, Number(params.id));
      const [record] = hydrate(entityKey, [row]);
      record.followers = listFollowers(entityKey, row.id);
      record.notes_count = get('SELECT COUNT(*) n FROM notes WHERE entity=? AND entity_id=?', entityKey, row.id).n;
      record.files = all('SELECT id,name,mime,size,created_at FROM files WHERE entity=? AND entity_id=? ORDER BY id DESC', entityKey, row.id);
      record.documents = documentsFor(entityKey, row.id);
      record.custom_fields = customFieldsFor(entityKey, { pipelineId: row.pipeline_id, boardId: row.board_id });
      if (['lead', 'deal', 'person'].includes(entityKey)) record.sequences = enrollmentsFor(entityKey, row.id);
      if (entityKey === 'deal') {
        record.products = all('SELECT * FROM deal_products WHERE deal_id=?', row.id);
        record.products_total = record.products.reduce((s, p) => {
          const gross = p.quantity * p.price;
          const disc = p.discount_type === 'percentage' ? gross * (p.discount / 100) : p.discount;
          const net = gross - disc;
          return s + net + net * (p.tax / 100);
        }, 0);
      }
      if (entityKey === 'organization') {
        record.people = all('SELECT id,name,emails,job_title FROM persons WHERE org_id=? AND deleted=0', row.id)
          .map((p) => ({ ...p, emails: json(p.emails, []) }));
        record.deals = all("SELECT id,title,value,currency,status,stage_id FROM deals WHERE org_id=? AND deleted=0 ORDER BY id DESC LIMIT 50", row.id);
      }
      if (entityKey === 'person') {
        record.deals = all("SELECT id,title,value,currency,status,stage_id FROM deals WHERE person_id=? AND deleted=0 ORDER BY id DESC LIMIT 50", row.id);
      }
      if (entityKey === 'project') {
        record.tasks = all('SELECT * FROM tasks WHERE project_id=? ORDER BY order_idx, id', row.id)
          .map((t) => ({ ...t, depends_on: json(t.depends_on, []) }));
      }
      return record;
    });

    router.patch(`/api/${segment}/:id`, async (req, res, { ctx, params, body }) => {
      const row = updateRecord(entityKey, ctx, Number(params.id), body);
      return hydrate(entityKey, [row])[0];
    });

    router.delete(`/api/${segment}/:id`, async (req, res, { ctx, params }) =>
      deleteRecord(entityKey, ctx, Number(params.id)));

    router.post(`/api/${segment}/:id/restore`, async (req, res, { ctx, params }) =>
      restoreRecord(entityKey, ctx, Number(params.id)));

    if (e.archiveField) {
      router.post(`/api/${segment}/:id/archive`, async (req, res, { ctx, params, body }) =>
        setArchived(entityKey, ctx, Number(params.id), body.archived !== false));
    }

    router.get(`/api/${segment}/:id/history`, async (req, res, { ctx, params }) => {
      getRecord(entityKey, ctx, Number(params.id));
      return historyFor(entityKey, Number(params.id));
    });

    router.get(`/api/${segment}/:id/activities`, async (req, res, { ctx, params }) => {
      getRecord(entityKey, ctx, Number(params.id));
      const col = { deal: 'deal_id', lead: 'lead_id', person: 'person_id', organization: 'org_id', project: 'project_id' }[entityKey];
      if (!col) return [];
      const rows = all(
        `SELECT * FROM activities WHERE ${col}=? AND deleted=0 ORDER BY done ASC, due_date ASC, id DESC`, Number(params.id),
      );
      return hydrate('activity', rows, { withActivity: false });
    });

    router.get(`/api/${segment}/:id/notes`, async (req, res, { ctx, params }) => {
      getRecord(entityKey, ctx, Number(params.id));
      return all(
        `SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id=n.user_id
         WHERE n.entity=? AND n.entity_id=? ORDER BY n.pinned DESC, n.id DESC`, entityKey, Number(params.id),
      );
    });

    router.post(`/api/${segment}/:id/notes`, async (req, res, { ctx, params, body }) => {
      getRecord(entityKey, ctx, Number(params.id));
      if (!body.content) throw badRequest('Note content is required');
      const id = insert('notes', {
        entity: entityKey, entity_id: Number(params.id), content: body.content,
        pinned: body.pinned ? 1 : 0, user_id: ctx.user.id,
      });
      return get('SELECT * FROM notes WHERE id=?', id);
    });

    router.get(`/api/${segment}/:id/followers`, async (req, res, { ctx, params }) => {
      getRecord(entityKey, ctx, Number(params.id));
      return listFollowers(entityKey, Number(params.id));
    });
    router.post(`/api/${segment}/:id/followers`, async (req, res, { ctx, params, body }) => {
      getRecord(entityKey, ctx, Number(params.id));
      return addFollower(entityKey, Number(params.id), Number(body.user_id || ctx.user.id));
    });
    router.delete(`/api/${segment}/:id/followers/:userId`, async (req, res, { ctx, params }) => {
      getRecord(entityKey, ctx, Number(params.id));
      return removeFollower(entityKey, Number(params.id), Number(params.userId));
    });

    // files
    router.post(`/api/${segment}/:id/files`, async (req, res, { ctx, params }) => {
      getRecord(entityKey, ctx, Number(params.id));
      const name = String(req.headers['x-filename'] || 'upload.bin').replace(/[^\w.\- ]/g, '_');
      const buf = await readBody(req, 25 * 1024 * 1024);
      if (!buf.length) throw badRequest('Empty upload');
      const stored = `${crypto.randomBytes(8).toString('hex')}-${name}`;
      fs.writeFileSync(path.join(DATA_DIR, 'files', stored), buf);
      const id = insert('files', {
        entity: entityKey, entity_id: Number(params.id), name,
        mime: req.headers['content-type'] || 'application/octet-stream',
        size: buf.length, storage_path: stored, user_id: ctx.user.id,
      });
      return get('SELECT id,name,mime,size,created_at FROM files WHERE id=?', id);
    });

    // bulk operations
    router.post(`/api/${segment}/bulk/preview`, async (req, res, { ctx, body }) => {
      const ids = resolveBulkIds(entityKey, ctx, body);
      const automations = all('SELECT id, name, trigger_config FROM automations WHERE enabled=1')
        .filter((a) => {
          const t = json(a.trigger_config, {});
          if (t.entity !== entityKey) return false;
          if (t.event === 'updated') return true;
          if (t.event === 'field_updated') return Object.prototype.hasOwnProperty.call(body.values || {}, t.field);
          return false;
        })
        .map((a) => ({ id: a.id, name: a.name }));
      return {
        affected: ids.length,
        sample: hydrate(entityKey, all(
          `SELECT * FROM ${e.table} WHERE id IN (${ids.slice(0, 5).map(() => '?').join(',') || 'NULL'})`,
          ...ids.slice(0, 5),
        ), { withActivity: false }),
        automations_that_will_run: automations,
        warning: ids.length > 200 ? 'This affects more than 200 records — review carefully.' : null,
      };
    });

    router.post(`/api/${segment}/bulk`, async (req, res, { ctx, body }) => {
      const action = body.action || 'edit';
      const ids = resolveBulkIds(entityKey, ctx, body);
      if (!ids.length) throw badRequest('No records matched');
      if (ids.length > 1) assertCan(ctx, e.perms.bulk || e.perms.edit);
      const results = { updated: 0, failed: [], action, total: ids.length };
      for (const id of ids) {
        try {
          switch (action) {
            case 'edit': updateRecord(entityKey, ctx, id, body.values || {}); break;
            case 'delete': deleteRecord(entityKey, ctx, id); break;
            case 'archive': setArchived(entityKey, ctx, id, true); break;
            case 'unarchive': setArchived(entityKey, ctx, id, false); break;
            case 'change_owner': updateRecord(entityKey, ctx, id, { owner_id: Number(body.owner_id) }); break;
            case 'change_stage': updateRecord(entityKey, ctx, id, { stage_id: Number(body.stage_id) }); break;
            case 'schedule_activity': {
              const rec = getRecord(entityKey, ctx, id);
              createRecord('activity', ctx, {
                subject: body.subject || 'Follow up',
                type_key: body.type_key || 'call',
                due_date: body.due_date,
                assignee_id: body.assignee_id || rec.owner_id || ctx.user.id,
                [`${entityKey === 'organization' ? 'org' : entityKey}_id`]: id,
              });
              break;
            }
            case 'enroll_sequence':
              enrollInSequence(Number(body.sequence_id), entityKey, id, ctx.user.id);
              break;
            case 'mark_done':
              updateRecord('activity', ctx, id, { done: true });
              break;
            default: throw badRequest(`Unknown bulk action ${action}`);
          }
          results.updated++;
        } catch (err) {
          results.failed.push({ id, reason: err.message });
        }
      }
      return results;
    });

    // export
    router.get(`/api/${segment}/export.csv`, async (req, res, { ctx, query }) => {
      assertCan(ctx, e.perms.export || 'data.export');
      const opts = parseListOptions(query, entityKey);
      const result = queryEntity(entityKey, ctx, { ...opts, scope: scopeFromQuery(entityKey, query), limit: 10000, offset: 0 });
      const rows = hydrate(entityKey, result.rows, { withActivity: false });
      const requested = query.columns ? query.columns.split(',') : e.defaultColumns;
      const catalogue = columnsFor(entityKey);
      const columns = requested.map((key) => {
        const meta = catalogue.find((c) => c.key === key) || { key, label: key };
        return {
          key, label: meta.label,
          value: (r) => {
            if (key === 'owner_id') return r.owner?.name ?? '';
            if (key === 'stage_id') return r.stage?.name ?? '';
            if (key === 'pipeline_id') return r.pipeline?.name ?? '';
            if (key === 'org_id') return r.organization?.name ?? '';
            if (key === 'person_id') return r.person?.name ?? '';
            if (key === 'emails' || key === 'phones') return (r[key] || []).map((x) => x.value).join('; ');
            if (key === 'labels' || key === 'label_ids') return (r.labels || []).map((l) => l.name).join('; ');
            if (key === 'next_activity') return r.next_activity ? `${r.next_activity.due_date} ${r.next_activity.subject}` : '';
            if (meta.custom) return r.cf?.[key] ?? '';
            return r[key];
          },
        };
      });
      sendText(res, 200, toCsv(rows, columns), 'text/csv; charset=utf-8', {
        'Content-Disposition': `attachment; filename="${segment}-${new Date().toISOString().slice(0, 10)}.csv"`,
      });
      return { __raw: true };
    });
  }

  // ---- shared sub-resource routes ----
  router.patch('/api/notes/:id', async (req, res, { ctx, params, body }) => {
    const note = get('SELECT * FROM notes WHERE id=?', params.id);
    if (!note) throw notFound('Note not found');
    if (note.user_id !== ctx.user.id && !ctx.isAdmin) throw badRequest('You can only edit your own notes');
    update('notes', note.id, { content: body.content ?? note.content, pinned: body.pinned ? 1 : 0, updated_at: nowIso() });
    return get('SELECT * FROM notes WHERE id=?', note.id);
  });
  router.delete('/api/notes/:id', async (req, res, { ctx, params }) => {
    const note = get('SELECT * FROM notes WHERE id=?', params.id);
    if (!note) throw notFound('Note not found');
    if (note.user_id !== ctx.user.id && !ctx.isAdmin) throw badRequest('You can only delete your own notes');
    run('DELETE FROM notes WHERE id=?', note.id);
    return { ok: true };
  });

  router.get('/api/files/:id', async (req, res, { params }) => {
    const f = get('SELECT * FROM files WHERE id=?', params.id);
    if (!f) throw notFound('File not found');
    const full = path.join(DATA_DIR, 'files', f.storage_path);
    if (!fs.existsSync(full)) throw notFound('File content missing');
    res.writeHead(200, {
      'Content-Type': f.mime || 'application/octet-stream',
      'Content-Length': f.size,
      'Content-Disposition': `attachment; filename="${f.name}"`,
    });
    fs.createReadStream(full).pipe(res);
    return { __raw: true };
  });
  router.delete('/api/files/:id', async (req, res, { ctx, params }) => {
    const f = get('SELECT * FROM files WHERE id=?', params.id);
    if (!f) throw notFound('File not found');
    try { fs.unlinkSync(path.join(DATA_DIR, 'files', f.storage_path)); } catch { /* already gone */ }
    run('DELETE FROM files WHERE id=?', f.id);
    return { ok: true };
  });

  // ---- saved filters ----
  router.get('/api/filters', async (req, res, { ctx, query }) => {
    const rows = query.entity
      ? all('SELECT * FROM filters WHERE entity=? AND (owner_id=? OR shared=1) ORDER BY name', query.entity, ctx.user.id)
      : all('SELECT * FROM filters WHERE owner_id=? OR shared=1 ORDER BY entity, name', ctx.user.id);
    return rows.map((f) => ({ ...f, conditions: json(f.conditions, {}), columns: json(f.columns, []), sort: json(f.sort, {}) }));
  });
  router.post('/api/filters', async (req, res, { ctx, body }) => {
    if (!body.name || !body.entity) throw badRequest('Filter needs a name and entity');
    const id = insert('filters', {
      name: body.name, entity: body.entity,
      conditions: JSON.stringify(body.conditions || { match: 'all', rules: [] }),
      columns: JSON.stringify(body.columns || []),
      sort: JSON.stringify(body.sort || {}),
      owner_id: ctx.user.id, shared: body.shared ? 1 : 0,
    });
    return get('SELECT * FROM filters WHERE id=?', id);
  });
  router.patch('/api/filters/:id', async (req, res, { ctx, params, body }) => {
    const f = get('SELECT * FROM filters WHERE id=?', params.id);
    if (!f) throw notFound('Filter not found');
    if (f.owner_id !== ctx.user.id && !ctx.isAdmin) throw badRequest('You can only edit your own filters');
    update('filters', f.id, {
      name: body.name ?? f.name,
      conditions: body.conditions ? JSON.stringify(body.conditions) : undefined,
      columns: body.columns ? JSON.stringify(body.columns) : undefined,
      sort: body.sort ? JSON.stringify(body.sort) : undefined,
      shared: body.shared === undefined ? undefined : (body.shared ? 1 : 0),
    });
    return get('SELECT * FROM filters WHERE id=?', f.id);
  });
  router.delete('/api/filters/:id', async (req, res, { ctx, params }) => {
    const f = get('SELECT * FROM filters WHERE id=?', params.id);
    if (!f) throw notFound('Filter not found');
    if (f.owner_id !== ctx.user.id && !ctx.isAdmin) throw badRequest('You can only delete your own filters');
    run('DELETE FROM filters WHERE id=?', f.id);
    return { ok: true };
  });

  // ---- global search / command palette ----
  router.get('/api/search', async (req, res, { ctx, query }) => {
    const term = String(query.q || '').trim();
    if (term.length < 2) return { results: [] };
    const results = [];
    for (const [segment, key] of Object.entries(SEGMENTS)) {
      const r = queryEntity(key, ctx, { search: term, limit: 5 });
      for (const row of r.rows) {
        results.push({
          entity: key, segment, id: row.id,
          title: row[entity(key).titleField],
          subtitle: row.value ? `${row.currency || ''} ${row.value}` : (row.emails ? json(row.emails, [])[0]?.value : null),
        });
      }
    }
    return { results };
  });
}

function resolveBulkIds(entityKey, ctx, body) {
  if (Array.isArray(body.ids) && body.ids.length) {
    return body.ids.map(Number);
  }
  if (body.conditions || body.search) {
    return queryIds(entityKey, ctx, { conditions: body.conditions, search: body.search });
  }
  throw badRequest('Provide ids or a filter for the bulk operation');
}
