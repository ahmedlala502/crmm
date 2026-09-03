// Generic record detail renderer used by all entities.
// Renders a full-width view (designed to live inside a drawer) with a tab strip
// (Overview / Notes / Files / History / Activity / Sequences) and an editable
// overview panel for core + custom fields.

import { el, clear, on } from '../lib/dom.js';
import { api, state, can, userById, labelById, customFieldsFor, stageById, pipelineById } from '../lib/api.js';
import { toast, modal, confirmDialog, apiAction, fmtDate, fmtDateTime, money, badge, relTime, statusBadge } from '../lib/ui.js';

const SEGMENT_BY_KEY = { lead: 'leads', deal: 'deals', person: 'persons', organization: 'organizations', activity: 'activities', product: 'products', project: 'projects' };

export function renderDetail(entityKey, id, onChange) {
  const wrap = el('div', { class: 'detail-pane', 'data-entity': entityKey, 'data-id': String(id) });
  wrap.innerHTML = '<div class="loading">Loading…</div>';
  api.get(`/api/${SEGMENT_BY_KEY[entityKey]}/${id}`).then((record) => {
    record.__entity = entityKey;
    clear(wrap);
    wrap.appendChild(renderHeader(record, entityKey, onChange));
    wrap.appendChild(renderTabs(record, entityKey, onChange));
  }).catch((err) => {
    wrap.innerHTML = '';
    wrap.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load']), el('p', { class: 'muted' }, [err.message])]));
  });
  return wrap;
}

function titleOf(entityKey, r) {
  if (entityKey === 'person') return r.name;
  if (entityKey === 'activity') return r.subject;
  if (entityKey === 'product') return r.name;
  return r.title || r.name || `#${r.id}`;
}

function renderHeader(r, entityKey, onChange) {
  const title = el('div', { style: { flex: '1' } }, [
    el('h1', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
      el('span', {}, [titleOf(entityKey, r)]),
      entityKey === 'deal' && r.status ? statusBadge(r.status) : null,
    ]),
    el('div', { class: 'muted', style: { fontSize: '12px' } }, [
      r.org_id && r.organization ? r.organization.name : null,
      r.org_id && r.organization && r.person_id ? ' · ' : null,
      r.person_id && r.person ? r.person.name : null,
      r.owner ? ` · Owner: ${r.owner.name}` : null,
    ].filter(Boolean).join('') || `#${r.id}`),
  ]);

  const actions = el('div', { class: 'inline', style: { gap: '6px' } });
  // follow toggle
  const followed = (r.followers || []).some((f) => f.id === state.me?.user?.id);
  actions.appendChild(el('button', { class: 'btn sm ghost', title: followed ? 'Following' : 'Follow', onClick: async () => {
    try {
      if (followed) await api.del(`/api/${SEGMENT_BY_KEY[entityKey]}/${r.id}/followers/${state.me.user.id}`);
      else await api.post(`/api/${SEGMENT_BY_KEY[entityKey]}/${r.id}/followers`, { user_id: state.me.user.id });
      toast(followed ? 'Unfollowed' : 'Following', 'success');
      if (onChange) onChange();
    } catch (err) { toast(err.message, 'error'); }
  } }, [followed ? '★' : '☆']));

  if (entityKey === 'deal') {
    actions.appendChild(el('button', { class: 'btn sm', onClick: () => wonLost(r, 'won') }, ['Mark won']));
    actions.appendChild(el('button', { class: 'btn sm danger', onClick: () => wonLost(r, 'lost') }, ['Mark lost']));
  }
  if (entityKey === 'lead') {
    actions.appendChild(el('button', { class: 'btn sm', onClick: () => convert(r) }, ['Convert']));
  }
  actions.appendChild(el('button', { class: 'btn sm danger', onClick: () => del(entityKey, r, onChange) }, ['Delete']));

  return el('header', { class: 'card', style: { borderRadius: '0', borderLeft: '0', borderRight: '0', borderTop: '0' } }, [
    title,
    actions,
  ]);
}

