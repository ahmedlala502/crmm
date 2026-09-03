import { all, get, insert, update, run, json, tx, nowIso } from '../db.mjs';
import { entity } from '../registry.mjs';
import { customFieldsFor } from '../customfields.mjs';
import { createRecord, updateRecord, systemContext } from '../records.mjs';
import { badRequest } from '../http.mjs';
import { parseTable } from './tabular.mjs';
import { audit } from '../audit.mjs';

export const IMPORT_ENTITIES = ['lead', 'deal', 'person', 'organization', 'activity', 'product', 'project'];
export const DUPLICATE_STRATEGIES = [
  { key: 'create', label: 'Always create a new record' },
  { key: 'skip', label: 'Skip rows that match an existing record' },
  { key: 'update', label: 'Update the existing record' },
  { key: 'merge', label: 'Fill only the empty fields of the existing record' },
];

function targetFields(entityKey) {
  const e = entity(entityKey);
  const core = e.fields.filter((f) => f.editable !== false).map((f) => ({ key: f.key, label: f.label, type: f.type }));
  const cf = customFieldsFor(entityKey).map((f) => ({ key: f.key, label: f.name, type: f.type, custom: true }));
  const extra = [];
  if (['lead', 'deal'].includes(entityKey)) {
    extra.push({ key: '_person_name', label: 'Contact person (by name)', type: 'text', linked: true });
    extra.push({ key: '_org_name', label: 'Organization (by name)', type: 'text', linked: true });
  }
  if (entityKey === 'person') extra.push({ key: '_org_name', label: 'Organization (by name)', type: 'text', linked: true });
  if (entityKey === 'deal') extra.push({ key: '_stage_name', label: 'Stage (by name)', type: 'text', linked: true });
  extra.push({ key: '_owner_email', label: 'Owner (by email)', type: 'text', linked: true });
  return [...core, ...cf, ...extra];
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Heuristic column mapping. Deterministic; the AI layer can refine it but is never required. */
export function suggestMapping(entityKey, headers) {
  const fields = targetFields(entityKey);
  const aliases = {
    title: ['title', 'dealname', 'name', 'opportunity', 'subject'],
    name: ['name', 'fullname', 'contactname', 'company', 'organization'],
    value: ['value', 'amount', 'dealvalue', 'price', 'revenue'],
    currency: ['currency', 'curr'],
    emails: ['email', 'emailaddress', 'workemail', 'mail'],
    phones: ['phone', 'phonenumber', 'mobile', 'telephone', 'tel'],
    _org_name: ['company', 'organization', 'organisation', 'account', 'companyname'],
    _person_name: ['contact', 'person', 'contactname', 'fullname'],
    _owner_email: ['owner', 'owneremail', 'assignedto', 'salesrep'],
    _stage_name: ['stage', 'dealstage', 'pipelinestage'],
    expected_close_date: ['closedate', 'expectedclose', 'expectedclosedate', 'closingdate'],
    job_title: ['jobtitle', 'title', 'position', 'role'],
    source: ['source', 'leadsource', 'channel'],
    address: ['address', 'street', 'location'],
    domain: ['domain', 'website', 'url'],
    due_date: ['duedate', 'date'],
    code: ['code', 'sku', 'productcode'],
    category: ['category', 'type'],
    description: ['description', 'notes', 'details'],
  };
  const mapping = {};
  const used = new Set();
  // Relation id columns are never matched directly — spreadsheets carry names and
  // emails, not internal ids, so those route through the "_by name/email" targets.
  const matchable = fields.filter((f) => !/_id$/.test(f.key));
  headers.forEach((h, i) => {
    const nh = norm(h);
    let found = matchable.find((f) => norm(f.key) === nh || norm(f.label) === nh);
    if (!found) {
      for (const [key, list] of Object.entries(aliases)) {
        if (list.some((a) => a === nh)) {
          const cand = fields.find((f) => f.key === key);
          if (cand && !used.has(cand.key)) { found = cand; break; }
        }
      }
    }
    if (found && !used.has(found.key)) {
      mapping[String(i)] = found.key;
      used.add(found.key);
    } else {
      mapping[String(i)] = '';
    }
  });
  return mapping;
}

export function analyseFile(entityKey, filename, buffer) {
  const rows = parseTable(filename, buffer);
  if (rows.length < 2) throw badRequest('File needs a header row and at least one data row');
  const headers = rows[0].map((h) => String(h).trim());
  const sample = rows.slice(1, 11);
  return {
    headers,
    sample,
    total_rows: rows.length - 1,
    mapping: suggestMapping(entityKey, headers),
    fields: targetFields(entityKey),
    duplicate_strategies: DUPLICATE_STRATEGIES,
  };
}

function findDuplicate(entityKey, values) {
  switch (entityKey) {
    case 'person': {
      const email = (values.emails || []).find((e) => e.value)?.value;
      if (email) {
        const hit = get("SELECT * FROM persons WHERE deleted=0 AND emails LIKE ? LIMIT 1", `%${email}%`);
        if (hit) return hit;
      }
      return get('SELECT * FROM persons WHERE deleted=0 AND lower(name)=lower(?) LIMIT 1', values.name);
    }
    case 'organization':
      return get('SELECT * FROM organizations WHERE deleted=0 AND lower(name)=lower(?) LIMIT 1', values.name);
    case 'product':
      return values.code
        ? get('SELECT * FROM products WHERE deleted=0 AND code=? LIMIT 1', values.code)
        : get('SELECT * FROM products WHERE deleted=0 AND lower(name)=lower(?) LIMIT 1', values.name);
    case 'deal':
      return get('SELECT * FROM deals WHERE deleted=0 AND lower(title)=lower(?) LIMIT 1', values.title);
    case 'lead':
      return get('SELECT * FROM leads WHERE deleted=0 AND lower(title)=lower(?) LIMIT 1', values.title);
    default:
      return null;
  }
}

function coerce(entityKey, fieldKey, raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return null;
  const e = entity(entityKey);
  const def = e.fields.find((f) => f.key === fieldKey);
  const type = def?.type || customFieldsFor(entityKey).find((f) => f.key === fieldKey)?.type || 'text';
  switch (type) {
    case 'number': case 'monetary': {
      const n = Number(value.replace(/[^0-9.\-]/g, ''));
      if (Number.isNaN(n)) throw new Error(`"${value}" is not a number`);
      return n;
    }
    case 'boolean': return ['1', 'true', 'yes', 'y'].includes(value.toLowerCase());
    case 'date': {
      const d = normaliseDate(value);
      if (!d) throw new Error(`"${value}" is not a recognised date`);
      return d;
    }
    case 'emails': return [{ label: 'work', value, primary: true }];
    case 'phones': return [{ label: 'work', value, primary: true }];
    case 'labels': return value.split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
    default: return value;
  }
}

function normaliseDate(v) {
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(v);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = '20' + y;
    // day-first when unambiguous, otherwise month-first
    const day = Number(a) > 12 ? a : b;
    const month = Number(a) > 12 ? b : a;
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function resolveLinks(entityKey, values, ctx, createMissing) {
  if (values._owner_email) {
    const u = get('SELECT id FROM users WHERE lower(email)=lower(?)', values._owner_email);
    if (u) values.owner_id = u.id;
    delete values._owner_email;
  }
  // A mapped owner column may still arrive as an email or a name rather than an id.
  for (const key of ['owner_id', 'assignee_id']) {
    const v = values[key];
    if (v === undefined || v === null || /^\d+$/.test(String(v))) continue;
    const u = get('SELECT id FROM users WHERE lower(email)=lower(?) OR lower(name)=lower(?)', String(v), String(v));
    if (u) values[key] = u.id;
    else delete values[key];
  }
  if (values._org_name) {
    let org = get('SELECT id FROM organizations WHERE deleted=0 AND lower(name)=lower(?)', values._org_name);
    if (!org && createMissing) org = { id: createRecord('organization', ctx, { name: values._org_name }, { skipPerms: true, source: 'import' }).id };
    if (org) values.org_id = org.id;
    delete values._org_name;
  }
  if (values._person_name) {
    let p = get('SELECT id FROM persons WHERE deleted=0 AND lower(name)=lower(?)', values._person_name);
    if (!p && createMissing) {
      p = { id: createRecord('person', ctx, { name: values._person_name, org_id: values.org_id ?? null }, { skipPerms: true, source: 'import' }).id };
    }
    if (p) values.person_id = p.id;
    delete values._person_name;
  }
  if (values._stage_name) {
    const s = get('SELECT id FROM stages WHERE lower(name)=lower(?) LIMIT 1', values._stage_name);
    if (s) values.stage_id = s.id;
    delete values._stage_name;
  }
  return values;
}

/**
 * Runs an import. Returns the persisted import_job row, including per-row skip reasons.
 */
export function runImport(ctx, { entityKey, filename, buffer, mapping, duplicateStrategy = 'create', createMissingLinks = true, dryRun = false }) {
  if (!IMPORT_ENTITIES.includes(entityKey)) throw badRequest(`Cannot import ${entityKey}`);
  const rows = parseTable(filename, buffer);
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const cfKeys = new Set(customFieldsFor(entityKey).map((f) => f.key));

  const errors = [];
  const createdIds = [];
  let created = 0; let updated = 0; let skipped = 0;

  const jobId = dryRun ? null : insert('import_jobs', {
    entity: entityKey, filename, mapping: JSON.stringify(mapping),
    duplicate_strategy: duplicateStrategy, status: 'running', total: dataRows.length,
    user_id: ctx.user.id,
  });

  const process = () => {
    dataRows.forEach((row, idx) => {
      const rowNo = idx + 2; // 1-based including header
      const values = {};
      const cf = {};
      try {
        for (const [colIdx, target] of Object.entries(mapping)) {
          if (!target) continue;
          const raw = row[Number(colIdx)];
          if (raw === undefined || String(raw).trim() === '') continue;
          const coerced = coerce(entityKey, target, raw);
          if (coerced === null) continue;
          if (cfKeys.has(target)) cf[target] = coerced;
          else values[target] = coerced;
        }
        if (Object.keys(values).length === 0 && Object.keys(cf).length === 0) {
          skipped++;
          errors.push({ row: rowNo, reason: 'Row is empty after mapping', data: row.slice(0, 6) });
          return;
        }
        resolveLinks(entityKey, values, ctx, createMissingLinks && !dryRun);
        if (Object.keys(cf).length) values.cf = cf;

        const dup = findDuplicate(entityKey, values);
        if (dup && duplicateStrategy === 'skip') {
          skipped++;
          errors.push({ row: rowNo, reason: `Duplicate of ${entityKey} #${dup.id}`, data: row.slice(0, 6) });
          return;
        }
        if (dryRun) { created++; return; }

        if (dup && duplicateStrategy === 'update') {
          updateRecord(entityKey, ctx, dup.id, values, { skipPerms: true, source: 'import', ignoreUnknown: true });
          updated++;
        } else if (dup && duplicateStrategy === 'merge') {
          const patch = {};
          for (const [k, v] of Object.entries(values)) {
            if (k === 'cf') continue;
            if (dup[k] === null || dup[k] === '' || dup[k] === '[]') patch[k] = v;
          }
          if (Object.keys(patch).length) {
            updateRecord(entityKey, ctx, dup.id, patch, { skipPerms: true, source: 'import', ignoreUnknown: true });
            updated++;
          } else skipped++;
        } else {
          const rec = createRecord(entityKey, ctx, values, { skipPerms: true, source: 'import', ignoreUnknown: true });
          createdIds.push(rec.id);
          created++;
        }
      } catch (err) {
        skipped++;
        errors.push({ row: rowNo, reason: err.message || String(err), data: row.slice(0, 6) });
      }
    });
  };

  if (dryRun) {
    process();
    return { dry_run: true, total: dataRows.length, would_create: created, skipped, errors: errors.slice(0, 200) };
  }

  tx(process);
  update('import_jobs', jobId, {
    status: 'done', created_count: created, updated_count: updated, skipped_count: skipped,
    errors: JSON.stringify(errors.slice(0, 1000)), created_ids: JSON.stringify(createdIds),
    finished_at: nowIso(),
  });
  audit({ ctx, entity: 'import_job', entityId: jobId, action: 'imported', changes: { entity: entityKey, created, updated, skipped } });
  return importJob(jobId);
}

export function importJob(id) {
  const j = get('SELECT * FROM import_jobs WHERE id=?', id);
  if (!j) return null;
  return { ...j, mapping: json(j.mapping, {}), errors: json(j.errors, []), created_ids: json(j.created_ids, []) };
}

export function listImports(limit = 50) {
  return all('SELECT * FROM import_jobs ORDER BY id DESC LIMIT ?', limit).map((j) => ({
    ...j, mapping: json(j.mapping, {}), errors: json(j.errors, []), created_ids: json(j.created_ids, []),
  }));
}

/** Reverts an import by soft-deleting every record it created. */
export function revertImport(ctx, id) {
  const job = importJob(id);
  if (!job) throw badRequest('Import job not found');
  if (job.status === 'reverted') throw badRequest('This import was already reverted');
  const e = entity(job.entity);
  const ids = job.created_ids;
  tx(() => {
    for (const recId of ids) {
      run(`UPDATE ${e.table} SET ${e.softDelete}=1 WHERE id=?`, recId);
    }
    update('import_jobs', id, { status: 'reverted' });
    audit({ ctx, entity: 'import_job', entityId: id, action: 'reverted', changes: { removed: ids.length } });
  });
  return { reverted: ids.length, job: importJob(id) };
}

// ---------- duplicates & merge ----------
export function findDuplicates(entityKey, limit = 100) {
  if (entityKey === 'person') {
    return all(
      `SELECT lower(name) k, COUNT(*) n, GROUP_CONCAT(id) ids FROM persons WHERE deleted=0
       GROUP BY k HAVING n > 1 ORDER BY n DESC LIMIT ?`, limit,
    ).map((r) => ({ key: r.k, count: r.n, ids: r.ids.split(',').map(Number) }));
  }
  if (entityKey === 'organization') {
    return all(
      `SELECT lower(name) k, COUNT(*) n, GROUP_CONCAT(id) ids FROM organizations WHERE deleted=0
       GROUP BY k HAVING n > 1 ORDER BY n DESC LIMIT ?`, limit,
    ).map((r) => ({ key: r.k, count: r.n, ids: r.ids.split(',').map(Number) }));
  }
  if (entityKey === 'deal') {
    return all(
      `SELECT lower(title) k, COUNT(*) n, GROUP_CONCAT(id) ids FROM deals WHERE deleted=0
       GROUP BY k HAVING n > 1 ORDER BY n DESC LIMIT ?`, limit,
    ).map((r) => ({ key: r.k, count: r.n, ids: r.ids.split(',').map(Number) }));
  }
  return [];
}

/** Merges `loserId` into `winnerId`, re-pointing every related record. */
export function mergeRecords(ctx, entityKey, winnerId, loserId) {
  if (winnerId === loserId) throw badRequest('Cannot merge a record into itself');
  const e = entity(entityKey);
  const winner = get(`SELECT * FROM ${e.table} WHERE id=?`, winnerId);
  const loser = get(`SELECT * FROM ${e.table} WHERE id=?`, loserId);
  if (!winner || !loser) throw badRequest('Both records must exist');

  tx(() => {
    const patch = {};
    for (const [k, v] of Object.entries(loser)) {
      if (['id', 'created_at', 'updated_at'].includes(k)) continue;
      if ((winner[k] === null || winner[k] === '' || winner[k] === '[]') && v !== null && v !== '') patch[k] = v;
    }
    if (Object.keys(patch).length) update(e.table, winnerId, patch);

    const repoint = {
      person: [['deals', 'person_id'], ['leads', 'person_id'], ['activities', 'person_id'], ['email_threads', 'person_id'], ['projects', 'person_id'], ['campaign_recipients', 'person_id']],
      organization: [['deals', 'org_id'], ['leads', 'org_id'], ['activities', 'org_id'], ['persons', 'org_id'], ['email_threads', 'org_id'], ['projects', 'org_id']],
      deal: [['activities', 'deal_id'], ['email_threads', 'deal_id'], ['projects', 'deal_id'], ['deal_products', 'deal_id']],
    }[entityKey] || [];
    for (const [table, col] of repoint) run(`UPDATE ${table} SET ${col}=? WHERE ${col}=?`, winnerId, loserId);
    for (const table of ['notes', 'files', 'documents']) run(`UPDATE ${table} SET entity_id=? WHERE entity=? AND entity_id=?`, winnerId, entityKey, loserId);
    run(`UPDATE ${e.table} SET ${e.softDelete}=1 WHERE id=?`, loserId);
    audit({ ctx, entity: entityKey, entityId: winnerId, action: 'merged', changes: { merged_from: loserId } });
  });
  return get(`SELECT * FROM ${e.table} WHERE id=?`, winnerId);
}
