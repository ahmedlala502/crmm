import { el, clear, $ } from './lib/dom.js';
import { state, api, loadSession, hasModule, can, userById, defaultCurrency } from './lib/api.js';
import { toast, openCommandPalette, drawer, modal } from './lib/ui.js';
import { go, register, onRouteChange, start as startRouter, current } from './lib/router.js';

import { renderPulse } from './modules/pulse.js';
import { renderLeadsList, renderLeadDetail } from './modules/leads.js';
import { renderDealsList, renderDealDetail, renderDealBoard } from './modules/deals.js';
import { renderContacts } from './modules/contacts.js';
import { renderActivities } from './modules/activities.js';
import { renderMail } from './modules/mail.js';
import { renderProducts } from './modules/products.js';
import { renderProjects, renderProjectDetail } from './modules/projects.js';
import { renderInsights } from './modules/insights.js';
import { renderAutomations } from './modules/automations.js';
import { renderCampaigns } from './modules/campaigns.js';
import { renderDocuments } from './modules/documents.js';
import { renderAdmin, renderAdminSection } from './modules/admin.js';

const NAV = [
  { key: 'pulse', label: 'Pulse', icon: '◉', path: 'pulse', section: 'sell' },
  { key: 'leads', label: 'Leads', icon: '✱', path: 'leads', section: 'sell', perm: 'access.leads' },
  { key: 'deals', label: 'Deals', icon: '◐', path: 'deals', section: 'sell', perm: 'access.deals' },
  { key: 'contacts', label: 'Contacts', icon: '◯', path: 'contacts', section: 'sell', perm: 'access.contacts' },
  { key: 'activities', label: 'Activities', icon: '✓', path: 'activities', section: 'sell', perm: 'access.activities' },
  { key: 'mail', label: 'Mail', icon: '✉', path: 'mail', section: 'sell', perm: 'access.mail' },
  { key: 'products', label: 'Products', icon: '◫', path: 'products', section: 'catalogue', perm: 'access.products' },
  { key: 'projects', label: 'Projects', icon: '⊞', path: 'projects', section: 'catalogue', perm: 'access.projects' },
  { key: 'insights', label: 'Insights', icon: '∿', path: 'insights', section: 'analyse', perm: 'access.insights' },
  { key: 'automations', label: 'Automations', icon: '⚙', path: 'automations', section: 'analyse', perm: 'access.automations' },
  { key: 'campaigns', label: 'Campaigns', icon: '◊', path: 'campaigns', section: 'analyse', perm: 'access.campaigns' },
  { key: 'documents', label: 'Documents', icon: '⎙', path: 'documents', section: 'analyse', perm: 'access.documents' },
  { key: 'admin', label: 'Admin', icon: '☰', path: 'admin', section: 'admin', perm: 'access.admin' },
];

const SECTIONS = { sell: 'Sell', catalogue: 'Catalogue', analyse: 'Analyse', admin: 'Admin' };

function renderLogin() {
  const root = $('#root');
  clear(root);
  const errBox = el('div', { class: 'muted', style: { minHeight: '18px', color: 'var(--red)' } });
  const totpBox = el('label', { class: 'field', style: { display: 'none' } }, [
    el('span', { class: 'lbl' }, ['Two-factor code']),
    el('input', { type: 'text', name: 'totp', placeholder: '123456', autocomplete: 'one-time-code' }),
  ]);
  const form = el('form', { class: 'card pad login' }, [
    el('h1', { style: { marginBottom: '6px' } }, [state.ref?.company?.name || 'CRM']),
    el('p', { class: 'muted', style: { marginBottom: '14px' } }, ['Sign in to continue']),
    el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Email']), el('input', { type: 'email', name: 'email', value: 'admin@crm.local', required: true, autofocus: true })]),
    el('label', { class: 'field required' }, [el('span', { class: 'lbl' }, ['Password']), el('input', { type: 'password', name: 'password', value: 'admin1234', required: true })]),
    totpBox,
    errBox,
    el('button', { class: 'btn primary', type: 'submit', style: { width: '100%', marginTop: '6px' } }, ['Sign in']),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.textContent = '';
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const res = await api.post('/api/auth/login', data);
      if (res?.mfa_required) {
        totpBox.style.display = '';
        totpBox.querySelector('input').focus();
        errBox.textContent = 'Enter the 6-digit code from your authenticator app.';
        return;
      }
      state.me = res;
      await refreshReference();
      state.meta = await api.get('/api/meta/entities');
      renderShell();
      if (!location.hash) location.hash = '#/pulse';
      startRouter();
      onRouteChange(setActiveNav);
      setActiveNav();
    } catch (err) {
      errBox.textContent = err.message || 'Login failed';
    }
  });
  root.appendChild(el('div', { class: 'login-wrap' }, [form]));
}

async function refreshReference() { state.ref = await api.get('/api/reference'); }