function renderTabs(r, entityKey, onChange) {
  const tabs = el('div', { class: 'tabs', style: { padding: '0 14px' } });
  const body = el('div', { class: 'tab-body' });
  const defs = [
    { key: 'overview', label: 'Overview', render: () => renderOverview(r, entityKey, onChange) },
    { key: 'notes', label: 'Notes', render: () => renderNotes(r, entityKey, onChange) },
    { key: 'files', label: 'Files', render: () => renderFiles(r, entityKey, onChange) },
    { key: 'activity', label: 'Activity', render: () => renderActivity(r, entityKey, onChange) },
    { key: 'history', label: 'History', render: () => renderHistory(r, entityKey) },
  ];
  if (['lead', 'deal', 'person', 'organization'].includes(entityKey)) defs.push({ key: 'sequences', label: 'Sequences', render: () => renderSequences(r, entityKey, onChange) });
  if (entityKey === 'deal') defs.push({ key: 'products', label: 'Products', render: () => renderProducts(r, onChange) });
  if (entityKey === 'organization') defs.push({ key: 'deals', label: 'Deals', render: () => renderChildList(r, 'deals', 'Open deals linked to this organization.') });
  if (entityKey === 'person') defs.push({ key: 'deals', label: 'Deals', render: () => renderChildList(r, 'deals', 'Open deals linked to this person.') });
  if (entityKey === 'project') {
    defs.push({ key: 'board', label: 'Board', render: () => renderProjectBoard(r, onChange) });
    defs.push({ key: 'gantt', label: 'Gantt', render: () => renderProjectGantt(r) });
  }
  let active = 'overview';
  for (const t of defs) {
    const tab = el('div', { class: 'tab' + (t.key === active ? ' active' : ''), onClick: () => {
      active = t.key;
      for (const x of tabs.children) x.classList.toggle('active', x === tab);
      clear(body); body.appendChild(t.render());
    } }, [t.label]);
    tabs.appendChild(tab);
  }
  body.appendChild(defs[0].render());
  return el('div', {}, [tabs, body]);
}

function renderOverview(r, entityKey, onChange) {
  const e = state.meta?.entities.find((x) => x.key === entityKey);
  if (!e) return el('div', {}, ['Unknown entity']);
  const fields = e.fields.filter((f) => f.editable !== false || f.type === 'datetime');
  const customFields = customFieldsFor(entityKey);
  const grid = el('div', { class: 'cards cols-2' });
  const left = el('div', { class: 'card pad' }, [
    el('h2', { style: { marginBottom: '8px' } }, ['Core fields']),
    el('div', {}, fields.map((f) => editableField(f, r))),
  ]);
  const right = el('div', { class: 'card pad' }, [
    el('h2', { style: { marginBottom: '8px' } }, ['Custom fields']),
    customFields.length
      ? el('div', {}, customFields.map((f) => editableCustomField(f, r)))
      : el('div', { class: 'muted' }, ['No custom fields configured.']),
  ]);
  grid.append(left, right);
  return grid;
}

function editableField(f, r) {
  const row = el('div', { class: 'inline', style: { width: '100%', padding: '4px 0', borderBottom: '1px solid var(--border)' } });
  const lbl = el('div', { style: { width: '130px', color: 'var(--text-2)', fontSize: '12px' } }, [f.label]);
  const val = el('div', { style: { flex: '1' } });
  function show() {
    clear(val);
    if (f.type === 'boolean') {
      const cb = el('input', { type: 'checkbox', checked: !!r[f.key], onChange: async (e) => {
        try { await apiAction(api.patch(`/api/${SEGMENT_BY_KEY[r.__entity]}/${r.id}`, { [f.key]: e.target.checked ? 1 : 0 }), 'Saved'); r[f.key] = e.target.checked ? 1 : 0; } catch {}
      } });
      val.appendChild(cb);
    } else {
      const inp = el('input', { type: inputType(f), value: formatValue(f, r[f.key]) ?? '', style: { border: 'none', padding: '0' } });
      inp.addEventListener('blur', async () => {
        const nv = parseValue(f, inp.value);
        if (nv === formatValue(f, r[f.key])) return;
        try {
          await apiAction(api.patch(`/api/${SEGMENT_BY_KEY[r.__entity]}/${r.id}`, { [f.key]: nv }), 'Saved');
          r[f.key] = nv;
        } catch {}
      });
      val.appendChild(inp);
    }
  }
  show();
  row.append(lbl, val);
  return row;
}

