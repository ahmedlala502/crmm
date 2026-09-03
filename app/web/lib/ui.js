import { el, clear, on } from './dom.js';
import { api, state } from './api.js';
import { defaultCurrency, userById, labelById, stageById, pipelineById, customFieldsFor } from './api.js';

const toastWrap = () => {
  let w = document.querySelector('.toast-wrap');
  if (!w) { w = el('div', { class: 'toast-wrap' }); document.body.appendChild(w); }
  return w;
};

export function toast(msg, kind = 'info', ms = 3000) {
  const node = el('div', { class: `toast ${kind}` }, [msg]);
  toastWrap().appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transition = 'opacity .3s'; setTimeout(() => node.remove(), 320); }, ms);
}

export function confirmDialog({ title = 'Are you sure?', body = '', okText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = modal({
      title,
      body: el('div', {}, [body || 'This action cannot be undone.']),
      footer: [
        el('button', { class: 'btn ghost', onClick: () => { dlg.close(); resolve(false); } }, ['Cancel']),
        el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onClick: () => { dlg.close(); resolve(true); } }, [okText]),
      ],
    });
  });
}

export function modal({ title, body, footer, wide = false }) {
  const scrim = el('div', { class: 'scrim' });
  const close = () => { scrim.remove(); dlg.remove(); };
  const header = el('header', {}, [
    el('h2', {}, [title || '']),
    el('div', { class: 'spacer', style: { flex: '1' } }),
    el('button', { class: 'btn ghost', onClick: close, 'aria-label': 'Close' }, ['✕']),
  ]);
  const bodyEl = el('div', { class: 'body' }, body ? (Array.isArray(body) ? body : [body]) : []);
  const footerEl = el('footer', {}, footer || []);
  const dlg = el('div', { class: 'modal' + (wide ? ' wide' : '') }, [header, bodyEl, footerEl]);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.body.appendChild(scrim);
  document.body.appendChild(dlg);
  dlg._close = close;
  return Object.assign(dlg, { close });
}

export function drawer({ title, body, width, footer }) {
  const scrim = el('div', { class: 'scrim' });
  const close = () => { scrim.remove(); d.remove(); };
  const d = el('aside', { class: 'drawer', style: width ? { width } : null }, [
    el('header', {}, [
      el('div', {}, [el('h2', {}, [title || ''])]),
      el('div', { class: 'spacer', style: { flex: '1' } }),
      el('button', { class: 'btn ghost', onClick: close }, ['✕']),
    ]),
    el('div', { class: 'body' }, body ? (Array.isArray(body) ? body : [body]) : []),
  ]);
  if (footer) d.appendChild(el('div', { class: 'body', style: { borderTop: '1px solid var(--border)', background: 'var(--surface)' } }, [footer]));
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.body.appendChild(scrim);
  document.body.appendChild(d);
  return Object.assign(d, { close });
}

export async function apiAction(promise, okMsg) {
  try {
    const out = await promise;
    if (okMsg) toast(okMsg, 'success');
    return out;
  } catch (err) {
    toast(err.message || String(err), 'error', 5000);
    throw err;
  }
}

