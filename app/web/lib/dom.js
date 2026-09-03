// Minimal DOM helper. No framework, no virtual DOM — just jQuery-flavoured.
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'readOnly') {
      if (v) node[k] = true;
    } else if (k in node && typeof node[k] !== 'function' && typeof v !== 'string') {
      try { node[k] = v; } catch { node.setAttribute(k, v); }
    } else {
      node.setAttribute(k, v);
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  if (children === null || children === undefined || children === false) return;
  if (Array.isArray(children)) {
    for (const c of children) appendChildren(node, c);
    return;
  }
  if (typeof children === 'string' || typeof children === 'number' || typeof children === 'boolean') {
    node.appendChild(document.createTextNode(String(children)));
    return;
  }
  if (children instanceof Node) {
    node.appendChild(children);
  }
}

export function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function on(node, event, sel, handler) {
  if (typeof sel === 'function') { node.addEventListener(event, sel); return () => node.removeEventListener(event, sel); }
  return node.addEventListener(event, (e) => {
    const target = e.target.closest(sel);
    if (target && node.contains(target)) handler(e, target);
  });
}

export function fragment(children) {
  const f = document.createDocumentFragment();
  for (const c of [].concat(children || [])) {
    if (c == null || c === false) continue;
    if (typeof c === 'string') f.appendChild(document.createTextNode(c));
    else f.appendChild(c);
  }
  return f;
}

export function icon(name) {
  // lightweight unicode-glyph icons (no extra CSS needed)
  const m = {
    pulse: '◉', leads: '✱', deals: '◐', contacts: '◯', activities: '✓', mail: '✉',
    products: '◫', projects: '⊞', insights: '∿', automations: '⚙', campaigns: '◊',
    documents: '⎙', admin: '☰', search: '⌕', add: '＋', filter: '⌗', export: '↓',
    sort: '⇅', more: '⋯', close: '✕', back: '←', check: '✓', chev: '›',
    calendar: '▦', kanban: '⊟', list: '☰', board: '▦', gantt: '▤',
    edit: '✎', del: '🗑', follow: '☆', following: '★', note: '✎', file: '⎙',
  };
  return el('span', { class: 'ico' }, [m[name] || '·']);
}
