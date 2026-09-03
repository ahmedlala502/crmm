// Admin — configuration center: users, teams, permission sets, visibility groups, pipelines,
// custom fields, imports, data quality, audit/security, tokens, integrations, AI, settings, web forms.
import { el, clear } from '../lib/dom.js';
import { api, state } from '../lib/api.js';
import { modal, toast, apiAction, confirmDialog, fmtDate, fmtDateTime, relTime } from '../lib/ui.js';
import { go } from '../lib/router.js';

const SECTIONS = [
  { key: 'users', label: 'Users & Teams', perm: 'admin.users' },
  { key: 'permissions', label: 'Permission Sets', perm: 'admin.users' },
  { key: 'visibility', label: 'Visibility Groups', perm: 'admin.users' },
  { key: 'pipelines', label: 'Pipelines & Stages', perm: 'admin.pipelines' },
  { key: 'fields', label: 'Custom Fields', perm: 'admin.fields' },
  { key: 'labels', label: 'Labels', perm: 'admin.settings' },
  { key: 'lost-reasons', label: 'Lost Reasons', perm: 'admin.settings' },
  { key: 'currencies', label: 'Currencies', perm: 'admin.settings' },
  { key: 'activity-types', label: 'Activity Types', perm: 'admin.settings' },
  { key: 'taxes', label: 'Taxes', perm: 'admin.settings' },
  { key: 'imports', label: 'Import / Export', perm: 'data.import' },
  { key: 'web-forms', label: 'Web Forms', perm: 'admin.settings' },
  { key: 'webhooks', label: 'Webhooks', perm: 'admin.api' },
  { key: 'tokens', label: 'API Tokens', perm: 'admin.api' },
  { key: 'integrations', label: 'Integrations', perm: 'admin.settings' },
  { key: 'ai', label: 'AI', perm: 'admin.settings' },
  { key: 'security', label: 'Security', perm: 'admin.security' },
  { key: 'audit', label: 'Audit Log', perm: 'admin.security' },
  { key: 'settings', label: 'General Settings', perm: 'admin.settings' },
];

export function renderAdmin(params = {}) {
  const wrap = el('div', {});
  wrap.appendChild(el('div', { class: 'cards cols-3' }, SECTIONS.map((s) =>
    el('div', { class: 'card', style: { cursor: 'pointer' }, onClick: () => go('admin/' + s.key) }, [
      el('div', { class: 'pad' }, [
        el('h2', {}, [s.label]),
        el('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '4px' } }, ['Manage →']),
      ]),
    ])
  )));
  return wrap;
}

export function renderAdminSection(section, params = {}) {
  const meta = SECTIONS.find((s) => s.key === section);
  const wrap = el('div', {});
  wrap.appendChild(el('div', { class: 'inline', style: { marginBottom: '8px' } }, [
    el('button', { class: 'btn sm ghost', onClick: () => go('admin') }, ['← All settings']),
    el('h2', {}, [meta?.label || section]),
  ]));
  const body = el('div', {});
  wrap.appendChild(body);
  const renderer = RENDERERS[section];
  if (renderer) body.appendChild(renderer());
  else body.appendChild(el('div', { class: 'empty' }, ['Unknown settings section.']));
  return wrap;
}

// ============ helpers ============
function configTable({ segment, columns, defaults, title, addLabel, rowActions } = {}) {
  const wrap = el('div', {});
  const box = el('div', {});
  wrap.appendChild(box);
  load();
  async function load() {
    box.innerHTML = '<div class="loading">Loading…</div>';
    const rows = await api.get(`/api/config/${segment}`).catch(() => []);
    clear(box);
    const tbl = el('table', { class: 'grid' }, [
      el('thead', {}, [el('tr', {}, [...columns.map((c) => el('th', {}, [c.label])), el('th', {}, [''])])]),
      el('tbody', {}, rows.map((r) => el('tr', {}, [
        ...columns.map((c) => el('td', {}, [renderCell(r, c)])),
        el('td', { class: 'tight' }, [
          el('button', { class: 'btn sm', onClick: () => editRow(r, load) }, ['Edit']),
          ...(rowActions ? rowActions(r, load) : []),
          el('button', { class: 'btn sm danger', onClick: async () => {
            if (!await confirmDialog({ title: `Delete this ${title}?`, okText: 'Delete', danger: true })) return;
            try { await apiAction(api.del(`/api/config/${segment}/${r.id ?? r.code}`), 'Deleted'); load(); } catch {}
          } }, ['✕']),
        ]),
      ]))),
    ]);
    box.append(
      el('div', { class: 'toolbar' }, [el('button', { class: 'btn primary sm', onClick: () => editRow(null, load) }, [`＋ ${addLabel}`])]),
      el('div', { class: 'table-wrap' }, [tbl]),
    );
  }
  function renderCell(r, c) {
    const v = r[c.key];
    if (c.key === 'color') return el('span', { class: `badge ${v || 'gray'}` }, [v || '—']);
    if (v === true || v === 1) return 'Yes';
    if (v === false || v === 0) return 'No';
    return v == null ? '—' : String(v);
  }
  async function editRow(row, done) {
    const inputs = columns.map((c) => {
      let inp;
      if (c.options) inp = el('select', {}, c.options.map((o) => el('option', { value: o, selected: String(row?.[c.key] ?? '') === String(o.value ?? o) }, [o.label ?? o])));
      else if (c.type === 'bool') inp = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: !!row?.[c.key], id: 'cfg-' + c.key }), ' ']);
      else inp = el('input', { type: c.type === 'number' ? 'number' : 'text', value: row?.[c.key] ?? '', id: 'cfg-' + c.key });
      return { c, inp };
    });
    const m = modal({ title: row ? `Edit ${title}` : addLabel, body: el('div', { class: 'grid-2' },
      inputs.map(({ c, inp }) => el('label', { class: 'field' }, [el('span', { class: 'lbl' }, [c.label]), c.type === 'bool' ? inp : inp]))
    ), footer: [
      el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
      el('button', { class: 'btn primary', onClick: async () => {
        const payload = {};
        for (const { c, inp } of inputs) {
          if (c.type === 'bool') payload[c.key] = inp.querySelector('input').checked ? 1 : 0;
          else if (c.options) { const v = inp.value; payload[c.key] = typeof (c.options[0]) === 'object' ? c.options.find((o) => (o.value ?? o) == v)?.value ?? v : v; }
          else payload[c.key] = c.type === 'number' ? Number(inp.value) : inp.value;
        }
        try {
          if (row) await apiAction(api.patch(`/api/config/${segment}/${row.id ?? row.code}`, payload), 'Saved');
          else await apiAction(api.post(`/api/config/${segment}`, payload), 'Created');
          m.close(); done();
        } catch {}
      } }, ['Save']),
    ] });
  }
  return wrap;
}

