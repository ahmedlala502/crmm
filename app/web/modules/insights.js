// Insights — report builder (entity/measure/group/segment/chart), saved reports, dashboards, goals, AI report.
import { el, clear } from '../lib/dom.js';
import { api, state } from '../lib/api.js';
import { modal, toast, apiAction, money, confirmDialog } from '../lib/ui.js';
import { barChart, lineChart, donutChart, legend } from '../lib/charts.js';
import { go } from '../lib/router.js';

const COLORS = ['#1f6feb', '#17864a', '#a86200', '#6b45c9', '#c9333f', '#1d8fa6', '#5b6270'];

export function renderInsights(params = {}) {
  const wrap = el('div', {});
  const tabBar = el('div', { class: 'tabs' });
  const body = el('div', {});
  const tabs = [
    { key: 'builder', label: 'Report builder', render: () => renderBuilder() },
    { key: 'reports', label: 'Saved reports', render: () => renderSavedReports() },
    { key: 'dashboards', label: 'Dashboards', render: () => renderDashboards() },
    { key: 'goals', label: 'Goals', render: () => renderGoals() },
  ];
  let active = params.tab || 'builder';
  for (const t of tabs) {
    const tab = el('div', { class: 'tab' + (t.key === active ? ' active' : ''), onClick: () => {
      active = t.key;
      for (const x of tabBar.children) x.classList.toggle('active', x === tab);
      clear(body); body.appendChild(t.render());
    } }, [t.label]);
    tabBar.appendChild(tab);
  }
  body.appendChild(tabs.find((t) => t.key === active)?.render() || tabs[0].render());
  wrap.append(tabBar, body);
  return wrap;
}