function inputType(f) {
  if (f.type === 'date' || f.type === 'datetime') return f.type;
  if (f.type === 'time') return 'time';
  if (f.type === 'number' || f.type === 'monetary') return 'number';
  return 'text';
}
function formatValue(f, v) {
  if (v == null) return '';
  if (f.type === 'datetime') return String(v).replace(' ', 'T').slice(0, 16);
  if (f.type === 'date') return String(v).slice(0, 10);
  if (f.type === 'monetary') return v;
  return v;
}
function parseValue(f, v) {
  if (v === '') return null;
  if (f.type === 'number' || f.type === 'monetary') return Number(v);
  if (f.type === 'datetime') return v.replace('T', ' ');
  return v;
}

function editableCustomField(f, r) {
  const row = el('div', { class: 'inline', style: { width: '100%', padding: '4px 0', borderBottom: '1px solid var(--border)' } });
  const lbl = el('div', { style: { width: '130px', color: 'var(--text-2)', fontSize: '12px' } }, [f.name]);
  const val = el('div', { style: { flex: '1' } });
  const value = r.cf?.[f.key];
  if (f.read_only) {
    val.appendChild(el('div', {}, [value == null ? '—' : String(value)]));
  } else if (f.type === 'boolean') {
    val.appendChild(el('input', { type: 'checkbox', checked: !!value, onChange: async (e) => {
      try {
        await apiAction(api.patch(`/api/${SEGMENT_BY_KEY[r.__entity]}/${r.id}`, { cf: { [f.key]: e.target.checked ? 1 : 0 } }), 'Saved');
        r.cf = r.cf || {}; r.cf[f.key] = e.target.checked ? 1 : 0;
      } catch {}
    } }));
  } else {
    const inp = el('input', { type: f.type === 'date' ? 'date' : (f.type === 'datetime' ? 'datetime-local' : (f.type === 'number' || f.type === 'monetary' ? 'number' : 'text')), value: value ?? '', style: { border: 'none', padding: '0' } });
    inp.addEventListener('blur', async () => {
      try {
        await apiAction(api.patch(`/api/${SEGMENT_BY_KEY[r.__entity]}/${r.id}`, { cf: { [f.key]: inp.value === '' ? null : (f.type === 'number' || f.type === 'monetary' ? Number(inp.value) : inp.value) } }), 'Saved');
        r.cf = r.cf || {}; r.cf[f.key] = inp.value;
      } catch {}
    });
    val.appendChild(inp);
  }
  row.append(lbl, val);
  return row;
}

function renderNotes(r, entityKey, onChange) {
  const list = el('div', { class: 'timeline', id: 'notes-list' });
  const ta = el('textarea', { placeholder: 'Write a note…', style: { minHeight: '80px' } });
  const pin = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox' }), ' Pin to top']);
  const addBtn = el('button', { class: 'btn primary' }, ['Add note']);
  addBtn.addEventListener('click', async () => {
    if (!ta.value.trim()) return;
    try {
      await apiAction(api.post(`/api/${SEGMENT_BY_KEY[entityKey]}/${r.id}/notes`, { content: ta.value, pinned: pin.querySelector('input').checked ? 1 : 0 }), 'Note added');
      ta.value = '';
      await loadNotes();
      if (onChange) onChange();
    } catch {}
  });
  const input = el('div', { class: 'card pad' }, [
    el('h3', { style: { marginBottom: '6px' } }, ['Add a note']),
    ta, pin, el('div', { style: { marginTop: '6px' } }, [addBtn]),
  ]);
  async function loadNotes() {
    list.innerHTML = '<div class="loading">Loading…</div>';
    const rows = await api.get(`/api/${SEGMENT_BY_KEY[entityKey]}/${r.id}/notes`);
    clear(list);
    for (const n of rows) list.appendChild(noteItem(n));
  }
  function noteItem(n) {
    return el('div', { class: 'tl-item' }, [
      el('div', { class: 'tl-ico' }, ['✎']),
      el('div', { class: 'tl-body' }, [
        el('div', { class: 'tl-head' }, [
          el('strong', {}, [n.user_name || 'User']),
          n.pinned ? el('span', { class: 'badge amber' }, ['Pinned']) : null,
          el('span', { class: 'tl-when' }, [relTime(n.created_at)]),
        ]),
        el('div', { class: 'note-box', style: { marginTop: '4px' } }, [n.content]),
      ]),
    ]);
  }
  loadNotes();
  return el('div', { class: 'cards cols-2', style: { gridTemplateColumns: '1fr 320px' } }, [list, input]);
}

