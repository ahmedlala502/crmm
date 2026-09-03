// Documents — smart documents: generate from templates, merge fields, share links, view tracking, e-sign.
import { el, clear } from '../lib/dom.js';
import { api, state } from '../lib/api.js';
import { modal, toast, apiAction, fmtDateTime, confirmDialog } from '../lib/ui.js';

export function renderDocuments(params = {}) {
  const wrap = el('div', {});
  const bar = el('div', { class: 'toolbar' }, [
    el('h2', {}, ['Documents']),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn sm', onClick: openTemplates }, ['Templates']),
    el('button', { class: 'btn primary sm', onClick: openCreate }, ['＋ New document']),
  ]);
  const box = el('div', {});
  wrap.append(bar, box);
  load();
  async function load() {
    box.innerHTML = '<div class="loading">Loading…</div>';
    let docs;
    try { docs = await api.get('/api/documents'); } catch (err) {
      box.innerHTML = ''; box.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load']), el('p', { class: 'muted' }, [err.message])]));
      return;
    }
    clear(box);
    if (!docs.length) { box.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['No documents yet']), el('p', { class: 'muted' }, ['Generate quotes, proposals and contracts from templates with CRM merge fields.'])])); return; }
    const tbl = el('table', { class: 'grid' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Name']), el('th', {}, ['Linked to']), el('th', {}, ['Status']), el('th', { class: 'num' }, ['Version']), el('th', { class: 'num' }, ['Views']), el('th', {}, ['Created']), el('th', {}, [''])])]),
      el('tbody', {}, docs.map((d) => el('tr', {}, [
        el('td', {}, [el('a', { class: 'cell-link', onClick: () => openDoc(d) }, [d.name || `Document #${d.id}`])]),
        el('td', {}, [d.entity ? `${d.entity} #${d.entity_id}` : '—']),
        el('td', {}, [el('span', { class: `badge ${d.status === 'signed' ? 'green' : (d.status === 'sent' ? 'blue' : 'gray')}` }, [d.status || 'draft'])]),
        el('td', { class: 'num' }, [String(d.version ?? '—')]),
        el('td', { class: 'num' }, [String(d.views ?? 0)]),
        el('td', {}, [fmtDate(d.created_at)]),
        el('td', { class: 'tight' }, [
          el('button', { class: 'btn sm', onClick: () => openDoc(d) }, ['Open']),
          d.share_token ? el('a', { class: 'btn sm', href: `/public/documents/${d.share_token}`, target: '_blank' }, ['View link']) : null,
          el('button', { class: 'btn sm danger', onClick: () => toast('Use Admin to purge documents (server has no delete endpoint)', 'error') }, ['✕']),
        ].filter(Boolean)),
      ]))),
    ]);
    box.appendChild(el('div', { class: 'table-wrap' }, [tbl]));
  }
  function fmtDate(s) { return String(s || '').slice(0, 10); }

  async function openCreate() {
    const [templates, deals, leads] = await Promise.all([
      api.get('/api/document-templates').catch(() => []),
      api.get('/api/deals', { limit: 200, status: 'open' }).then((r) => r.data).catch(() => []),
      api.get('/api/leads', { limit: 200, status: 'open' }).then((r) => r.data).catch(() => []),
    ]);
    const name = el('input', { type: 'text', value: '', style: { width: '260px' } });
    const tplSel = el('select', { style: { width: 'auto' } }, [el('option', { value: '' }, ['— blank —']), ...templates.map((t) => el('option', { value: t.id }, [`${t.name} (${t.kind})`]))]);
    const entSel = el('select', { style: { width: 'auto' } }, [
      el('option', { value: '' }, ['— not linked —']),
      el('option', { value: 'deal' }, ['Deal']),
      el('option', { value: 'lead' }, ['Lead']),
    ]);
    const recSel = el('select', { style: { width: 'auto', display: 'none' } });
    function refillRecs() {
      clear(recSel);
      recSel.appendChild(el('option', { value: '' }, ['— pick —']));
      const items = entSel.value === 'deal' ? deals : entSel.value === 'lead' ? leads : [];
      for (const it of items) recSel.appendChild(el('option', { value: it.id }, [it.title]));
      recSel.style.display = entSel.value ? '' : 'none';
    }
    entSel.addEventListener('change', refillRecs);
    const m = modal({ title: 'New document', body: el('div', { class: 'inline wrap' }, [name, tplSel, entSel, recSel]), footer: [
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        if (!name.value.trim()) { toast('Name required', 'error'); return; }
        try {
          const doc = await apiAction(api.post('/api/documents', {
            name: name.value,
            template_id: tplSel.value ? Number(tplSel.value) : null,
            entity: entSel.value || null,
            entity_id: recSel.value ? Number(recSel.value) : null,
          }), 'Document created');
          m.close();
          if (doc?.id) openDoc(doc);
        } catch {}
      } }, ['Create']),
    ] });
  }

  async function openDoc(d) {
    const m = modal({ title: d.name || `Document #${d.id}`, wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    const bodyEl = m.querySelector('.body');
    let doc;
    try { doc = await api.get(`/api/documents/${d.id}`); } catch (err) { bodyEl.innerHTML = `<div class="empty">${err.message}</div>`; return; }
    clear(bodyEl);
    const content = el('textarea', { style: { minHeight: '300px', fontFamily: 'var(--mono)', fontSize: '12px' } }, [doc.content || '']);
    const previewBox = el('div', { class: 'card pad', style: { marginTop: '10px', maxHeight: '340px', overflow: 'auto' } }, [el('div', { class: 'muted' }, ['Preview renders after save.'])]);
    const statusSel = el('select', { style: { width: 'auto' } }, ['draft', 'sent', 'signed'].map((s) => el('option', { value: s, selected: doc.status === s }, [s])));
    const renderPreview = async () => {
      try {
        const r = await api.post(`/api/documents/${doc.id}/preview`, { content: content.value, entity: doc.entity, entity_id: doc.entity_id });
        clear(previewBox);
        previewBox.appendChild(el('div', { html: r.html || '<p class="muted">Empty</p>' }));
      } catch (err) { clear(previewBox); previewBox.appendChild(el('div', { class: 'muted' }, [err.message])); }
    };
    bodyEl.append(
      el('div', { class: 'inline', style: { marginBottom: '8px' } }, [statusSel, el('span', { class: 'muted', style: { fontSize: '12px' } }, [`views: ${doc.views ?? 0} · version ${doc.version ?? 1}`])]),
      content,
      previewBox,
    );
    const footer = m.querySelector('footer'); footer.innerHTML = '';
    footer.append(
      el('button', { class: 'btn', onClick: async () => { await renderPreview(); } }, ['Refresh preview']),
      el('button', { class: 'btn primary', onClick: async () => {
        try {
          await apiAction(api.patch(`/api/documents/${doc.id}`, { content: content.value, status: statusSel.value }), 'Document saved');
          m.close(); load();
        } catch {}
      } }, ['Save']),
    );
    renderPreview();
  }

  async function openTemplates() {
    const m = modal({ title: 'Document templates', wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    await load();
    async function load() {
      const templates = await api.get('/api/document-templates');
      const bodyEl = m.querySelector('.body'); clear(bodyEl);
      bodyEl.append(
        el('div', { class: 'inline', style: { marginBottom: '10px' } }, [
          el('button', { class: 'btn primary sm', onClick: () => editTpl(null, load) }, ['＋ New template']),
        ]),
        el('table', { class: 'grid' }, [
          el('thead', {}, [el('tr', {}, [el('th', {}, ['Name']), el('th', {}, ['Kind']), el('th', {}, ['Content preview']), el('th', {}, [''])])]),
          el('tbody', {}, templates.map((t) => el('tr', {}, [
            el('td', {}, [t.name]),
            el('td', {}, [t.kind || 'quote']),
            el('td', { class: 'muted', style: { fontSize: '11px', maxWidth: '380px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [String(t.content || '')]),
            el('td', { class: 'tight' }, [
              el('button', { class: 'btn sm', onClick: () => editTpl(t, load) }, ['Edit']),
            ]),
          ]))),
        ]),
      );
    }
  }
  function editTpl(t, done) {
    const m = modal({ title: t ? `Edit template: ${t.name}` : 'New template', wide: true, body: el('div', { class: 'loading' }, ['']), footer: [el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel'])] });
    const bodyEl = m.querySelector('.body'); clear(bodyEl);
    bodyEl.append(
      el('div', { class: 'grid-2' }, [
        el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Name']), el('input', { type: 'text', value: t?.name || '' })]),
        el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Kind']), el('select', { id: 'dt-kind' }, ['quote', 'proposal', 'contract'].map((k) => el('option', { value: k, selected: t?.kind === k }, [k])))]),
      ]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Content (HTML, merge fields like {{deal.title}} allowed)']), el('textarea', { id: 'dt-content', style: { minHeight: '220px', fontFamily: 'var(--mono)', fontSize: '12px' } }, [t?.content || ''])]),
    );
    const footer = m.querySelector('footer'); footer.innerHTML = '';
    footer.append(
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        const name = bodyEl.querySelector('input').value;
        const kind = bodyEl.querySelector('#dt-kind').value;
        const content = bodyEl.querySelector('#dt-content').value;
        try {
          if (t) await apiAction(api.patch(`/api/document-templates/${t.id}`, { name, kind, content }), 'Template saved');
          else await apiAction(api.post('/api/document-templates', { name, kind, content }), 'Template created');
          m.close(); done();
        } catch {}
      } }, ['Save']),
    );
  }
  return wrap;
}