// ---------------- report builder ----------------
function renderBuilder() {
  const wrap = el('div', {});
  let meta = null;
  const cfg = { entity: 'deal', measure: 'count', group_by: 'stage_id', chart: 'column', conditions: null, segment_by: null, bucket: null, limit: 12 };
  const controls = el('div', { class: 'card pad', style: { marginBottom: '12px' } });
  const resultBox = el('div', {});

  api.get('/api/insights/meta').then((m) => {
    meta = m;
    drawControls();
    run();
  });

  function drawControls() {
    clear(controls);
    const types = meta.report_types;
    const measuresFor = () => (types.find((t) => t.entity === cfg.entity)?.measures || ['count']);
    const fieldsFor = () => meta.fields[cfg.entity] || [];

    const entitySel = el('select', { style: { width: 'auto' } }, types.map((t) => el('option', { value: t.entity, selected: t.entity === cfg.entity }, [t.label])));
    const measureSel = el('select', { style: { width: 'auto' } }, measuresFor().map((mm) => el('option', { value: mm, selected: mm === cfg.measure }, [mm === 'count' ? 'Count' : mm.replace(':', ' of ').replace('sum:', 'Sum of ').replace('avg:', 'Avg of ')])));
    const groupSel = el('select', { style: { width: 'auto' } }, [el('option', { value: '' }, ['— none —']), ...fieldsFor().map((f) => el('option', { value: f.key, selected: f.key === cfg.group_by }, [f.label]))]);
    const segmentSel = el('select', { style: { width: 'auto' } }, [el('option', { value: '' }, ['— none —']), ...fieldsFor().map((f) => el('option', { value: f.key, selected: f.key === cfg.segment_by }, [f.label]))]);
    const chartSel = el('select', { style: { width: 'auto' } }, meta.chart_types.map((c) => el('option', { value: c, selected: c === cfg.chart }, [c])));

    entitySel.addEventListener('change', () => { cfg.entity = entitySel.value; cfg.measure = 'count'; cfg.group_by = 'stage_id'; cfg.segment_by = null; drawControls(); run(); });
    measureSel.addEventListener('change', () => { cfg.measure = measureSel.value; run(); });
    groupSel.addEventListener('change', () => { cfg.group_by = groupSel.value || null; run(); });
    segmentSel.addEventListener('change', () => { cfg.segment_by = segmentSel.value || null; run(); });

    controls.append(
      el('div', { class: 'inline wrap' }, [
        el('span', { class: 'muted', style: { fontSize: '12px' } }, ['Entity']), entitySel,
        el('span', { class: 'muted', style: { fontSize: '12px' } }, ['Measure']), measureSel,
        el('span', { class: 'muted', style: { fontSize: '12px' } }, ['Group by']), groupSel,
        el('span', { class: 'muted', style: { fontSize: '12px' } }, ['Segment by']), segmentSel,
      ]),
      el('div', { class: 'inline', style: { marginTop: '8px' } }, [
        el('input', { type: 'text', id: 'ai-prompt', placeholder: 'Or describe a report in plain English…', style: { width: '380px' } }),
        el('button', { class: 'btn sm', onClick: async () => {
          const prompt = controls.querySelector('#ai-prompt').value;
          if (!prompt.trim()) return;
          try {
            const r = await api.post('/api/insights/ai', { prompt, entity: cfg.entity });
            if (r.config) { Object.assign(cfg, r.config); drawControls(); run(); toast('AI configured the report', 'success'); }
            else toast(r.error || 'AI could not interpret that', 'error');
          } catch (err) { toast(err.message, 'error'); }
        } }, ['✨ Build with AI']),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn sm', onClick: saveReportModal }, ['💾 Save report']),
        el('button', { class: 'btn sm', onClick: exportCsv }, ['↓ Export CSV']),
      ]),
    );
  }

  async function run() {
    resultBox.innerHTML = '<div class="loading">Running report…</div>';
    try {
      const r = await api.post('/api/insights/run', { ...cfg });
      paintResult(r);
    } catch (err) {
      resultBox.innerHTML = '';
      resultBox.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Report failed']), el('p', { class: 'muted' }, [err.message])]));
    }
  }

  function paintResult(r) {
    clear(resultBox);
    const card = el('div', { class: 'card' }, [el('header', {}, [el('h2', {}, [r.label || 'Report']), el('span', { class: 'badge' }, [r.type || '']), el('div', { class: 'spacer' }), el('span', { class: 'muted', style: { fontSize: '11.5px' } }, [`${r.total ?? ''}`])])]);
    const bodyEl = el('div', { class: 'body' });

    if (r.type === 'segmented') {
      const series = r.series || [];
      const data = (series[0]?.data || []).map((v, i) => ({ label: r.categories[i], v }));
      if (['bar', 'column'].includes(cfg.chart)) bodyEl.appendChild(barChart(data.map((d) => ({ label: shortLabel(d.label), v: d.v ?? d }))));
      else if (['line', 'area'].includes(cfg.chart)) bodyEl.appendChild(lineChart(data.map((d) => d.v ?? d), { labels: (r.categories || []).map(shortLabel) }));
      else if (cfg.chart === 'pie') { bodyEl.appendChild(donutChart(data.map((d) => ({ label: d.label, v: d.v ?? d })))); bodyEl.appendChild(legend((r.categories || []).map((c, i) => ({ label: c, v: (series[0]?.data || [])[i] ?? '', color: COLORS[i % COLORS.length] })))); }
      else bodyEl.appendChild(tableFor([{ key: 'group', label: 'Group' }, ...series.map((s) => ({ key: s.name, label: s.name }))], r.categories.map((c, i) => ({ group: c, ...Object.fromEntries(series.map((s) => [s.name, s.data[i]])) }))));
    } else {
      const rows = r.rows || [];
      if (cfg.chart === 'number') {
        bodyEl.appendChild(el('div', { class: 'stat' }, [el('div', { class: 'k' }, [r.label || 'Total']), el('div', { class: 'v' }, [String(rows[0]?.value ?? r.total ?? '')])]));
      } else if (['bar', 'column'].includes(cfg.chart)) {
        bodyEl.appendChild(barChart(rows.map((row) => ({ label: shortLabel(row.group ?? row.label ?? ''), v: row.value }))));
      } else if (cfg.chart === 'pie') {
        bodyEl.appendChild(donutChart(rows.map((row) => ({ label: row.group ?? row.label, v: row.value }))));
      } else if (['line', 'area'].includes(cfg.chart)) {
        bodyEl.appendChild(lineChart(rows.map((row) => row.value), { labels: rows.map((row) => shortLabel(row.group ?? row.label ?? '')) }));
      }
      // detail table under the chart
      if (rows.length) bodyEl.appendChild(tableFor(colsFromRow(rows[0]), rows));
    }

    // drill-down
    if (r.categories || (r.rows || []).length) {
      bodyEl.appendChild(el('div', { class: 'muted', style: { margin: '10px 0 4px', fontSize: '11.5px' } }, ['Click a bar/row to drill into records.']));
    }

    card.appendChild(bodyEl);
    resultBox.appendChild(card);
  }

  function drill(groupKey) {
    const m = modal({ title: `Detail: ${groupKey}`, wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    api.post('/api/insights/detail', { config: cfg, group_key: groupKey, limit: 200 }).then((r) => {
      const bodyEl = m.querySelector('.body'); clear(bodyEl);
      const rows = r.data || [];
      if (!rows.length) { bodyEl.appendChild(el('div', { class: 'empty' }, ['No records.'])); return; }
      const tbl = el('table', { class: 'grid' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['Title']), el('th', { class: 'num' }, ['Value']), el('th', {}, ['Status']), el('th', {}, ['Owner'])])]),
        el('tbody', {}, rows.map((row) => el('tr', {}, [
          el('td', {}, [el('a', { class: 'cell-link', href: `#/${cfg.entity}s/${row.id}` }, [row.title || row.name || `#${row.id}`])]),
          el('td', { class: 'num' }, [row.value != null ? money(row.value, row.currency) : '—']),
          el('td', {}, [row.status || '—']),
          el('td', {}, [row.owner?.name || '—']),
        ]))),
      ]);
      bodyEl.appendChild(tbl);
    }).catch((err) => { m.querySelector('.body').innerHTML = `<div class="empty">${err.message}</div>`; });
  }

  async function exportCsv() {
    try {
      const res = await fetch('/api/insights/export.csv', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: cfg }), credentials: 'include',
      });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'report.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) { toast(err.message, 'error'); }
  }

  function saveReportModal() {
    const name = el('input', { type: 'text', placeholder: 'Report name', style: { width: '260px' } });
    const shared = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: true }), ' shared']);
    const m = modal({ title: 'Save report', body: el('div', { class: 'inline' }, [name, shared]), footer: [
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        if (!name.value.trim()) return;
        try {
          await apiAction(api.post('/api/reports', { name: name.value, entity: cfg.entity, config: cfg, shared: shared.querySelector('input').checked }), 'Report saved');
          m.close();
        } catch {}
      } }, ['Save']),
    ] });
  }

  wrap.append(controls, resultBox);
  return wrap;
}

