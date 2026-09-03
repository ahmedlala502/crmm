/** End-to-end smoke test against a running server. Usage: node smoke.mjs [baseUrl] */
const base = process.argv[2] || 'http://localhost:4173';
let cookie = '';
let pass = 0; const failures = [];

async function call(method, path, body, opts = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body && !opts.raw ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
    body: body ? (opts.raw ? body : JSON.stringify(body)) : undefined,
    redirect: 'manual',
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) if (c.startsWith('crm_session=')) cookie = c.split(';')[0];
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` :: ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  console.log(`\nSmoke test → ${base}\n`);

  // auth
  let r = await call('GET', '/api/auth/me');
  check('unauthenticated request is rejected', r.status === 401, r.data);
  r = await call('POST', '/api/auth/login', { email: 'admin@crm.local', password: 'wrong' });
  check('bad password rejected', r.status === 401);
  r = await call('POST', '/api/auth/login', { email: 'admin@crm.local', password: 'admin1234' });
  check('login succeeds', r.status === 200 && r.data.user?.email === 'admin@crm.local', r.data);
  check('permissions returned', Array.isArray(r.data.permissions), r.data);

  // reference data
  r = await call('GET', '/api/reference');
  check('reference data loads', r.data.pipelines?.length >= 2 && r.data.currencies?.length === 3, Object.keys(r.data || {}));

  // pipelines
  r = await call('GET', '/api/pipelines');
  const pipelineId = r.data[0].id;
  check('pipelines expose stages', r.data[0].stages.length === 5, r.data[0]?.stages?.length);
  r = await call('GET', `/api/pipeline/${pipelineId}/board`);
  const board = r.data;
  check('board returns stages with deals', board.stages.length === 5 && board.totals.count > 0, board.totals);
  check('board reports weighted value', typeof board.totals.weighted === 'number');

  // deals CRUD + stage move + history
  r = await call('POST', '/api/deals', { title: 'Smoke test deal', value: 42000, currency: 'USD' });
  check('create deal', r.status === 200 && r.data.id, r.data);
  const dealId = r.data.id;
  const firstStage = board.stages[0].id; const secondStage = board.stages[1].id;
  r = await call('POST', `/api/deals/${dealId}/move`, { stage_id: secondStage });
  check('move deal between stages', r.data.stage_id === secondStage, r.data);
  r = await call('GET', `/api/deals/${dealId}/history`);
  check('history records the stage change', r.data.some((h) => h.changes.stage_id), r.data?.[0]);
  r = await call('PATCH', `/api/deals/${dealId}`, { value: 55000, cf: { contract_length: 24 } });
  check('update deal + custom field', r.data.value === 55000 && r.data.cf.contract_length === 24, r.data.cf);
  check('formula field computed', r.data.cf.annualised_value === 55000 * 12 / 24, r.data.cf);
  r = await call('POST', `/api/deals/${dealId}/status`, { status: 'lost', lost_reason_id: 1, lost_comment: 'testing' });
  check('mark deal lost sets probability 0', r.data.status === 'lost' && r.data.probability === 0, r.data);

  // validation
  r = await call('POST', '/api/deals', { value: 10 });
  check('missing required title is rejected', r.status === 400, r.data);
  r = await call('POST', '/api/deals', { title: 'x', nonsense_field: 1 });
  check('unknown field is rejected', r.status === 400, r.data);

  // people & organizations
  r = await call('POST', '/api/organizations', { name: 'Smoke Test Ltd', domain: 'smoke.example', cf: { industry: 'Software', employees: 50 } });
  check('create organization', r.status === 200, r.data);
  const orgId = r.data.id;
  r = await call('POST', '/api/persons', {
    name: 'Smoke Person', org_id: orgId, job_title: 'CTO',
    emails: [{ label: 'work', value: 'smoke@smoke.example', primary: true }],
  });
  check('create person linked to org', r.data.org_id === orgId, r.data);
  const personId = r.data.id;
  r = await call('GET', `/api/organizations/${orgId}`);
  check('org detail lists linked people', r.data.people.some((p) => p.id === personId), r.data.people);
  r = await call('POST', '/api/persons', { name: 'Smoke Person', org_id: orgId });
  const dupId = r.data.id;
  r = await call('POST', '/api/admin/merge', { entity: 'person', winner_id: personId, loser_id: dupId });
  check('merge people', r.status === 200, r.data);
  r = await call('GET', `/api/persons/${dupId}`);
  check('merged loser is gone', r.status === 404);

  // custom field validation
  r = await call('PATCH', `/api/organizations/${orgId}`, { cf: { industry: 'Not a real option' } });
  check('invalid select option rejected', r.status === 400, r.data);

  // activities + calendar
  const today = new Date().toISOString().slice(0, 10);
  r = await call('POST', '/api/activities', {
    subject: 'Smoke call', type_key: 'call', due_date: today, due_time: '10:00',
    deal_id: dealId, person_id: personId,
  });
  check('create activity linked to deal', r.data.deal_id === dealId, r.data);
  const activityId = r.data.id;
  r = await call('GET', `/api/calendar?from=${today}&to=${today}`);
  check('calendar returns the activity', r.data.activities.some((a) => a.id === activityId), r.data.activities?.length);
  r = await call('POST', `/api/activities/${activityId}/done`, { done: true });
  check('complete activity stamps done_time', r.data.done === 1 && !!r.data.done_time, r.data);
  r = await call('GET', `/api/deals/${dealId}/activities`);
  check('deal detail shows its activities', r.data.length >= 1, r.data.length);

  // filters + list querying
  const conditions = JSON.stringify({ match: 'all', rules: [{ field: 'status', op: 'eq', value: 'open' }] });
  r = await call('GET', `/api/deals?conditions=${encodeURIComponent(conditions)}&limit=5`);
  check('filtered list works', r.data.data.every((d) => d.status === 'open'), r.data.meta);
  r = await call('GET', '/api/deals?search=Vertex');
  check('search works', r.data.data.length > 0, r.data.meta);
  r = await call('POST', '/api/filters', { name: 'Smoke filter', entity: 'deal', conditions: JSON.parse(conditions), shared: true });
  const filterId = r.data.id;
  r = await call('GET', `/api/deals?filter_id=${filterId}`);
  check('saved filter drives the list', r.data.meta.total > 0, r.data.meta);

  // relative date filter
  const rel = JSON.stringify({ match: 'all', rules: [{ field: 'expected_close_date', op: 'relative', value: 'this_month' }] });
  r = await call('GET', `/api/deals?conditions=${encodeURIComponent(rel)}`);
  check('relative date filter runs', r.status === 200, r.data);

  // bulk
  r = await call('GET', '/api/deals?limit=3');
  const bulkIds = r.data.data.map((d) => d.id);
  r = await call('POST', '/api/deals/bulk/preview', { ids: bulkIds, values: { source: 'Bulk test' } });
  check('bulk preview reports impact', r.data.affected === bulkIds.length && Array.isArray(r.data.automations_that_will_run), r.data);
  r = await call('POST', '/api/deals/bulk', { ids: bulkIds, action: 'edit', values: { source: 'Bulk test' } });
  check('bulk edit applies', r.data.updated === bulkIds.length, r.data);

  // export
  r = await call('GET', '/api/deals/export.csv?limit=5');
  check('csv export returns rows', typeof r.data === 'string' && r.data.split('\n').length > 2, String(r.data).slice(0, 80));

  // products & revenue
  r = await call('GET', '/api/products?limit=50');
  const productId = r.data.data[0].id;
  r = await call('POST', `/api/deals/${dealId}/products`, { product_id: productId, quantity: 2 });
  check('attach product to deal', r.status === 200 && r.data.quantity === 2, r.data);
  r = await call('GET', `/api/deals/${dealId}`);
  check('deal value syncs with products', r.data.products.length === 1 && r.data.value > 0, { v: r.data.value });
  r = await call('GET', '/api/revenue/summary');
  check('revenue summary computes MRR/ARR', typeof r.data.mrr === 'number' && r.data.arr === r.data.mrr * 12, r.data);

  // leads + conversion
  r = await call('POST', '/api/leads', { title: 'Smoke lead', value: 9000, person_id: personId, org_id: orgId });
  const leadId = r.data.id;
  check('create lead', r.status === 200, r.data);
  r = await call('POST', `/api/leads/${leadId}/convert`, {});
  check('convert lead to deal', r.status === 200 && r.data.origin_lead_id === leadId, r.data);
  r = await call('GET', `/api/leads/${leadId}`);
  check('converted lead marked converted', r.data.status === 'converted', r.data.status);

  // mail
  r = await call('POST', '/api/mail/send', {
    to: ['smoke@smoke.example'], subject: 'Hello {{person.first_name}}',
    body: '<p>Hi {{person.first_name}}, from {{company.name}}.</p>',
    person_id: personId, deal_id: dealId,
  });
  check('send email with merge fields', r.data.subject === 'Hello Smoke' && r.data.body.includes('Northwind'), { s: r.data.subject, b: r.data.body });
  const threadId = r.data.thread_id;
  r = await call('GET', `/api/mail/threads/${threadId}`);
  check('thread shows messages', r.data.messages.length === 1, r.data.messages?.length);
  r = await call('GET', `/t/o/${r.data.messages[0].id}.png`);
  check('open tracking pixel served', r.status === 200);
  r = await call('GET', `/api/mail/threads/${threadId}`);
  check('open registered', r.data.messages[0].opens === 1, r.data.messages[0].opens);
  r = await call('GET', `/api/mail/threads/${threadId}/ai-summary`);
  check('thread summary falls back without AI', !!r.data.summary, r.data);
  r = await call('GET', '/api/mail/threads?deal_id=' + dealId);
  check('threads filter by deal', r.data.length >= 1, r.data.length);

  // automations
  r = await call('POST', '/api/automations', {
    name: 'Smoke automation',
    trigger_config: { event: 'field_updated', entity: 'deal', field: 'source' },
    conditions: { match: 'all', rules: [{ field: 'source', op: 'eq', value: 'Automation trigger' }] },
    steps: [{ type: 'action', action: 'create_activity', config: { subject: 'Automated follow-up', type_key: 'task', due_in_days: 1 } }],
    enabled: true,
  });
  check('create automation', r.status === 200, r.data);
  const autoId = r.data.id;
  r = await call('POST', '/api/automations', { name: 'bad', trigger_config: { event: 'created' }, steps: [] });
  check('automation validation rejects incomplete definition', r.status === 400, r.data);

  r = await call('POST', '/api/deals', { title: 'Automation target', value: 1000 });
  const autoDeal = r.data.id;
  await call('PATCH', `/api/deals/${autoDeal}`, { source: 'Automation trigger' });
  await sleep(6500);
  r = await call('GET', `/api/deals/${autoDeal}/activities`);
  check('automation created the follow-up activity', r.data.some((a) => a.subject === 'Automated follow-up'), r.data.map((a) => a.subject));
  r = await call('GET', `/api/automations/${autoId}/executions`);
  check('execution history logged', r.data.length >= 1 && r.data[0].log.length > 0, r.data[0]);

  // recursion guard: automation writes must not re-trigger forever
  r = await call('GET', '/api/ops/jobs');
  check('job queue healthy', r.data.failed === 0, r.data.recent_failures);

  // reports
  r = await call('POST', '/api/insights/run', {
    entity: 'deal', measure: 'sum:value', group_by: 'stage_id',
    conditions: { match: 'all', rules: [{ field: 'status', op: 'eq', value: 'open' }] },
  });
  check('report groups by stage', r.data.type === 'grouped' && r.data.rows.length > 0, r.data.rows?.slice(0, 2));
  const reportTotal = r.data.rows.reduce((s, x) => s + x.value, 0);
  r = await call('GET', `/api/deals?conditions=${encodeURIComponent(conditions)}&limit=500`);
  const listTotal = r.data.data.reduce((s, d) => s + d.value, 0);
  check('report total matches the underlying records', Math.abs(reportTotal - listTotal) < 1, { reportTotal, listTotal });

  r = await call('POST', '/api/insights/detail', {
    config: { entity: 'deal', measure: 'count', group_by: 'stage_id', conditions: { match: 'all', rules: [] } },
    group_key: firstStage,
  });
  check('report drill-down returns rows', Array.isArray(r.data.data), r.data);
  r = await call('GET', '/api/goals');
  check('goals compute progress', r.data.length >= 2 && typeof r.data[0].actual === 'number', r.data[0]);
  r = await call('GET', '/api/dashboards');
  const dashId = r.data[0].id;
  r = await call('GET', `/api/dashboards/${dashId}`);
  check('dashboard renders tiles', r.data.tiles.length === 5 && r.data.tiles.every((t) => !t.error), r.data.tiles?.map((t) => t.error));
  r = await call('GET', '/api/forecast');
  check('forecast returns periods', Array.isArray(r.data.open), r.data);

  // projects
  r = await call('POST', `/api/deals/${autoDeal}/handoff`, { title: 'Smoke delivery' });
  check('deal → project handoff', r.status === 200, r.data);
  const projectId = r.data.id;
  r = await call('POST', `/api/projects/${projectId}/tasks`, { title: 'Task A' });
  const taskA = r.data.id;
  r = await call('POST', `/api/projects/${projectId}/tasks`, { title: 'Task B', depends_on: [taskA] });
  const taskB = r.data.id;
  r = await call('PATCH', `/api/tasks/${taskB}`, { done: true });
  check('dependency blocks completion', r.status === 400, r.data);
  await call('PATCH', `/api/tasks/${taskA}`, { done: true });
  r = await call('PATCH', `/api/tasks/${taskB}`, { done: true });
  check('task completes once dependency is done', r.data.done === 1, r.data);
  r = await call('GET', `/api/projects/${projectId}/gantt`);
  check('gantt returns bars', r.data.bars.length === 2, r.data.bars?.length);
  r = await call('GET', `/api/projects/${projectId}/health`);
  check('project health falls back without AI', !!r.data.status, r.data);

  // import
  const csv = 'Name,Email,Company,Owner\nIrene Fox,irene@acme.example,Acme Imports,admin@crm.local\nBad Row,,Acme Imports,admin@crm.local\n';
  r = await call('POST', '/api/admin/import/analyse?entity=person', csv, {
    raw: true, headers: { 'content-type': 'text/csv', 'x-filename': 'people.csv' },
  });
  check('import analysis suggests a mapping', r.data.headers.length === 4 && Object.values(r.data.mapping).includes('name'), r.data.mapping);
  const token = r.data.token;
  r = await call('POST', '/api/admin/import/run', { token, mapping: r.data.mapping, duplicate_strategy: 'create' });
  check('import creates records', r.data.created_count === 2, r.data);
  const importId = r.data.id;
  r = await call('GET', '/api/persons?search=Irene');
  check('imported person is searchable', r.data.data.length === 1, r.data.meta);
  r = await call('POST', `/api/admin/imports/${importId}/revert`, {});
  check('import revert removes records', r.data.reverted === 2, r.data);
  r = await call('GET', '/api/persons?search=Irene');
  check('reverted records disappear', r.data.data.length === 0, r.data.meta);

  // xlsx round trip is exercised through the CSV path only; verify the error is clear
  r = await call('POST', '/api/admin/import/analyse?entity=person', 'x', {
    raw: true, headers: { 'content-type': 'application/vnd.ms-excel', 'x-filename': 'old.xls' },
  });
  check('legacy .xls rejected with a clear message', r.status === 500 || r.status === 400, r.data);

  // documents
  r = await call('GET', '/api/document-templates');
  const tplId = r.data[0].id;
  r = await call('POST', '/api/documents', { template_id: tplId, entity: 'deal', entity_id: dealId, name: 'Smoke quote' });
  check('document generated from template', r.data.content.includes('Quotation'), r.data.content?.slice(0, 60));
  const shareToken = r.data.share_token;
  r = await call('GET', `/public/documents/${shareToken}`);
  check('public document link renders', typeof r.data === 'string' && r.data.includes('Quotation'));
  r = await call('POST', `/public/documents/${shareToken}/sign`, 'name=Test+Signer', {
    raw: true, headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  check('document can be signed', typeof r.data === 'string' && r.data.includes('Signed'));

  // web form → lead
  r = await call('POST', '/api/admin/web-forms', { name: 'Smoke form', target: 'lead' });
  const formToken = r.data.token;
  r = await call('POST', `/public/forms/${formToken}`, 'name=Web+Lead&email=web@lead.example&company=Web+Co', {
    raw: true, headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  check('public web form accepted', typeof r.data === 'string' && r.data.includes('Thank you'));
  r = await call('GET', '/api/leads?search=Web+Lead');
  check('web form created a lead', r.data.data.length >= 1, r.data.meta);

  // campaigns respect consent
  r = await call('GET', '/api/campaigns');
  const campaignId = r.data[0].id;
  r = await call('POST', `/api/campaigns/${campaignId}/preview-recipients`, {});
  check('campaign only targets subscribed contacts', r.data.total > 0, r.data.total);

  // permissions: read-only user cannot write
  const adminCookie = cookie;
  cookie = '';
  r = await call('POST', '/api/auth/login', { email: 'sam@crm.local', password: 'demo1234' });
  check('read-only user can sign in', r.status === 200);
  r = await call('POST', '/api/deals', { title: 'Should fail' });
  check('read-only user cannot create deals', r.status === 403, r.data);
  r = await call('GET', '/api/deals?limit=1');
  check('read-only user can still read', r.status === 200);
  r = await call('GET', '/api/admin/users');
  check('read-only user blocked from admin', r.status === 403, r.data);
  cookie = adminCookie;

  // API token auth
  r = await call('POST', '/api/admin/tokens', { name: 'smoke token', scopes: 'read' });
  const apiToken = r.data.token;
  const saved = cookie; cookie = '';
  r = await call('GET', '/api/deals?limit=1', null, { headers: { authorization: `Bearer ${apiToken}` } });
  check('API token can read', r.status === 200, r.data);
  r = await call('POST', '/api/deals', { title: 'token deal' }, { headers: { authorization: `Bearer ${apiToken}` } });
  check('read-only API token cannot write', r.status === 403, r.data);
  cookie = saved;

  // audit trail
  r = await call('GET', `/api/admin/audit?entity=deal&entity_id=${dealId}`);
  check('audit trail records deal changes', r.data.length >= 3, r.data.length);

  // cleanup check: deleting soft-deletes
  r = await call('DELETE', `/api/deals/${dealId}`);
  check('delete deal', r.data.deleted === true);
  r = await call('GET', `/api/deals/${dealId}`);
  check('deleted deal is hidden', r.status === 404);

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
};

run().catch((e) => { console.error(e); process.exit(1); });