function renderFiles(r, entityKey, onChange) {
  const list = el('div', { class: 'cards cols-3' });
  const fileInput = el('input', { type: 'file', multiple: true });
  const uploadBtn = el('button', { class: 'btn primary' }, ['Upload']);
  uploadBtn.addEventListener('click', async () => {
    if (!fileInput.files.length) return;
    for (const file of fileInput.files) {
      try { await apiAction(api.upload(`/api/${SEGMENT_BY_KEY[entityKey]}/${r.id}/files`, file), 'Uploaded ' + file.name); } catch {}
    }
    fileInput.value = '';
    load();
    if (onChange) onChange();
  });
  async function load() {
    list.innerHTML = '<div class="loading">Loading…</div>';
    const r2 = await api.get(`/api/${SEGMENT_BY_KEY[entityKey]}/${r.id}`);
    clear(list);
    const files = r2.files || [];
    if (!files.length) list.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, ['No files yet.'])]));
    for (const f of files) {
      const c = el('div', { class: 'card pad' }, [
        el('div', { class: 'inline' }, [el('span', {}, [f.name]), el('div', { class: 'spacer', style: { flex: '1' } }), el('span', { class: 'muted', style: { fontSize: '11px' } }, [(f.size / 1024).toFixed(1) + ' KB'])]),
        el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' } }, [fmtDate(f.created_at)]),
        el('div', { class: 'inline', style: { marginTop: '8px', gap: '4px' } }, [
          el('a', { class: 'btn sm', href: `/api/files/${f.id}`, target: '_blank' }, ['Download']),
          el('button', { class: 'btn sm danger', onClick: async () => { if (!await confirmDialog({ title: 'Delete file?' })) return; await apiAction(api.del(`/api/files/${f.id}`), 'Deleted'); load(); } }, ['Delete']),
        ]),
      ]);
      list.appendChild(c);
    }
  }
  load();
  return el('div', {}, [
    el('div', { class: 'inline', style: { marginBottom: '10px', gap: '6px' } }, [fileInput, uploadBtn]),
    list,
  ]);
}

function renderActivity(r, entityKey, onChange) {
  const wrap = el('div', {});
  const today = new Date().toISOString().slice(0, 10);
  const form = el('div', { class: 'card pad', style: { marginBottom: '12px' } });
  const subj = el('input', { type: 'text', placeholder: 'Subject (e.g. Follow-up call)' });
  const typeSel = el('select', {}, (state.ref?.activity_types || []).map((t) => el('option', { value: t.key_string }, [t.name])));
  const due = el('input', { type: 'date', value: today });
  const assignee = el('select', {}, [el('option', { value: state.me.user.id }, [state.me.user.name + ' (me)']), ...(state.ref?.users || []).filter((u) => u.id !== state.me.user.id).map((u) => el('option', { value: u.id }, [u.name]))]);
  const time = el('input', { type: 'time' });
  const add = el('button', { class: 'btn primary' }, ['＋ Schedule']);
  add.addEventListener('click', async () => {
    if (!subj.value.trim()) return;
    try {
      await apiAction(api.post('/api/activities', {
        subject: subj.value, type_key: typeSel.value, due_date: due.value, due_time: time.value || null,
        assignee_id: Number(assignee.value),
        [`${entityKey === 'organization' ? 'org' : entityKey}_id`]: r.id,
      }), 'Activity added');
      subj.value = '';
      load();
      if (onChange) onChange();
    } catch {}
  });
  form.append(
    el('h3', { style: { marginBottom: '6px' } }, ['Schedule a follow-up']),
    el('div', { class: 'grid-2' }, [
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Subject']), subj]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Type']), typeSel]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Due date']), due]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Time (optional)']), time]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Assigned to']), assignee]),
    ]),
    add,
  );
  wrap.appendChild(form);

  const list = el('div', { class: 'timeline' });
  async function load() {
    list.innerHTML = '<div class="loading">Loading…</div>';
    const rows = await api.get(`/api/${SEGMENT_BY_KEY[entityKey]}/${r.id}/activities`);
    clear(list);
    for (const a of rows) list.appendChild(activityItem(a, onChange));
    if (!rows.length) list.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, ['No activities yet.'])]));
  }
  function activityItem(a, onChange) {
    const state_ = a.done ? 'done' : (a.due_date < today ? 'overdue' : 'today');
    return el('div', { class: 'tl-item' }, [
      el('div', { class: 'tl-ico' }, [a.type_key?.slice(0, 1).toUpperCase() || '·']),
      el('div', { class: 'tl-body' }, [
        el('div', { class: 'tl-head' }, [
          el('strong', {}, [a.subject]),
          a.due_time ? el('span', { class: 'muted' }, [` ${a.due_time}`]) : null,
          el('span', { class: 'tl-when' }, [fmtDate(a.due_date)]),
          a.assignee ? el('span', { class: 'muted' }, [` · ${a.assignee.name}`]) : null,
          el('div', { class: 'spacer', style: { flex: '1' } }),
          a.done ? el('span', { class: 'badge green' }, ['Done']) : el('span', { class: `badge ${state_ === 'overdue' ? 'red' : 'amber'}` }, [state_]),
          el('button', { class: 'btn sm', onClick: async () => { try { await apiAction(api.post(`/api/activities/${a.id}/done`, { done: !a.done }), a.done ? 'Reopened' : 'Done'); load(); if (onChange) onChange(); } catch {} } }, [a.done ? 'Reopen' : 'Mark done']),
        ]),
        a.note ? el('div', { class: 'muted', style: { marginTop: '4px' } }, [a.note]) : null,
      ]),
    ]);
  }
  load();
  wrap.appendChild(list);
  return wrap;
}