function shortLabel(s) {
  return String(s == null ? '' : s).replace(/^20\d\d-/, '').replace(/^20\d\d-/, '').slice(0, 10);
}
function colsFromRow(row) {
  return Object.keys(row).map((k) => ({ key: k, label: k.replace(/_/g, ' ') }));
}
function tableFor(cols, rows) {
  const tbl = el('table', { class: 'grid' }, [
    el('thead', {}, [el('tr', {}, cols.map((c) => el('th', { class: /^value|v$/.test(c.key) ? 'num' : '' }, [c.label])))]),
    el('tbody', {}, rows.map((r) => el('tr', {}, cols.map((c) => el('td', { class: c.num ? 'num' : '' }, [fmtCell(r[c.key])]))))),
  ]);
  return el('div', { class: 'table-wrap', style: { maxHeight: '320px', overflow: 'auto', marginTop: '8px' } }, [tbl]);
}
function fmtCell(v) {
  if (v == null) return '—';
  if (typeof v === 'number') return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v);
}

// ---------------- saved reports ----------------
function renderSavedReports() {
  const wrap = el('div', {});
  const box = el('div', { class: 'cards cols-2' });
  wrap.appendChild(box);
  load();
  async function load() {
    box.innerHTML = '<div class="loading">Loading…</div>';
    const reports = await api.get('/api/reports').catch(() => []);
    clear(box);
    if (!reports.length) { box.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, ['No saved reports yet — build one in the Report builder tab and click Save.'])])); return; }
    for (const r of reports) {
      const card = el('div', { class: 'card' }, [
        el('header', {}, [
          el('h2', {}, [r.name]),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn sm', onClick: () => openReport(r) }, ['Open']),
          el('button', { class: 'btn sm danger', onClick: async () => {
            if (!await confirmDialog({ title: `Delete report "${r.name}"?`, okText: 'Delete', danger: true })) return;
            try { await apiAction(api.del(`/api/reports/${r.id}`), 'Deleted'); load(); } catch {}
          } }, ['✕']),
        ]),
        el('div', { class: 'body muted', style: { fontSize: '12px' } }, [`${r.entity || r.config?.entity || ''} report · saved ${fmtDate(r.created_at)}`]),
      ]);
      box.appendChild(card);
    }
  }
  function fmtDate(s) { return String(s || '').slice(0, 10); }
  function openReport(r) {
    // switch to builder tab via hash param is complex; simplest: open result in modal
    const m = modal({ title: r.name, wide: true, body: el('div', { class: 'loading' }, ['Running…']) });
    api.get(`/api/reports/${r.id}`).then((full) => {
      const bodyEl = m.querySelector('.body'); clear(bodyEl);
      const res = full.result || {};
      if (res.type === 'segmented') {
        bodyEl.appendChild(legend(res.categories.map((c, i) => ({ label: c, v: (res.series?.[0]?.data || [])[i] ?? '', color: COLORS[i % COLORS.length] }))));
        bodyEl.appendChild(barChart((res.categories || []).map((c, i) => ({ label: c, v: res.series?.[0]?.data?.[i] ?? 0 }))));
      } else {
        bodyEl.appendChild(barChart((res.rows || []).map((row) => ({ label: row.group ?? row.label ?? '', v: row.value }))));
        if (res.rows?.length) bodyEl.appendChild(tableFor(colsFromRow(res.rows[0]), res.rows));
      }
    }).catch((err) => { m.querySelector('.body').innerHTML = `<div class="empty">${err.message}</div>`; });
  }
  return wrap;
}