function renderShell() {
  const root = $('#root');
  clear(root);
  const navEl = el('nav', { class: 'nav' });
  const sidebar = el('aside', { class: 'sidebar' }, [
    el('div', { class: 'brand' }, [el('div', { class: 'logo' }, ['C']), el('span', {}, [state.ref?.company?.name || 'CRM'])]),
    navEl,
    el('div', { class: 'sidebar-foot' }, [
      el('div', { class: 'avatar' }, [(state.me?.user?.name || '?').slice(0, 1).toUpperCase()]),
      el('div', { class: 'who' }, [
        el('div', { style: { fontWeight: '600' } }, [state.me?.user?.name || '—']),
        el('div', { class: 'dim', style: { fontSize: '11px' } }, [state.me?.user?.email || '']),
      ]),
      el('div', { class: 'spacer', style: { flex: '1' } }),
      el('button', { class: 'btn ghost sm', title: 'Sign out', onClick: signOut }, ['⎋']),
    ]),
  ]);

  // group nav items by section
  const visible = NAV.filter((n) => !n.perm || hasModule(n.key));
  let currentSection = null;
  for (const item of visible) {
    if (item.section !== currentSection) {
      currentSection = item.section;
      navEl.appendChild(el('div', { class: 'nav-group' }, [SECTIONS[item.section] || '']));
    }
    const a = el('a', { class: 'nav-item', href: `#/${item.path}`, 'data-path': item.path }, [
      el('span', { class: 'ico' }, [item.icon]),
      el('span', {}, [item.label]),
    ]);
    navEl.appendChild(a);
  }

  const topbar = el('header', { class: 'topbar' }, [
    el('button', { class: 'btn ghost sm', title: 'Toggle sidebar', onClick: () => $('#app').classList.toggle('nav-collapsed') }, ['☰']),
    el('h1', { id: 'page-title' }, ['']),
    el('div', { class: 'spacer' }),
    el('div', { class: 'search-box' }, [
      el('span', { class: 'ico' }, ['⌕']),
      el('input', { type: 'search', placeholder: 'Search…', id: 'topbar-search' }),
    ]),
    el('button', { class: 'btn ghost sm', id: 'theme-toggle', title: 'Theme', onClick: toggleTheme }, [state.theme === 'dark' ? '☼' : '☾']),
  ]);
  const view = el('main', { class: 'content', id: 'view' });
  const main = el('section', { class: 'main' }, [topbar, view]);

  const app = el('div', { class: 'app', id: 'app' }, [sidebar, main]);
  root.appendChild(app);

  // topbar search → command palette
  $('#topbar-search').addEventListener('focus', () => {
    openCommandPalette((it) => {
      if (it.entity === 'deal') go('deals/' + it.id);
      else if (it.entity === 'lead') go('leads/' + it.id);
      else if (it.entity === 'person') go('contacts?tab=people&id=' + it.id);
      else if (it.entity === 'organization') go('contacts?tab=orgs&id=' + it.id);
      else if (it.entity === 'product') go('products/' + it.id);
      else if (it.entity === 'project') go('projects/' + it.id);
    });
    $('#topbar-search').blur();
  });
  // also keep focusable for keyboard: ctrl/cmd+k
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#topbar-search').focus();
    }
  });
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('crm.theme', state.theme);
  document.documentElement.dataset.theme = state.theme === 'dark' ? 'dark' : '';
  const t = $('#theme-toggle'); if (t) t.textContent = state.theme === 'dark' ? '☼' : '☾';
}

async function signOut() {
  try { await api.post('/api/auth/logout', {}); } catch {}
  state.me = null;
  location.hash = '';
  location.reload();
}

function setActiveNav() {
  const path = (location.hash || '#/pulse').slice(1).split('/').filter(Boolean)[0] || 'pulse';
  for (const a of document.querySelectorAll('.nav-item')) a.classList.toggle('active', a.dataset.path === path);
  const route = current();
  const t = $('#page-title');
  if (t && route) {
    const map = { pulse: 'Pulse', leads: 'Leads', deals: 'Deals', contacts: 'Contacts', activities: 'Activities', mail: 'Mail', products: 'Products', projects: 'Projects', insights: 'Insights', automations: 'Automations', campaigns: 'Campaigns', documents: 'Documents', admin: 'Admin' };
    t.textContent = map[route.parts[0]] || 'CRM';
  }
}

function mountView(node) {
  const v = $('#view'); if (!v) return;
  if (node instanceof Promise) {
    v.innerHTML = '<div class="loading">Loading…</div>';
    node.then((resolved) => {
      if (current() && $('#view') === v) { clear(v); v.appendChild(resolved); }
    }).catch((err) => {
      clear(v);
      v.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load view']), el('p', { class: 'muted' }, [String(err.message || err)])]));
    });
    return;
  }
  clear(v);
  v.appendChild(node);
}

// ----- routes -----
register('pulse', () => mountView(renderPulse()));
register('leads', () => mountView(renderLeadsList({})));
register('leads/:id', (p) => mountView(renderLeadDetail(p.id)));
register('deals', (p) => mountView(renderDealsList(p)));
register('deals/board', (p) => mountView(renderDealBoard(p)));
register('deals/:id', (p) => mountView(renderDealDetail(p.id)));
register('contacts', (p) => mountView(renderContacts(p)));
register('activities', (p) => mountView(renderActivities(p)));
register('mail', (p) => mountView(renderMail(p)));
register('products', (p) => mountView(renderProducts(p)));
register('products/:id', (p) => mountView(renderProducts({ id: p.id })));
register('projects', (p) => mountView(renderProjects(p)));
register('projects/:id', (p) => mountView(renderProjectDetail(p.id)));
register('insights', (p) => mountView(renderInsights(p)));
register('automations', (p) => mountView(renderAutomations(p)));
register('campaigns', (p) => mountView(renderCampaigns(p)));
register('documents', (p) => mountView(renderDocuments(p)));
register('admin', (p) => mountView(renderAdmin(p)));
register('admin/:section', (p) => mountView(renderAdminSection(p.section, p)));

// ----- boot -----
(async function boot() {
  document.documentElement.dataset.theme = state.theme === 'dark' ? 'dark' : '';
  try {
    state.me = await api.get('/api/auth/me');
    if (!state.me || !state.me.user) throw new Error('no session');
    await refreshReference();
    state.meta = await api.get('/api/meta/entities');
    renderShell();
    if (!location.hash) location.hash = '#/pulse';
    startRouter();
    onRouteChange(setActiveNav);
    setActiveNav();
  } catch {
    renderLogin();
  }
})();