function renderHistory(r, entityKey) {
  const list = el('div', { class: 'timeline' });
  api.get(`/api/${SEGMENT_BY_KEY[entityKey]}/${r.id}/history`).then((rows) => {
    clear(list);
    for (const h of rows) list.appendChild(historyItem(h));
    if (!rows.length) list.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, ['No history yet.'])]));
  });
  return list;
}
function historyItem(h) {
  const changes = Object.keys(h.changes || {}).map((k) => `${k}: ${JSON.stringify(h.changes[k]).slice(0, 80)}`).join(', ') || '—';
  return el('div', { class: 'tl-item' }, [
    el('div', { class: 'tl-ico' }, ['•']),
    el('div', { class: 'tl-body' }, [
      el('div', { class: 'tl-head' }, [
        el('strong', {}, [h.user_name || `User #${h.user_id}`]),
        el('span', { class: 'badge' }, [h.action]),
        el('span', { class: 'tl-when' }, [relTime(h.created_at)]),
      ]),
      el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '2px' } }, [changes]),
    ]),
  ]);
}

function renderSequences(r, entityKey, onChange) {
  const wrap = el('div', {});
  const list = el('div', { class: 'cards cols-2' });
  const sel = el('select', {}, [
    el('option', { value: '' }, ['— choose a sequence —']),
    ...(state.ref?.sequences || []).filter((s) => s.entity === entityKey).map((s) => el('option', { value: s.id }, [s.name])),
  ]);
  const start = el('button', { class: 'btn primary' }, ['Enrol']);
  start.addEventListener('click', async () => {
    if (!sel.value) return;
    try {
      await apiAction(api.post(`/api/sequences/${sel.value}/enroll`, { entity: entityKey, ids: [r.id] }), 'Enrolled');
      load();
    } catch {}
  });
  async function load() {
    const rows = r.sequences || [];
    clear(list);
    for (const s of rows) {
      list.appendChild(el('div', { class: 'card pad' }, [
        el('strong', {}, [s.sequence_name || `Sequence #${s.sequence_id}`]),
        el('div', { class: 'muted' }, [s.status]),
        el('div', { class: 'muted' }, [s.next_run_at ? `Next: ${fmtDateTime(s.next_run_at)}` : '']),
      ]));
    }
    if (!rows.length) list.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, ['Not enrolled in any sequence.'])]));
  }
  load();
  wrap.append(
    el('div', { class: 'inline', style: { marginBottom: '10px' } }, [sel, start]),
    list,
  );
  return wrap;
}