// ---------------- dashboards ----------------
function renderDashboards() {
  const wrap = el('div', {});
  const bar = el('div', { class: 'toolbar' }, [
    el('h2', {}, ['Dashboards']),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn primary sm', onClick: createDashboard }, ['＋ New dashboard']),
  ]);
  const box = el('div', {});
  wrap.append(bar, box);
  load();
  async function load() {
    box.innerHTML = '<div class="loading">Loading…</div>';
    const dashboards = await api.get('/api/dashboards').catch(() => []);
    clear(box);
    if (!dashboards.length) {
      box.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, ['No dashboards yet. Create one, then add saved reports or goals as tiles.'])]));
      return;
    }
    for (const d of dashboards) {
      box.appendChild(el('div', { class: 'card', style: { marginBottom: '12px' } }, [
        el('header', {}, [
          el('h2', {}, [d.name]),
          d.shared ? el('span', { class: 'badge blue' }, ['Shared']) : null,
          d.public_token ? el('a', { class: 'badge green', href: `/public/dashboards/${d.public_token}`, target: '_blank' }, ['Public link']) : null,
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn sm', onClick: () => openDashboard(d.id) }, ['Open']),
          el('button', { class: 'btn sm', onClick: () => shareDashboard(d, load) }, ['Share']),
          el('button', { class: 'btn sm danger', onClick: async () => {
            if (!await confirmDialog({ title: `Delete dashboard "${d.name}"?`, okText: 'Delete', danger: true })) return;
            try { await apiAction(api.del(`/api/dashboards/${d.id}`), 'Deleted'); load(); } catch {}
          } }, ['✕']),
        ]),
        el('div', { class: 'body muted', style: { fontSize: '12px' } }, [`${(d.layout || []).length} tiles`]),
      ]));
    }
  }
  async function openDashboard(id) {
    const m = modal({ title: 'Dashboard', wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    const d = await api.get(`/api/dashboards/${id}`);
    m.querySelector('header h2').textContent = d.name;
    const bodyEl = m.querySelector('.body'); clear(bodyEl);
    const grid = el('div', { class: 'cards cols-2' });
    for (const tile of d.tiles || []) {
      const card = el('div', { class: 'card pad' });
      if (tile.error) { card.append(el('h3', {}, [tile.name || 'Tile']), el('div', { class: 'muted' }, [tile.error])); }
      else if (tile.type === 'goal' && tile.data) {
        const pct = Math.max(0, Math.min(100, Number(tile.data.progress || 0)));
        card.append(
          el('h3', {}, [tile.name || tile.data.name || 'Goal']),
          el('div', { class: 'progressbar', style: { marginTop: '6px' } }, [el('i', { style: { width: `${pct}%` } })]),
          el('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '4px' } }, [`${tile.data.actual ?? 0} of ${tile.data.target ?? '—'} (${pct}%)`]),
        );
      } else if (tile.data) {
        card.append(el('h3', { style: { marginBottom: '6px' } }, [tile.name || 'Report']));
        const res = tile.data;
        if (res.type === 'segmented') card.appendChild(barChart((res.categories || []).map((c, i) => ({ label: c, v: res.series?.[0]?.data?.[i] ?? 0 }))));
        else if (res.rows) card.appendChild(barChart((res.rows || []).slice(0, 8).map((row) => ({ label: String(row.group ?? row.label ?? '').slice(0, 12), v: row.value }))));
      }
      grid.appendChild(card);
    }
    bodyEl.appendChild(grid);
  }
  function createDashboard() {
    const name = el('input', { type: 'text', placeholder: 'Dashboard name', style: { width: '260px' } });
    const m = modal({ title: 'New dashboard', body: el('div', {}, [name]), footer: [
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        try { await apiAction(api.post('/api/dashboards', { name: name.value, layout: [] }), 'Dashboard created'); m.close(); load(); } catch {}
      } }, ['Create']),
    ] });
  }
  async function shareDashboard(d, done) {
    const m = modal({ title: 'Sharing', body: el('div', { class: 'grid-2' }, [
      el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', id: 'sh-team', checked: !!d.shared }), ' Visible to whole team']),
      el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', id: 'sh-public', checked: !!d.public_token }), ' Public view-only link']),
    ]), footer: [
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        try {
          await apiAction(api.patch(`/api/dashboards/${d.id}`, { shared: m.querySelector('#sh-team').checked }), 'Saved');
          const wantPublic = m.querySelector('#sh-public').checked;
          if (!!wantPublic !== !!d.public_token) await api.post(`/api/dashboards/${d.id}/share`, { enabled: wantPublic });
          m.close(); done();
        } catch {}
      } }, ['Save']),
    ] });
  }
  return wrap;
}

