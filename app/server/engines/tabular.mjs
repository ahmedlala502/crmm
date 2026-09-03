import zlib from 'node:zlib';

/** ---------- CSV ---------- */
export function parseDelimited(text, delimiter = null) {
  const src = text.replace(/^﻿/, '');
  if (!delimiter) {
    const head = src.split(/\r?\n/)[0] || '';
    const counts = { ',': (head.match(/,/g) || []).length, ';': (head.match(/;/g) || []).length, '\t': (head.match(/\t/g) || []).length };
    delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label ?? c.key)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  return '﻿' + [head, ...body].join('\n');
}

/** ---------- XLSX (read-only: zip + sharedStrings + first sheet) ---------- */
function readZipEntries(buf) {
  const entries = new Map();
  // locate End Of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid XLSX file (no zip directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const raw = buf.slice(dataStart, dataStart + compSize);
    entries.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function xmlMatches(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(\\s[^>]*)?(/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  let m;
  while ((m = re.exec(xml))) out.push({ attrs: m[1] || '', inner: m[3] ?? '' });
  return out;
}
const attr = (attrs, name) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs || '');
  return m ? m[1] : null;
};
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function colToIndex(ref) {
  const letters = (ref.match(/^[A-Z]+/) || ['A'])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseXlsx(buffer) {
  const entries = readZipEntries(buffer);
  const sharedXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') || '';
  const shared = xmlMatches(sharedXml, 'si').map((si) =>
    xmlMatches(si.inner, 't').map((t) => unescapeXml(t.inner)).join(''));

  let sheetName = null;
  for (const key of entries.keys()) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(key)) { sheetName = key; break; }
  }
  if (!sheetName) throw new Error('XLSX contains no worksheet');
  const sheet = entries.get(sheetName).toString('utf8');

  const rows = [];
  for (const row of xmlMatches(sheet, 'row')) {
    const cells = [];
    for (const c of xmlMatches(row.inner, 'c')) {
      const ref = attr(c.attrs, 'r') || 'A1';
      const type = attr(c.attrs, 't');
      const vs = xmlMatches(c.inner, 'v');
      const isNode = xmlMatches(c.inner, 'is');
      let value = '';
      if (type === 's' && vs.length) value = shared[Number(vs[0].inner)] ?? '';
      else if (type === 'inlineStr' && isNode.length) value = xmlMatches(isNode[0].inner, 't').map((t) => unescapeXml(t.inner)).join('');
      else if (vs.length) value = unescapeXml(vs[0].inner);
      cells[colToIndex(ref)] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

export function parseTable(filename, buffer) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return parseXlsx(buffer);
  if (lower.endsWith('.xls')) throw new Error('Legacy .xls is not supported — save the file as .xlsx or .csv');
  return parseDelimited(buffer.toString('utf8'));
}
