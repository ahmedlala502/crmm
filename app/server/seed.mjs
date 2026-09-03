import { db, all, get, insert, run, setSetting, nowIso } from './db.mjs';
import { hashPassword } from './auth.mjs';
import { defaultPermissionSets } from './rbac.mjs';
import { invalidateCustomFields } from './customfields.mjs';

const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const stamp = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 19).replace('T', ' ');
const pick = (arr, i) => arr[i % arr.length];

export function ensureSeed() {
  if (get('SELECT id FROM users LIMIT 1')) return false;
  console.log('[seed] empty database — creating demo workspace');

  setSetting('company_name', 'Northwind Systems');
  setSetting('public_base_url', `http://localhost:${process.env.PORT || 4173}`);
  setSetting('mail', { provider: 'log' });

  // ---- currencies, taxes, labels, activity types, lost reasons ----
  for (const c of [
    { code: 'USD', name: 'US Dollar', symbol: '$', rate: 1, is_default: 1 },
    { code: 'EUR', name: 'Euro', symbol: '€', rate: 0.92 },
    { code: 'GBP', name: 'Pound Sterling', symbol: '£', rate: 0.79 },
  ]) insert('currencies', c);

  for (const t of [
    { name: 'No tax', percentage: 0, is_default: 1 },
    { name: 'VAT 20%', percentage: 20 },
    { name: 'Sales tax 8.5%', percentage: 8.5 },
  ]) insert('taxes', t);

  for (const [entity, names] of Object.entries({
    deal: [['Hot', 'red'], ['Warm', 'amber'], ['Cold', 'blue'], ['Renewal', 'green']],
    lead: [['Inbound', 'green'], ['Outbound', 'purple'], ['Event', 'amber']],
    person: [['Champion', 'green'], ['Decision maker', 'purple'], ['Blocker', 'red']],
    organization: [['Enterprise', 'purple'], ['SMB', 'blue'], ['Partner', 'green']],
    project: [['Implementation', 'blue'], ['Migration', 'amber']],
  })) for (const [name, color] of names) insert('labels', { entity, name, color });

  [['Call', 'call', 'phone'], ['Meeting', 'meeting', 'calendar'], ['Task', 'task', 'check'],
    ['Deadline', 'deadline', 'flag'], ['Email', 'email', 'mail'], ['Lunch', 'lunch', 'coffee'],
    ['Demo', 'demo', 'monitor']].forEach(([name, key_string, icon], i) =>
    insert('activity_types', { name, key_string, icon, order_idx: i }));

  for (const name of ['Price too high', 'Lost to competitor', 'No budget', 'No decision / timing', 'Not a fit'])
    insert('lost_reasons', { name });

  // ---- access control ----
  const setIds = {};
  for (const ps of defaultPermissionSets()) {
    setIds[ps.name] = insert('permission_sets', {
      name: ps.name, description: ps.description, is_system: ps.is_system,
      permissions: JSON.stringify(ps.permissions),
    });
  }
  const groupAll = insert('visibility_groups', { name: 'Whole company', description: 'Every employee' });
  const groupEmea = insert('visibility_groups', { name: 'EMEA sales', parent_id: groupAll });
  const groupAmer = insert('visibility_groups', { name: 'Americas sales', parent_id: groupAll });

  const teamEmea = insert('teams', { name: 'EMEA' });
  const teamAmer = insert('teams', { name: 'Americas' });

  const users = [
    { name: 'Alex Admin', email: 'admin@crm.local', password: 'admin1234', is_admin: 1, team_id: teamEmea, set: 'Admin', group: groupAll },
    { name: 'Morgan Reid', email: 'morgan@crm.local', password: 'demo1234', team_id: teamEmea, set: 'Sales manager', group: groupEmea },
    { name: 'Priya Nair', email: 'priya@crm.local', password: 'demo1234', team_id: teamEmea, set: 'Sales rep', group: groupEmea },
    { name: 'Dan Okafor', email: 'dan@crm.local', password: 'demo1234', team_id: teamAmer, set: 'Sales rep', group: groupAmer },
    { name: 'Sam Ito', email: 'sam@crm.local', password: 'demo1234', team_id: teamAmer, set: 'Read only', group: groupAmer },
  ];
  const userIds = [];
  for (const u of users) {
    const id = insert('users', {
      name: u.name, email: u.email, password_hash: hashPassword(u.password),
      is_admin: u.is_admin || 0, team_id: u.team_id,
      signature: `<p>—<br>${u.name}<br>Northwind Systems</p>`,
    });
    insert('user_permission_sets', { user_id: id, permission_set_id: setIds[u.set] });
    insert('user_visibility_groups', { user_id: id, group_id: u.group });
    if (u.group !== groupAll) insert('user_visibility_groups', { user_id: id, group_id: groupAll });
    userIds.push(id);
  }
  const [admin, manager, priya, dan] = userIds;

  // ---- pipelines ----
  const salesPipeline = insert('pipelines', { name: 'New business', order_idx: 0 });
  const stageDefs = [
    ['Qualified', 20, 14], ['Contact made', 40, 14], ['Demo scheduled', 55, 10],
    ['Proposal sent', 70, 7], ['Negotiation', 85, 7],
  ];
  const stages = stageDefs.map(([name, probability, rotten_days], i) =>
    insert('stages', { pipeline_id: salesPipeline, name, order_idx: i, probability, rotten_days }));

  const renewalPipeline = insert('pipelines', { name: 'Renewals', order_idx: 1 });
  const rStages = [['Upcoming', 30], ['Outreach', 55], ['Commercials', 80]].map(([name, probability], i) =>
    insert('stages', { pipeline_id: renewalPipeline, name, order_idx: i, probability }));

  // ---- custom fields ----
  const cfDefs = [
    { entity: 'deal', key: 'contract_length', name: 'Contract length (months)', type: 'number', show_in_add: 1, show_in_list: 1 },
    { entity: 'deal', key: 'competitor', name: 'Competitor', type: 'select', options: ['None', 'Salesforce', 'HubSpot', 'In-house'], important: 1 },
    { entity: 'deal', key: 'annualised_value', name: 'Annualised value', type: 'formula', formula: '{value} * 12 / {contract_length}', read_only: 1 },
    { entity: 'deal', key: 'renewal_date', name: 'Renewal date', type: 'date', pipeline_ids: [], show_in_detail: 1 },
    { entity: 'lead', key: 'lead_temperature', name: 'Temperature', type: 'select', options: ['Hot', 'Warm', 'Cold'], show_in_add: 1, show_in_list: 1 },
    { entity: 'person', key: 'linkedin', name: 'LinkedIn', type: 'text' },
    { entity: 'organization', key: 'employees', name: 'Employees', type: 'number', show_in_list: 1 },
    { entity: 'organization', key: 'industry', name: 'Industry', type: 'select', options: ['Software', 'Manufacturing', 'Retail', 'Healthcare', 'Finance'], show_in_list: 1 },
    { entity: 'project', key: 'go_live', name: 'Go-live date', type: 'date' },
  ];
  cfDefs.forEach((f, i) => insert('custom_fields', {
    entity: f.entity, key: f.key, name: f.name, type: f.type,
    options: JSON.stringify(f.options || []), formula: f.formula || null,
    required: 0, important: f.important || 0, read_only: f.read_only || 0,
    pipeline_ids: JSON.stringify(f.pipeline_ids || []), board_ids: '[]', editable_by: '[]',
    order_idx: i, show_in_list: f.show_in_list || 0, show_in_detail: 1, show_in_add: f.show_in_add || 0,
  }));
  invalidateCustomFields();

  // ---- organizations & people ----
  const orgNames = [
    ['Vertex Manufacturing', 'vertex.example', 'Manufacturing', 1200],
    ['Blue Harbour Retail', 'blueharbour.example', 'Retail', 340],
    ['Kestrel Health', 'kestrelhealth.example', 'Healthcare', 890],
    ['Lumen Financial', 'lumenfin.example', 'Finance', 2400],
    ['Orbit Software', 'orbitsoft.example', 'Software', 120],
    ['Northlake Logistics', 'northlake.example', 'Manufacturing', 610],
    ['Cobalt Systems', 'cobaltsys.example', 'Software', 75],
    ['Meridian Retail Group', 'meridian.example', 'Retail', 1500],
  ];
  const orgIds = orgNames.map(([name, domain, industry, employees], i) => insert('organizations', {
    name, domain, address: `${100 + i} Market Street, London`,
    owner_id: pick(userIds.slice(1, 4), i), phone: `+44 20 7000 ${1000 + i}`,
    label_ids: JSON.stringify([employees > 1000 ? 1 : 2]),
    cf: JSON.stringify({ industry, employees }),
    visible_to: 7, created_at: stamp(-90 + i * 3),
  }));

  const firstNames = ['Ella', 'Tom', 'Aisha', 'Marco', 'Nina', 'Ravi', 'Clara', 'Jonas', 'Beth', 'Omar', 'Sofia', 'Ken'];
  const lastNames = ['Hart', 'Brennan', 'Osei', 'Ricci', 'Kowal', 'Menon', 'Duval', 'Weber', 'Shaw', 'Haddad', 'Lang', 'Tanaka'];
  const titles = ['Head of Operations', 'CTO', 'Procurement Lead', 'CFO', 'IT Director', 'COO', 'Programme Manager'];
  const personIds = [];
  for (let i = 0; i < 24; i++) {
    const name = `${pick(firstNames, i)} ${pick(lastNames, i + 3)}`;
    const orgId = pick(orgIds, i);
    const domain = orgNames[orgIds.indexOf(orgId)][1];
    personIds.push(insert('persons', {
      name,
      owner_id: pick(userIds.slice(1, 4), i),
      org_id: orgId,
      emails: JSON.stringify([{ label: 'work', value: `${name.split(' ')[0].toLowerCase()}.${name.split(' ')[1].toLowerCase()}@${domain}`, primary: true }]),
      phones: JSON.stringify([{ label: 'work', value: `+44 7700 ${900000 + i}`, primary: true }]),
      job_title: pick(titles, i),
      marketing_status: i % 3 === 0 ? 'subscribed' : 'no_consent',
      label_ids: JSON.stringify(i % 4 === 0 ? [9] : []),
      cf: JSON.stringify({ linkedin: `https://linkedin.example/in/${name.toLowerCase().replace(' ', '-')}` }),
      visible_to: 7, created_at: stamp(-80 + i),
    }));
  }

  // ---- products ----
  const products = [
    ['Platform licence — Core', 'PLAT-CORE', 'Licences', 'monthly', 1200],
    ['Platform licence — Enterprise', 'PLAT-ENT', 'Licences', 'monthly', 3400],
    ['Implementation package', 'SVC-IMPL', 'Services', 'one-time', 12000],
    ['Data migration', 'SVC-MIGR', 'Services', 'one-time', 6500],
    ['Premium support', 'SUP-PREM', 'Support', 'yearly', 9000],
    ['Training day', 'SVC-TRAIN', 'Services', 'one-time', 1800],
  ];
  const productIds = products.map(([name, code, category, billing_frequency, price]) => {
    const id = insert('products', {
      name, code, category, billing_frequency, unit: 'unit', owner_id: admin,
      tax_id: 2, description: `${name} — standard commercial terms.`,
    });
    insert('product_prices', { product_id: id, currency: 'USD', price, cost: price * 0.4 });
    insert('product_prices', { product_id: id, currency: 'EUR', price: Math.round(price * 0.92), cost: price * 0.37 });
    return id;
  });

  // ---- deals ----
  const dealTitles = [
    'Platform rollout', 'ERP integration', '支持 renewal', 'Warehouse pilot', 'Compliance upgrade',
    'Multi-site licence', 'Support renewal', 'Analytics add-on', 'Migration project', 'Team expansion',
    'Security review', 'Data platform', 'Field service pilot', 'Onboarding package', 'Contract renewal',
  ];
  const dealIds = [];
  for (let i = 0; i < 22; i++) {
    const orgId = pick(orgIds, i);
    const org = orgNames[orgIds.indexOf(orgId)][0];
    const isRenewal = i % 7 === 6;
    const pipelineId = isRenewal ? renewalPipeline : salesPipeline;
    const stageList = isRenewal ? rStages : stages;
    const stageId = pick(stageList, i);
    const stage = get('SELECT probability FROM stages WHERE id=?', stageId);
    const status = i % 9 === 3 ? 'won' : i % 11 === 7 ? 'lost' : 'open';
    const value = 8000 + ((i * 4700) % 90000);
    dealIds.push(insert('deals', {
      title: `${org} — ${pick(dealTitles, i).replace('支持 ', '')}`,
      pipeline_id: pipelineId, stage_id: stageId,
      owner_id: pick(userIds.slice(1, 4), i),
      person_id: pick(personIds, i * 2), org_id: orgId,
      value, currency: i % 5 === 0 ? 'EUR' : 'USD',
      status,
      probability: status === 'won' ? 100 : status === 'lost' ? 0 : stage.probability,
      expected_close_date: day(-20 + (i * 5) % 70),
      lost_reason_id: status === 'lost' ? 2 : null,
      won_time: status === 'won' ? stamp(-10 + (i % 5)) : null,
      lost_time: status === 'lost' ? stamp(-6) : null,
      source: pick(['Inbound', 'Outbound', 'Partner', 'Event'], i),
      label_ids: JSON.stringify(i % 3 === 0 ? [1] : i % 3 === 1 ? [2] : []),
      cf: JSON.stringify({ contract_length: 12, competitor: pick(['None', 'Salesforce', 'HubSpot'], i) }),
      stage_changed_at: stamp(-(i % 21)),
      created_at: stamp(-60 + i * 2), visible_to: 7,
    }));
  }

  // deal products on the first eight deals
  dealIds.slice(0, 8).forEach((dealId, i) => {
    const pid = pick(productIds, i);
    const price = get('SELECT price FROM product_prices WHERE product_id=? AND currency=?', pid, 'USD').price;
    insert('deal_products', {
      deal_id: dealId, product_id: pid, name: products[productIds.indexOf(pid)][0],
      quantity: 1 + (i % 4), price, discount: i % 3 === 0 ? 10 : 0, tax: 20,
      billing_frequency: products[productIds.indexOf(pid)][3], currency: 'USD',
    });
    const svc = productIds[2];
    insert('deal_products', {
      deal_id: dealId, product_id: svc, name: products[2][0], quantity: 1,
      price: get('SELECT price FROM product_prices WHERE product_id=? AND currency=?', svc, 'USD').price,
      tax: 20, currency: 'USD',
    });
  });

  // ---- leads ----
  const leadSources = ['Web form', 'Cold outreach', 'Conference', 'Referral', 'Chat'];
  for (let i = 0; i < 14; i++) {
    const orgId = pick(orgIds, i + 2);
    insert('leads', {
      title: `${orgNames[orgIds.indexOf(orgId)][0]} — inbound enquiry`,
      owner_id: pick(userIds.slice(1, 4), i),
      person_id: pick(personIds, i * 3 + 1), org_id: orgId,
      value: 5000 + ((i * 3100) % 40000), currency: 'USD',
      source: pick(leadSources, i),
      label_ids: JSON.stringify([5 + (i % 3)]),
      status: i % 8 === 7 ? 'archived' : 'open',
      archive_reason: i % 8 === 7 ? 'No response after 5 attempts' : null,
      expected_close_date: day(20 + i),
      cf: JSON.stringify({ lead_temperature: pick(['Hot', 'Warm', 'Cold'], i) }),
      created_at: stamp(-30 + i), visible_to: 7,
    });
  }

  // ---- activities ----
  const subjects = ['Discovery call', 'Follow-up call', 'Demo', 'Proposal walkthrough', 'Check-in',
    'Send pricing', 'Contract review', 'Kick-off meeting', 'Quarterly review'];
  const types = ['call', 'meeting', 'task', 'demo', 'email'];
  const leadIds = all('SELECT id FROM leads').map((r) => r.id);
  for (let i = 0; i < 60; i++) {
    const onDeal = i % 4 !== 3;
    const dueOffset = (i % 9) - 4;
    const done = dueOffset < -1;
    insert('activities', {
      subject: pick(subjects, i),
      type_key: pick(types, i),
      assignee_id: pick(userIds.slice(1, 4), i),
      due_date: day(dueOffset),
      due_time: `${String(9 + (i % 8)).padStart(2, '0')}:00`,
      duration: '00:30',
      done: done ? 1 : 0,
      done_time: done ? stamp(dueOffset) : null,
      deal_id: onDeal ? pick(dealIds, i) : null,
      lead_id: onDeal ? null : pick(leadIds, i),
      person_id: pick(personIds, i),
      org_id: pick(orgIds, i),
      created_by: admin,
      note: i % 5 === 0 ? 'Agenda: current process, pain points, decision timeline.' : null,
      created_at: stamp(-20 + (i % 20)),
    });
  }

  // ---- notes ----
  for (let i = 0; i < 12; i++) {
    insert('notes', {
      entity: 'deal', entity_id: pick(dealIds, i), user_id: pick(userIds.slice(1, 4), i),
      content: pick([
        'Budget confirmed for next quarter. Procurement will need two weeks.',
        'Champion is the Head of Operations; CFO signs anything over $50k.',
        'They are also evaluating an in-house build — timeline is the deciding factor.',
        'Asked for a security questionnaire before the proposal stage.',
      ], i),
      created_at: stamp(-15 + i),
    });
  }

  // ---- email templates + threads ----
  const tplIntro = insert('email_templates', {
    name: 'Intro after inbound enquiry', owner_id: admin,
    subject: 'Following up on your enquiry, {{person.first_name}}',
    body: '<p>Hi {{person.first_name}},</p><p>Thanks for getting in touch about {{organization.name}}\'s plans. ' +
      'I\'d love to understand where you are today and whether we can help.</p><p>Do you have 20 minutes this week?</p>{{user.signature}}',
  });
  insert('email_templates', {
    name: 'Proposal follow-up', owner_id: admin,
    subject: 'Proposal for {{organization.name}}',
    body: '<p>Hi {{person.first_name}},</p><p>Attaching the proposal for {{deal.title}} at {{deal.value}} {{deal.currency}}. ' +
      'Happy to walk the team through it.</p>{{user.signature}}',
  });
  insert('email_templates', {
    name: 'Renewal reminder', owner_id: admin,
    subject: 'Your renewal is coming up',
    body: '<p>Hi {{person.first_name}},</p><p>Your agreement renews soon. Shall we book 15 minutes to review usage and terms?</p>{{user.signature}}',
  });

  for (let i = 0; i < 8; i++) {
    const dealId = pick(dealIds, i);
    const deal = get('SELECT * FROM deals WHERE id=?', dealId);
    const person = get('SELECT * FROM persons WHERE id=?', deal.person_id);
    const email = JSON.parse(person.emails)[0].value;
    const threadId = insert('email_threads', {
      subject: `Re: ${deal.title}`, deal_id: dealId, person_id: person.id, org_id: deal.org_id,
      user_id: deal.owner_id, shared: 1, last_message_at: stamp(-i), read: i % 3 ? 1 : 0,
    });
    const owner = get('SELECT * FROM users WHERE id=?', deal.owner_id);
    insert('emails', {
      thread_id: threadId, direction: 'out', from_email: owner.email, from_name: owner.name,
      to_emails: JSON.stringify([email]), subject: `Re: ${deal.title}`,
      body: '<p>Hi ' + person.name.split(' ')[0] + ',</p><p>Great speaking earlier — summary and next steps attached.</p>',
      status: 'sent', sent_at: stamp(-i - 1), track_opens: 1, track_clicks: 1,
      opens: 2 + (i % 3), clicks: i % 2, user_id: owner.id, created_at: stamp(-i - 1),
    });
    if (i % 2 === 0) {
      insert('emails', {
        thread_id: threadId, direction: 'in', from_email: email, from_name: person.name,
        to_emails: JSON.stringify([owner.email]), subject: `Re: ${deal.title}`,
        body: '<p>Thanks — this looks good. I will share internally and come back to you this week.</p>',
        status: 'sent', sent_at: stamp(-i), user_id: owner.id, created_at: stamp(-i),
      });
    }
  }

  // ---- projects ----
  const board = insert('project_boards', { name: 'Delivery', order_idx: 0 });
  const phases = ['Discovery', 'Build', 'Testing', 'Go live'].map((name, i) =>
    insert('project_phases', { board_id: board, name, order_idx: i }));
  insert('project_templates', {
    name: 'Standard implementation', board_id: board,
    payload: JSON.stringify({
      tasks: [
        { title: 'Kick-off workshop', due_in_days: 3 },
        { title: 'Data mapping', due_in_days: 10 },
        { title: 'Configure environments', due_in_days: 15 },
        { title: 'UAT sign-off', due_in_days: 30, milestone: true },
        { title: 'Go live', due_in_days: 40, milestone: true },
      ],
    }),
  });

  const wonDeals = all("SELECT * FROM deals WHERE status='won' LIMIT 3");
  wonDeals.forEach((deal, i) => {
    const projectId = insert('projects', {
      title: `${deal.title} — delivery`,
      board_id: board, phase_id: pick(phases, i),
      owner_id: deal.owner_id, deal_id: deal.id, person_id: deal.person_id, org_id: deal.org_id,
      start_date: day(-20 + i * 5), end_date: day(30 + i * 10),
      description: 'Implementation following the signed agreement.',
      cf: JSON.stringify({ go_live: day(35 + i * 10) }),
    });
    ['Kick-off workshop', 'Data mapping', 'Configure environments', 'UAT sign-off', 'Go live']
      .forEach((title, t) => {
        insert('tasks', {
          project_id: projectId, phase_id: pick(phases, t), title,
          assignee_id: pick(userIds.slice(1, 4), t), due_date: day(-10 + t * 8),
          done: t < 2 ? 1 : 0, done_time: t < 2 ? stamp(-9 + t * 8) : null,
          is_milestone: t >= 3 ? 1 : 0, order_idx: t,
          depends_on: JSON.stringify(t > 0 ? [] : []),
        });
      });
  });

  // ---- sequences ----
  insert('sequences', {
    name: 'Inbound lead nurture', entity: 'lead', owner_id: admin,
    steps: JSON.stringify([
      { type: 'automated_email', delay_days: 0, template_id: tplIntro },
      { type: 'activity', delay_days: 2, subject: 'Call the lead', activity_type: 'call', due_in_days: 0 },
      { type: 'manual_email', delay_days: 4, subject: 'Anything I can help with?', body: '<p>Hi {{person.first_name}}, just checking whether now is the right time.</p>' },
    ]),
  });

  // ---- automations ----
  insert('automations', {
    name: 'New deal → schedule discovery call', owner_id: admin, enabled: 1,
    trigger_config: JSON.stringify({ event: 'created', entity: 'deal' }),
    conditions: JSON.stringify({ match: 'all', rules: [] }),
    steps: JSON.stringify([
      { type: 'action', action: 'create_activity', config: { subject: 'Discovery call — {{deal.title}}', type_key: 'call', due_in_days: 2 } },
    ]),
  });
  insert('automations', {
    name: 'Deal won → create delivery project', owner_id: admin, enabled: 1,
    trigger_config: JSON.stringify({ event: 'field_updated', entity: 'deal', field: 'status' }),
    conditions: JSON.stringify({ match: 'all', rules: [{ field: 'status', op: 'eq', value: 'won' }] }),
    steps: JSON.stringify([
      { type: 'action', action: 'create_project', config: { title: '{{deal.title}} — delivery', board_id: board, template_id: 1 } },
      { type: 'delay', config: { days: 1 } },
      { type: 'action', action: 'create_activity', config: { subject: 'Send welcome pack', type_key: 'task', due_in_days: 1 } },
    ]),
  });
  insert('automations', {
    name: 'High-value deal → notify manager', owner_id: admin, enabled: 0,
    trigger_config: JSON.stringify({ event: 'field_updated', entity: 'deal', field: 'value' }),
    conditions: JSON.stringify({ match: 'all', rules: [{ field: 'value', op: 'gte', value: 75000 }] }),
    steps: JSON.stringify([
      { type: 'action', action: 'create_activity', config: { subject: 'Review high-value deal {{deal.title}}', type_key: 'task', assignee_id: manager, due_in_days: 1 } },
    ]),
  });

  // ---- reports, dashboard, goals ----
  const rPipeline = insert('reports', {
    name: 'Open pipeline by stage', entity: 'deal', owner_id: admin,
    config: JSON.stringify({
      entity: 'deal', measure: 'sum:value', group_by: 'stage_id', chart: 'column',
      conditions: { match: 'all', rules: [{ field: 'status', op: 'eq', value: 'open' }] },
    }),
  });
  const rOwner = insert('reports', {
    name: 'Won value by owner', entity: 'deal', owner_id: admin,
    config: JSON.stringify({
      entity: 'deal', measure: 'sum:value', group_by: 'owner_id', chart: 'bar',
      conditions: { match: 'all', rules: [{ field: 'status', op: 'eq', value: 'won' }] },
    }),
  });
  const rTrend = insert('reports', {
    name: 'Deals created per month', entity: 'deal', owner_id: admin,
    config: JSON.stringify({ entity: 'deal', measure: 'count', group_by: 'created_at', bucket: 'month', chart: 'line' }),
  });
  const rActivities = insert('reports', {
    name: 'Activities completed by type', entity: 'activity', owner_id: admin,
    config: JSON.stringify({
      entity: 'activity', measure: 'count', group_by: 'type_key', chart: 'pie',
      conditions: { match: 'all', rules: [{ field: 'done', op: 'eq', value: true }] },
    }),
  });
  const goalWon = insert('goals', {
    name: 'Won revenue this month', metric: 'deals_won_value', target: 150000,
    interval: 'monthly', assignee_type: 'company', currency: 'USD',
  });
  insert('goals', {
    name: 'Activities completed', metric: 'activities_done', target: 120, interval: 'monthly', assignee_type: 'company',
  });
  insert('dashboards', {
    name: 'Sales overview', owner_id: admin, shared: 1,
    layout: JSON.stringify([
      { type: 'goal', goal_id: goalWon, w: 4 },
      { type: 'report', report_id: rPipeline, w: 8 },
      { type: 'report', report_id: rOwner, w: 6 },
      { type: 'report', report_id: rTrend, w: 6 },
      { type: 'report', report_id: rActivities, w: 6 },
    ]),
  });

  // ---- document template ----
  insert('document_templates', {
    name: 'Standard quote', kind: 'quote',
    content: '<h1>Quotation</h1><p><strong>{{organization.name}}</strong><br>{{organization.address}}</p>' +
      '<p>Prepared for {{person.name}} on {{today}} by {{user.name}}.</p>' +
      '<h2>{{deal.title}}</h2>{{products_table}}' +
      '<p>Prices are valid for 30 days. Payment terms: 30 days net.</p>',
  });

  // ---- saved filters ----
  insert('filters', {
    name: 'My open deals', entity: 'deal', owner_id: admin, shared: 1,
    conditions: JSON.stringify({ match: 'all', rules: [{ field: 'status', op: 'eq', value: 'open' }] }),
  });
  insert('filters', {
    name: 'Deals closing this month', entity: 'deal', owner_id: admin, shared: 1,
    conditions: JSON.stringify({ match: 'all', rules: [{ field: 'expected_close_date', op: 'relative', value: 'this_month' }] }),
  });
  insert('filters', {
    name: 'Subscribed contacts', entity: 'person', owner_id: admin, shared: 1,
    conditions: JSON.stringify({ match: 'all', rules: [{ field: 'marketing_status', op: 'eq', value: 'subscribed' }] }),
  });

  // ---- campaign ----
  insert('campaigns', {
    name: 'Q3 product update', subject: 'What is new in the platform, {{person.first_name}}',
    preview_text: 'Release highlights and what they mean for your team',
    body: '<h2>Product update</h2><p>Hi {{person.first_name}},</p><p>Here is what shipped this quarter…</p>',
    sender_name: 'Northwind Systems', sender_email: 'marketing@northwind.example',
    recipient_filter: JSON.stringify({ match: 'all', rules: [] }), owner_id: admin,
  });

  // recompute derived values
  for (const d of all('SELECT id FROM deals')) {
    const deal = get('SELECT * FROM deals WHERE id=?', d.id);
    run('UPDATE deals SET score=? WHERE id=?', quickScore(deal), d.id);
  }
  console.log('[seed] demo workspace ready');
  return true;
}

function quickScore(deal) {
  let score = Math.min(30, (deal.value / 50000) * 30);
  score += (deal.probability ?? 50) * 0.2;
  const next = get('SELECT id FROM activities WHERE deal_id=? AND done=0', deal.id);
  if (next) score += 15;
  if (deal.person_id) score += 8;
  if (deal.expected_close_date) score += 7;
  return Math.round(score);
}