function renderProducts(r, onChange) {
  const wrap = el('div', {});
  const list = el('div', { class: 'cards cols-2' });
  const totalEl = el('div', { class: 'card stat', style: { marginBottom: '10px' } }, [el('div', { class: 'k' }, ['Products total']), el('div', { class: 'v' }, [money(r.products_total, r.currency)])]);
  const productSel = el('select', {}, [el('option', { value: '' }, ['— pick a product —']), ...(state.ref?.products?.length ? [] : [])]);
  const qty = el('input', { type: 'number', value: '1', min: '1', step: '1', style: { width: '80px' } });
  const price = el('input', { type: 'number', value: '0', min: '0', step: '0.01', style: { width: '120px' } });
  const addBtn = el('button', { class: 'btn primary' }, ['＋ Add product']);
  api.get('/api/products', { limit: 200, active: true }).then((res) => {
    clear(productSel);
    productSel.appendChild(el('option', { value: '' }, ['— pick a product —']));
    for (const p of res.data) productSel.appendChild(el('option', { value: p.id }, [p.name]));
  });
  addBtn.addEventListener('click', async () => {
    if (!productSel.value) return;
    try {
      await apiAction(api.post(`/api/deals/${r.id}/products`, { product_id: Number(productSel.value), quantity: Number(qty.value), price: Number(price.value) }), 'Added');
      const fresh = await api.get(`/api/deals/${r.id}`);
      renderProducts(fresh, onChange);
      if (onChange) onChange();
    } catch {}
  });
  async function loadList() {
    const items = await api.get(`/api/deals/${r.id}/products`);
    clear(list);
    for (const it of items) {
      const gross = it.quantity * it.price;
      const disc = it.discount_type === 'percentage' ? gross * (it.discount / 100) : it.discount;
      const net = gross - disc;
      const total = net + net * (it.tax / 100);
      list.appendChild(el('div', { class: 'card pad' }, [
        el('div', { class: 'inline' }, [
          el('strong', {}, [it.name]),
          el('div', { class: 'spacer', style: { flex: '1' } }),
          el('span', { class: 'muted' }, [`${it.quantity} × ${money(it.price, it.currency)} = ${money(total, it.currency)}`]),
        ]),
        el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' } }, [`${it.billing_frequency} · tax ${it.tax}% · disc ${it.discount}${it.discount_type === 'percentage' ? '%' : ''}`]),
        el('div', { class: 'inline', style: { marginTop: '6px' } }, [
          el('button', { class: 'btn sm danger', onClick: async () => { await apiAction(api.del(`/api/deal-products/${it.id}`), 'Removed'); const fresh = await api.get(`/api/deals/${r.id}`); renderProducts(fresh, onChange); if (onChange) onChange(); } }, ['Remove']),
        ]),
      ]));
    }
    if (!items.length) list.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, ['No products added.'])]));
  }
  loadList();
  wrap.append(
    totalEl,
    el('div', { class: 'card pad', style: { marginBottom: '10px' } }, [
      el('h3', { style: { marginBottom: '6px' } }, ['Add product']),
      el('div', { class: 'inline', style: { gap: '6px' } }, [productSel, qty, price, addBtn]),
    ]),
    list,
  );
  return wrap;
}

function renderChildList(r, segment, emptyMsg) {
  const list = el('div', { class: 'cards cols-2' });
  for (const d of (r.deals || [])) {
    list.appendChild(el('div', { class: 'card pad' }, [
      el('a', { href: `#/deals/${d.id}`, class: 'cell-link' }, [d.title]),
      el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' } }, [money(d.value, d.currency) + ' · ' + d.status]),
    ]));
  }
  if (!list.children.length) list.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, [emptyMsg])]));
  return list;
}

function renderProjectBoard(r, onChange) {
  const wrap = el('div', { class: 'kanban', style: { padding: '0' } });
  api.get(`/api/projects/${r.id}/board`).then((b) => {
    clear(wrap);
    for (const ph of b.phases) {
      const col = el('div', { class: 'kcol' }, [
        el('header', {}, [
          el('div', { class: 'kname' }, [ph.name]),
          el('div', { class: 'kmeta' }, [`${(ph.tasks || []).length} tasks`]),
        ]),
        el('div', { class: 'klist' }, (ph.tasks || []).map(taskCard)),
      ]);
      wrap.appendChild(col);
    }
    if (b.unphased?.length) {
      const col = el('div', { class: 'kcol' }, [
        el('header', {}, [el('div', { class: 'kname' }, ['Unphased'])]),
        el('div', { class: 'klist' }, b.unphased.map(taskCard)),
      ]);
      wrap.appendChild(col);
    }
  });
  function taskCard(t) {
    return el('div', { class: 'kcard ' + (t.done ? 'state-future' : 'state-today') }, [
      el('div', { class: 'ktitle' }, [t.title]),
      t.due_date ? el('div', { class: 'krow' }, [fmtDate(t.due_date)]) : null,
      el('div', { class: 'kfoot' }, [
        el('div', { class: 'spacer', style: { flex: '1' } }),
        el('button', { class: 'btn sm', onClick: async () => { try { await apiAction(api.patch(`/api/tasks/${t.id}`, { done: !t.done }), t.done ? 'Reopened' : 'Done'); const fresh = await api.get(`/api/projects/${r.id}`); renderProjectBoard(fresh, onChange); } catch {} } }, [t.done ? '✓ Done' : '○ Mark']),
      ]),
    ]);
  }
  return wrap;
}