// --------- form field renderers ---------
export function formField(field, value, { entity, custom, required, hint, placeholder } = {}) {
  const f = field;
  const id = `f_${f.key}_${Math.random().toString(36).slice(2, 7)}`;
  const lbl = el('span', { class: 'lbl' }, [f.label + (f.required || required ? '' : '')]);
  const wrap = el('label', { class: 'field' + ((f.required || required) ? ' required' : '') }, [lbl]);
  if (hint) wrap.appendChild(el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '2px' } }, [hint]));
  const v = value === undefined || value === null ? '' : value;
  let input;

  switch (f.type) {
    case 'text':
    case 'address':
      input = el('input', { type: 'text', id, value: v, placeholder: placeholder || '' });
      break;
    case 'email': {
      const list = Array.isArray(v) ? v : (v ? [{ value: v, primary: true }] : []);
      input = el('input', { type: 'text', value: list[0]?.value || '', placeholder: 'name@example.com' });
      break;
    }
    case 'phones': {
      const list = Array.isArray(v) ? v : (v ? [{ value: v, primary: true }] : []);
      input = el('input', { type: 'text', value: list[0]?.value || '', placeholder: '+1 555 …' });
      break;
    }
    case 'number':
    case 'monetary':
      input = el('input', { type: 'number', id, value: v, step: '0.01' });
      break;
    case 'date':
      input = el('input', { type: 'date', id, value: String(v).slice(0, 10) || '' });
      break;
    case 'datetime':
      input = el('input', { type: 'datetime-local', id, value: String(v).replace(' ', 'T').slice(0, 16) || '' });
      break;
    case 'time':
      input = el('input', { type: 'time', id, value: v || '' });
      break;
    case 'textarea':
      input = el('textarea', { id, placeholder: placeholder || '' }, [v]);
      break;
    case 'boolean':
      input = el('label', { class: 'checkbox' }, [
        el('input', { type: 'checkbox', id, checked: !!v }),
        el('span', {}, [f.label]),
      ]);
      lbl.remove();
      break;
    case 'select':
      input = el('select', { id }, [
        el('option', { value: '' }, ['— none —']),
        ...(f.options || []).map((o) => el('option', { value: o, selected: o === v }, [o])),
      ]);
      break;
    case 'currency':
      input = el('select', { id }, [
        ...(state.ref?.currencies || []).map((c) => el('option', { value: c.code, selected: (v || defaultCurrency()) === c.code }, [`${c.code} — ${c.name}`])),
      ]);
      break;
    case 'user':
      input = el('select', { id }, [
        el('option', { value: '' }, ['— unassigned —']),
        ...(state.ref?.users || []).map((u) => el('option', { value: u.id, selected: Number(v) === u.id }, [u.name])),
      ]);
      break;
    case 'person':
      input = personSelect(id, v);
      break;
    case 'organization':
      input = orgSelect(id, v);
      break;
    case 'lead':
      input = leadSelect(id, v);
      break;
    case 'deal':
      input = dealSelect(id, v);
      break;
    case 'project':
      input = projectSelect(id, v);
      break;
    case 'pipeline':
      input = el('select', { id }, [
        ...(state.ref?.pipelines || []).map((p) => el('option', { value: p.id, selected: Number(v) === p.id }, [p.name])),
      ]);
      break;
    case 'stage':
      input = stageSelect(id, v, f.pipeline_id);
      break;
    case 'activity_type':
      input = el('select', { id }, [
        ...(state.ref?.activity_types || []).map((t) => el('option', { value: t.key_string, selected: v === t.key_string }, [t.name])),
      ]);
      break;
    case 'lost_reason':
      input = el('select', { id }, [
        el('option', { value: '' }, ['— none —']),
        ...(state.ref?.lost_reasons || []).map((r) => el('option', { value: r.id, selected: Number(v) === r.id }, [r.name])),
      ]);
      break;
    case 'tax':
      input = el('select', { id }, [
        el('option', { value: '' }, ['— none —']),
        ...(state.ref?.taxes || []).map((t) => el('option', { value: t.id, selected: Number(v) === t.id }, [`${t.name} (${t.percentage}%)`])),
      ]);
      break;
    case 'board':
      input = el('select', { id }, [
        el('option', { value: '' }, ['— default —']),
        ...(state.ref?.project_boards || []).map((b) => el('option', { value: b.id, selected: Number(v) === b.id }, [b.name])),
      ]);
      break;
    case 'visibility':
      input = el('select', { id }, [
        ...Object.entries(state.ref?.visibility_labels || { 3: 'Owner + groups', 7: 'Everyone' })
          .map(([k, label]) => el('option', { value: k, selected: Number(v || 3) === Number(k) }, [label])),
      ]);
      break;
    case 'labels': {
      const all = (state.ref?.labels || []).filter((l) => l.entity === entity);
      const selected = Array.isArray(v) ? v : (v ? String(v).split(',').map(Number) : []);
      const multi = el('div', { class: 'inline wrap' },
        all.map((l) => {
          const isOn = selected.includes(l.id);
          return el('label', { class: 'checkbox' }, [
            el('input', { type: 'checkbox', value: l.id, checked: isOn, 'data-key': 'label' }),
            el('span', { class: `badge ${l.color}` }, [l.name]),
          ]);
        })
      );
      multi.dataset.multi = 'labels';
      input = multi;
      break;
    }
    case 'emails': {
      const arr = Array.isArray(v) ? v : [];
      const list = el('div', { class: 'multi-list' },
        arr.length ? arr.map((e) => emailRow(e, arr)) : [emailRow({ value: '', primary: true }, arr)]
      );
      list.appendChild(el('button', { class: 'btn sm ghost', type: 'button', onClick: () => list.appendChild(emailRow({ value: '' }, arr)) }, ['＋ Add email']));
      input = list;
      input.dataset.multi = 'emails';
      break;
    }
    case 'phones': {
      const arr = Array.isArray(v) ? v : [];
      const list = el('div', { class: 'multi-list' },
        arr.length ? arr.map((p) => phoneRow(p, arr)) : [phoneRow({ value: '' }, arr)]
      );
      list.appendChild(el('button', { class: 'btn sm ghost', type: 'button', onClick: () => list.appendChild(phoneRow({ value: '' }, arr)) }, ['＋ Add phone']));
      input = list;
      input.dataset.multi = 'phones';
      break;
    }
    default:
      input = el('input', { type: 'text', id, value: v, placeholder: placeholder || '' });
  }

  if (input instanceof Node) wrap.appendChild(input);
  if (!custom) wrap.dataset.field = f.key;
  else wrap.dataset.cf = f.key;
  return wrap;
}