function crudPanel({ url, columns, title, addLabel, renderForm, onEdit }) {
  const wrap = el('div', {});
  const box = el('div', {});
  wrap.appendChild(box);
  load();
  async function load() {
    box.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const data = await api.get(url);
      paint(data);
    } catch (err) {
      box.innerHTML = ''; box.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load']), el('p', { class: 'muted' }, [err.message])]));
    }
  }
  function paint(data) {
    clear(box);
    const rows = Array.isArray(data) ? data : (data.rows || data.sets || data.jobs || []);
    const extras = Array.isArray(data) ? null : data;
    const tbl = el('table', { class: 'grid' }, [
      el('thead', {}, [el('tr', {}, [...columns.map((c) => el('th', {}, [c.label])), el('th', {}, [''])])]),
      el('tbody', {}, rows.map((r) => el('tr', {}, [
        ...columns.map((c) => el('td', {}, [c.render ? c.render(r) : (r[c.key] == null ? '—' : String(r[c.key]))])),
        el('td', { class: 'tight' }, [el('button', { class: 'btn sm', onClick: () => onEdit(r, load, extras) }, ['Edit'])]),
      ]))),
    ]);
    box.append(
      el('div', { class: 'toolbar' }, [el('button', { class: 'btn primary sm', onClick: () => onEdit(null, load, extras) }, [`＋ ${addLabel}`])]),
      el('div', { class: 'table-wrap' }, [tbl]),
    );
  }
  return wrap;
}

