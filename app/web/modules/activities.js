// Activities — calendar + list views, summary tiles, bulk creation, scheduler links.
import { el, clear } from '../lib/dom.js';
import { listView } from './list.js';
import { api, state, can } from '../lib/api.js';
import { modal, drawer, toast, apiAction, fmtDate, fmtDateTime } from '../lib/ui.js';
import { renderDetail } from './detail.js';
import { go } from '../lib/router.js';

export function renderActivities(params = {}) {
  const wrap = el('div', {});
  const mode = params.view === 'list' ? 'list' : 'calendar';

  const switchBar = el('div', { class: 'inline', style: { marginBottom: '8px' } }, [
    el('div', { class: 'btn-group' }, [
      el('button', { class: 'btn sm' + (mode === 'calendar' ? ' active' : ''), onClick: () => go('activities') }, ['▦ Calendar']),
      el('button', { class: 'btn sm' + (mode === 'list' ? ' active' : ''), onClick: () => go('activities?view=list') }, ['☰ List']),
    ]),
  ]);
  const container = el('div', {});
  wrap.append(switchBar, container);

  const summaryBar = el('div', { class: 'cards cols-4', style: { marginBottom: '12px' } });
  api.get('/api/activities/summary').then((s) => {
    clear(summaryBar);
    summaryBar.append(
      statTile('Overdue', s.overdue, 'red'),
      statTile('Due today', s.today, 'amber'),
      statTile('Upcoming', s.upcoming, 'blue'),
      statTile('Done this week', s.done_this_week, 'green'),
    );
  }).catch(() => {});

  if (mode === 'calendar') container.appendChild(renderCalendar());
  else container.appendChild(listView('activity', { title: 'Activities', allowCreate: true }));

  wrap.append(summaryBar, container);
  return wrap;
}

function statTile(k, v, tone) {
  return el('div', { class: 'card stat' }, [
    el('div', { class: 'k' }, [k]),
    el('div', { class: 'v' }, [String(v ?? 0)]),
    el('div', { class: 'sub' }, ['Open activities']),
  ]);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function renderCalendar() {
  const wrap = el('div', {});
  const today = new Date();
  let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
  let assignee = '';

  const bar = el('div', { class: 'toolbar' }, [
    el('h2', {}, []),
    el('button', { class: 'btn sm', onClick: () => shift(-1) }, ['‹']),
    el('button', { class: 'btn sm', onClick: () => { cursor = new Date(); load(); renderBar(); } }, ['Today']),
    el('button', { class: 'btn sm', onClick: () => shift(1) }, ['›']),
    el('select', { style: { width: 'auto' }, onChange: (e) => { assignee = e.target.value; load(); } }, [
      el('option', { value: '' }, ['Everyone']),
      ...(state.ref?.users || []).map((u) => el('option', { value: u.id }, [u.name])),
    ]),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn primary sm', onClick: openBulkCreate }, ['＋ Schedule activities']),
    can('admin.settings') || state.me?.user?.is_admin ? el('button', { class: 'btn sm', onClick: openSchedulerLinks }, ['⧗ Scheduler links']) : null,
  ]);
  const labelEl = bar.querySelector('h2');
  const grid = el('div', {});

  function shift(n) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
    load();
  }

  function renderBar() {
    labelEl.textContent = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  }

  async function load() {
    renderBar();
    grid.innerHTML = '<div class="loading">Loading…</div>';
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1).toISOString().slice(0, 10);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).toISOString().slice(0, 10);
    try {
      const res = await api.get('/api/calendar', { from, to, ...(assignee ? { assignee_id: assignee } : {}) });
      paint(res);
    } catch (err) {
      grid.innerHTML = '';
      grid.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load calendar']), el('p', { class: 'muted' }, [err.message])]));
    }
  }

  function paint(res) {
    clear(grid);
    const todayIso = new Date().toISOString().slice(0, 10);
    const cal = el('div', { class: 'cal' });
    for (const d of DOW) cal.appendChild(el('div', { class: 'cal-head' }, [d]));
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const lead = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - startOffset);
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(lead.getFullYear(), lead.getMonth(), lead.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const cell = el('div', { class: 'cal-day' + (d.getMonth() !== cursor.getMonth() ? ' other' : '') + (iso === todayIso ? ' today' : '') }, [
        el('div', { class: 'daynum' }, [String(d.getDate())]),
        ...(res.by_date[iso] || []).slice(0, 4).map((a) => {
          const cls = a.done ? 'done' : (a.due_date < todayIso ? 'overdue' : '');
          const ev = el('div', { class: 'cal-ev ' + cls, title: `${a.subject} (${a.type_name || a.type_key || ''})` }, [
            (a.due_time ? a.due_time + ' ' : '') + (a.subject || '(untitled)'),
          ]);
          ev.addEventListener('click', () => openActivity(a.id));
          return ev;
        }),
        (res.by_date[iso] || []).length > 4 ? el('div', { class: 'dim', style: { fontSize: '10.5px' } }, [`+${res.by_date[iso].length - 4} more`]) : null,
      ]);
      cal.appendChild(cell);
    }
    grid.appendChild(cal);
  }

  function openActivity(id) {
    drawer({ title: `Activity #${id}`, body: el('div', { class: 'loading' }, ['Loading…']), wide: true });
    setTimeout(() => {
      const d = document.querySelector('.drawer');
      if (!d) return;
      const body = d.querySelector('.body');
      clear(body);
      body.appendChild(renderDetail('activity', id, load));
    }, 10);
  }

  load();
  wrap.append(bar, grid);
  return wrap;
}