function emailRow(e, list) {
  return el('div', { class: 'inline', style: { marginBottom: '4px' } }, [
    el('input', { type: 'text', value: e.value || '', placeholder: 'name@example.com', 'data-email-value': '' }),
    el('input', { type: 'text', value: e.label || 'work', placeholder: 'label', style: { width: '90px' }, 'data-email-label': '' }),
    el('label', { class: 'checkbox', style: { fontSize: '11px' } }, [
      el('input', { type: 'checkbox', checked: !!e.primary, 'data-email-primary': '' }), 'primary',
    ]),
    el('button', { class: 'btn sm ghost', type: 'button', onClick: (ev) => ev.target.closest('.inline').remove() }, ['✕']),
  ]);
}
function phoneRow(p, list) {
  return el('div', { class: 'inline', style: { marginBottom: '4px' } }, [
    el('input', { type: 'text', value: p.value || '', placeholder: '+1 555 …', 'data-phone-value': '' }),
    el('input', { type: 'text', value: p.label || 'mobile', placeholder: 'label', style: { width: '90px' }, 'data-phone-label': '' }),
    el('label', { class: 'checkbox', style: { fontSize: '11px' } }, [
      el('input', { type: 'checkbox', checked: !!p.primary, 'data-phone-primary': '' }), 'primary',
    ]),
    el('button', { class: 'btn sm ghost', type: 'button', onClick: (ev) => ev.target.closest('.inline').remove() }, ['✕']),
  ]);
}

export function collectForm(formEl, customFields) {
  const out = {};
  const cf = {};
  for (const wrap of formEl.querySelectorAll('[data-field], [data-cf]')) {
    const key = wrap.dataset.field || wrap.dataset.cf;
    const isCf = !!wrap.dataset.cf;
    const field = (customFields || []).find((f) => f.key === key);
    const val = extract(wrap, field);
    if (isCf) cf[key] = val;
    else out[key] = val;
  }
  if (Object.keys(cf).length) out.cf = cf;
  return out;
}

function extract(wrap, field) {
  if (!field) {
    const inp = wrap.querySelector('input,select,textarea');
    if (!inp) return null;
    if (inp.type === 'checkbox') return inp.checked;
    if (inp.type === 'number') return inp.value === '' ? null : Number(inp.value);
    return inp.value === '' ? null : inp.value;
  }
  if (field.type === 'labels') {
    const ids = [...wrap.querySelectorAll('input[data-key="label"]:checked')].map((i) => Number(i.value));
    return ids;
  }
  if (field.type === 'emails') {
    const rows = wrap.querySelectorAll('.inline');
    return [...rows].map((r) => ({
      value: r.querySelector('[data-email-value]').value.trim(),
      label: r.querySelector('[data-email-label]').value.trim() || 'work',
      primary: r.querySelector('[data-email-primary]').checked,
    })).filter((x) => x.value);
  }
  if (field.type === 'phones') {
    const rows = wrap.querySelectorAll('.inline');
    return [...rows].map((r) => ({
      value: r.querySelector('[data-phone-value]').value.trim(),
      label: r.querySelector('[data-phone-label]').value.trim() || 'mobile',
      primary: r.querySelector('[data-phone-primary]').checked,
    })).filter((x) => x.value);
  }
  const inp = wrap.querySelector('input,select,textarea');
  if (!inp) return null;
  if (inp.type === 'checkbox') return inp.checked ? 1 : 0;
  if (inp.type === 'number') return inp.value === '' ? null : Number(inp.value);
  if (inp.value === '') return null;
  if (['user', 'person', 'organization', 'lead', 'deal', 'project', 'lost_reason', 'tax', 'board', 'pipeline', 'stage', 'activity_type'].includes(field.type)) {
    return Number(inp.value);
  }
  return inp.value;
}