// ---------------- goals ----------------
function renderGoals() {
  const wrap = el('div', {});
  const bar = el('div', { class: 'toolbar' }, [
    el('h2', {}, ['Goals']),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn primary sm', onClick: createGoal }, ['＋ New goal']),
  ]);
  const box = el('div', {});
  wrap.append(bar, box);
  load();
  async function load() {
    box.innerHTML = '<div class="loading">Loading…</div>';
    const goals = await api.get('/api/goals').catch(() => []);
    clear(box);
    if (!goals.length) { box.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, ['No goals yet. Track deal count/value or activity counts.'])])); return; }
    const grid = el('div', { class: 'cards cols-3' });
    for (const g of goals) {
      const pct = Math.max(0, Math.min(100, Number(g.progress || 0)));
      grid.appendChild(el('div', { class: 'card pad' }, [
        el('div', { class: 'inline' }, [
          el('strong', {}, [g.name]),
          el('div', { class: 'spacer' }),
          el('span', { class: 'badge blue' }, [g.metric || '']),
        ]),
        el('div', { class: 'progressbar', style: { marginTop: '8px' } }, [el('i', { style: { width: pct + '%' } })]),
        el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '6px' } }, [`${g.actual ?? 0} of ${g.target} (${pct}%) · ${g.interval}`]),
        el('div', { class: 'inline', style: { marginTop: '8px' } }, [
          el('button', { class: 'btn sm', onClick: () => editGoal(g) }, ['Edit']),
          el('button', { class: 'btn sm danger', onClick: async () => {
            if (!await confirmDialog({ title: `Delete goal "${g.name}"?`, okText: 'Delete', danger: true })) return;
            try { await apiAction(api.del(`/api/goals/${g.id}`), 'Deleted'); load(); } catch {}
          } }, ['Delete']),
        ]),
      ]));
    }
    box.appendChild(grid);
  }
  function createGoal() { editGoal(null); }
  function editGoal(g) {
    const metricSel = el('select', {}, [
      el('option', { value: 'deals_won_value' }, ['Won deal value']),
      el('option', { value: 'deals_won_count' }, ['Won deal count']),
      el('option', { value: 'deals_started' }, ['Deals started']),
      el('option', { value: 'deals_progressed' }, ['Deals progressed']),
      el('option', { value: 'expected_revenue' }, ['Expected revenue']),
      el('option', { value: 'activities_done' }, ['Activities completed']),
      el('option', { value: 'leads_created' }, ['Leads created']),
    ]);
    const name = el('input', { type: 'text', value: g?.name || '', style: { width: '240px' } });
    const target = el('input', { type: 'number', value: g?.target ?? 10000, style: { width: '140px' } });
    const interval = el('select', {}, ['monthly', 'quarterly', 'yearly'].map((x) => el('option', { value: x, selected: g?.interval === x }, [x])));
    const pipeline = el('select', {}, [el('option', { value: '' }, ['— all pipelines —']), ...(state.ref?.pipelines || []).map((p) => el('option', { value: p.id, selected: g?.pipeline_id === p.id }, [p.name]))]);
    const m = modal({ title: g ? `Edit goal: ${g.name}` : 'New goal', body: el('div', { class: 'grid-2' }, [
      el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Name']), name]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Metric']), metricSel]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Target']), target]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Interval']), interval]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Pipeline (optional)']), pipeline]),
    ]), footer: [
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        const payload = { name: name.value, metric: metricSel.value, target: Number(target.value), interval: interval.value, pipeline_id: pipeline.value ? Number(pipeline.value) : null };
        try {
          if (g) await apiAction(api.patch(`/api/goals/${g.id}`, payload), 'Goal saved');
          else await apiAction(api.post('/api/goals', payload), 'Goal created');
          m.close(); load();
        } catch {}
      } }, ['Save']),
    ] });
  }
  return wrap;
}