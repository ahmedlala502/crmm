/** Thin API client + shared app state. */

export const state = {
  me: null,
  ref: null,
  meta: null,
  theme: localStorage.getItem('crm.theme') || 'light',
};

class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
export { ApiError };

async function request(method, path, body, opts = {}) {
  const res = await fetch(path, {
    method,
    headers: body && !opts.raw ? { 'content-type': 'application/json' } : (opts.headers || {}),
    body: body === undefined ? undefined : (opts.raw ? body : JSON.stringify(body)),
  });
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, text.slice(0, 200));
    return text;
  }
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error || 'Request failed', data.detail);
  return data;
}

export const api = {
  get: (p, params) => request('GET', params ? `${p}${p.includes('?') ? '&' : '?'}${qs(params)}` : p),
  post: (p, b) => request('POST', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b ?? {}),
  put: (p, b) => request('PUT', p, b ?? {}),
  del: (p) => request('DELETE', p),
  upload: (p, file, extraHeaders = {}) => request('POST', p, file, {
    raw: true,
    headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': file.name, ...extraHeaders },
  }),
};

export function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  }
  return sp.toString();
}

export async function loadSession() {
  state.me = await api.get('/api/auth/me');
  await refreshReference();
  state.meta = await api.get('/api/meta/entities');
  return state.me;
}

export async function refreshReference() {
  state.ref = await api.get('/api/reference');
  return state.ref;
}

export const can = (perm) => !!state.me && (state.me.user.is_admin || state.me.permissions.includes(perm));
export const hasModule = (mod) => !!state.me && (state.me.user.is_admin || state.me.modules.includes(mod));

// ---------- reference lookups ----------
export const userById = (id) => state.ref?.users.find((u) => u.id === id) || null;
export const stageById = (id) => state.ref?.stages.find((s) => s.id === id) || null;
export const pipelineById = (id) => state.ref?.pipelines.find((p) => p.id === id) || null;
export const stagesOf = (pipelineId) => (state.ref?.stages || []).filter((s) => s.pipeline_id === Number(pipelineId));
export const labelsFor = (entity) => (state.ref?.labels || []).filter((l) => l.entity === entity);
export const labelById = (id) => (state.ref?.labels || []).find((l) => l.id === id) || null;
export const customFieldsFor = (entity) => (state.ref?.custom_fields || []).filter((f) => f.entity === entity);
export const entityMeta = (key) => state.meta?.entities.find((e) => e.key === key) || null;
export const segmentOf = (key) => entityMeta(key)?.segment || `${key}s`;
export const activityType = (key) => (state.ref?.activity_types || []).find((t) => t.key_string === key) || null;

export const defaultCurrency = () => (state.ref?.currencies || []).find((c) => c.is_default)?.code || 'USD';
