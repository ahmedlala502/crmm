import { all, json } from './db.mjs';
import { badRequest } from './http.mjs';

export const CF_TYPES = [
  'text', 'textarea', 'number', 'monetary', 'date', 'daterange', 'time', 'timerange',
  'select', 'multiselect', 'user', 'person', 'organization', 'phone', 'address', 'formula',
];

let cfCache = { at: 0, rows: null };
export function allCustomFields() {
  if (Date.now() - cfCache.at < 1000 && cfCache.rows) return cfCache.rows;
  const rows = all('SELECT * FROM custom_fields WHERE active=1 ORDER BY entity, order_idx, id').map((r) => ({
    ...r,
    options: json(r.options, []),
    pipeline_ids: json(r.pipeline_ids, []),
    board_ids: json(r.board_ids, []),
    editable_by: json(r.editable_by, []),
    required: !!r.required,
    important: !!r.important,
    read_only: !!r.read_only,
    show_in_list: !!r.show_in_list,
    show_in_detail: !!r.show_in_detail,
    show_in_add: !!r.show_in_add,
  }));
  cfCache = { at: Date.now(), rows };
  return rows;
}
export function invalidateCustomFields() { cfCache = { at: 0, rows: null }; }

export function customFieldsFor(entityKey, { pipelineId = null, boardId = null } = {}) {
  return allCustomFields().filter((f) => {
    if (f.entity !== entityKey) return false;
    if (pipelineId && f.pipeline_ids.length && !f.pipeline_ids.includes(Number(pipelineId))) return false;
    if (boardId && f.board_ids.length && !f.board_ids.includes(Number(boardId))) return false;
    return true;
  });
}

export function slugifyKey(name, entityKey) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';
  const taken = new Set(allCustomFields().filter((f) => f.entity === entityKey).map((f) => f.key));
  let key = base;
  let i = 2;
  while (taken.has(key)) key = `${base}_${i++}`;
  return key;
}

// ---------- formula evaluation (safe, no eval) ----------
function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if ('+-*/()'.includes(c)) { tokens.push({ t: c }); i++; continue; }
    if (c === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw badRequest('Formula: unclosed { }');
      tokens.push({ t: 'ref', v: src.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    const m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (m) { tokens.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    throw badRequest(`Formula: unexpected character "${c}"`);
  }
  return tokens;
}
function parseFormula(tokens, resolve) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t) => { if (peek()?.t !== t) throw badRequest(`Formula: expected ${t}`); return tokens[pos++]; };
  function primary() {
    const tk = peek();
    if (!tk) throw badRequest('Formula: unexpected end');
    if (tk.t === 'num') { pos++; return tk.v; }
    if (tk.t === 'ref') { pos++; return Number(resolve(tk.v)) || 0; }
    if (tk.t === '-') { pos++; return -primary(); }
    if (tk.t === '(') { pos++; const v = expr(); eat(')'); return v; }
    throw badRequest('Formula: unexpected token');
  }
  function term() {
    let v = primary();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = tokens[pos++].t;
      const r = primary();
      v = op === '*' ? v * r : (r === 0 ? 0 : v / r);
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = tokens[pos++].t;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const out = expr();
  if (pos !== tokens.length) throw badRequest('Formula: trailing input');
  return out;
}
export function evalFormula(formula, record) {
  if (!formula) return null;
  const resolve = (name) => {
    if (record[name] !== undefined) return record[name];
    if (record.cf && record.cf[name] !== undefined) return record.cf[name];
    return 0;
  };
  try {
    const v = parseFormula(tokenize(formula), resolve);
    return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
  } catch {
    return null;
  }
}

// ---------- validation ----------
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v) => /^\d{2}:\d{2}(:\d{2})?$/.test(v);

export function validateCustomValues(entityKey, incoming, existing = {}, opts = {}) {
  const defs = customFieldsFor(entityKey, opts);
  const merged = { ...existing };
  const errors = [];
  for (const def of defs) {
    const has = Object.prototype.hasOwnProperty.call(incoming, def.key);
    let value = has ? incoming[def.key] : existing[def.key];

    if (def.type === 'formula') {
      merged[def.key] = null; // computed after merge, below
      continue;
    }
    if (has && def.read_only && !opts.allowReadOnly) {
      errors.push({ field: def.key, message: `${def.name} is read-only` });
      continue;
    }
    if (value === '' || value === null || value === undefined) {
      if (def.required && !opts.partial) errors.push({ field: def.key, message: `${def.name} is required` });
      merged[def.key] = value === '' ? null : value ?? null;
      continue;
    }
    switch (def.type) {
      case 'number': case 'monetary': {
        const n = Number(value);
        if (Number.isNaN(n)) errors.push({ field: def.key, message: `${def.name} must be a number` });
        else merged[def.key] = n;
        break;
      }
      case 'date':
        if (!isDate(value)) errors.push({ field: def.key, message: `${def.name} must be YYYY-MM-DD` });
        else merged[def.key] = value;
        break;
      case 'daterange': {
        const v = typeof value === 'string' ? json(value, null) : value;
        if (!v || !isDate(v.from) || !isDate(v.to)) errors.push({ field: def.key, message: `${def.name} needs from/to dates` });
        else merged[def.key] = { from: v.from, to: v.to };
        break;
      }
      case 'time':
        if (!isTime(value)) errors.push({ field: def.key, message: `${def.name} must be HH:MM` });
        else merged[def.key] = value;
        break;
      case 'timerange': {
        const v = typeof value === 'string' ? json(value, null) : value;
        if (!v || !isTime(v.from) || !isTime(v.to)) errors.push({ field: def.key, message: `${def.name} needs from/to times` });
        else merged[def.key] = { from: v.from, to: v.to };
        break;
      }
      case 'select':
        if (def.options.length && !def.options.includes(value)) errors.push({ field: def.key, message: `${def.name}: "${value}" is not an allowed option` });
        else merged[def.key] = value;
        break;
      case 'multiselect': {
        const arr = Array.isArray(value) ? value : [value];
        const bad = arr.filter((x) => def.options.length && !def.options.includes(x));
        if (bad.length) errors.push({ field: def.key, message: `${def.name}: invalid options ${bad.join(', ')}` });
        else merged[def.key] = arr;
        break;
      }
      case 'user': case 'person': case 'organization': {
        const n = Number(value);
        if (Number.isNaN(n)) errors.push({ field: def.key, message: `${def.name} must reference a record id` });
        else merged[def.key] = n;
        break;
      }
      default:
        merged[def.key] = value;
    }
  }
  if (errors.length) throw badRequest('Validation failed', errors);
  return merged;
}

export function applyFormulas(entityKey, record) {
  const defs = customFieldsFor(entityKey).filter((f) => f.type === 'formula');
  if (!defs.length) return record.cf || {};
  const cf = { ...(record.cf || {}) };
  for (const def of defs) cf[def.key] = evalFormula(def.formula, { ...record, cf });
  return cf;
}