function asyncSelect(id, value, fetch, render) {
  const select = el('select', { id }, [el('option', { value: '' }, ['— loading —'])]);
  fetch().then((items) => {
    clear(select);
    select.appendChild(el('option', { value: '' }, ['— none —']));
    for (const it of items) {
      const o = el('option', { value: it.id, selected: Number(value) === it.id }, [render(it)]);
      select.appendChild(o);
    }
  });
  return select;
}
export function personSelect(id, v) { return asyncSelect(id, v, () => api.get('/api/persons', { limit: 200, archived: false }).then((r) => r.data), (p) => p.name); }
export function orgSelect(id, v) { return asyncSelect(id, v, () => api.get('/api/organizations', { limit: 200, archived: false }).then((r) => r.data), (p) => p.name); }
export function leadSelect(id, v) { return asyncSelect(id, v, () => api.get('/api/leads', { limit: 200, status: 'open' }).then((r) => r.data), (p) => p.title); }
export function dealSelect(id, v) { return asyncSelect(id, v, () => api.get('/api/deals', { limit: 200, status: 'open' }).then((r) => r.data), (p) => p.title); }
export function projectSelect(id, v) { return asyncSelect(id, v, () => api.get('/api/projects', { limit: 200 }).then((r) => r.data), (p) => p.title); }

function stageSelect(id, v, pipelineId) {
  const stages = pipelineId
    ? (state.ref?.stages || []).filter((s) => s.pipeline_id === Number(pipelineId))
    : (state.ref?.stages || []);
  return el('select', { id }, stages.map((s) => el('option', { value: s.id, selected: Number(v) === s.id }, [s.name])));
}

export function badge(label, color) {
  return el('span', { class: `badge ${color || 'gray'}` }, [label || '—']);
}

export function money(v, currency) {
  if (v == null || v === '') return '—';
  const c = currency || defaultCurrency();
  return `${c} ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function fmtDate(s) {
  if (!s) return '—';
  return String(s).slice(0, 10);
}
export function fmtDateTime(s) {
  if (!s) return '—';
  return String(s).replace('T', ' ').slice(0, 16);
}
export function relTime(s) {
  if (!s) return '';
  const d = (Date.now() - new Date(String(s).replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')).getTime()) / 1000;
  const abs = Math.abs(d);
  const sign = d < 0 ? 'in ' : '';
  const suffix = d < 0 ? '' : ' ago';
  if (abs < 60) return 'just now';
  if (abs < 3600) return `${sign}${Math.round(abs / 60)}m${suffix}`;
  if (abs < 86400) return `${sign}${Math.round(abs / 3600)}h${suffix}`;
  if (abs < 30 * 86400) return `${sign}${Math.round(abs / 86400)}d${suffix}`;
  return fmtDate(s);
}

export function personLabel(p) {
  if (!p) return '—';
  return p.name || (p.emails?.[0]?.value) || `#${p.id}`;
}

export function statusBadge(status) {
  const map = {
    open: ['Open', 'blue'], won: ['Won', 'green'], lost: ['Lost', 'red'],
    converted: ['Converted', 'green'], archived: ['Archived', 'gray'], junk: ['Junk', 'red'],
    on_hold: ['On hold', 'amber'], completed: ['Completed', 'green'], canceled: ['Canceled', 'gray'],
  };
  const [label, color] = map[status] || [status, 'gray'];
  return badge(label, color);
}

// --------- command palette (global search) ---------
export function openCommandPalette(onPick) {
  const input = el('input', { type: 'search', placeholder: 'Search deals, contacts, leads, products…', autofocus: true });
  const list = el('div', { class: 'results' });
  const pal = el('div', { class: 'palette card' }, [
    input, list,
  ]);
  document.body.appendChild(pal);
  input.focus();
  let to;
  input.addEventListener('input', () => {
    clearTimeout(to);
    const q = input.value.trim();
    if (q.length < 2) { clear(list); return; }
    to = setTimeout(async () => {
      try {
        const r = await api.get('/api/search', { q });
        clear(list);
        for (const it of r.results) {
          const row = el('div', { class: 'res' }, [
            el('span', { class: 'badge blue' }, [it.entity]),
            el('span', {}, [it.title]),
            el('span', { class: 'muted' }, [it.subtitle || '']),
          ]);
          row.addEventListener('click', () => { close(); onPick(it); });
          list.appendChild(row);
        }
        if (!r.results.length) list.appendChild(el('div', { class: 'muted', style: { padding: '12px' } }, ['No results.']));
      } catch {}
    }, 180);
  });
  const close = () => pal.remove();
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
  });
  pal.addEventListener('click', (e) => { if (e.target === pal) close(); });
}