// ============ section renderers ============
const RENDERERS = {
  users: () => crudPanel({
    url: '/api/admin/users',
    title: 'user', addLabel: 'New user',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'is_admin', label: 'Admin', render: (r) => r.is_admin ? 'Yes' : 'No' },
      { key: 'active', label: 'Active', render: (r) => r.active ? 'Yes' : 'No' },
      { key: 'team_id', label: 'Team', render: (r) => r.team_id ? `#${r.team_id}` : '—' },
      { key: 'permission_sets', label: 'Permission sets', render: (r) => (r.permission_sets || []).map((p) => p.name).join(', ') || '—' },
      { key: 'last_login_at', label: 'Last login', render: (r) => relTime(r.last_login_at) || 'never' },
    ],
    onEdit: (row, done) => {
      api.get('/api/admin/teams').then(async (teams) => {
        const sets = await api.get('/api/admin/permission-sets');
        const groups = await api.get('/api/admin/visibility-groups');
        const name = el('input', { type: 'text', value: row?.name || '' });
        const email = el('input', { type: 'text', value: row?.email || '' });
        const team = el('select', {}, [el('option', { value: '' }, ['— none —']), ...teams.map((t) => el('option', { value: t.id, selected: row?.team_id === t.id }, [t.name]))]);
        const isAdmin = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: !!row?.is_admin }), ' administrator']);
        const active = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: row ? !!row.active : true }), ' active']);
        const password = el('input', { type: 'password', value: '', placeholder: row ? '(unchanged)' : 'initial password' });
        const psBoxes = el('div', { class: 'inline wrap' }, (sets.sets || []).map((s) => el('label', { class: 'checkbox' }, [
          el('input', { type: 'checkbox', value: s.id, checked: (row?.permission_sets || []).some((p) => p.id === s.id), 'data-ps': '' }), ` ${s.name}`,
        ])));
        const vgBoxes = el('div', { class: 'inline wrap' }, (Array.isArray(groups) ? groups : []).map((g) => el('label', { class: 'checkbox' }, [
          el('input', { type: 'checkbox', value: g.id, checked: (row?.visibility_groups || []).some((p) => p.id === g.id), 'data-vg': '' }), ` ${g.name}`,
        ])));
        const m = modal({ title: row ? `Edit user: ${row.name}` : 'New user', wide: true, body: el('div', { class: 'grid-2' }, [
          el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Name']), name]),
          el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Email']), email]),
          el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Team']), team]),
          el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Password']), password]),
          el('div', { class: 'inline', style: { gridColumn: '1 / -1' } }, [isAdmin, active]),
          el('div', { style: { gridColumn: '1 / -1' } }, [el('h3', {}, ['Permission sets']), psBoxes]),
          el('div', { style: { gridColumn: '1 / -1' } }, [el('h3', {}, ['Visibility groups']), vgBoxes]),
        ]), footer: [
          el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
          el('button', { class: 'btn primary', onClick: async () => {
            const payload = {
              name: name.value, email: email.value,
              team_id: team.value ? Number(team.value) : null,
              is_admin: isAdmin.querySelector('input').checked,
              active: active.querySelector('input').checked,
              permission_sets: [...psBoxes.querySelectorAll('input:checked')].map((i) => Number(i.value)),
              visibility_groups: [...vgBoxes.querySelectorAll('input:checked')].map((i) => Number(i.value)),
            };
            if (password.value) payload.password = password.value;
            try {
              if (row) await apiAction(api.patch(`/api/admin/users/${row.id}`, payload), 'User saved');
              else { payload.name = payload.name || payload.email; await apiAction(api.post('/api/admin/users', payload), 'User created'); }
              m.close(); done();
            } catch {}
          } }, ['Save']),
        ] });
      });
    },
  }),

  permissions: () => crudPanel({
    url: '/api/admin/permission-sets',
    title: 'permission set', addLabel: 'New permission set',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description' },
      { key: 'user_count', label: 'Users' },
      { key: 'is_system', label: 'System', render: (r) => r.is_system ? 'Yes' : 'No' },
    ],
    onEdit: (row, done, extras) => {
      const catalogue = extras.catalogue || { permissions: [] };
      const name = el('input', { type: 'text', value: row?.name || '' });
      const desc = el('input', { type: 'text', value: row?.description || '' });
      const perms = catalogue.permissions || [];
      const boxes = el('div', { class: 'inline wrap', style: { gap: '8px 14px' } }, perms.map((p) => el('label', { class: 'checkbox' }, [
        el('input', { type: 'checkbox', value: p, checked: !row || !!row.permissions?.[p], 'data-perm': '' }), ` ${p}`,
      ])));
      const m = modal({ title: row ? `Edit: ${row.name}` : 'New permission set', wide: true, body: el('div', {}, [
        el('div', { class: 'grid-2' }, [
          el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Name']), name]),
          el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Description']), desc]),
        ]),
        el('h3', { style: { margin: '8px 0 6px' } }, ['Permissions (granted)']),
        boxes,
      ]), footer: [
        el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
        el('button', { class: 'btn primary', onClick: async () => {
          const payload = { name: name.value, description: desc.value, permissions: {} };
          for (const p of perms) payload.permissions[p] = [...boxes.querySelectorAll('input:checked')].some((i) => i.value === p);
          try {
            if (row) await apiAction(api.patch(`/api/admin/permission-sets/${row.id}`, payload), 'Saved');
            else await apiAction(api.post('/api/admin/permission-sets', payload), 'Created');
            m.close(); done();
          } catch {}
        } }, ['Save']),
      ] });
    },
  }),

  visibility: () => crudPanel({
    url: '/api/admin/visibility-groups',
    title: 'visibility group', addLabel: 'New group',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description' },
      { key: 'users', label: 'Members', render: (r) => (r.users || []).map((u) => u.name).join(', ') || '—' },
    ],
    onEdit: (row, done, extras) => {
      const name = el('input', { type: 'text', value: row?.name || '' });
      const desc = el('input', { type: 'text', value: row?.description || '' });
      const parent = el('select', {}, [el('option', { value: '' }, ['— none (top level) —']), ...(extras || []).filter((g) => g.id !== row?.id).map((g) => el('option', { value: g.id, selected: row?.parent_id === g.id }, [g.name]))]);
      const userBoxes = el('div', { class: 'inline wrap' }, (state.ref?.users || []).map((u) => el('label', { class: 'checkbox' }, [
        el('input', { type: 'checkbox', value: u.id, checked: (row?.users || []).some((x) => x.id === u.id), 'data-u': '' }), ` ${u.name}`,
      ])));
      const m = modal({ title: row ? `Edit group: ${row.name}` : 'New visibility group', body: el('div', {}, [
        el('div', { class: 'grid-2' }, [
          el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Name']), name]),
          el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Description']), desc]),
          el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Parent group']), parent]),
        ]),
        el('h3', { style: { margin: '8px 0 6px' } }, ['Members']),
        userBoxes,
      ]), footer: [
        el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
        el('button', { class: 'btn primary', onClick: async () => {
          try {
            const payload = { name: name.value, description: desc.value, parent_id: parent.value ? Number(parent.value) : null };
            if (row) await apiAction(api.patch(`/api/admin/visibility-groups/${row.id}`, payload), 'Saved');
            else await apiAction(api.post('/api/admin/visibility-groups', payload), 'Created');
            m.close(); done();
          } catch {}
        } }, ['Save']),
      ] });
    },
  }),

  pipelines: () => {
    const wrap = el('div', {});
    const box = el('div', {});
    wrap.appendChild(box);
    load();
    async function load() {
      box.innerHTML = '<div class="loading">Loading…</div>';
      const pipelines = await api.get('/api/pipelines').catch(() => []);
      clear(box);
      for (const p of pipelines) {
        const stagesBox = el('div', { class: 'body', style: { padding: '8px 12px' } });
        function drawStages() {
          clear(stagesBox);
          for (const s of p.stages || []) {
            const name = el('input', { type: 'text', value: s.name, style: { width: '150px' } });
            const prob = el('input', { type: 'number', value: s.probability ?? 100, min: '0', max: '100', style: { width: '70px' } });
            const rotten = el('input', { type: 'number', value: s.rotten_days ?? '', min: '0', style: { width: '70px' }, placeholder: 'rotten d' });
            stagesBox.appendChild(el('div', { class: 'inline', style: { marginBottom: '4px' } }, [
              name, el('span', { class: 'muted', style: { fontSize: '11px' } }, ['prob %']), prob, rotten,
              el('button', { class: 'btn sm', onClick: async () => {
                try { await apiAction(api.patch(`/api/stages/${s.id}`, { name: name.value, probability: Number(prob.value), rotten_days: rotten.value === '' ? null : Number(rotten.value) }), 'Stage saved'); load(); } catch {}
              } }, ['Save']),
              (p.stages || []).indexOf(s) > 0 ? el('button', { class: 'btn sm ghost', title: 'Move up', onClick: async () => {
                const order = p.stages.map((x) => x.id);
                const i = order.indexOf(s.id);
                [order[i - 1], order[i]] = [order[i], order[i - 1]];
                try { await apiAction(api.post('/api/stages/reorder', { order }), 'Reordered'); load(); } catch {}
              } }, ['↑']) : null,
              el('button', { class: 'btn sm danger', onClick: async () => {
                if (!await confirmDialog({ title: `Delete stage "${s.name}"?`, danger: true })) return;
                try { await apiAction(api.del(`/api/stages/${s.id}`), 'Deleted'); load(); } catch {}
              } }, ['✕']),
            ]));
          }
          const nn = el('input', { type: 'text', placeholder: 'New stage name', style: { width: '150px' } });
          const np = el('input', { type: 'number', placeholder: '%', style: { width: '70px' }, min: '0', max: '100' });
          stagesBox.appendChild(el('div', { class: 'inline', style: { marginTop: '6px' } }, [
            nn, np,
            el('button', { class: 'btn sm primary', onClick: async () => {
              if (!nn.value.trim()) return;
              try { await apiAction(api.post(`/api/pipelines/${p.id}/stages`, { name: nn.value, probability: Number(np.value ?? 100) }), 'Stage added'); load(); } catch {}
            } }, ['＋ Add stage']),
          ]));
        }
        drawStages();

        box.appendChild(el('div', { class: 'card', style: { marginBottom: '12px' } }, [
          el('header', {}, [
            el('input', { type: 'text', value: p.name, style: { width: '200px', fontWeight: '600' }, onChange: async (e) => {
              try { await apiAction(api.patch(`/api/pipelines/${p.id}`, { name: e.target.value }), 'Pipeline renamed'); load(); } catch {}
            } }),
            p.probability_enabled ? el('span', { class: 'badge purple' }, ['Weighted']) : null,
            el('span', { class: 'badge blue' }, [`${p.deal_count} open deals`]),
            el('div', { class: 'spacer' }),
            el('button', { class: 'btn sm', onClick: async () => {
              try { await apiAction(api.patch(`/api/pipelines/${p.id}`, { probability_enabled: !p.probability_enabled }), 'Saved'); load(); } catch {}
            } }, [p.probability_enabled ? 'Disable weighting' : 'Enable weighting']),
            el('button', { class: 'btn sm danger', onClick: async () => {
              if (!await confirmDialog({ title: `Delete pipeline "${p.name}"?`, danger: true })) return;
              try { await apiAction(api.del(`/api/pipelines/${p.id}`), 'Deleted'); load(); } catch {}
            } }, ['✕']),
          ]),
          stagesBox,
        ]));
      }
      box.prepend(el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn primary sm', onClick: async () => {
          const name = el('input', { type: 'text', placeholder: 'Pipeline name', style: { width: '240px' } });
          const m = modal({ title: 'New pipeline', body: el('div', {}, [name]), footer: [
            el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
            el('button', { class: 'btn primary', onClick: async () => {
              try { await apiAction(api.post('/api/pipelines', { name: name.value }), 'Pipeline created'); m.close(); load(); } catch {}
            } }, ['Create']),
          ] });
        } }, ['＋ New pipeline']),
      ]));
    }
    return wrap;
  },

  fields: () => {
    const wrap = el('div', {});
    const bar = el('div', { class: 'toolbar' }, [
      el('h2', {}, ['Custom fields']),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn primary sm', onClick: () => editField(null) }, ['＋ New field']),
    ]);
    const box = el('div', {});
    wrap.append(bar, box);
    load();
    async function load() {
      box.innerHTML = '<div class="loading">Loading…</div>';
      const r = await api.get('/api/admin/fields').catch(() => ({ types: [], fields: [] }));
      clear(box);
      const tbl = el('table', { class: 'grid' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['Entity']), el('th', {}, ['Name']), el('th', {}, ['Key']), el('th', {}, ['Type']), el('th', {}, ['Flags']), el('th', {}, [''])])]),
        el('tbody', {}, (r.fields || []).filter((f) => f.active !== 0).map((f) => el('tr', {}, [
          el('td', {}, [f.entity]),
          el('td', {}, [f.name]),
          el('td', { class: 'mono' }, [f.key]),
          el('td', {}, [f.type + (f.formula ? ` (${f.formula})` : '')]),
          el('td', {}, [el('div', { class: 'inline' }, [
            f.required ? el('span', { class: 'badge amber' }, ['required']) : null,
            f.important ? el('span', { class: 'badge purple' }, ['important']) : null,
            f.read_only ? el('span', { class: 'badge gray' }, ['read-only']) : null,
            f.show_in_list ? el('span', { class: 'badge blue' }, ['in list']) : null,
          ].filter(Boolean))]),
          el('td', { class: 'tight' }, [
            el('button', { class: 'btn sm', onClick: () => editField(f, load) }, ['Edit']),
            el('button', { class: 'btn sm danger', onClick: async () => {
              if (!await confirmDialog({ title: `Deactivate field "${f.name}"?`, body: 'Stored values are preserved.', okText: 'Deactivate', danger: true })) return;
              try { await apiAction(api.del(`/api/admin/fields/${f.id}`), 'Deactivated'); load(); } catch {}
            } }, ['✕']),
          ]),
        ]))),
      ]);
      box.appendChild(el('div', { class: 'table-wrap' }, [tbl]));
    }
    async function editField(row) {
      const typesR = await api.get('/api/admin/fields');
      const types = typesR.types || [];
      const entitySel = el('select', {}, ['lead', 'deal', 'person', 'organization', 'activity', 'product', 'project'].map((x) => el('option', { value: x, selected: row?.entity === x }, [x])));
      const name = el('input', { type: 'text', value: row?.name || '' });
      const typeSel = el('select', {}, types.map((t) => el('option', { value: t, selected: row?.type === t }, [t])));
      const options = el('input', { type: 'text', value: (row?.options || []).join(', '), placeholder: 'comma-separated options (select types)' });
      const formula = el('input', { type: 'text', value: row?.formula || '', placeholder: 'e.g. value * 12 / cf.contract_length' });
      const req = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: !!row?.required }), ' required']);
      const imp = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: !!row?.important }), ' important (shows on cards)']);
      const inList = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: !!row?.show_in_list }), ' show in list']);
      const readOnly = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: !!row?.read_only }), ' read-only']);
      const m = modal({ title: row ? `Edit field: ${row.name}` : 'New custom field', wide: true, body: el('div', { class: 'grid-2' }, [
        el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Entity']), entitySel]),
        el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Name']), name]),
        el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Type']), typeSel]),
        el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Options']), options]),
        el('label', { class: 'field', style: { gridColumn: '1 / -1' } }, [el('span', { class: 'lbl' }, ['Formula (for formula fields)']), formula]),
        el('div', { class: 'inline', style: { gridColumn: '1 / -1' } }, [req, imp, inList, readOnly]),
      ]), footer: [
        el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
        el('button', { class: 'btn primary', onClick: async () => {
          const payload = {
            entity: entitySel.value, name: name.value, type: typeSel.value,
            options: options.value.split(',').map((s) => s.trim()).filter(Boolean),
            formula: formula.value || null,
            required: req.querySelector('input').checked,
            important: imp.querySelector('input').checked,
            show_in_list: inList.querySelector('input').checked,
            read_only: readOnly.querySelector('input').checked,
          };
          try {
            if (row) await apiAction(api.patch(`/api/admin/fields/${row.id}`, payload), 'Field saved');
            else await apiAction(api.post('/api/admin/fields', payload), 'Field created');
            m.close(); load();
          } catch {}
        } }, ['Save']),
      ] });
    }
    return wrap;
  },

  imports: () => {
    const wrap = el('div', {});
    const bar = el('div', { class: 'toolbar' }, [
      el('h2', {}, ['Import']),
      el('div', { class: 'spacer' }),
    ]);
    const entitySel = el('select', { style: { width: 'auto' } }, ['lead', 'deal', 'person', 'organization', 'product', 'activity', 'project'].map((x) => el('option', { value: x }, [x])));
    const file = el('input', { type: 'file', accept: '.csv,.xlsx' });
    const analyseBtn = el('button', { class: 'btn primary sm', onClick: analyse }, ['⬆ Upload & map']);
    const historyBox = el('div', { style: { marginTop: '14px' } });
    bar.append(entitySel, file, analyseBtn);
    wrap.append(bar, historyBox);
    loadHistory();
    async function loadHistory() {
      historyBox.innerHTML = '<div class="loading">Loading history…</div>';
      const r = await api.get('/api/admin/imports').catch(() => ({ jobs: [] }));
      clear(historyBox);
      historyBox.appendChild(el('h3', { style: { marginBottom: '6px' } }, ['Import history']));
      if (!(r.jobs || []).length) { historyBox.appendChild(el('div', { class: 'empty' }, ['No imports yet.'])); return; }
      historyBox.appendChild(el('table', { class: 'grid' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['When']), el('th', {}, ['Entity']), el('th', {}, ['File']), el('th', { class: 'num' }, ['Created']), el('th', { class: 'num' }, ['Updated']), el('th', { class: 'num' }, ['Skipped']), el('th', {}, [''])])]),
        el('tbody', {}, (r.jobs || []).map((j) => el('tr', {}, [
          el('td', {}, [fmtDateTime(j.created_at)]),
          el('td', {}, [j.entity]),
          el('td', {}, [j.filename || '—']),
          el('td', { class: 'num' }, [String(j.created_count ?? '—')]),
          el('td', { class: 'num' }, [String(j.updated_count ?? '—')]),
          el('td', { class: 'num' }, [String((j.skipped || []).length)]),
          el('td', { class: 'tight' }, [
            el('button', { class: 'btn sm', onClick: () => importDetail(j) }, ['Detail']),
            j.can_revert !== false ? el('button', { class: 'btn sm danger', onClick: async () => {
              if (!await confirmDialog({ title: 'Revert this import?', body: 'Created records will be removed; updates cannot be reversed.', okText: 'Revert', danger: true })) return;
              try { await apiAction(api.post(`/api/admin/imports/${j.id}/revert`, {}), 'Import reverted'); loadHistory(); } catch {}
            } }, ['Revert']) : null,
          ].filter(Boolean)),
        ]))),
      ]));
    }
    function importDetail(j) {
      const m = modal({ title: `Import #${j.id}`, wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
      api.get(`/api/admin/imports/${j.id}`).then((job) => {
        const bodyEl = m.querySelector('.body'); clear(bodyEl);
        bodyEl.appendChild(el('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap' } }, [JSON.stringify(job, null, 2).slice(0, 6000)]));
      });
    }
    async function analyse() {
      if (!file.files.length) { toast('Choose a CSV or XLSX file first', 'error'); return; }
      const f = file.files[0];
      const m = modal({ title: 'Import mapping', wide: true, body: el('div', { class: 'loading' }, ['Uploading…']) });
      try {
        const res = await fetch(`/api/admin/import/analyse?entity=${entitySel.value}`, {
          method: 'POST', headers: { 'x-filename': f.name, 'content-type': f.type || 'application/octet-stream' }, body: f, credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        paintMapping(data, m);
      } catch (err) {
        m.close();
        toast(err.message, 'error', 6000);
      }
    }
    function paintMapping(data, m) {
      const bodyEl = m.querySelector('.body'); clear(bodyEl);
      const mappingBox = el('div', {});
      for (const [csvCol, target] of Object.entries(data.mapping || {})) {
        const sel = el('select', { style: { width: 'auto' } }, [el('option', { value: '' }, ['— skip —']), ...(data.fields || []).map((f) => el('option', { value: f.key, selected: f.key === target }, [f.label]))]);
        sel.dataset.csv = csvCol;
        mappingBox.appendChild(el('div', { class: 'inline', style: { marginBottom: '4px' } }, [
          el('span', { class: 'mono', style: { width: '160px' } }, [csvCol]), el('span', { class: 'muted' }, ['→']), sel,
        ]));
      }
      const dupSel = el('select', { style: { width: 'auto' } }, (data.duplicate_strategies || ['create', 'update', 'skip']).map((s) => el('option', { value: s }, [s])));
      bodyEl.append(
        el('div', { class: 'muted', style: { marginBottom: '6px', fontSize: '12px' } }, [`Mapped by ${data.mapping_source || 'auto'} · ${data.rows_detected ?? '?'} rows detected`]),
        mappingBox,
        el('div', { class: 'inline', style: { marginTop: '10px' } }, [el('span', { class: 'muted' }, ['Duplicates:']), dupSel]),
      );
      const footer = m.querySelector('footer'); footer.innerHTML = '';
      footer.append(
        el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
        el('button', { class: 'btn', onClick: async () => run(true) }, ['Dry run']),
        el('button', { class: 'btn primary', onClick: async () => run(false) }, ['Run import']),
      );
      async function run(dryRun) {
        const mapping = {};
        for (const sel of mappingBox.querySelectorAll('select')) if (sel.value) mapping[sel.dataset.csv] = sel.value;
        try {
          const r = await apiAction(api.post('/api/admin/import/run', { token: data.token, mapping, duplicate_strategy: dupSel.value, dry_run: dryRun }), dryRun ? 'Dry run complete' : 'Import complete');
          const bodyEl2 = m.querySelector('.body'); clear(bodyEl2);
          bodyEl2.appendChild(el('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap' } }, [JSON.stringify(r, null, 2).slice(0, 6000)]));
          footer.innerHTML = '';
          footer.append(el('button', { class: 'btn primary', onClick: () => { m.close(); loadHistory(); } }, ['Close']));
        } catch {}
      }
    }
    return wrap;
  },

  'web-forms': () => {
    const wrap = el('div', {});
    const bar = el('div', { class: 'toolbar' }, [
      el('h2', {}, ['Web forms (lead generation)']),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn primary sm', onClick: () => editForm(null) }, ['＋ New form']),
    ]);
    const box = el('div', {});
    wrap.append(bar, box);
    load();
    async function load() {
      box.innerHTML = '<div class="loading">Loading…</div>';
      const forms = await api.get('/api/admin/web-forms').catch(() => []);
      clear(box);
      if (!forms.length) { box.appendChild(el('div', { class: 'empty' }, ['No web forms yet. Embed one on your site to capture leads.'])); return; }
      box.appendChild(el('table', { class: 'grid' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['Name']), el('th', {}, ['Target']), el('th', {}, ['Public link']), el('th', {}, ['Active']), el('th', {}, [''])])]),
        el('tbody', {}, forms.map((f) => el('tr', {}, [
          el('td', {}, [f.name]),
          el('td', {}, [f.target]),
          el('td', {}, [el('a', { href: `/public/forms/${f.token}`, target: '_blank' }, [`${location.origin}/public/forms/${f.token}`])]),
          el('td', {}, [f.active ? 'Yes' : 'No']),
          el('td', { class: 'tight' }, [
            el('button', { class: 'btn sm', onClick: () => editForm(f, load) }, ['Edit']),
          ]),
        ]))),
      ]));
    }
    async function editForm(row, done) {
      const pipelines = state.ref?.pipelines || [];
      const name = el('input', { type: 'text', value: row?.name || '' });
      const target = el('select', {}, ['lead', 'deal'].map((x) => el('option', { value: x, selected: row?.target === x }, [x])));
      const pipeline = el('select', {}, [el('option', { value: '' }, ['— default —']), ...pipelines.map((p) => el('option', { value: p.id, selected: row?.pipeline_id === p.id }, [p.name]))]);
      const m = modal({ title: row ? `Edit form: ${row.name}` : 'New web form', body: el('div', { class: 'grid-2' }, [
        el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Name']), name]),
        el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Creates']), target]),
        el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Pipeline']), pipeline]),
      ]), footer: [
        el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
        el('button', { class: 'btn primary', onClick: async () => {
          try {
            const payload = { name: name.value, target: target.value, pipeline_id: pipeline.value ? Number(pipeline.value) : null };
            if (row) await apiAction(api.patch(`/api/admin/web-forms/${row.id}`, payload), 'Saved');
            else await apiAction(api.post('/api/admin/web-forms', payload), 'Form created');
            m.close(); done?.();
          } catch {}
        } }, ['Save']),
      ] });
    }
    return wrap;
  },

  webhooks: () => configTable({
    segment: 'webhooks', title: 'webhook', addLabel: 'New webhook',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'event', label: 'Event' },
      { key: 'method', label: 'Method' },
      { key: 'url', label: 'URL' },
      { key: 'active', label: 'Active', render: (r) => r.active ? 'Yes' : 'No' },
    ],
    rowActions: (r, reload) => [
      el('button', { class: 'btn sm', onClick: async () => {
        const m = modal({ title: `Deliveries — ${r.name}`, wide: true, body: el('div', { class: 'loading' }, ['Loading…']) });
        api.get(`/api/config/webhooks/${r.id}/deliveries`).then((ds) => {
          const bodyEl = m.querySelector('.body'); clear(bodyEl);
          if (!ds.length) { bodyEl.appendChild(el('div', { class: 'empty' }, ['No deliveries yet.'])); return; }
          bodyEl.appendChild(el('table', { class: 'grid' }, [
            el('thead', {}, [el('tr', {}, [el('th', {}, ['When']), el('th', {}, ['Status code']), el('th', {}, ['Response'])])]),
            el('tbody', {}, ds.map((d) => el('tr', {}, [
              el('td', {}, [relTime(d.created_at)]),
              el('td', {}, [String(d.status_code ?? '—')]),
              el('td', { class: 'mono', style: { fontSize: '11px' } }, [String(d.response || '').slice(0, 140)]),
            ]))),
          ]));
        });
      } }, ['Deliveries']),
    ],
  }),

  tokens: () => {
    const wrap = el('div', {});
    const bar = el('div', { class: 'toolbar' }, [
      el('h2', {}, ['API tokens']),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn primary sm', onClick: create }, ['＋ New token']),
    ]);
    const box = el('div', {});
    wrap.append(bar, box);
    load();
    async function load() {
      box.innerHTML = '<div class="loading">Loading…</div>';
      const tokens = await api.get('/api/admin/tokens').catch(() => []);
      clear(box);
      if (!tokens.length) { box.appendChild(el('div', { class: 'empty' }, ['No API tokens yet.'])); return; }
      box.appendChild(el('table', { class: 'grid' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['Name']), el('th', {}, ['User']), el('th', {}, ['Prefix']), el('th', {}, ['Scopes']), el('th', {}, ['Last used']), el('th', {}, [''])])]),
        el('tbody', {}, tokens.map((t) => el('tr', {}, [
          el('td', {}, [t.name]),
          el('td', {}, [t.user_name || '—']),
          el('td', { class: 'mono' }, [t.token_prefix || '']),
          el('td', {}, [t.scopes || '']),
          el('td', {}, [t.last_used_at ? relTime(t.last_used_at) : 'never']),
          el('td', { class: 'tight' }, [
            t.revoked_at ? el('span', { class: 'badge gray' }, ['Revoked']) : el('button', { class: 'btn sm danger', onClick: async () => {
              if (!await confirmDialog({ title: `Revoke token "${t.name}"?`, danger: true })) return;
              try { await apiAction(api.del(`/api/admin/tokens/${t.id}`), 'Revoked'); load(); } catch {}
            } }, ['Revoke']),
          ]),
        ]))),
      ]));
    }
    function create() {
      const name = el('input', { type: 'text', placeholder: 'Token name', style: { width: '220px' } });
      const scopes = el('select', {}, [el('option', { value: 'read,write' }, ['read + write']), el('option', { value: 'read' }, ['read only'])]);
      const m = modal({ title: 'New API token', body: el('div', { class: 'inline' }, [name, scopes]), footer: [
        el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
        el('button', { class: 'btn primary', onClick: async () => {
          try {
            const r = await apiAction(api.post('/api/admin/tokens', { name: name.value || 'API token', scopes: scopes.value }), 'Token created');
            m.close();
            modal({ title: 'Copy your token now', body: el('div', {}, [
              el('p', {}, ['It will not be shown again.']),
              el('pre', { class: 'mono', style: { userSelect: 'all', padding: '10px', background: 'var(--surface-3)', borderRadius: '6px' } }, [r.token]),
            ]), footer: [el('button', { class: 'btn primary', onClick: () => document.querySelector('.modal')?._close?.() }, ['Done'])] });
            load();
          } catch {}
        } }, ['Create']),
      ] });
    }
    return wrap;
  },

  integrations: () => {
    const wrap = el('div', {});
    const box = el('div', {});
    wrap.appendChild(box);
    load();
    async function load() {
      box.innerHTML = '<div class="loading">Loading…</div>';
      const cfg = await api.get('/api/admin/integrations').catch(() => null);
      clear(box);
      if (!cfg) { box.appendChild(el('div', { class: 'empty' }, ['Not available'])); return; }
      const cards = el('div', { class: 'cards cols-2' });
      cards.appendChild(intCard('Email provider', `Current: ${cfg.email.current?.provider || 'log'}`, cfg.email.adapters.map((a) => a.name).join(', '), async (provider) => {
        await api.put('/api/admin/integrations/email', { ...cfg.email.current, provider });
      }, cfg.email.current?.provider));
      cards.appendChild(intCard('Calendar sync', `Provider: ${cfg.calendar?.provider || 'none'} (${cfg.calendar?.sync || 'one-way'})`, 'Google / Outlook / CalDAV adapters — provider integrations land here', async (v) => {
        await api.put('/api/admin/integrations/calendar', { ...cfg.calendar, ...v });
      }, null));
      cards.appendChild(intCard('Cloud storage', `Provider: ${cfg.storage?.provider || 'local'}`, 'Google Drive / OneDrive / SharePoint adapters', async (v) => {
        await api.put('/api/admin/integrations/storage', { ...cfg.storage, ...v });
      }, null));
      cards.appendChild(intCard('Lead generation tools', ['web_forms', 'chatbot', 'live_chat', 'prospector', 'web_visitors'].map((k) => `${k.replace('_', ' ')}: ${cfg.lead_gen?.[k] ? 'on' : 'off'}`).join(' · '), 'Web forms, chatbot playbooks, live chat, prospector, web visitors', async (v) => {
        await api.put('/api/admin/integrations/lead_gen', { ...cfg.lead_gen, ...v });
      }, null));
      box.appendChild(cards);
    }
    function intCard(title, subtitle, adapters, save, current) {
      const card = el('div', { class: 'card pad' });
      card.append(el('h3', {}, [title]), el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } }, [subtitle]));
      if (adapters) card.appendChild(el('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '4px' } }, [`Available: ${adapters}`]));
      return card;
    }
    return wrap;
  },

  ai: () => {
    const wrap = el('div', {});
    const box = el('div', {});
    wrap.appendChild(box);
    load();
    async function load() {
      box.innerHTML = '<div class="loading">Loading…</div>';
      const r = await api.get('/api/admin/ai').catch(() => null);
      clear(box);
      if (!r) return;
      const enabled = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: !!r.config.enabled }), ' Enable AI features']);
      const provider = el('select', { style: { width: 'auto' } }, ['anthropic', 'openai'].map((p) => el('option', { value: p, selected: r.config.provider === p }, [p])));
      const model = el('input', { type: 'text', value: r.config.model || '', style: { width: '220px' } });
      const key = el('input', { type: 'password', value: '', placeholder: r.config.api_key ? '(stored — type new to replace)' : 'API key', style: { width: '260px' } });
      const base = el('input', { type: 'text', value: r.config.base_url || '', placeholder: 'https:// (optional override)', style: { width: '260px' } });
      const featureBoxes = el('div', { class: 'inline wrap feature-box', style: { marginTop: '8px' } }, (r.features || []).map((f) => el('label', { class: 'checkbox' }, [
        el('input', { type: 'checkbox', value: f, checked: r.config.features?.[f] !== false, 'data-f': '' }), ` ${f}`,
      ])));
      box.append(
        el('div', { class: 'card pad' }, [
          el('h3', {}, ['AI provider']),
          el('div', { class: 'inline wrap', style: { marginTop: '8px', gap: '10px' } }, [enabled, provider, model]),
          el('div', { class: 'inline wrap', style: { marginTop: '8px' } }, [key, base]),
          el('div', { style: { marginTop: '10px' } }, [el('h3', {}, ['Features']), featureBoxes]),
          el('button', { class: 'btn primary', style: { marginTop: '10px' }, onClick: async () => {
            try {
              await apiAction(api.put('/api/admin/ai', {
                enabled: enabled.querySelector('input').checked,
                provider: provider.value,
                model: model.value,
                api_key: key.value || undefined,
                base_url: base.value || undefined,
                features: Object.fromEntries([...box.querySelectorAll('.feature-box input:checked')].map((i) => [i.value, true])),
              }), 'AI settings saved');
              load();
            } catch {}
          } }, ['Save']),
        ]),
      );
    }
    return wrap;
  },

  security: () => {
    const wrap = el('div', {});
    const box = el('div', {});
    wrap.appendChild(box);
    load();
    async function load() {
      box.innerHTML = '<div class="loading">Loading…</div>';
      const r = await api.get('/api/admin/security').catch(() => null);
      clear(box);
      if (!r) return;
      const p = r.policy || {};
      const sessionHours = el('input', { type: 'number', value: p.session_hours ?? 336, style: { width: '100px' } });
      const pwMin = el('input', { type: 'number', value: p.password_min_length ?? 8, style: { width: '70px' } });
      const require2fa = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: !!p.require_2fa_for_admins }), ' require 2FA for admins']);
      const saveBtn = el('button', { class: 'btn primary sm', onClick: async () => {
        try {
          await apiAction(api.put('/api/admin/security', { ...p, session_hours: Number(sessionHours.value), password_min_length: Number(pwMin.value), require_2fa_for_admins: require2fa.querySelector('input').checked }), 'Policy saved');
        } catch {}
      } }, ['Save policy']);
      const stats = el('div', { class: 'cards cols-4', style: { marginBottom: '12px' } }, [
        el('div', { class: 'card stat' }, [el('div', { class: 'k' }, ['Failed logins (24h)']), el('div', { class: 'v' }, [String(r.failed_logins_24h ?? 0)])]),
        el('div', { class: 'card stat' }, [el('div', { class: 'k' }, ['Active sessions']), el('div', { class: 'v' }, [String((r.active_sessions || []).length)])]),
        el('div', { class: 'card stat' }, [el('div', { class: 'k' }, ['Admins without 2FA']), el('div', { class: 'v' }, [String((r.admins_without_2fa || []).length)])]),
        el('div', { class: 'card stat' }, [el('div', { class: 'k' }, ['Security events']), el('div', { class: 'v' }, [String((r.events || []).length)])]),
      ]);
      const events = el('table', { class: 'grid' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['When']), el('th', {}, ['Kind']), el('th', {}, ['Detail'])])]),
        el('tbody', {}, (r.events || []).slice(0, 30).map((e) => el('tr', {}, [
          el('td', {}, [relTime(e.created_at)]),
          el('td', {}, [el('span', { class: `badge ${/fail|denied|locked/i.test(e.kind || '') ? 'red' : 'gray'}` }, [e.kind || ''])]),
          el('td', { class: 'muted', style: { fontSize: '11.5px' } }, [e.detail || e.ip || '—']),
        ]))),
      ]);
      box.append(
        stats,
        el('div', { class: 'card pad', style: { marginBottom: '12px' } }, [
          el('h3', {}, ['Session & password policy']),
          el('div', { class: 'inline wrap', style: { marginTop: '8px' } }, [
            el('span', { class: 'muted' }, ['Session hours']), sessionHours,
            el('span', { class: 'muted' }, ['Min password length']), pwMin,
            require2fa, saveBtn,
          ]),
        ]),
        el('h3', { style: { margin: '8px 0 6px' } }, ['Recent security events']),
        el('div', { class: 'table-wrap' }, [events]),
      );
    }
    return wrap;
  },

  settings: () => {
    const wrap = el('div', {});
    const box = el('div', {});
    wrap.appendChild(box);
    load();
    async function load() {
      box.innerHTML = '<div class="loading">Loading…</div>';
      const s = await api.get('/api/admin/settings').catch(() => null);
      clear(box);
      if (!s) return;
      const company = el('input', { type: 'text', value: s.company_name || '', style: { width: '280px' } });
      const baseUrl = el('input', { type: 'text', value: s.public_base_url || '', style: { width: '280px' }, placeholder: 'https://crm.example.com' });
      const currency = el('select', { style: { width: 'auto' } }, (state.ref?.currencies || []).map((c) => el('option', { value: c.code, selected: c.code === s.default_currency }, [c.code])));
      const sandbox = el('label', { class: 'checkbox' }, [el('input', { type: 'checkbox', checked: !!s.sandbox_mode }), ' sandbox/test workspace mode']);
      box.appendChild(el('div', { class: 'card pad' }, [
        el('h3', {}, ['Workspace']),
        el('div', { class: 'grid-2', style: { marginTop: '8px' } }, [
          el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Company name']), company]),
          el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Public base URL']), baseUrl]),
          el('label', { class: 'field' }, [el('span', { class: 'lbl' }, ['Default currency']), currency]),
          sandbox,
        ]),
        el('button', { class: 'btn primary', onClick: async () => {
          try {
            await apiAction(api.put('/api/admin/settings', {
              company_name: company.value,
              public_base_url: baseUrl.value,
              default_currency: currency.value,
              sandbox_mode: sandbox.querySelector('input').checked,
            }), 'Settings saved');
          } catch {}
        } }, ['Save']),
      ]));
    }
    return wrap;
  },
};

