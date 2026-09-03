// Mail — Sales Inbox: thread list, conversation view, compose with templates/merge fields, AI assists.
import { el, clear } from '../lib/dom.js';
import { api, state } from '../lib/api.js';
import { modal, drawer, toast, apiAction, fmtDateTime, relTime, money } from '../lib/ui.js';
import { go } from '../lib/router.js';

export function renderMail(params = {}) {
  const wrap = el('div', {});
  const layout = el('div', { class: 'mail-layout' });

  // ---- left: thread list ----
  const listCol = el('div', { class: 'card', style: { display: 'flex', flexDirection: 'column', overflow: 'hidden' } });
  const listHead = el('header', {}, [
    el('h2', {}, ['Inbox']),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn primary sm', onClick: openCompose }, ['✎ Compose']),
    el('button', { class: 'btn sm', onClick: openTemplates }, ['Templates']),
  ]);
  const filterBar = el('div', { class: 'inline', style: { padding: '6px 10px', borderBottom: '1px solid var(--border)', gap: '6px' } }, [
    el('input', { type: 'search', placeholder: 'Search subject…', style: { padding: '5px 8px', fontSize: '12px' }, onInput: (e) => { clearTimeout(filterBar._t); filterBar._t = setTimeout(() => loadThreads(e.target.value), 250); } }),
  ]);
  const threadList = el('div', { class: 'thread-list', style: { flex: '1' } });
  listCol.append(listHead, filterBar, threadList);

  // ---- right: thread reader ----
  const readerCol = el('div', { class: 'card', style: { overflow: 'auto' } });
  const reader = el('div', { class: 'body' }, [el('div', { class: 'empty' }, [el('h3', {}, ['No conversation selected']), el('p', { class: 'muted' }, ['Pick a thread on the left, or compose a new email.'])])]);
  readerCol.appendChild(reader);

  layout.append(listCol, readerCol);
  wrap.appendChild(layout);

  let activeThreadId = null;

  async function loadThreads(search = '') {
    threadList.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const threads = await api.get('/api/mail/threads', search ? { search } : {});
      clear(threadList);
      if (!threads.length) {
        threadList.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, ['No emails yet. Send one with Compose, or log an inbound message.'])]));
        return;
      }
      for (const t of threads) {
        const item = el('div', { class: 'thread-item' + (t.id === activeThreadId ? ' active' : '') + (t.read ? '' : ' unread') }, [
          el('div', { class: 'inline', style: { gap: '6px' } }, [
            t.person ? el('strong', {}, [t.person.name]) : el('strong', {}, [t.subject || '(no subject)']),
            el('div', { class: 'spacer' }),
            el('span', { class: 'dim', style: { fontSize: '11px' } }, [relTime(t.last_message_at)]),
          ]),
          el('div', { class: 'subj', style: { fontSize: '12px' } }, [t.subject || '(no subject)']),
          el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '2px' } }, [
            (t.last_direction === 'out' ? 'You: ' : ''),
            String(t.preview || '').slice(0, 90),
            t.message_count > 1 ? ` · ${t.message_count} messages` : '',
            t.shared ? ' · shared' : '',
          ]),
        ]);
        item.addEventListener('click', () => openThread(t.id, item));
        threadList.appendChild(item);
      }
    } catch (err) {
      threadList.innerHTML = '';
      threadList.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load inbox']), el('p', { class: 'muted' }, [err.message])]));
    }
  }

  async function openThread(id, itemEl) {
    activeThreadId = id;
    for (const n of threadList.children) n.classList.remove('active');
    if (itemEl) { itemEl.classList.add('active'); itemEl.classList.remove('unread'); }
    reader.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const r = await api.get(`/api/mail/threads/${id}`);
      paintThread(r);
    } catch (err) {
      reader.innerHTML = '';
      reader.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load thread']), el('p', { class: 'muted' }, [err.message])]));
    }
  }

  function paintThread({ thread, messages }) {
    clear(reader);
    const head = el('div', { style: { padding: '12px 14px', borderBottom: '1px solid var(--border)' } }, [
      el('div', { class: 'inline' }, [
        el('h2', { style: { flex: '1' } }, [thread.subject || '(no subject)']),
        el('button', { class: 'btn sm', title: 'AI thread summary', onClick: () => aiSummary(thread.id) }, ['✨ Summary']),
        el('button', { class: 'btn sm', title: 'AI suggested reply', onClick: () => aiReply(thread.id) }, ['✨ Reply idea']),
        el('button', { class: 'btn sm', onClick: () => openLinkModal(thread) }, ['⌁ Link to CRM']),
        thread.shared
          ? el('button', { class: 'btn sm', onClick: async () => { await apiAction(api.patch(`/api/mail/threads/${thread.id}`, { shared: false }), 'Made private'); openThread(thread.id); } }, ['Make private'])
          : el('button', { class: 'btn sm', onClick: async () => { await apiAction(api.patch(`/api/mail/threads/${thread.id}`, { shared: true }), 'Shared with team'); openThread(thread.id); } }, ['Share']),
      ]),
      el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } }, [
        thread.deal ? `Deal: ${thread.deal.title}` : null,
        thread.person ? ` · Person: ${thread.person.name}` : null,
        !thread.deal && !thread.person ? 'Not linked to any record' : '',
      ].filter(Boolean).join('')),
    ]);

    const msgs = el('div', { style: { padding: '12px 14px' } },
      messages.map((msg) => el('div', { class: `msg ${msg.direction === 'in' ? 'in' : 'out'}` }, [
        el('header', {}, [
          el('strong', {}, [msg.direction === 'in' ? (msg.from_name || msg.from_email || 'Incoming') : (msg.from_name || 'You')]),
          el('span', { class: 'muted', style: { fontSize: '11.5px' } }, [msg.from_email || '']),
          el('div', { class: 'spacer' }),
          msg.opened_at ? el('span', { class: 'badge green', title: fmtDateTime(msg.opened_at) }, ['Opened']) : null,
          msg.status === 'draft' ? el('span', { class: 'badge amber' }, ['Draft']) : null,
          msg.status === 'scheduled' ? el('span', { class: 'badge blue' }, ['Scheduled']) : null,
          el('span', { class: 'dim', style: { fontSize: '11.5px' } }, [relTime(msg.sent_at || msg.created_at)]),
        ]),
        el('div', { class: 'msg-body' }, [
          el('div', { class: 'inline', style: { marginBottom: '6px', fontSize: '11.5px', color: 'var(--text-2)' } }, [`To: ${(msg.to || []).join(', ') || '—'}`]),
          el('div', { style: { whiteSpace: 'pre-wrap' } }, [stripHtml(msg.body)]),
        ]),
      ])),
    );

    const replyBar = el('div', { style: { padding: '10px 14px', borderTop: '1px solid var(--border)' } }, [
      el('button', { class: 'btn primary sm', onClick: () => openCompose({ threadId: thread.id, to: messages[messages.length - 1]?.direction === 'in' ? [messages[messages.length - 1].from_email].filter(Boolean) : [], subject: thread.subject, personId: thread.person_id, dealId: thread.deal_id, leadId: thread.lead_id }) }, ['↩ Reply']),
    ]);

    reader.append(head, msgs, replyBar);
  }

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = String(html || '');
    return div.textContent || div.innerText || '';
  }

  async function aiSummary(threadId) {
    try {
      const r = await api.get(`/api/mail/threads/${threadId}/ai-summary`);
      modal({ title: 'AI thread summary', body: el('div', { style: { whiteSpace: 'pre-wrap' } }, [r.summary || r.text || JSON.stringify(r)]) });
    } catch (err) { toast(err.message, 'error'); }
  }
  async function aiReply(threadId) {
    try {
      const r = await api.post(`/api/mail/threads/${threadId}/ai-reply`, {});
      const m = modal({ title: 'AI suggested reply', body: el('textarea', { style: { minHeight: '160px' } }, [r.reply || r.text || '']) , footer: [
        el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Dismiss']),
        el('button', { class: 'btn primary', onClick: () => { openCompose({ threadId, prefill: r.reply || r.text || '' }); m.close(); } }, ['Use in reply']),
      ] });
    } catch (err) { toast(err.message, 'error'); }
  }

  function openLinkModal(thread) {
    const m = modal({ title: 'Link thread to CRM records', body: el('div', { class: 'loading' }, ['Loading…']) });
    const body = m.querySelector('.body');
    Promise.all([
      api.get('/api/deals', { limit: 200, status: 'open' }).then((r) => r.data),
      api.get('/api/leads', { limit: 200, status: 'open' }).then((r) => r.data),
    ]).then(([deals, leads]) => {
      clear(body);
      const dealSel = el('select', {}, [el('option', { value: '' }, ['— none —']), ...deals.map((d) => el('option', { value: d.id, selected: thread.deal_id === d.id }, [d.title]))]);
      const leadSel = el('select', {}, [el('option', { value: '' }, ['— none —']), ...leads.map((l) => el('option', { value: l.id, selected: thread.lead_id === l.id }, [l.title]))]);
      body.append(
        el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Deal']), dealSel]),
        el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Lead']), leadSel]),
      );
      m.querySelector('footer').innerHTML = '';
      m.querySelector('footer').append(
        el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
        el('button', { class: 'btn primary', onClick: async () => {
          try {
            await apiAction(api.patch(`/api/mail/threads/${thread.id}`, {
              deal_id: dealSel.value ? Number(dealSel.value) : null,
              lead_id: leadSel.value ? Number(leadSel.value) : null,
            }), 'Thread linked');
            m.close();
            openThread(thread.id);
            loadThreads();
          } catch {}
        } }, ['Save']),
      );
    });
  }

  async function openCompose(pre = {}) {
    const m = modal({ title: pre.threadId ? 'Reply' : 'Compose email', wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    const body = m.querySelector('.body');
    let [templates, mergeFields] = [[], []];
    try { templates = await api.get('/api/mail/templates'); } catch {}
    try { mergeFields = await api.get('/api/mail/merge-fields'); } catch {}
    clear(body);

    const prefill = pre.prefill || '';

    const to = el('input', { type: 'text', value: (pre.to || []).join(', '), placeholder: 'name@example.com' });
    const subject = el('input', { type: 'text', value: pre.subject || '' });
    const content = el('textarea', { style: { minHeight: '200px' } }, [prefill || '']);
    const tplSel = el('select', { style: { width: 'auto' } }, [el('option', { value: '' }, ['— insert template —']), ...templates.map((t) => el('option', { value: t.id }, [t.name]))]);
    tplSel.addEventListener('change', async () => {
      if (!tplSel.value) return;
      const t = templates.find((x) => String(x.id) === tplSel.value);
      if (t) { subject.value = t.subject || subject.value; content.value = t.body || content.value; }
    });
    const mfSel = el('select', { style: { width: 'auto' } }, [
      el('option', { value: '' }, ['— merge field —']),
      ...(mergeFields || []).flatMap((group) => (group.fields || []).map((f) => el('option', { value: `{{${f}}}` }, [`{{${f}}}`]))),
    ]);
    mfSel.addEventListener('change', () => { if (mfSel.value) { content.value += mfSel.value; mfSel.value = ''; } });
    const aiBtn = el('button', { class: 'btn sm', title: 'AI draft', onClick: async () => {
      try {
        const r = await api.post('/api/mail/ai/draft', { intent: subject.value || 'Follow up', context: content.value });
        content.value = r.body || r.text || content.value;
      } catch (err) { toast(err.message, 'error'); }
    } }, ['✨ AI draft']);
    const sched = el('input', { type: 'datetime-local' });
    const shared = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: true }), ' shared']);

    body.append(
      el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['To']), to]),
      el('div', { class: 'inline' }, [tplSel, mfSel, aiBtn]),
      el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Subject']), subject]),
      content,
      el('div', { class: 'inline', style: { marginTop: '8px' } }, [el('span', { class: 'muted', style: { fontSize: '12px' } }, ['Schedule (optional)']), sched, shared]),
    );

    m.querySelector('footer').innerHTML = '';
    m.querySelector('footer').append(
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn', onClick: async () => {
        try {
          await apiAction(api.post('/api/mail/send', {
            to: to.value.split(',').map((s) => s.trim()).filter(Boolean),
            subject: subject.value, body: content.value,
            thread_id: pre.threadId || null, person_id: pre.personId || null,
            deal_id: pre.dealId || null, lead_id: pre.leadId || null,
            draft: true, shared: shared.querySelector('input').checked,
          }), 'Draft saved');
          m.close(); loadThreads();
        } catch {}
      } }, ['Save draft']),
      el('button', { class: 'btn primary', onClick: async () => {
        try {
          await apiAction(api.post('/api/mail/send', {
            to: to.value.split(',').map((s) => s.trim()).filter(Boolean),
            subject: subject.value, body: content.value,
            thread_id: pre.threadId || null, person_id: pre.personId || null,
            deal_id: pre.dealId || null, lead_id: pre.leadId || null,
            scheduled_at: sched.value ? sched.value.replace('T', ' ') : null,
            shared: shared.querySelector('input').checked,
          }), sched.value ? 'Scheduled' : 'Sent');
          m.close(); loadThreads();
          if (pre.threadId) openThread(pre.threadId);
        } catch {}
      } }, [sched.value ? 'Schedule' : 'Send']),
    );
  }

  async function openTemplates() {
    const m = modal({ title: 'Email templates', wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
    const body = m.querySelector('.body');
    await load();
    async function load() {
      const templates = await api.get('/api/mail/templates');
      clear(body);
      const tbl = el('table', { class: 'grid' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['Name']), el('th', {}, ['Subject']), el('th', {}, ['Shared']), el('th', {}, [''])])]),
        el('tbody', {}, templates.map((t) => el('tr', {}, [
          el('td', {}, [t.name]),
          el('td', {}, [t.subject || '—']),
          el('td', {}, [t.shared ? 'Shared' : 'Private']),
          el('td', { class: 'tight' }, [
            el('button', { class: 'btn sm', onClick: () => editTemplate(t, load) }, ['Edit']),
            el('button', { class: 'btn sm danger', onClick: async () => { try { await apiAction(api.del(`/api/mail/templates/${t.id}`), 'Deleted'); load(); } catch {} } }, ['Delete']),
          ]),
        ]))),
      ]);
      body.append(
        el('div', { class: 'inline', style: { marginBottom: '10px' } }, [
          el('button', { class: 'btn primary sm', onClick: () => editTemplate(null, load) }, ['＋ New template']),
        ]),
        tbl,
      );
    }
  }

  function editTemplate(t, done) {
    const m2 = modal({ title: t ? `Edit template: ${t.name}` : 'New template', body: el('div', {}, [
      el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Name']), el('input', { type: 'text', id: 'et-name', value: t?.name || '' })]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Subject']), el('input', { type: 'text', id: 'et-subject', value: t?.subject || '' })]),
      el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Body (HTML allowed)']), el('textarea', { id: 'et-body', style: { minHeight: '140px' } }, [t?.body || ''])]),
    ]), footer: [
      el('button', { class: 'btn ghost', onClick: () => m2.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        const payload = { name: m2.querySelector('#et-name').value, subject: m2.querySelector('#et-subject').value, body: m2.querySelector('#et-body').value };
        try {
          if (t) await apiAction(api.patch(`/api/mail/templates/${t.id}`, payload), 'Template saved');
          else await apiAction(api.post('/api/mail/templates', payload), 'Template created');
          m2.close(); done();
        } catch {}
      } }, ['Save']),
    ] });
  }

  loadThreads();
  return wrap;
}