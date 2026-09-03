// Projects — post-sale delivery: list view, project boards by phase, deal handoff, templates.
import { el, clear } from '../lib/dom.js';
import { listView } from './list.js';
import { api, state, can } from '../lib/api.js';
import { modal, drawer, toast, apiAction, fmtDate } from '../lib/ui.js';
import { renderDetail } from './detail.js';
import { go } from '../lib/router.js';

export function renderProjects(params = {}) {
  const wrap = el('div', {});
  const view = params.view === 'board' ? 'board' : 'list';
  const switchBar = el('div', { class: 'inline', style: { marginBottom: '8px' } }, [
    el('div', { class: 'btn-group' }, [
      el('button', { class: 'btn sm' + (view === 'list' ? ' active' : ''), onClick: () => go('projects') }, ['☰ List']),
      el('button', { class: 'btn sm' + (view === 'board' ? ' active' : ''), onClick: () => go('projects?view=board') }, ['▦ Board']),
    ]),
  ]);
  const container = el('div', {});
  container.appendChild(view === 'board' ? renderProjectBoards() : listView('project', { title: 'Projects', allowCreate: true, allowImport: true }));
  wrap.append(switchBar, container);
  return wrap;
}

function renderProjectBoards() {
  const wrap = el('div', {});
  const boardSel = el('select', { style: { width: 'auto', fontWeight: '600' } });
  const boardEl = el('div', { class: 'kanban' });

  api.get('/api/project-boards').then((boards) => {
    clear(boardSel);
    if (!boards.length) {
      boardSel.appendChild(el('option', {}, ['No boards configured']));
      return;
    }
    for (const b of boards) boardSel.appendChild(el('option', { value: b.id }, [b.name]));
    boardSel.value = String(boards[0].id);
    loadBoard(boardSel.value);
  });
  boardSel.addEventListener('change', () => loadBoard(boardSel.value));

  async function loadBoard(boardId) {
    boardEl.innerHTML = '<div class="loading">Loading board…</div>';
    try {
      const res = await api.get(`/api/projects/board/${boardId}`);
      paint(res);
    } catch (err) {
      boardEl.innerHTML = '';
      boardEl.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load board']), el('p', { class: 'muted' }, [err.message])]));
    }
  }

  function paint({ phases, unphased }) {
    clear(boardEl);
    const cols = [...(phases || []).map((p) => ({ id: p.id, name: p.name, projects: p.projects || [] })), { id: null, name: 'Unphased', projects: unphased || [] }];
    for (const col of cols) {
      const colEl = el('div', { class: 'kcol' }, [
        el('header', {}, [
          el('div', { class: 'kname' }, [col.name]),
          el('div', { class: 'kmeta' }, [`${col.projects.length} projects`]),
        ]),
        el('div', { class: 'klist' }, col.projects.map((p) => el('div', { class: 'kcard', draggable: 'true' }, [
          el('div', { class: 'ktitle truncate', onClick: () => go(`projects/${p.id}`) }, [p.title]),
          el('div', { class: 'krow' }, [p.owner ? p.owner.name : '', p.end_date ? ` · due ${fmtDate(p.end_date)}` : '']),
          el('div', { class: 'kfoot' }, [
            p.status ? el('span', { class: 'badge blue' }, [p.status]) : null,
            el('div', { class: 'spacer' }),
            p.health ? el('span', { class: `badge ${p.health.risk_level === 'high' ? 'red' : (p.health.risk_level === 'medium' ? 'amber' : 'green')}` }, [p.health.risk_level || 'OK']) : null,
          ].filter(Boolean)),
        ]))),
      ]);
      // drag & drop between phases
      const list = colEl.querySelector('.klist');
      list.addEventListener('dragover', (e) => { e.preventDefault(); colEl.classList.add('drag-over'); });
      list.addEventListener('dragleave', () => colEl.classList.remove('drag-over'));
      list.addEventListener('drop', async (e) => {
        e.preventDefault();
        colEl.classList.remove('drag-over');
        const projectId = e.dataTransfer.getData('text/plain');
        if (!projectId) return;
        try {
          await apiAction(api.patch(`/api/projects/${projectId}`, { phase_id: col.id }), 'Project moved');
          loadBoard(boardSel.value);
        } catch {}
      });
      boardEl.appendChild(colEl);
    }
  }

  const bar = el('div', { class: 'toolbar' }, [
    el('h2', {}, ['Projects']),
    boardSel,
    el('div', { class: 'spacer' }),
    can('projects.create') ? el('button', { class: 'btn primary sm', onClick: () => go('projects') }, ['＋ New project (list)']) : null,
  ]);
  wrap.append(bar, boardEl);
  return wrap;
}

export function renderProjectDetail(id) {
  const wrap = el('div', {});
  const pane = renderDetail('project', Number(id));
  const healthCard = el('div', { class: 'card pad', style: { marginBottom: '10px' } }, [el('div', { class: 'loading' }, ['Loading health…'])]);
  api.get(`/api/projects/${id}/health`).then((h) => {
    clear(healthCard);
    healthCard.append(
      el('h3', { style: { marginBottom: '4px' } }, ['Project health']),
      el('div', { class: 'inline', style: { marginBottom: '6px' } }, [
        h.risk_level ? el('span', { class: `badge ${h.risk_level === 'high' ? 'red' : (h.risk_level === 'medium' ? 'amber' : 'green')}` }, [`Risk: ${h.risk_level}`]) : null,
        h.progress != null ? el('span', { class: 'badge blue' }, [`Progress ${Math.round(h.progress)}%`]) : null,
      ].filter(Boolean)),
      el('div', { style: { whiteSpace: 'pre-wrap' } }, [h.summary || h.text || 'No AI configured — enable it in Admin → AI for health summaries.']),
    );
  }).catch(() => {
    clear(healthCard);
    healthCard.append(el('h3', {}, ['Project health']), el('div', { class: 'muted' }, ['Health unavailable.']));
  });
  const extras = el('div', {}, [healthCard, pane]);
  wrap.appendChild(extras);
  // attach templates panel + board inside detail is handled by detail.js tabs; add template application here
  api.get('/api/project-templates').then((templates) => {
    if (!templates.length) return;
    const tplBar = el('div', { class: 'inline', style: { marginBottom: '10px' } }, [
      el('span', { class: 'muted' }, ['Apply template:']),
      el('select', { id: 'tpl-sel', style: { width: 'auto' } }, templates.map((t) => el('option', { value: t.id }, [t.name]))),
      el('button', { class: 'btn sm', onClick: async () => {
        try {
          const tplId = Number(tplBar.querySelector('#tpl-sel').value);
          await apiAction(api.post(`/api/projects/${id}/apply-template`, { template_id: tplId }), 'Template applied');
          location.reload();
        } catch {}
      } }, ['Apply']),
    ]);
    extras.prepend(tplBar);
  }).catch(() => {});
  return wrap;
}