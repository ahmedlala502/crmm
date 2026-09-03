// Generic list view for any segment (leads / deals / persons / orgs / activities / products / projects).
// Provides: search, sort, filter modal, pagination, bulk bar, row actions, open in drawer.

import { el, clear } from '../lib/dom.js';
import { api, state, hasModule, can } from '../lib/api.js';
import { toast, modal, drawer, confirmDialog, apiAction, fmtDate, money, badge, statusBadge } from '../lib/ui.js';
import { renderDetail } from './detail.js';
import { go } from '../lib/router.js';

const FIELDS_BY_ENTITY = {
  lead: { segment: 'leads', title: 'leads', label: 'Lead' },
  deal: { segment: 'deals', title: 'deals', label: 'Deal' },
  person: { segment: 'persons', title: 'persons', label: 'Person' },
  organization: { segment: 'organizations', title: 'organizations', label: 'Organization' },
  activity: { segment: 'activities', title: 'activities', label: 'Activity' },
  product: { segment: 'products', title: 'products', label: 'Product' },
  project: { segment: 'projects', title: 'projects', label: 'Project' },
};

export function listView(entityKey, { extraParams = {}, extraColumns, title, defaultView, allowCreate = true, allowImport = false, customFilters, onCreate } = {}) {
  const meta = FIELDS_BY_ENTITY[entityKey];
  if (!meta) return el('div', {}, ['Unknown entity ' + entityKey]);
  const e = state.meta?.entities.find((x) => x.key === entityKey);
  const columns = e?.default_columns || ['title'];
  const allColumns = e?.fields || [];
  const customFields = (state.ref?.custom_fields || []).filter((f) => f.entity === entityKey);

  const state2 = {
    page: 1, limit: 50, search: '', sort: null, dir: 'desc',
    conditions: null, view: defaultView || 'list', data: null,
    selected: new Set(), columns, extraParams, customFilters,
  };

  const wrap = el('div', {});
  const toolbar = el('div', { class: 'toolbar' });
  const view = el('div', { id: 'listview-' + entityKey });

  function syncUrl() {
    const q = new URLSearchParams();
    if (state2.view && state2.view !== 'list') q.set('view', state2.view);
    if (state2.page > 1) q.set('page', state2.page);
    if (state2.conditions) q.set('conditions', JSON.stringify(state2.conditions));
    const qs = q.toString();
    const path = meta.segment + (qs ? '?' + qs : '');
    if ((location.hash || '').slice(1) !== '/' + path) {
      history.replaceState(null, '', '#/' + path);
    }
  }

  function buildToolbar() {
    clear(toolbar);
    const searchInput = el('input', { type: 'search', placeholder: `Search ${meta.label.toLowerCase()}s…`, value: state2.search, style: { width: '240px' } });
    searchInput.addEventListener('input', (e) => { clearTimeout(searchInput._t); searchInput._t = setTimeout(() => { state2.search = e.target.value; state2.page = 1; refresh(); }, 220); });
    toolbar.append(
      el('h2', { style: { marginRight: '10px' } }, [title || meta.label + 's']),
      searchInput,
    );
    if (customFilters) {
      for (const f of customFilters) {
        const sel = el('select', { onChange: (e) => { f.onChange(e.target.value); refresh(); } }, [
          el('option', { value: '' }, [f.placeholder || f.label]),
          ...(f.options || []).map((o) => el('option', { value: o.value, selected: state2.extraParams[f.key] == o.value }, [o.label])),
        ]);
        toolbar.appendChild(sel);
      }
    }
    toolbar.appendChild(el('div', { class: 'spacer' }));
    if (allowCreate && can(e.perms.create)) {
      const addBtn = el('button', { class: 'btn primary' }, ['＋ New ' + meta.label]);
      addBtn.addEventListener('click', () => onCreate ? onCreate(refresh) : openAddModal());
      toolbar.appendChild(addBtn);
    }
    if (allowImport && can('data.import')) {
      toolbar.appendChild(el('button', { class: 'btn', onClick: () => go('admin/imports') }, ['⬆ Import']));
    }
    const filterBtn = el('button', { class: 'btn', onClick: openFilterModal }, ['⌗ Filter' + (state2.conditions ? ' •' : '')]);
    toolbar.appendChild(filterBtn);
    const colsBtn = el('button', { class: 'btn', onClick: openColumnsModal }, ['⊟ Columns']);
    toolbar.appendChild(colsBtn);
    const exportBtn = el('button', { class: 'btn', onClick: doExport }, ['↓ Export']);
    toolbar.appendChild(exportBtn);
  }

  function refresh() {
    syncUrl();
    buildToolbar();
    load();
  }

  async function load() {
    view.innerHTML = '<div class="loading">Loading…</div>';
    const params = { page: state2.page, limit: state2.limit, search: state2.search, ...state2.extraParams };
    if (state2.sort) { params.sort = state2.sort; params.dir = state2.dir; }
    if (state2.conditions) params.conditions = JSON.stringify(state2.conditions);
    try {
      const r = await api.get('/api/' + meta.segment, params);
      state2.data = r.data;
      state2.total = r.meta.total;
      state2.page = r.meta.page;
      state2.limit = r.meta.limit;
      render();
    } catch (err) {
      view.innerHTML = '';
      view.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load']), el('p', { class: 'muted' }, [err.message])]));
    }
  }

  function render() {
    clear(view);
    const rows = state2.data || [];
    if (!rows.length) {
      view.appendChild(el('div', { class: 'empty' }, [
        el('h3', {}, ['No ' + meta.label.toLowerCase() + 's yet']),
        el('p', { class: 'muted' }, [state2.search ? 'Try a different search.' : 'Add the first ' + meta.label.toLowerCase() + ' to get started.']),
        allowCreate && can(e.perms.create) ? el('button', { class: 'btn primary', onClick: () => onCreate ? onCreate(refresh) : openAddModal() }, ['＋ New ' + meta.label]) : null,
      ]));
      return;
    }
    // bulk bar
    if (state2.selected.size) {
      const bb = el('div', { class: 'bulkbar' }, [
        el('div', {}, [`${state2.selected.size} selected`]),
        el('button', { class: 'btn sm', onClick: bulkEdit }, ['Edit']),
        can(e.perms.delete) ? el('button', { class: 'btn sm danger', onClick: bulkDelete }, ['Delete']) : null,
        el('div', { class: 'spacer', style: { flex: '1' } }),
        el('button', { class: 'btn sm ghost', onClick: () => { state2.selected.clear(); render(); } }, ['Clear']),
      ]);
      view.appendChild(bb);
    }
    const table = renderTable(rows);
    const wrapT = el('div', { class: 'table-wrap' }, [table]);
    view.appendChild(wrapT);
    view.appendChild(renderPager());
  }

  function renderTable(rows) {
    const tbl = el('table', { class: 'grid' });
    const thead = el('thead');
    const trh = el('tr');
    const selAll = el('input', { type: 'checkbox', onChange: (e) => {
      if (e.target.checked) rows.forEach((r) => state2.selected.add(r.id));
      else state2.selected.clear();
      render();
    } });
    trh.appendChild(el('th', { style: { width: '28px' } }, [selAll]));
    const cols = state2.columns;
    for (const key of cols) {
      const field = allColumns.find((f) => f.key === key);
      const cf = customFields.find((f) => f.key === key);
      const label = field?.label || cf?.name || key;
      const isSorted = state2.sort === key;
      const th = el('th', {
        class: 'plain',
        onClick: () => {
          if (state2.sort === key) state2.dir = state2.dir === 'asc' ? 'desc' : 'asc';
          else { state2.sort = key; state2.dir = 'asc'; }
          load();
        },
      }, [
        label,
        isSorted ? el('span', { class: 'muted', style: { marginLeft: '4px' } }, [state2.dir === 'asc' ? '▲' : '▼']) : null,
      ]);
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    tbl.appendChild(thead);

    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr', { onClick: (ev) => { if (ev.target.tagName === 'INPUT' || ev.target.closest('.row-actions')) return; openDetail(r); } });
      if (state2.selected.has(r.id)) tr.classList.add('selected');
      const cb = el('input', { type: 'checkbox', checked: state2.selected.has(r.id), onChange: (e) => {
        if (e.target.checked) state2.selected.add(r.id); else state2.selected.delete(r.id);
        e.target.checked = state2.selected.has(r.id);
        tr.classList.toggle('selected', state2.selected.has(r.id));
        renderBulkBar();
      } });
      tr.appendChild(el('td', { class: 'tight' }, [cb]));
      for (const key of cols) tr.appendChild(el('td', {}, [renderCell(r, key)]));
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    return tbl;
  }

  function renderBulkBar() {
    const existing = view.querySelector('.bulkbar');
    if (state2.selected.size && !existing) { render(); return; }
    if (!state2.selected.size && existing) { render(); return; }
    if (existing) {
      existing.firstElementChild.textContent = `${state2.selected.size} selected`;
    }
  }

  function renderCell(r, key) {
    const field = allColumns.find((f) => f.key === key);
    const cf = customFields.find((f) => f.key === key);
    const value = cf ? (r.cf?.[key]) : r[key];
    if (key === 'title' || key === 'name') {
      return el('span', { class: 'cell-link' }, [String(value || '(untitled)')]);
    }
    if (key === 'status') return statusBadge(value);
    if (key === 'org_id') return r.organization ? r.organization.name : '—';
    if (key === 'person_id') return r.person ? r.person.name : '—';
    if (key === 'lead_id') return r.lead ? r.lead.title : '—';
    if (key === 'deal_id') return r.deal ? r.deal.title : '—';
    if (key === 'project_id') return r.project ? r.project.title : '—';
    if (key === 'phase_id') return r.phase ? r.phase.name : '—';
    if (key === 'board_id') return r.board ? r.board.name : '—';
    if (key === 'owner_id' || key === 'assignee_id') return r.owner ? r.owner.name : '—';
    if (key === 'pipeline_id') return r.pipeline ? r.pipeline.name : '—';
    if (key === 'stage_id') return r.stage ? r.stage.name : '—';
    if (key === 'value') return money(value, r.currency);
    if (key === 'next_activity') return r.next_activity ? `${fmtDate(r.next_activity.due_date)} ${r.next_activity.subject || ''}` : '—';
    if (key === 'emails' || key === 'phones') return (Array.isArray(value) && value.length) ? value[0].value : '—';
    if (key === 'label_ids' || key === 'labels') {
      const labs = r.labels || [];
      return el('div', { class: 'inline wrap' }, labs.map((l) => badge(l.name, l.color)));
    }
    if (key === 'done') return value ? el('span', { class: 'badge green' }, ['Done']) : el('span', { class: 'badge gray' }, ['Open']);
    if (key === 'archived' || key === 'active') return value ? badge('Yes', 'green') : badge('No', 'gray');
    if (key === 'due_date' || key === 'created_at' || key === 'updated_at') return fmtDate(value);
    if (field?.type === 'monetary') return money(value, r.currency);
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  }

  function renderPager() {
    const total = state2.total;
    const pages = Math.max(1, Math.ceil(total / state2.limit));
    const cur = state2.page;
    return el('div', { class: 'inline', style: { padding: '10px 4px', gap: '6px' } }, [
      el('span', { class: 'muted' }, [`${total} ${total === 1 ? meta.label.toLowerCase() : meta.label.toLowerCase() + 's'}`]),
      el('div', { class: 'spacer', style: { flex: '1' } }),
      el('button', { class: 'btn sm', disabled: cur <= 1, onClick: () => { state2.page = Math.max(1, cur - 1); load(); } }, ['‹ Prev']),
      el('span', { class: 'muted' }, [`Page ${cur} / ${pages}`]),
      el('button', { class: 'btn sm', disabled: cur >= pages, onClick: () => { state2.page = Math.min(pages, cur + 1); load(); } }, ['Next ›']),
    ]);
  }

  function openDetail(row) {
    drawer({ title: `${meta.label} #${row.id}`, body: el('div', { class: 'loading' }, ['Loading…']), wide: true });
    setTimeout(() => {
      const d = document.querySelector('.drawer');
      const body = d.querySelector('.body');
      clear(body);
      body.appendChild(renderDetail(entityKey, row.id, refresh));
    }, 10);
  }

  async function openAddModal() {
    const m = modal({ title: 'New ' + meta.label, body: el('div', { class: 'loading' }, ['Loading…']), wide: true });
    const body = m.querySelector('.body'); clear(body);
    const { renderAddForm } = await import('./addform.js');
    body.appendChild(renderAddForm(entityKey, async (values) => {
      try {
        await apiAction(api.post('/api/' + meta.segment, values), 'Created');
        m.close();
        refresh();
      } catch {}
    }));
  }

  function openFilterModal() {
    const m = modal({ title: 'Filter ' + meta.label.toLowerCase() + 's', wide: true, body: el('div') });
    import('./filter.js').then((mod) => {
      const body = m.querySelector('.body'); clear(body);
      body.appendChild(mod.renderFilter(entityKey, state2.conditions, (cfg) => { state2.conditions = cfg; state2.page = 1; m.close(); refresh(); }));
    });
  }

  function openColumnsModal() {
    const m = modal({ title: 'Choose columns', body: el('div'), footer: [el('button', { class: 'btn primary', onClick: () => m.close() }, ['Done'])] });
    const body = m.querySelector('.body'); clear(body);
    const allKeys = [...allColumns.map((f) => ({ key: f.key, label: f.label })), ...customFields.map((f) => ({ key: f.key, label: f.name + ' (CF)' }))];
    const wrap = el('div', { class: 'inline wrap' });
    for (const k of allKeys) {
      const has = state2.columns.includes(k.key);
      const cb = el('label', { class: 'checkbox' }, [
        el('input', { type: 'checkbox', checked: has, onChange: (e) => {
          if (e.target.checked && !state2.columns.includes(k.key)) state2.columns.push(k.key);
          else if (!e.target.checked) state2.columns = state2.columns.filter((x) => x !== k.key);
        } }),
        el('span', {}, [k.label]),
      ]);
      wrap.appendChild(cb);
    }
    body.appendChild(wrap);
  }

  async function bulkEdit() {
    const ids = [...state2.selected];
    const m = modal({ title: `Edit ${ids.length} ${meta.label.toLowerCase() + (ids.length > 1 ? 's' : '')}`, wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    const body = m.querySelector('.body'); clear(body);
    const { renderAddForm } = await import('./addform.js');
    body.appendChild(renderAddForm(entityKey, async (values) => {
      try {
        const r = await apiAction(api.post('/api/' + meta.segment + '/bulk', { action: 'edit', ids, values }), `Updated ${ids.length}`);
        state2.selected.clear();
        m.close();
        refresh();
      } catch {}
    }, { bulk: true }));
  }

  async function bulkDelete() {
    if (!await confirmDialog({ title: `Delete ${state2.selected.size} ${meta.label.toLowerCase() + 's'}?`, body: 'Deleted records can be restored within the grace period from the trash.', okText: 'Delete', danger: true })) return;
    const ids = [...state2.selected];
    try {
      await apiAction(api.post('/api/' + meta.segment + '/bulk', { action: 'delete', ids }), 'Deleted');
      state2.selected.clear();
      refresh();
    } catch {}
  }

  async function doExport() {
    const cols = state2.columns;
    const url = `/api/${meta.segment}/export.csv?columns=${encodeURIComponent(cols.join(','))}&limit=10000`;
    const params = new URLSearchParams();
    if (state2.search) params.set('search', state2.search);
    if (state2.conditions) params.set('conditions', JSON.stringify(state2.conditions));
    Object.entries(state2.extraParams || {}).forEach(([k, v]) => v != null && params.set(k, v));
    const full = url + (url.includes('?') ? '&' : '?') + params.toString();
    const res = await fetch(full, { credentials: 'include' });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = meta.segment + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Exported', 'success');
  }

  // parse URL on first mount
  const urlParams = new URLSearchParams(location.hash.split('?')[1] || '');
  if (urlParams.get('page')) state2.page = Number(urlParams.get('page'));
  if (urlParams.get('conditions')) {
    try { state2.conditions = JSON.parse(urlParams.get('conditions')); } catch {}
  }
  if (urlParams.get('view')) state2.view = urlParams.get('view');

  wrap.append(toolbar, view);
  refresh();
  return wrap;
}