function renderProjectGantt(r) {
  const wrap = el('div', { class: 'card pad' });
  api.get(`/api/projects/${r.id}/gantt`).then((g) => {
    clear(wrap);
    const start = new Date(g.start);
    const end = new Date(g.end);
    const span = Math.max(1, (end - start) / 86400000);
    for (const b of g.bars) {
      const bs = new Date(b.start);
      const be = new Date(b.end);
      const left = Math.max(0, ((bs - start) / 86400000) / span * 100);
      const width = Math.max(1.2, ((be - bs) / 86400000) / span * 100);
      const bar = el('div', { class: 'gantt-bar ' + (b.done ? 'done' : (b.milestone ? 'milestone' : '')), style: { left: left + '%', width: width + '%' } });
      wrap.appendChild(el('div', { class: 'gantt-row' }, [
        el('div', { class: 'truncate' }, [b.title]),
        el('div', { class: 'gantt-track' }, [bar]),
      ]));
    }
    if (!g.bars.length) wrap.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, ['No tasks with due dates yet.'])]));
  });
  return wrap;
}

async function wonLost(r, status) {
  if (status === 'lost') {
    const m = modal({ title: 'Mark deal lost', body: el('div', {}, [
      el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Lost reason']), el('select', { id: 'lr' }, [el('option', { value: '' }, ['— none —']), ...(state.ref?.lost_reasons || []).map((x) => el('option', { value: x.id }, [x.name]))])]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Comment']), el('textarea', { id: 'lc' })]),
    ]), footer: [
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        try {
          const reason = m.querySelector('#lr').value;
          const comment = m.querySelector('#lc').value;
          await apiAction(api.post(`/api/deals/${r.id}/status`, { status, lost_reason_id: reason || null, lost_comment: comment || null }), 'Marked lost');
          m.close();
          renderDetail('deal', r.id);
        } catch {}
      } }, ['Mark lost']),
    ]});
    return;
  }
  try { await apiAction(api.post(`/api/deals/${r.id}/status`, { status }), 'Marked won'); renderDetail('deal', r.id); } catch {}
}

async function convert(r) {
  const m = modal({ title: 'Convert lead to deal', body: el('div', { class: 'muted' }, ['Loading…']) });
  const body = m.querySelector('.body'); clear(body);
  const form = el('div', { class: 'grid-2' });
  const title = el('input', { type: 'text', value: r.title });
  const value = el('input', { type: 'number', value: r.value || 0, step: '0.01' });
  const pipelineSel = el('select', {}, (state.ref?.pipelines || []).map((p) => el('option', { value: p.id }, [p.name])));
  pipelineSel.addEventListener('change', () => {
    const stages = (state.ref?.stages || []).filter((s) => s.pipeline_id === Number(pipelineSel.value));
    clear(stageSel);
    for (const s of stages) stageSel.appendChild(el('option', { value: s.id }, [s.name]));
  });
  const stageSel = el('select', {});
  pipelineSel.dispatchEvent(new Event('change'));
  form.append(
    el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Title']), title]),
    el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Value']), value]),
    el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Pipeline']), pipelineSel]),
    el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Stage']), stageSel]),
  );
  body.appendChild(form);
  m.querySelector('footer').innerHTML = '';
  m.querySelector('footer').append(
    el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
    el('button', { class: 'btn primary', onClick: async () => {
      try {
        await apiAction(api.post(`/api/leads/${r.id}/convert`, { title: title.value, value: Number(value.value), pipeline_id: Number(pipelineSel.value), stage_id: Number(stageSel.value) }), 'Converted to deal');
        m.close();
        location.hash = '#/deals';
      } catch {}
    } }, ['Convert']),
  );
}

async function del(entityKey, r, onChange) {
  if (!await confirmDialog({ title: `Delete this ${entityKey}?`, body: r.title || r.name || `#${r.id}`, okText: 'Delete', danger: true })) return;
  try {
    await apiAction(api.del(`/api/${SEGMENT_BY_KEY[entityKey]}/${r.id}`), 'Deleted');
    if (onChange) onChange();
    document.querySelector('.drawer')?.remove();
  } catch {}
}
