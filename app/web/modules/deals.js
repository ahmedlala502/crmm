import { el, clear } from '../lib/dom.js';
import { listView } from './list.js';
import { renderDetail } from './detail.js';
import { api, state, can } from '../lib/api.js';
import { drawer, modal, toast, apiAction, money, fmtDate, relTime, statusBadge } from '../lib/ui.js';
import { go } from '../lib/router.js';

export function renderDealsList(params = {}) {
  const wrap = el('div', {});
  const switchBar = el('div', { class: 'inline', style: { marginBottom: '8px' } }, [
    el('div', { class: 'btn-group' }, [
      el('button', { class: 'btn sm active', onClick: () => go('deals') }, ['☰ List']),
      el('button', { class: 'btn sm', onClick: () => go('deals/board') }, ['⊞ Board']),
    ]),
  ]);
  const list = listView('deal', {
    title: 'Deals',
    extraParams: { status: params.status || 'open' },
    customFilters: [
      {
        key: 'status', label: 'Status', placeholder: 'All statuses',
        options: [
          { value: 'open', label: 'Open' },
          { value: 'won', label: 'Won' },
          { value: 'lost', label: 'Lost' },
        ],
        onChange: (v) => {},
      },
    ],
  });
  wrap.append(switchBar, list);
  return wrap;
}

export function renderDealBoard(params = {}) {
  const wrap = el('div', { style: { height: '100%', display: 'flex', flexDirection: 'column' } });
  const pipelines = state.ref?.pipelines || [];
  let currentPipelineId = params.pipelineId ? Number(params.pipelineId) : (pipelines[0]?.id || 1);

  const top = el('div', { class: 'toolbar', style: { flex: 'none' } });
  const pipeSel = el('select', { style: { fontWeight: '600', width: 'auto' }, onChange: (e) => {
    currentPipelineId = Number(e.target.value);
    loadBoard();
  } }, pipelines.map((p) => el('option', { value: p.id, selected: p.id === currentPipelineId }, [p.name])));

  const filterOwner = el('select', { style: { width: 'auto' }, onChange: () => loadBoard() }, [
    el('option', { value: '' }, ['Everyone']),
    ...(state.ref?.users || []).map((u) => el('option', { value: u.id }, [u.name])),
  ]);

  const viewSwitch = el('div', { class: 'btn-group' }, [
    el('button', { class: 'btn sm', onClick: () => go('deals') }, ['☰ List']),
    el('button', { class: 'btn sm active' }, ['⊞ Board']),
  ]);

  const newDealBtn = el('button', { class: 'btn primary sm', onClick: openNewDealModal }, ['＋ New Deal']);

  top.append(
    el('h2', { style: { marginRight: '8px' } }, ['Deals']),
    viewSwitch,
    pipeSel,
    filterOwner,
    el('div', { class: 'spacer' }),
    newDealBtn,
  );

  const boardEl = el('div', { class: 'kanban', style: { flex: '1', minHeight: '0' } });
  wrap.append(top, boardEl);

  async function loadBoard() {
    boardEl.innerHTML = '<div class="loading">Loading board…</div>';
    try {
      const q = {};
      if (filterOwner.value) q.owner_id = filterOwner.value;
      const res = await api.get(`/api/pipeline/${currentPipelineId}/board`, q);
      renderBoard(res);
    } catch (err) {
      boardEl.innerHTML = '';
      boardEl.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load board']), el('p', { class: 'muted' }, [err.message])]));
    }
  }

  function renderBoard(data) {
    clear(boardEl);
    const stages = data.stages || [];

    for (const st of stages) {
      const col = el('div', { class: 'kcol', 'data-stage-id': String(st.id) });

      // Column header
      const header = el('header', {}, [
        el('div', { class: 'kname' }, [
          el('span', {}, [st.name]),
          st.probability != null && st.probability < 100 ? el('span', { class: 'dim', style: { fontSize: '11px' } }, [`${st.probability}%`]) : null,
        ]),
        el('div', { class: 'kmeta' }, [
          el('span', {}, [money(st.total_value, data.pipeline?.currency || 'USD')]),
          el('span', { class: 'dim' }, [`${st.count} ${st.count === 1 ? 'deal' : 'deals'}`]),
          st.rotten > 0 ? el('span', { class: 'badge red', style: { marginLeft: 'auto' } }, [`${st.rotten} rotten`]) : null,
        ]),
      ]);

      const list = el('div', { class: 'klist' });

      // Drag & Drop handlers on list container
      list.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      list.addEventListener('dragleave', () => {
        col.classList.remove('drag-over');
      });
      list.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const dealId = e.dataTransfer.getData('text/plain');
        if (!dealId) return;
        try {
          await apiAction(api.post(`/api/deals/${dealId}/move`, { stage_id: st.id }), 'Deal moved');
          loadBoard();
        } catch {}
      });

      for (const d of st.deals || []) {
        list.appendChild(createDealCard(d, st));
      }

      col.append(header, list);
      boardEl.appendChild(col);
    }
  }

  function createDealCard(d, st) {
    const card = el('div', {
      class: `kcard state-${d.activity_state || 'none'}`,
      draggable: 'true',
    });

    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', String(d.id));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });

    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      openDealDrawer(d.id);
    });

    const titleEl = el('div', { class: 'ktitle truncate' }, [d.title]);
    const valRow = el('div', { class: 'krow' }, [
      el('strong', {}, [money(d.value, d.currency)]),
      d.score != null ? el('span', { class: 'badge purple', style: { marginLeft: 'auto' } }, [`${d.score} pts`]) : null,
    ]);

    const orgPersonRow = el('div', { class: 'krow dim' }, [
      d.organization ? el('span', { class: 'truncate' }, [d.organization.name]) : null,
      d.organization && d.person ? ' · ' : null,
      d.person ? el('span', { class: 'truncate' }, [d.person.name]) : null,
    ]);

    const foot = el('div', { class: 'kfoot' }, [
      d.next_activity ? el('span', { class: `badge ${d.activity_state === 'overdue' ? 'red' : (d.activity_state === 'today' ? 'amber' : 'green')}` }, [
        d.next_activity.subject || fmtDate(d.next_activity.due_date),
      ]) : el('span', { class: 'badge gray' }, ['No activity']),
      el('div', { class: 'spacer', style: { flex: '1' } }),
      d.owner ? el('span', { class: 'dim', style: { fontSize: '11px' } }, [d.owner.name.split(' ')[0]]) : null,
    ]);

    card.append(titleEl, valRow, orgPersonRow, foot);
    return card;
  }

  function openDealDrawer(id) {
    drawer({ title: `Deal #${id}`, body: el('div', { class: 'loading' }, ['Loading…']), wide: true });
    setTimeout(() => {
      const d = document.querySelector('.drawer');
      if (!d) return;
      const body = d.querySelector('.body');
      clear(body);
      body.appendChild(renderDetail('deal', id, loadBoard));
    }, 10);
  }

  async function openNewDealModal() {
    const m = modal({ title: 'New Deal', wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    const body = m.querySelector('.body');
    clear(body);
    const { renderAddForm } = await import('./addform.js');
    body.appendChild(renderAddForm('deal', async (values) => {
      try {
        if (!values.pipeline_id) values.pipeline_id = currentPipelineId;
        await apiAction(api.post('/api/deals', values), 'Deal created');
        m.close();
        loadBoard();
      } catch {}
    }));
  }

  loadBoard();
  return wrap;
}

export function renderDealDetail(id) {
  return renderDetail('deal', Number(id));
}
