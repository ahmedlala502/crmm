// Campaigns — email marketing: create, recipient preview, send/schedule, stats, consent overview.
import { el, clear } from '../lib/dom.js';
import { api, state } from '../lib/api.js';
import { modal, toast, apiAction, fmtDate, confirmDialog } from '../lib/ui.js';

export function renderCampaigns(params = {}) {
  const wrap = el('div', {});
  const bar = el('div', { class: 'toolbar' }, [
    el('h2', {}, ['Campaigns']),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn sm', onClick: openConsent }, ['⏻ Marketing consent']),
    el('button', { class: 'btn primary sm', onClick: () => openEditor(null) }, ['＋ New campaign']),
  ]);
  const box = el('div', {});
  wrap.append(bar, box);
  load();
  async function load() {
    box.innerHTML = '<div class="loading">Loading…</div>';
    let campaigns;
    try { campaigns = await api.get('/api/campaigns'); } catch (err) {
      box.innerHTML = ''; box.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load']), el('p', { class: 'muted' }, [err.message])]));
      return;
    }
    clear(box);
    if (!campaigns.length) { box.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['No campaigns yet']), el('p', { class: 'muted' }, ['Send targeted email to subscribed contacts.'])])); return; }
    for (const c of campaigns) {
      const s = c.stats || {};
      box.appendChild(el('div', { class: 'card', style: { marginBottom: '10px' } }, [
        el('header', {}, [
          el('h2', {}, [c.name]),
          statusBadge(c.status),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn sm', onClick: () => openDetail(c, load) }, ['Open']),
          c.status !== 'sent' && c.status !== 'sending' ? el('button', { class: 'btn sm danger', onClick: async () => {
            if (!await confirmDialog({ title: `Delete campaign "${c.name}"?`, okText: 'Delete', danger: true })) return;
            try { await apiAction(api.del(`/api/campaigns/${c.id}`), 'Deleted'); load(); } catch {}
          } }, ['✕']) : null,
        ]),
        el('div', { class: 'body', style: { padding: '8px 12px' } }, [
          el('div', { class: 'inline wrap', style: { gap: '10px', fontSize: '12px' } }, [
            el('span', { class: 'muted' }, [`Subject: ${c.subject || '—'}`]),
            el('span', { class: 'badge blue' }, [`Recipients ${s.sent ?? '—'}`]),
            el('span', { class: 'badge green' }, [`Opens ${s.opened ?? '—'}${s.open_rate != null ? ` (${s.open_rate}%)` : ''}`]),
            el('span', { class: 'badge purple' }, [`Clicks ${s.clicked ?? '—'}${s.click_rate ? ` (${s.click_rate}%)` : ''}`]),
            s.unsubscribed ? el('span', { class: 'badge red' }, [`Unsubs ${s.unsubscribed}`]) : null,
          ]),
        ]),
      ]));
    }
  }
  function statusBadge(status) {
    const map = { draft: ['Draft', 'gray'], scheduled: ['Scheduled', 'amber'], sending: ['Sending', 'blue'], sent: ['Sent', 'green'], failed: ['Failed', 'red'] };
    const [label, color] = map[status] || [status || '—', 'gray'];
    return el('span', { class: `badge ${color}` }, [label]);
  }
  function openConsent() {
    const m = modal({ title: 'Marketing consent', wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    api.get('/api/campaigns/meta/consent').then((r) => {
      const bodyEl = m.querySelector('.body'); clear(bodyEl);
      const counts = Object.fromEntries((r.counts || []).map((x) => [x.marketing_status || 'none', x.n]));
      bodyEl.appendChild(el('div', { class: 'cards cols-3' }, (r.statuses || Object.keys(counts)).map((k) =>
        el('div', { class: 'card stat' }, [el('div', { class: 'k' }, [k]), el('div', { class: 'v' }, [String(counts[k] ?? 0)])])
      )));
    }).catch((err) => { m.querySelector('.body').innerHTML = `<div class="empty">${err.message}</div>`; });
  }
  function openDetail(c, done) {
    const m = modal({ title: c.name, wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    api.get(`/api/campaigns/${c.id}`).then((full) => {
      const bodyEl = m.querySelector('.body'); clear(bodyEl);
      const s = full.stats || {};
      bodyEl.append(
        el('div', { class: 'cards cols-4', style: { marginBottom: '10px' } }, [
          el('div', { class: 'card stat' }, [el('div', { class: 'k' }, ['Recipients']), el('div', { class: 'v' }, [String(s.sent ?? s.recipients ?? 0)])]),
          el('div', { class: 'card stat' }, [el('div', { class: 'k' }, ['Opens']), el('div', { class: 'v' }, [String(s.opened ?? 0)])]),
          el('div', { class: 'card stat' }, [el('div', { class: 'k' }, ['Clicks']), el('div', { class: 'v' }, [String(s.clicked ?? 0)])]),
          el('div', { class: 'card stat' }, [el('div', { class: 'k' }, ['Unsubscribes']), el('div', { class: 'v' }, [String(s.unsubscribed ?? 0)])]),
        ]),
        el('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '6px' } }, [`Sender: ${full.sender_name || ''} <${full.sender_email || ''}>`]),
      );
      const footer = m.querySelector('footer'); footer.innerHTML = '';
      if (full.status === 'draft' || full.status === 'scheduled') {
        footer.append(
          el('button', { class: 'btn', onClick: async () => { await openEditor(full); m.close(); load(); } }, ['Edit']),
          el('button', { class: 'btn', onClick: async () => {
            try { const r = await apiAction(api.post(`/api/campaigns/${full.id}/preview-recipients`, {}), undefined); toast(`${r.total ?? '?'} recipients match`, 'info'); } catch {}
          } }, ['Preview recipients']),
          el('button', { class: 'btn primary', onClick: async () => {
            try {
              await apiAction(api.post(`/api/campaigns/${full.id}/send`, { scheduled_at: null }), 'Campaign queued');
              m.close(); done();
            } catch {}
          } }, ['Send now']),
        );
      }
    }).catch((err) => { m.querySelector('.body').innerHTML = `<div class="empty">${err.message}</div>`; });
  }
  function openEditor(existing) {
    const m = modal({ title: existing ? `Edit campaign: ${existing.name}` : 'New campaign', wide: true, body: el('div', { class: 'grid-2' }, [
      el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Name']), el('input', { type: 'text', id: 'c-name', value: existing?.name || '' })]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Preview text']), el('input', { type: 'text', id: 'c-preview', value: existing?.preview_text || '' })]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Sender name']), el('input', { type: 'text', id: 'c-sname', value: existing?.sender_name || state.me?.user?.name || '' })]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Sender email']), el('input', { type: 'text', id: 'c-semail', value: existing?.sender_email || state.me?.user?.email || '' })]),
      el('label', { class: 'field required', style: { gridColumn: '1 / -1' } }, [el('span', { class: 'lbl' }, ['Subject']), el('input', { type: 'text', id: 'c-subject', value: existing?.subject || '' })]),
      el('label', { class: 'field', style: { gridColumn: '1 / -1' } }, [el('span', { class: 'lbl' }, ['HTML body (merge fields like {{person.name}} allowed)']), el('textarea', { id: 'c-body', style: { minHeight: '180px' } }, [existing?.body || ''])]),
    ]), footer: [
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        const payload = {
          name: m.querySelector('#c-name').value,
          preview_text: m.querySelector('#c-preview').value,
          sender_name: m.querySelector('#c-sname').value,
          sender_email: m.querySelector('#c-semail').value,
          subject: m.querySelector('#c-subject').value,
          body: m.querySelector('#c-body').value,
        };
        if (!payload.name || !payload.subject) { toast('Name and subject are required', 'error'); return; }
        try {
          if (existing) await apiAction(api.patch(`/api/campaigns/${existing.id}`, payload), 'Campaign saved');
          else await apiAction(api.post('/api/campaigns', payload), 'Campaign created');
          m.close();
        } catch {}
      } }, ['Save']),
    ] });
    return m;
  }
  return wrap;
}