// Hash-based router. URL pattern: #/module/segment?query
const routes = [];
let currentRoute = null;
let onChangeListeners = [];

export function register(pattern, handler) {
  // pattern: 'pulse' | 'deals/:id' | 'admin/users'
  const parts = pattern.split('/').filter(Boolean);
  routes.push({ pattern, parts, handler });
}

export function onRouteChange(fn) { onChangeListeners.push(fn); }

export function go(path) {
  if (location.hash === '#' + path) {
    // force a re-render even if hash is the same
    handleRoute();
  } else {
    location.hash = '#' + (path.startsWith('/') ? path : '/' + path);
  }
}

export function current() { return currentRoute; }

export function start() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

function handleRoute() {
  const raw = (location.hash || '#/').slice(1);
  const [pathPart, queryPart] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  let best = null, bestScore = -1;
  for (const r of routes) {
    if (r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true, score = 0;
    for (let i = 0; i < r.parts.length; i++) {
      if (r.parts[i].startsWith(':')) params[r.parts[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (r.parts[i] !== segs[i]) { ok = false; break; }
      else score++;
    }
    if (ok && score > bestScore) { best = { ...r, params, query }; bestScore = score; }
  }
  if (!best) best = { pattern: '_404', parts: [], params: {}, query, handler: () => notFound() };
  currentRoute = best;
  for (const fn of onChangeListeners) fn(best);
  best.handler(best.params, best.query);
}

function notFound() {
  const main = document.getElementById('view');
  if (main) main.innerHTML = '<div class="empty"><h3>Not found</h3><p>No view matches this URL.</p></div>';
}
