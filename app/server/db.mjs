import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.CRM_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'files'), { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'crm.sqlite');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

/** node:sqlite only binds null/number/string/bigint/Uint8Array. Normalise everything else. */
function norm(params) {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString().slice(0, 19).replace('T', ' ');
    if (typeof p === 'object') return JSON.stringify(p);
    return p;
  });
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...norm(params));
}
export function get(sql, ...params) {
  return db.prepare(sql).get(...norm(params)) ?? null;
}
export function run(sql, ...params) {
  const r = db.prepare(sql).run(...norm(params));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}
export function pluck(sql, ...params) {
  const row = get(sql, ...params);
  if (!row) return null;
  return row[Object.keys(row)[0]];
}

let txDepth = 0;
export function tx(fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN');
  txDepth++;
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  } finally {
    txDepth--;
  }
}

/** INSERT helper: insert('deals', {title:'x'}) -> id */
export function insert(table, data) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) throw new Error('insert: no columns');
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return run(sql, ...keys.map((k) => data[k])).lastInsertRowid;
}

/** UPDATE helper: update('deals', id, {title:'x'}) */
export function update(table, id, data, idCol = 'id') {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE ${idCol}=?`;
  return run(sql, ...keys.map((k) => data[k]), id).changes;
}

export function nowIso() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function setting(key, fallback = null) {
  const v = pluck('SELECT value FROM settings WHERE key=?', key);
  if (v === null || v === undefined) return fallback;
  try { return JSON.parse(v); } catch { return v; }
}
export function setSetting(key, value) {
  run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key, JSON.stringify(value));
}

export function json(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
