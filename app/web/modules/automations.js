// Automations — visual builder: trigger, conditions (AND/OR), ordered steps incl. if/else + delay, executions, test mode.
import { el, clear } from '../lib/dom.js';
import { api, state } from '../lib/api.js';
import { modal, toast, apiAction, fmtDateTime, relTime, confirmDialog } from '../lib/ui.js';
import { go } from '../lib/router.js';

export function renderAutomations(params = {}) {
  const wrap = el('div', {});
  const bar = el('div', { class: 'toolbar' }, [
    el('h2', {}, ['Automations']),
    el('div', { class: 'spacer' }),
    state.me?.user?.is_admin ? el('button', { class: 'btn sm', onClick: openJobs }, ['⚙ Job queue']) : null,
    el('button', { class: 'btn primary sm', onClick: () => openEditor(null) }, ['＋ New automation']),
  ]);
  const box = el('div', {});
  wrap.append(bar, box);
  load();
  async function load() {
    box.innerHTML = '<div class="loading">Loading…</div>';
    let automations;
    try { automations = await api.get('/api/automations'); } catch (err) {
      box.innerHTML = ''; box.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load']), el('p', { class: 'muted' }, [err.message])]));
      return;
    }
    clear(box);
    if (!automations.length) { box.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['No automations yet']), el('p', { class: 'muted' }, ['Automate follow-ups, stage moves, emails and more.'])])); return; }
    for (const a of automations) {
      const ok = a.recent?.find((x) => x.status === 'success')?.n || 0;
      const fail = a.recent?.find((x) => x.status === 'failed')?.n || 0;
      box.appendChild(el('div', { class: 'card', style: { marginBottom: '10px' } }, [
        el('header', {}, [
          el('h2', {}, [a.name]),
          a.enabled ? el('span', { class: 'badge green' }, ['Enabled']) : el('span', { class: 'badge gray' }, ['Disabled']),
          a.test_mode ? el('span', { class: 'badge amber' }, ['Test mode']) : null,
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn sm', onClick: () => openEditor(a) }, ['Edit']),
          el('button', { class: 'btn sm', onClick: () => openExecutions(a) }, ['History']),
          el('button', { class: 'btn sm', onClick: () => openTest(a) }, ['Test']),
          el('button', { class: 'btn sm', onClick: async () => {
            try { await apiAction(api.patch(`/api/automations/${a.id}`, { enabled: !a.enabled }), a.enabled ? 'Disabled' : 'Enabled'); load(); } catch {}
          } }, [a.enabled ? 'Disable' : 'Enable']),
          el('button', { class: 'btn sm danger', onClick: async () => {
            if (!await confirmDialog({ title: `Delete automation "${a.name}"?`, okText: 'Delete', danger: true })) return;
            try { await apiAction(api.del(`/api/automations/${a.id}`), 'Deleted'); load(); } catch {}
          } }, ['✕']),
        ]),
        el('div', { class: 'body', style: { padding: '8px 12px' } }, [
          el('div', { class: 'muted', style: { fontSize: '12px' } }, [
            `When ${triggerText(a.trigger_config)} → ${a.steps?.length || 0} step(s)`,
            a.conditions?.rules?.length ? ` · ${a.conditions.match === 'all' ? 'ALL' : 'ANY'} of ${a.conditions.rules.length} condition(s)` : '',
          ].join('')),
          el('div', { class: 'inline', style: { marginTop: '4px', fontSize: '11.5px' } }, [
            el('span', { class: 'badge green' }, [`${ok} ok (7d)`]),
            fail ? el('span', { class: 'badge red' }, [`${fail} failed (7d)`]) : null,
          ].filter(Boolean)),
        ]),
      ]));
    }
  }
  function triggerText(t = {}) {
    const labels = { created: 'a record is created', updated: 'a record is updated', field_updated: `the field ${t.field || '?'} changes`, date: `the date ${t.date_field || '?'} is reached` };
    return labels[t.event] || t.event || '…';
  }
  function openJobs() {
    const m = modal({ title: 'Job queue', wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    api.get('/api/ops/jobs').then((s) => {
      const bodyEl = m.querySelector('.body'); clear(bodyEl);
      bodyEl.appendChild(el('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap' } }, [JSON.stringify(s, null, 2)]));
    }).catch((err) => { m.querySelector('.body').innerHTML = `<div class="empty">${err.message}</div>`; });
  }
  function openExecutions(a) {
    const m = modal({ title: `Execution history — ${a.name}`, wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    api.get(`/api/automations/${a.id}/executions`, { limit: 100 }).then((execs) => {
      const bodyEl = m.querySelector('.body'); clear(bodyEl);
      if (!execs.length) { bodyEl.appendChild(el('div', { class: 'empty' }, ['Not run yet.'])); return; }
      bodyEl.appendChild(el('table', { class: 'grid' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['When']), el('th', {}, ['Status']), el('th', {}, ['Entity']), el('th', {}, ['Log'])])]),
        el('tbody', {}, execs.map((e) => el('tr', {}, [
          el('td', { class: 'nowrap' }, [relTime(e.started_at)]),
          el('td', {}, [el('span', { class: `badge ${e.status === 'success' ? 'green' : (e.status === 'failed' ? 'red' : 'amber')}` }, [e.status || ''])]),
          el('td', {}, [`${e.entity || ''} #${e.entity_id || ''}`]),
          el('td', {}, [el('div', { class: 'muted', style: { fontSize: '11px' } }, [(e.log || []).map((l) => l.msg || l.message || JSON.stringify(l)).join(' · ').slice(0, 220) || (e.error || '—')])]),
        ]))),
      ]));
    }).catch((err) => { m.querySelector('.body').innerHTML = `<div class="empty">${err.message}</div>`; });
  }
  function openTest(a) {
    const m = modal({ title: `Test — ${a.name}`, body: el('div', { class: 'grid-2' }, [
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Entity']), el('select', { id: 't-entity' }, ['deal', 'lead', 'person', 'organization', 'activity', 'project'].map((x) => el('option', { value: x }, [x])))]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Record ID']), el('input', { type: 'number', id: 't-record', value: '1', style: { width: '120px' } })]),
    ]), footer: [
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        try {
          const r = await apiAction(api.post(`/api/automations/${a.id}/test`, { entity: m.querySelector('#t-entity').value, record_id: m.querySelector('#t-record').value }), 'Test executed');
          const bodyEl = m.querySelector('.body');
          bodyEl.appendChild(el('div', { class: 'hr' }));
          bodyEl.appendChild(el('div', {}, [
            el('strong', {}, [`Result: ${r.execution?.status || 'done'}`]),
            el('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap', fontSize: '11px', marginTop: '6px' } }, [JSON.stringify(r.execution?.log || r, null, 2).slice(0, 3000)]),
          ]));
        } catch {}
      } }, ['Run test']),
    ] });
  }

  async function openEditor(existing) {
    const m = modal({ title: existing ? `Edit automation: ${existing.name}` : 'New automation', wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    const bodyEl = m.querySelector('.body');
    let meta;
    try { meta = await api.get('/api/automations/meta'); } catch (err) { bodyEl.innerHTML = `<div class="empty">${err.message}</div>`; return; }
    clear(bodyEl);

    const a = {
      name: existing?.name || '',
      enabled: existing ? !!existing.enabled : true,
      test_mode: !!existing?.test_mode,
      trigger_config: existing?.trigger_config || { event: 'created', entity: 'deal' },
      conditions: existing?.conditions || { match: 'all', rules: [] },
      steps: existing?.steps || [],
    };

    const name = el('input', { type: 'text', value: a.name || '', style: { width: '320px' } });
    const enabled = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: a.enabled }), ' enabled']);
    const testMode = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: a.test_mode }), ' test mode (log only)']);

    // trigger row
    const evSel = el('select', { style: { width: 'auto' } }, meta.triggers.map((t) => el('option', { value: t.key, selected: t.key === a.trigger_config.event }, [t.label])));
    const entSel = el('select', { style: { width: 'auto' } }, meta.entities.map((e2) => el('option', { value: e2, selected: e2 === a.trigger_config.entity }, [e2])));
    const fieldSel = el('select', { style: { width: 'auto', display: a.trigger_config.event === 'field_updated' ? '' : 'none' } }, [el('option', { value: '' }, ['— field —']), ...(meta.fields[a.trigger_config.entity] || []).map((f) => el('option', { value: f.key, selected: f.key === a.trigger_config.field }, [f.label]))]);
    const dateSel = el('select', { style: { width: 'auto', display: a.trigger_config.event === 'date' ? '' : 'none' } }, [el('option', { value: '' }, ['— date field —']), ...(meta.fields[a.trigger_config.entity] || []).filter((f) => ['date', 'datetime'].includes(f.type)).map((f) => el('option', { value: f.key, selected: f.key === a.trigger_config.date_field }, [f.label]))]);
    evSel.addEventListener('change', () => {
      a.trigger_config.event = evSel.value;
      fieldSel.style.display = evSel.value === 'field_updated' ? '' : 'none';
      dateSel.style.display = evSel.value === 'date' ? '' : 'none';
    });
    entSel.addEventListener('change', () => {
      a.trigger_config.entity = entSel.value;
      refillFieldSelectors();
    });
    function refillFieldSelectors() {
      clear(fieldSel);
      fieldSel.appendChild(el('option', { value: '' }, ['— field —']));
      for (const f of meta.fields[a.trigger_config.entity] || []) fieldSel.appendChild(el('option', { value: f.key, selected: f.key === a.trigger_config.field }, [f.label]));
      clear(dateSel);
      dateSel.appendChild(el('option', { value: '' }, ['— date field —']));
      for (const f of (meta.fields[a.trigger_config.entity] || []).filter((f) => ['date', 'datetime'].includes(f.type))) dateSel.appendChild(el('option', { value: f.key, selected: f.key === a.trigger_config.date_field }, [f.label]));
    }

    // conditions builder
    const condBox = el('div', {});
    function drawConditions() {
      clear(condBox);
      const match = el('select', { style: { width: 'auto' } }, [
        el('option', { value: 'all', selected: a.conditions.match === 'all' }, ['ALL of']),
        el('option', { value: 'any', selected: a.conditions.match === 'any' }, ['ANY of']),
      ]);
      match.addEventListener('change', () => { a.conditions.match = match.value; });
      condBox.appendChild(el('div', { class: 'inline', style: { marginBottom: '6px' } }, [el('span', { class: 'muted', style: { fontSize: '12px' } }, ['Run only when']), match, el('button', { class: 'btn sm', onClick: () => { a.conditions.rules.push({ field: 'status', op: 'eq', value: '' }); drawConditions(); } }, ['＋ condition'])]));
      const fields = meta.fields[a.trigger_config.entity] || [];
      for (let i = 0; i < a.conditions.rules.length; i++) {
        const rule = a.conditions.rules[i];
        const fs = el('select', { style: { width: 'auto' } }, fields.map((f) => el('option', { value: f.key, selected: f.key === rule.field }, [f.label])));
        const vs = el('input', { type: 'text', value: rule.value ?? '', style: { width: '120px' } });
        const rm = el('button', { class: 'btn sm ghost', onClick: () => { a.conditions.rules.splice(i, 1); drawConditions(); } }, ['✕']);
        fs.addEventListener('change', () => { rule.field = fs.value; });
        vs.addEventListener('input', () => { rule.value = vs.value; });
        condBox.appendChild(el('div', { class: 'inline', style: { marginBottom: '4px' } }, [fs, el('span', { class: 'muted' }, ['equals']), vs, rm]));
      }
    }
    drawConditions();

    // steps builder (recursive flow)
    const stepsBox = el('div', { class: 'flow' });
    function stepCard(step, list, idx) {
      const card = el('div', { class: 'flow-node ' + (step.type === 'if' ? 'control' : (step.type === 'delay' || step.type === 'wait' ? 'control' : 'action')) });
      const head = el('div', { class: 'inline' }, [
        el('strong', {}, [stepLabel(step)]),
        el('div', { class: 'spacer' }),
        idx > 0 ? el('button', { class: 'btn sm ghost', title: 'Move up', onClick: () => { [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]; drawSteps(); } }, ['↑']) : null,
        el('button', { class: 'btn sm ghost', title: 'Remove', onClick: () => { list.splice(idx, 1); drawSteps(); } }, ['✕']),
      ].filter(Boolean));
      card.appendChild(head);
      const cfgBox = el('div', { style: { marginTop: '6px' } });
      card.appendChild(cfgBox);
      drawStepConfig(step, cfgBox, () => drawSteps());
      if (step.type === 'if') {
        const branch = el('div', { class: 'flow-branch', style: { marginTop: '8px' } }, [
          branchBox(step, 'then', 'THEN'),
          branchBox(step, 'else', 'ELSE'),
        ]);
        card.appendChild(branch);
      }
      return card;
    }
    function branchBox(step, key, label) {
      const box = el('div', {}, [
        el('div', { class: 'muted', style: { fontSize: '11px', fontWeight: '700', marginBottom: '4px' } }, [key]),
        el('div', { class: 'flow' }),
      ]);
      const holder = box.querySelector('.flow');
      (step[key] || []).forEach((s, i) => holder.appendChild(stepCard(s, step[key], i)));
      holder.appendChild(el('button', { class: 'btn sm', onClick: () => { step[key] = step[key] || []; step[key].push(newStep()); drawSteps(); } }, ['＋ step']));
      return box;
    }
    function newStep() { return { type: 'action', action: 'create_activity', config: {} }; }
    function stepLabel(step) {
      if (step.type === 'if') return 'IF condition';
      if (step.type === 'delay') return `Wait ${step.config?.days || 0} day(s)`;
      if (step.type === 'wait') return 'Wait until condition';
      const act = meta.actions.find((x) => x.key === step.action);
      return act?.label || step.action || 'Action';
    }
    function drawStepConfig(step, box, refresh) {
      clear(box);
      if (step.type === 'action') {
        const sel = el('select', { style: { width: 'auto' } }, meta.actions.map((x) => el('option', { value: x.key, selected: x.key === step.action }, [x.label])));
        sel.addEventListener('change', () => { step.action = sel.value; step.config = {}; refresh(); });
        box.appendChild(el('div', { class: 'inline' }, [sel]));
        const cfg = step.config || (step.config = {});
        const fields = meta.fields[a.trigger_config.entity] || [];
        if (step.action === 'move_stage') {
          const sel2 = el('select', { style: { width: 'auto' } }, [el('option', { value: '' }, ['— stage —']), ...meta.stages.map((s) => el('option', { value: s.id, selected: Number(step.config?.stage_id) === s.id }, [`${s.pipeline_name} / ${s.name}`]))]);
          sel2.addEventListener('change', () => { step.config.stage_id = Number(sel2.value) || null; });
          box.appendChild(el('div', { class: 'inline', style: { marginTop: '4px' } }, [sel2]));
        } else if (step.action === 'create_activity') {
          const subj = el('input', { type: 'text', value: step.config?.subject || '', placeholder: 'Activity subject', style: { width: '200px' } });
          const tsel = el('select', { style: { width: 'auto' } }, meta.activity_types.map((t) => el('option', { value: t.key_string, selected: step.config?.type_key === t.key_string }, [t.name])));
          const days = el('input', { type: 'number', value: step.config?.due_in_days ?? 1, style: { width: '70px' } });
          subj.addEventListener('input', () => { step.config.subject = subj.value; });
          tsel.addEventListener('change', () => { step.config.type_key = tsel.value; });
          days.addEventListener('input', () => { step.config.due_in_days = Number(days.value); });
          box.append(el('div', { class: 'inline', style: { marginTop: '4px' } }, [subj, tsel, el('span', { class: 'muted' }, ['due in']), days, el('span', { class: 'muted' }, ['days'])]));
        } else if (step.action === 'send_email') {
          const tpl = el('select', { style: { width: 'auto' } }, [el('option', { value: '' }, ['— template —']), ...meta.templates.map((t) => el('option', { value: t.id, selected: Number(step.config?.template_id) === t.id }, [t.name]))]);
          tpl.addEventListener('change', () => { step.config.template_id = Number(tpl.value) || null; });
          box.appendChild(el('div', { class: 'inline', style: { marginTop: '4px' } }, [tpl]));
        } else if (step.action === 'enroll_sequence') {
          const seq = el('select', { style: { width: 'auto' } }, [el('option', { value: '' }, ['— sequence —']), ...meta.sequences.map((s) => el('option', { value: s.id, selected: Number(step.config?.sequence_id) === s.id }, [s.name]))]);
          seq.addEventListener('change', () => { step.config.sequence_id = Number(seq.value) || null; });
          box.appendChild(el('div', { class: 'inline', style: { marginTop: '4px' } }, [seq]));
        } else if (step.action === 'assign_owner') {
          const usr = el('select', { style: { width: 'auto' } }, [el('option', { value: '' }, ['— user —']), ...meta.users.map((u) => el('option', { value: u.id, selected: Number(step.config?.user_id) === u.id }, [u.name]))]);
          usr.addEventListener('change', () => { step.config.user_id = Number(usr.value) || null; });
          box.appendChild(el('div', { class: 'inline', style: { marginTop: '4px' } }, [usr]));
        } else if (step.action === 'webhook') {
          const url = el('input', { type: 'text', value: step.config?.url || '', placeholder: 'https://…', style: { width: '320px' } });
          const method = el('select', { style: { width: 'auto' } }, ['POST', 'PUT', 'DELETE'].map((x) => el('option', { value: x, selected: step.config?.method === x }, [x])));
          url.addEventListener('input', () => { step.config.url = url.value; });
          method.addEventListener('change', () => { step.config.method = method.value; });
          box.append(el('div', { class: 'inline', style: { marginTop: '4px' } }, [method, url]));
        } else if (step.action === 'update_record') {
          const fs = el('select', { style: { width: 'auto' } }, [el('option', { value: '' }, ['— field —']), ...fields.map((f) => el('option', { value: f.key, selected: step.config?.field === f.key }, [f.label]))]);
          const vs = el('input', { type: 'text', value: step.config?.value ?? '', style: { width: '140px' } });
          fs.addEventListener('change', () => { step.config.field = fs.value; });
          vs.addEventListener('input', () => { step.config.value = vs.value; });
          box.append(el('div', { class: 'inline', style: { marginTop: '4px' } }, [fs, el('span', { class: 'muted' }, ['=']), vs]));
        } else if (step.action === 'create_task') {
          const title = el('input', { type: 'text', value: step.config?.title || '', placeholder: 'Task title', style: { width: '200px' } });
          title.addEventListener('input', () => { step.config.title = title.value; });
          box.appendChild(el('div', { class: 'inline', style: { marginTop: '4px' } }, [title]));
        }
      } else if (step.type === 'delay') {
        const days = el('input', { type: 'number', value: step.config?.days ?? 1, style: { width: '70px' } });
        days.addEventListener('input', () => { step.config = step.config || {}; step.config.days = Number(days.value); });
        box.append(el('div', { class: 'inline' }, [el('span', { class: 'muted' }, ['Wait']), days, el('span', { class: 'muted' }, ['day(s)'])]));
      }
    }
    function drawSteps() {
      clear(stepsBox);
      a.steps.forEach((s, i) => {
        if (i > 0) stepsBox.appendChild(el('div', { class: 'flow-connector' }));
        stepsBox.appendChild(stepCard(s, a.steps, i));
      });
    }
    drawSteps();

    const addRow = el('div', { class: 'inline wrap', style: { marginTop: '10px' } }, [
      el('button', { class: 'btn sm', onClick: () => { a.steps.push({ type: 'action', action: 'create_activity', config: {} }); drawSteps(); } }, ['＋ Action']),
      el('button', { class: 'btn sm', onClick: () => { a.steps.push({ type: 'delay', config: { days: 1 } }); drawSteps(); } }, ['＋ Delay']),
      el('button', { class: 'btn sm', onClick: () => { a.steps.push({ type: 'if', config: { field: 'status', op: 'eq', value: '' }, then: [], else: [] }); drawSteps(); } }, ['＋ If / else']),
    ]);

    bodyEl.append(
      el('div', { class: 'inline', style: { marginBottom: '10px' } }, [name, enabled, testMode]),
      el('div', { class: 'card pad', style: { marginBottom: '10px' } }, [
        el('h3', { style: { marginBottom: '6px' } }, ['Trigger']),
        el('div', { class: 'inline wrap' }, [evSel, entSel, fieldSel, dateSel]),
        el('div', { class: 'hr' }),
        condBox,
      ]),
      el('div', { class: 'card pad', style: { marginBottom: '10px' } }, [
        el('h3', { style: { marginBottom: '6px' } }, ['Steps']),
        stepsBox,
        addRow,
      ]),
    );

    m.querySelector('footer').innerHTML = '';
    m.querySelector('footer').append(
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        const payload = {
          name: name.value || 'Untitled automation',
          enabled: enabled.querySelector('input').checked,
          test_mode: testMode.querySelector('input').checked,
          trigger_config: { ...a.trigger_config, field: fieldSel.value || null, date_field: dateSel.value || null },
          conditions: a.conditions,
          steps: a.steps,
        };
        try {
          if (existing) await apiAction(api.patch(`/api/automations/${existing.id}`, payload), 'Automation saved');
          else await apiAction(api.post('/api/automations', payload), 'Automation created');
          m.close(); load();
        } catch {}
      } }, ['Save automation']),
    );
  }

  return wrap;
}