// alias keys used by routes
RENDERERS.labels = () => configTable({ segment: 'labels', title: 'label', addLabel: 'New label', columns: [
  { key: 'entity', label: 'Entity', options: ['lead', 'deal', 'person', 'organization', 'project'] },
  { key: 'name', label: 'Name' },
  { key: 'color', label: 'Color', options: ['green', 'blue', 'red', 'amber', 'purple', 'gray'] },
] });
RENDERERS['lost-reasons'] = () => configTable({ segment: 'lost-reasons', title: 'lost reason', addLabel: 'New lost reason', columns: [
  { key: 'name', label: 'Name' },
  { key: 'active', label: 'Active', type: 'bool' },
] });
RENDERERS.currencies = () => configTable({ segment: 'currencies', title: 'currency', addLabel: 'New currency', columns: [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Name' },
  { key: 'symbol', label: 'Symbol' },
  { key: 'rate', label: 'Rate', type: 'number' },
  { key: 'is_default', label: 'Default', type: 'bool' },
  { key: 'active', label: 'Active', type: 'bool' },
] });
RENDERERS['activity-types'] = () => configTable({ segment: 'activity-types', title: 'activity type', addLabel: 'New activity type', columns: [
  { key: 'name', label: 'Name' },
  { key: 'key_string', label: 'Key' },
  { key: 'icon', label: 'Icon' },
  { key: 'active', label: 'Active', type: 'bool' },
] });
RENDERERS.taxes = () => configTable({ segment: 'taxes', title: 'tax', addLabel: 'New tax', columns: [
  { key: 'name', label: 'Name' },
  { key: 'percentage', label: 'Percent', type: 'number' },
  { key: 'is_default', label: 'Default', type: 'bool' },
] });
RENDERERS.audit = () => {
  const wrap = el('div', {});
  const box = el('div', {});
  wrap.appendChild(box);
  load();
  async function load() {
    box.innerHTML = '<div class="loading">Loading…</div>';
    const events = await api.get('/api/admin/audit', { limit: 200 }).catch(() => []);
    clear(box);
    box.appendChild(el('table', { class: 'grid' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['When']), el('th', {}, ['User']), el('th', {}, ['Entity']), el('th', {}, ['Action']), el('th', {}, ['Changes'])])]),
      el('tbody', {}, events.map((e) => el('tr', {}, [
        el('td', { class: 'nowrap' }, [relTime(e.created_at)]),
        el('td', {}, [e.user_name || `#${e.user_id}`]),
        el('td', {}, [`${e.entity}${e.entity_id ? ' #' + e.entity_id : ''}`]),
        el('td', {}, [el('span', { class: 'badge' }, [e.action || ''])]),
        el('td', { class: 'mono', style: { fontSize: '11px' } }, [JSON.stringify(e.changes || {}).slice(0, 160)]),
      ]))),
    ]));
  }
  return wrap;
};