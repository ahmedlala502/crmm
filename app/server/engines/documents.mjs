import crypto from 'node:crypto';
import { all, get, insert, update, run, json, nowIso, setting } from '../db.mjs';
import { badRequest, notFound } from '../http.mjs';
import { renderMerge, mergeContext } from './mailer.mjs';
import { audit } from '../audit.mjs';

/** Cloud-storage adapters are declared here; core code never calls a provider directly. */
export const STORAGE_ADAPTERS = [
  { key: 'local', name: 'Local storage', connected: true },
  { key: 'gdrive', name: 'Google Drive', connected: false },
  { key: 'onedrive', name: 'OneDrive', connected: false },
  { key: 'sharepoint', name: 'SharePoint', connected: false },
];
export const ESIGN_ADAPTERS = [
  { key: 'internal', name: 'Built-in signature capture', connected: true },
  { key: 'docusign', name: 'DocuSign', connected: false },
  { key: 'adobesign', name: 'Adobe Acrobat Sign', connected: false },
];

function productTable(dealId) {
  const items = all('SELECT * FROM deal_products WHERE deal_id=?', dealId);
  if (!items.length) return '<p><em>No products attached to this deal.</em></p>';
  const rows = items.map((i) => {
    const gross = i.quantity * i.price;
    const disc = i.discount_type === 'percentage' ? gross * (i.discount / 100) : i.discount;
    const net = gross - disc;
    const tax = net * (i.tax / 100);
    return `<tr><td>${escapeHtml(i.name)}</td><td class="num">${i.quantity}</td><td class="num">${fmt(i.price)}</td><td class="num">${fmt(disc)}</td><td class="num">${i.tax}%</td><td class="num">${fmt(net + tax)}</td></tr>`;
  }).join('');
  const total = items.reduce((sum, i) => {
    const gross = i.quantity * i.price;
    const disc = i.discount_type === 'percentage' ? gross * (i.discount / 100) : i.discount;
    const net = gross - disc;
    return sum + net + net * (i.tax / 100);
  }, 0);
  return `<table class="doc-products"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Discount</th><th class="num">Tax</th><th class="num">Total</th></tr></thead>
  <tbody>${rows}</tbody><tfoot><tr><th colspan="5">Total</th><th class="num">${fmt(total)}</th></tr></tfoot></table>`;
}
const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderDocument(templateContent, { entity, entityId, user }) {
  const ids = {};
  if (entity === 'deal') ids.dealId = entityId;
  if (entity === 'lead') ids.leadId = entityId;
  if (entity === 'person') ids.personId = entityId;
  if (entity === 'organization') ids.orgId = entityId;
  if (entity === 'project') ids.projectId = entityId;
  const ctx = mergeContext({ ...ids, user });
  ctx.today = new Date().toISOString().slice(0, 10);
  let html = renderMerge(templateContent, ctx);
  if (entity === 'deal') html = html.replace(/\{\{\s*products_table\s*\}\}/g, productTable(entityId));
  return html;
}

export function createDocument(ctx, { templateId, entity, entityId, name }) {
  const tpl = templateId ? get('SELECT * FROM document_templates WHERE id=?', templateId) : null;
  if (templateId && !tpl) throw badRequest('Template not found');
  const content = renderDocument(tpl ? tpl.content : '', { entity, entityId, user: ctx.user });
  const id = insert('documents', {
    name: name || `${tpl?.name || 'Document'} — ${new Date().toISOString().slice(0, 10)}`,
    template_id: templateId || null, entity, entity_id: entityId,
    content, user_id: ctx.user.id, share_token: crypto.randomBytes(12).toString('hex'),
  });
  audit({ ctx, entity: 'document', entityId: id, action: 'created', changes: { entity, entity_id: entityId } });
  return get('SELECT * FROM documents WHERE id=?', id);
}

export function updateDocument(ctx, id, patch) {
  const doc = get('SELECT * FROM documents WHERE id=?', id);
  if (!doc) throw notFound('Document not found');
  update('documents', id, { ...patch, version: doc.version + (patch.content ? 1 : 0) });
  audit({ ctx, entity: 'document', entityId: id, action: 'updated', changes: patch.content ? { version: { from: doc.version, to: doc.version + 1 } } : patch });
  return get('SELECT * FROM documents WHERE id=?', id);
}

export function publicDocument(token) {
  const doc = get('SELECT * FROM documents WHERE share_token=?', token);
  if (!doc) return null;
  run('UPDATE documents SET views = views + 1, status = CASE WHEN status=\'sent\' THEN \'viewed\' ELSE status END WHERE id=?', doc.id);
  return get('SELECT * FROM documents WHERE id=?', doc.id);
}

export function signDocument(token, signerName) {
  const doc = get('SELECT * FROM documents WHERE share_token=?', token);
  if (!doc) throw notFound('Document not found');
  if (doc.signed_at) throw badRequest('Document is already signed');
  update('documents', doc.id, { status: 'signed', signed_at: nowIso(), signer_name: signerName });
  audit({ ctx: null, entity: 'document', entityId: doc.id, action: 'signed', changes: { signer: signerName }, actor: signerName, source: 'public_link' });
  return get('SELECT * FROM documents WHERE id=?', doc.id);
}

export function documentsFor(entity, entityId) {
  return all('SELECT id, name, status, version, views, share_token, created_at, signed_at FROM documents WHERE entity=? AND entity_id=? ORDER BY id DESC', entity, entityId);
}

export function documentHtml(doc) {
  const base = setting('company_name', 'Our Company');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(doc.name)}</title>
<style>
 body{font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#1a1c22}
 h1,h2,h3{line-height:1.25} .doc-products{width:100%;border-collapse:collapse;margin:18px 0}
 .doc-products th,.doc-products td{border-bottom:1px solid #e4e6ec;padding:8px 10px;text-align:left}
 .doc-products .num{text-align:right} .doc-products tfoot th{border-top:2px solid #1a1c22}
 .sign{margin-top:40px;padding:20px;border:1px dashed #b9bec9;border-radius:8px}
 .footer{margin-top:48px;color:#7b8091;font-size:12px}
</style></head><body>${doc.content}
${doc.signed_at
    ? `<div class="sign"><strong>Signed</strong> by ${escapeHtml(doc.signer_name)} on ${doc.signed_at}</div>`
    : `<div class="sign"><form method="POST" action="/public/documents/${doc.share_token}/sign">
        <label>Type your full name to sign<br><input name="name" required style="padding:8px;width:280px;margin-top:6px"></label>
        <button type="submit" style="padding:9px 16px;margin-left:8px">Sign document</button></form></div>`}
<div class="footer">${escapeHtml(base)} · document v${doc.version}</div></body></html>`;
}