function openBulkCreate() {
  const m = modal({
    title: 'Schedule activities (bulk)',
    body: el('div', { class: 'grid-2' }, [
      el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Subject']), el('input', { type: 'text', id: 'bc-subject', placeholder: 'e.g. Follow-up call' })]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Type']), el('select', { id: 'bc-type' }, (state.ref?.activity_types || []).map((t) => el('option', { value: t.key_string }, [t.name])))]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Assignee']), el('select', { id: 'bc-assignee' }, (state.ref?.users || []).map((u) => el('option', { value: u.id, selected: u.id === state.me?.user?.id }, [u.name])))]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Time (optional)']), el('input', { type: 'time', id: 'bc-time' })]),
      el('label', { class: 'field', style: { gridColumn: '1 / -1' } }, [el('span', { class: 'lbl' }, ['Dates (one per line)']), el('textarea', { id: 'bc-dates', style: { minHeight: '90px' }, placeholder: new Date().toISOString().slice(0, 10) })]),
    ]),
    footer: [
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        const dates = m.querySelector('#bc-dates').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (!m.querySelector('#bc-subject').value.trim() || !dates.length) { toast('Subject and at least one date are required', 'error'); return; }
        try {
          const r = await apiAction(api.post('/api/activities/bulk-create', {
            subject: m.querySelector('#bc-subject').value,
            type_key: m.querySelector('#bc-type').value,
            assignee_id: Number(m.querySelector('#bc-assignee').value),
            due_time: m.querySelector('#bc-time').value || null,
            dates,
          }), `Created ${dates.length} activities`);
          m.close();
          location.reload();
        } catch {}
      } }, ['Create']),
    ],
  });
}

function openSchedulerLinks() {
  const m = modal({ title: 'Meeting scheduler links', wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
  const body = m.querySelector('.body');
  load();
  async function load() {
    const links = await api.get('/api/scheduler/links');
    clear(body);
    const rows = el('div', { class: 'table-wrap' });
    const tbl = el('table', { class: 'grid' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Name']), el('th', {}, ['Link']), el('th', {}, ['Created'])])]),
      el('tbody', {}, links.map((l) => el('tr', {}, [
        el('td', {}, [l.name || `Link #${l.id}`]),
        el('td', {}, [el('a', { href: `/public/forms/${l.token}`, target: '_blank' }, [`${location.origin}/public/forms/${l.token}`])]),
        el('td', {}, [fmtDate(l.created_at)]),
      ]))),
    ]);
    const name = el('input', { type: 'text', placeholder: 'Link name (e.g. 30 min intro call)', style: { width: '260px' } });
    const duration = el('select', { style: { width: 'auto' } }, [30, 45, 60].map((n) => el('option', { value: n }, [`${n} minutes`])));
    const create = el('button', { class: 'btn primary sm', onClick: async () => {
      try {
        await apiAction(api.post('/api/scheduler/links', { name: name.value || undefined, duration: Number(duration.value) }), 'Link created');
        load();
      } catch {}
    } }, ['＋ New link']);
    body.append(
      el('div', { class: 'inline', style: { marginBottom: '10px' } }, [name, duration, create]),
      rows,
    );
  }
}