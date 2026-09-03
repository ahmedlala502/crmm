import { setting, setSetting, get, all, json } from '../db.mjs';
import { badRequest } from '../http.mjs';

export const AI_FEATURES = [
  'import_mapping', 'report_builder', 'email_draft', 'email_summary',
  'suggested_reply', 'next_step', 'project_health',
];

export const DEFAULT_AI = {
  enabled: false,
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  api_key: '',
  base_url: '',
  features: Object.fromEntries(AI_FEATURES.map((f) => [f, true])),
};

export function aiConfig() {
  const cfg = { ...DEFAULT_AI, ...(setting('ai', {}) || {}) };
  cfg.features = { ...DEFAULT_AI.features, ...(cfg.features || {}) };
  return cfg;
}
export function saveAiConfig(patch) {
  const next = { ...aiConfig(), ...patch };
  setSetting('ai', next);
  return publicAiConfig();
}
export function publicAiConfig() {
  const c = aiConfig();
  return { ...c, api_key: c.api_key ? '••••••••' + c.api_key.slice(-4) : '', configured: !!c.api_key };
}
export function aiEnabled(feature) {
  const c = aiConfig();
  return !!(c.enabled && c.api_key && c.features[feature]);
}

/** Single provider-agnostic completion call. Returns plain text. */
async function complete(system, user, { maxTokens = 1200 } = {}) {
  const c = aiConfig();
  if (!c.enabled) throw badRequest('AI features are disabled in Admin → AI');
  if (!c.api_key) throw badRequest('No AI API key configured');
  if (c.provider === 'anthropic') {
    const res = await fetch((c.base_url || 'https://api.anthropic.com') + '/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': c.api_key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: c.model, max_tokens: maxTokens, system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`AI provider error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return (data.content || []).map((p) => p.text || '').join('');
  }
  // OpenAI-compatible (also covers local gateways via base_url)
  const res = await fetch((c.base_url || 'https://api.openai.com') + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${c.api_key}` },
    body: JSON.stringify({
      model: c.model, max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`AI provider error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

function extractJson(text) {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{');
  const arr = raw.indexOf('[');
  const from = start < 0 ? arr : (arr >= 0 && arr < start ? arr : start);
  if (from < 0) throw new Error('AI response contained no JSON');
  return JSON.parse(raw.slice(from));
}

// ---------- features (each has a deterministic fallback) ----------
export async function aiImportMapping(entityKey, headers, sampleRows, fields, heuristic) {
  if (!aiEnabled('import_mapping')) return { mapping: heuristic, source: 'heuristic' };
  try {
    const text = await complete(
      'You map spreadsheet columns to CRM fields. Reply with JSON only: {"mapping":{"0":"field_key","1":""}}. Use "" when no field fits.',
      JSON.stringify({ entity: entityKey, headers, sample: sampleRows.slice(0, 5), available_fields: fields.map((f) => ({ key: f.key, label: f.label, type: f.type })) }),
    );
    const parsed = extractJson(text);
    return { mapping: { ...heuristic, ...(parsed.mapping || {}) }, source: 'ai' };
  } catch (err) {
    return { mapping: heuristic, source: 'heuristic', error: String(err.message || err) };
  }
}

export async function aiReportConfig(prompt, availableFields) {
  if (!aiEnabled('report_builder')) throw badRequest('AI report building is disabled');
  const text = await complete(
    'You turn a natural-language request into a CRM report definition. Reply with JSON only, shaped as ' +
    '{"entity":"deal|lead|activity|person|organization|product|project","measure":"count|sum:value|avg:value",' +
    '"group_by":"field_key","bucket":"month","chart":"bar|line|pie|number|table","conditions":{"match":"all","rules":[{"field":"","op":"eq","value":""}]},"name":"short title"}',
    JSON.stringify({ request: prompt, fields: availableFields }),
  );
  return extractJson(text);
}

export async function aiEmailDraft({ intent, tone = 'professional', context }) {
  if (!aiEnabled('email_draft')) throw badRequest('AI email drafting is disabled');
  const text = await complete(
    `You draft short B2B sales emails in a ${tone} tone. Reply with JSON only: {"subject":"...","body":"<p>...</p>"}. ` +
    'Use merge fields like {{person.first_name}} where a name is needed. Keep it under 150 words.',
    JSON.stringify({ intent, context }),
  );
  return extractJson(text);
}

export async function aiThreadSummary(threadId) {
  const messages = all('SELECT direction, from_email, subject, body, created_at FROM emails WHERE thread_id=? ORDER BY id', threadId);
  if (!messages.length) throw badRequest('Thread has no messages');
  if (!aiEnabled('email_summary')) {
    return {
      summary: `${messages.length} message(s) between ${[...new Set(messages.map((m) => m.from_email))].join(', ')}. Latest: "${messages[messages.length - 1].subject}".`,
      sentiment: 'unknown',
      action_items: [],
      source: 'fallback',
    };
  }
  const text = await complete(
    'Summarise this sales email thread. Reply with JSON only: {"summary":"2-3 sentences","sentiment":"positive|neutral|negative","action_items":["..."]}',
    JSON.stringify(messages.map((m) => ({ ...m, body: String(m.body).replace(/<[^>]+>/g, ' ').slice(0, 2000) }))),
  );
  return { ...extractJson(text), source: 'ai' };
}

export async function aiSuggestedReply(threadId) {
  if (!aiEnabled('suggested_reply')) throw badRequest('AI suggested replies are disabled');
  const messages = all('SELECT direction, from_email, subject, body FROM emails WHERE thread_id=? ORDER BY id DESC LIMIT 6', threadId).reverse();
  const text = await complete(
    'Draft a concise reply to the latest message in this sales thread. Reply with JSON only: {"body":"<p>...</p>"}',
    JSON.stringify(messages.map((m) => ({ ...m, body: String(m.body).replace(/<[^>]+>/g, ' ').slice(0, 1500) }))),
  );
  return extractJson(text);
}

export async function aiNextStep(entityKey, id) {
  const table = entityKey === 'deal' ? 'deals' : 'leads';
  const record = get(`SELECT * FROM ${table} WHERE id=?`, id);
  if (!record) throw badRequest('Record not found');
  const activities = all(
    `SELECT subject, type_key, done, due_date FROM activities WHERE ${entityKey}_id=? AND deleted=0 ORDER BY id DESC LIMIT 10`,
    id,
  );
  if (!aiEnabled('next_step')) {
    const open = activities.filter((a) => !a.done);
    return {
      recommendation: open.length
        ? `Complete "${open[0].subject}" (due ${open[0].due_date || 'no date'}).`
        : 'No next activity is scheduled — book the next call or meeting to keep the deal moving.',
      source: 'rules',
    };
  }
  const text = await complete(
    'You advise sales reps. Reply with JSON only: {"recommendation":"one concrete next step","reasons":["..."]}',
    JSON.stringify({ record: { ...record, cf: json(record.cf, {}) }, activities }),
  );
  return { ...extractJson(text), source: 'ai' };
}

export async function aiProjectHealth(projectId) {
  const project = get('SELECT * FROM projects WHERE id=?', projectId);
  if (!project) throw badRequest('Project not found');
  const tasks = all('SELECT title, done, due_date, is_milestone FROM tasks WHERE project_id=?', projectId);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = tasks.filter((t) => !t.done && t.due_date && t.due_date < today);
  const done = tasks.filter((t) => t.done).length;
  if (!aiEnabled('project_health')) {
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    return {
      status: overdue.length > 2 ? 'at_risk' : overdue.length ? 'watch' : 'on_track',
      summary: `${pct}% of ${tasks.length} tasks complete. ${overdue.length} overdue.`,
      risks: overdue.slice(0, 5).map((t) => `Overdue: ${t.title} (${t.due_date})`),
      recommendations: overdue.length ? ['Re-plan or reassign the overdue tasks'] : ['Keep the current cadence'],
      source: 'rules',
    };
  }
  const text = await complete(
    'Assess delivery-project health. Reply with JSON only: {"status":"on_track|watch|at_risk","summary":"...","risks":["..."],"recommendations":["..."]}',
    JSON.stringify({ project, tasks, today }),
  );
  return { ...extractJson(text), source: 'ai' };
}
