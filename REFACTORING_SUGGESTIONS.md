# Code Refactoring Suggestions

## Executive Summary

This repository contains a Pipedrive-style CRM application built with vanilla JavaScript (frontend) and Node.js with SQLite (backend). The codebase is functional but has several areas that would benefit from refactoring to improve maintainability, scalability, testability, and developer experience.

**Total Lines of Code:** ~12,600 lines across 23 JavaScript/ES modules

---

## 1. Architecture & Structure

### 1.1 Missing Module System
**Issue:** Frontend uses ES modules but lacks a proper build system or dependency management.

**Current State:**
- No `package.json` for dependency management
- No bundler (Vite, Webpack, Rollup)
- Direct browser ES module imports

**Recommendation:**
```json
// package.json
{
  "name": "crm-app",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "test": "vitest"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "eslint": "^8.0.0",
    "vitest": "^1.0.0"
  }
}
```

**Benefits:**
- Dependency versioning
- Tree-shaking for production
- Hot module replacement during development
- Better error messages and stack traces

### 1.2 Directory Structure Reorganization
**Issue:** Flat structure makes navigation difficult as the project grows.

**Current:**
```
app/
├── server/
│   ├── routes/
│   ├── engines/
│   └── *.mjs
├── web/
│   ├── lib/
│   ├── modules/
│   └── *.js
```

**Recommended:**
```
app/
├── server/
│   ├── api/
│   │   ├── middleware/
│   │   ├── routes/
│   │   └── controllers/
│   ├── db/
│   ├── engines/
│   ├── services/
│   └── utils/
├── web/
│   ├── components/
│   ├── views/
│   ├── lib/
│   ├── state/
│   └── utils/
├── shared/
│   └── constants/
└── tests/
    ├── unit/
    └── integration/
```

---

## 2. Frontend Code Quality

### 2.1 DOM Helper Improvements (`/web/lib/dom.js`)

**Issue:** Manual DOM manipulation is error-prone and lacks TypeScript safety.

**Current Code (Line 2-20):**
```javascript
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    // ... more conditionals
  }
  appendChildren(node, children);
  return node;
}
```

**Problems:**
- No type checking on attributes
- Silent failures on invalid properties
- No support for SVG elements
- Memory leak potential with event listeners

**Refactored Version:**
```javascript
// /web/lib/dom.js
const EVENT_PATTERN = /^on[a-z]+$/i;
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

export function el(tag, attrs = {}, children = []) {
  const ns = tag.includes(':') ? getNamespace(tag) : null;
  const node = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
  
  if (attrs) {
    setAttributes(node, attrs);
  }
  
  if (!VOID_ELEMENTS.has(tag) && children) {
    appendChildren(node, children);
  }
  
  return node;
}

function setAttributes(node, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    
    if (key === 'class' || key === 'className') {
      node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    } 
    else if (key === 'style') {
      Object.assign(node.style, value);
    } 
    else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } 
    else if (EVENT_PATTERN.test(key)) {
      const eventName = key.slice(2).toLowerCase();
      node.addEventListener(eventName, value, { once: attrs.once });
    } 
    else if (key in node && typeof node[key] !== 'function') {
      try { node[key] = value; } 
      catch { node.setAttribute(key, value); }
    } 
    else {
      node.setAttribute(key, value);
    }
  }
}

function getNamespace(tag) {
  if (tag.startsWith('svg:')) return 'http://www.w3.org/2000/svg';
  if (tag.startsWith('math:')) return 'http://www.w3.org/1998/Math/MathML';
  return null;
}
```

### 2.2 State Management (`/web/lib/api.js`)

**Issue:** Global mutable state without reactivity or validation.

**Current Code (Line 3-8):**
```javascript
export const state = {
  me: null,
  ref: null,
  meta: null,
  theme: localStorage.getItem('crm.theme') || 'light',
};
```

**Problems:**
- No change detection
- Direct mutation everywhere
- No persistence strategy
- Race conditions possible

**Refactored Version:**
```javascript
// /web/lib/state.js
class Store {
  constructor(initialState = {}) {
    this.state = { ...initialState };
    this.listeners = new Set();
    this._locked = false;
  }
  
  get(path) {
    return path.split('.').reduce((obj, key) => obj?.[key], this.state);
  }
  
  set(path, value, options = {}) {
    if (this._locked) throw new Error('Cannot mutate state during dispatch');
    
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => obj[key], this.state);
    
    const oldValue = target[lastKey];
    target[lastKey] = value;
    
    if (!options.silent) {
      this.notify({ path, value, oldValue });
    }
    
    if (options.persist) {
      this.persist(path, value);
    }
  }
  
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  notify(change) {
    this.listeners.forEach(fn => fn(change));
  }
  
  persist(path, value) {
    try {
      localStorage.setItem(`crm.${path}`, JSON.stringify(value));
    } catch (err) {
      console.warn('Failed to persist state:', err);
    }
  }
  
  batch(updates) {
    this._locked = true;
    try {
      for (const [path, value] of Object.entries(updates)) {
        this.set(path, value, { silent: true });
      }
      this._locked = false;
      this.notify({ batch: updates });
    } catch (err) {
      this._locked = false;
      throw err;
    }
  }
}

export const state = new Store({
  me: null,
  ref: null,
  meta: null,
  theme: (() => {
    try {
      return localStorage.getItem('crm.theme') || 'light';
    } catch {
      return 'light';
    }
  })(),
});
```

### 2.3 API Client Error Handling (`/web/lib/api.js`)

**Issue:** Inconsistent error handling and no retry logic.

**Current Code (Line 19-34):**
```javascript
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
```

**Problems:**
- No timeout
- No retry logic for transient failures
- No request/response logging
- No cancellation support

**Refactored Version:**
```javascript
// /web/lib/api.js
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

class ApiClient {
  constructor(baseOptions = {}) {
    this.baseURL = baseOptions.baseURL || '';
    this.defaultHeaders = baseOptions.headers || {};
    this.timeout = baseOptions.timeout || DEFAULT_TIMEOUT;
  }
  
  async request(method, path, body, options = {}) {
    const url = this.buildURL(path, options.params);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers: this.getHeaders(options),
          body: this.serializeBody(body, options),
          signal: controller.signal,
          credentials: 'include',
        });
        
        clearTimeout(timeoutId);
        const data = await this.parseResponse(response);
        
        if (!response.ok) {
          throw new ApiError(
            response.status,
            data.error || 'Request failed',
            data.detail,
            { method, path, response }
          );
        }
        
        return data;
      } catch (error) {
        lastError = error;
        clearTimeout(timeoutId);
        
        if (!this.isRetryable(error) || attempt === MAX_RETRIES) {
          break;
        }
        
        await this.delay(RETRY_DELAY * Math.pow(2, attempt));
      }
    }
    
    throw lastError;
  }
  
  isRetryable(error) {
    return error instanceof ApiError 
      ? [408, 429, 500, 502, 503, 504].includes(error.status)
      : error.name === 'AbortError';
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  buildURL(path, params) {
    const url = new URL(path, this.baseURL);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value != null && value !== '') {
          url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
        }
      });
    }
    return url.toString();
  }
  
  getHeaders(options) {
    return {
      'Content-Type': options.raw ? 'application/octet-stream' : 'application/json',
      ...this.defaultHeaders,
      ...options.headers,
    };
  }
  
  serializeBody(body, options) {
    if (body === undefined) return undefined;
    if (options.raw) return body;
    return JSON.stringify(body);
  }
  
  async parseResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      return response.json();
    }
    
    const text = await response.text();
    return contentType.includes('text/') ? text : { __raw: text };
  }
  
  get(path, params, options) {
    return this.request('GET', path, undefined, { ...options, params });
  }
  
  post(path, body, options) {
    return this.request('POST', path, body, options);
  }
  
  patch(path, body, options) {
    return this.request('PATCH', path, body, options);
  }
  
  put(path, body, options) {
    return this.request('PUT', path, body, options);
  }
  
  delete(path, options) {
    return this.request('DELETE', path, undefined, options);
  }
}

export const api = new ApiClient();
```

### 2.4 Router Improvements (`/web/lib/router.js`)

**Issue:** Basic hash router lacks features like guards, lazy loading, and proper error handling.

**Current Problems:**
- No route guards/authentication checks
- No lazy loading of modules
- Synchronous handler assumption
- No 404 handling customization

**Refactored Version:**
```javascript
// /web/lib/router.js
class Router {
  constructor() {
    this.routes = [];
    this.currentRoute = null;
    this.onChangeListeners = new Set();
    this.beforeEachGuards = [];
    this.errorHandler = null;
  }
  
  register(pattern, handler, options = {}) {
    const parts = pattern.split('/').filter(Boolean);
    this.routes.push({ 
      pattern, 
      parts, 
      handler,
      meta: options.meta || {},
      lazy: options.lazy || false,
    });
  }
  
  beforeEach(guard) {
    this.beforeEachGuards.push(guard);
  }
  
  onError(handler) {
    this.errorHandler = handler;
  }
  
  async navigate(path, options = {}) {
    const fullHash = path.startsWith('#') ? path : '#' + path;
    
    if (location.hash === fullHash && options.force) {
      await this.handleRoute();
      return;
    }
    
    location.hash = fullHash;
  }
  
  async handleRoute() {
    try {
      const raw = (location.hash || '#/').slice(1);
      const [pathPart, queryPart] = raw.split('?');
      const segments = pathPart.split('/').filter(Boolean);
      const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
      
      const match = this.findBestMatch(segments);
      if (!match) {
        this.renderNotFound();
        return;
      }
      
      // Run guards
      for (const guard of this.beforeEachGuards) {
        const result = await guard(match, this.currentRoute);
        if (result === false) return;
        if (typeof result === 'string') {
          location.hash = result;
          return;
        }
      }
      
      // Lazy load if needed
      let handler = match.handler;
      if (match.lazy) {
        handler = await handler();
      }
      
      this.currentRoute = { ...match, query };
      this.notifyChange();
      await handler(match.params, query);
      
    } catch (error) {
      if (this.errorHandler) {
        this.errorHandler(error, this.currentRoute);
      } else {
        console.error('Router error:', error);
        this.renderError(error);
      }
    }
  }
  
  findBestMatch(segments) {
    let bestMatch = null;
    let bestScore = -1;
    
    for (const route of this.routes) {
      if (route.parts.length !== segments.length) continue;
      
      const params = {};
      let score = 0;
      let valid = true;
      
      for (let i = 0; i < route.parts.length; i++) {
        const part = route.parts[i];
        if (part.startsWith(':')) {
          params[part.slice(1)] = decodeURIComponent(segments[i]);
        } else if (part !== segments[i]) {
          valid = false;
          break;
        } else {
          score++;
        }
      }
      
      if (valid && score > bestScore) {
        bestMatch = route;
        bestMatch.params = params;
        bestScore = score;
      }
    }
    
    return bestMatch;
  }
  
  onChange(callback) {
    this.onChangeListeners.add(callback);
    return () => this.onChangeListeners.delete(callback);
  }
  
  notifyChange() {
    this.onChangeListeners.forEach(fn => fn(this.currentRoute));
  }
  
  start() {
    window.addEventListener('hashchange', () => this.handleRoute());
    window.addEventListener('popstate', () => this.handleRoute());
    this.handleRoute();
  }
  
  renderNotFound() {
    const view = document.getElementById('view');
    if (view) {
      view.innerHTML = `
        <div class="empty">
          <h3>Page Not Found</h3>
          <p>The page you're looking for doesn't exist.</p>
          <button class="btn primary" onclick="location.hash='#/pulse'">Go Home</button>
        </div>
      `;
    }
  }
  
  renderError(error) {
    const view = document.getElementById('view');
    if (view) {
      view.innerHTML = `
        <div class="empty">
          <h3>Something went wrong</h3>
          <p class="muted">${error.message || 'Unknown error'}</p>
          <button class="btn" onclick="location.reload()">Reload</button>
        </div>
      `;
    }
  }
}

export const router = new Router();
export const register = (...args) => router.register(...args);
export const go = (...args) => router.navigate(...args);
export const onRouteChange = (...args) => router.onChange(...args);
export const start = () => router.start();
export const current = () => router.currentRoute;
```

### 2.5 Module Code Duplication

**Issue:** Similar patterns repeated across multiple module files.

**Example:** Every module file has similar drawer/detail opening logic:

```javascript
// Repeated in deals.js, leads.js, contacts.js, etc.
function openDetail(row) {
  drawer({ title: `${meta.label} #${row.id}`, body: el('div', { class: 'loading' }, ['Loading…']), wide: true });
  setTimeout(() => {
    const d = document.querySelector('.drawer');
    const body = d.querySelector('.body');
    clear(body);
    body.appendChild(renderDetail(entityKey, row.id, refresh));
  }, 10);
}
```

**Solution:** Create a shared utility:

```javascript
// /web/lib/navigation.js
import { drawer } from './ui.js';
import { clear } from './dom.js';
import { renderDetail } from '../modules/detail.js';

export function openRecordDrawer(entityType, recordId, options = {}) {
  const { title = `Record #${recordId}`, wide = true, onClose } = options;
  
  const d = drawer({ 
    title, 
    body: el('div', { class: 'loading' }, ['Loading…']), 
    wide,
    footer: options.footer,
  });
  
  // Micro-task to allow drawer animation to start
  queueMicrotask(() => {
    const body = d.querySelector('.body');
    if (!body) return;
    
    clear(body);
    const detailView = renderDetail(entityType, recordId, options.onRefresh);
    body.appendChild(detailView);
  });
  
  if (onClose) {
    d.addEventListener('transitionend', () => {
      if (!document.contains(d)) onClose();
    });
  }
  
  return d;
}

export function openModalForm(entityType, options = {}) {
  // Similar abstraction for modals
}
```

---

## 3. Backend Code Quality

### 3.1 Database Connection Management (`/server/db.mjs`)

**Issue:** Single database connection with no pooling or error recovery.

**Current Code (Line 11-15):**
```javascript
const DB_PATH = path.join(DATA_DIR, 'crm.sqlite');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
```

**Problems:**
- No connection pooling
- No error handling for database initialization
- No migration system
- WAL mode without proper checkpoint configuration

**Refactored Version:**
```javascript
// /server/db/connection.js
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

class DatabaseManager {
  constructor(dbPath, options = {}) {
    this.dbPath = dbPath;
    this.options = {
      walAutoCheckpoint: 1000,
      busyTimeout: 5000,
      ...options,
    };
    this.db = null;
    this.initialized = false;
  }
  
  connect() {
    if (this.db) return this.db;
    
    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      fs.mkdirSync(dir, { recursive: true });
      
      this.db = new DatabaseSync(this.dbPath);
      this.configure();
      this.initialized = true;
      
      return this.db;
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }
  
  configure() {
    const pragmas = [
      'PRAGMA journal_mode = WAL;',
      `PRAGMA wal_autocheckpoint = ${this.options.walAutoCheckpoint};`,
      `PRAGMA busy_timeout = ${this.options.busyTimeout};`,
      'PRAGMA foreign_keys = ON;',
      'PRAGMA synchronous = NORMAL;',
      'PRAGMA cache_size = -64000;', // 64MB cache
      'PRAGMA temp_store = memory;',
    ];
    
    for (const pragma of pragmas) {
      this.db.exec(pragma);
    }
  }
  
  migrate(migrations) {
    const applied = this.db.prepare('SELECT version FROM _migrations ORDER BY version DESC').all();
    const appliedVersions = new Set(applied.map(r => r.version));
    
    for (const migration of migrations) {
      if (!appliedVersions.has(migration.version)) {
        console.log(`Applying migration ${migration.version}: ${migration.name}`);
        
        this.db.exec('BEGIN');
        try {
          this.db.exec(migration.sql);
          this.db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(
            migration.version,
            migration.name
          );
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      }
    }
  }
  
  close() {
    if (this.db) {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton instance
let dbManager = null;

export function getDatabase() {
  if (!dbManager) {
    const dbPath = process.env.CRM_DB_PATH || path.join(process.cwd(), 'data', 'crm.sqlite');
    dbManager = new DatabaseManager(dbPath);
    dbManager.connect();
  }
  return dbManager.db;
}

export function runMigrations(migrations) {
  const db = getDatabase();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  
  dbManager.migrate(migrations);
}
```

### 3.2 Transaction Handling (`/server/db.mjs`)

**Issue:** Simple transaction wrapper without proper nesting or savepoint support.

**Current Code (Line 45-60):**
```javascript
let txDepth = 0;
export function tx(fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN');
  txDepth++;
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  } finally {
    txDepth--;
  }
}
```

**Problems:**
- Nested transactions become no-ops (dangerous)
- No savepoint support
- No timeout/retry logic
- Silent rollback failures

**Refactored Version:**
```javascript
// /server/db/transaction.js
let transactionStack = [];

export class TransactionError extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = 'TransactionError';
  }
}

export async function transaction(db, fn, options = {}) {
  const {
    timeout = 30000,
    retries = 3,
    isolationLevel = 'DEFERRED',
  } = options;
  
  let attempt = 0;
  let lastError = null;
  
  while (attempt < retries) {
    try {
      return await executeTransaction(db, fn, isolationLevel);
    } catch (error) {
      lastError = error;
      attempt++;
      
      if (attempt < retries && isDeadlockError(error)) {
        await delay(Math.min(100 * Math.pow(2, attempt), 1000));
        continue;
      }
      
      throw error;
    }
  }
  
  throw new TransactionError(`Transaction failed after ${retries} attempts`, lastError);
}

async function executeTransaction(db, fn, isolationLevel) {
  const depth = transactionStack.length;
  const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  if (depth === 0) {
    db.prepare(`BEGIN ${isolationLevel} TRANSACTION`).run();
    transactionStack.push(txId);
    
    try {
      const result = await fn({ txId, depth: 0 });
      db.prepare('COMMIT').run();
      transactionStack.pop();
      return result;
    } catch (error) {
      try {
        db.prepare('ROLLBACK').run();
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError);
      }
      transactionStack.pop();
      throw error;
    }
  } else {
    // Nested transaction - use savepoint
    db.prepare(`SAVEPOINT ${txId}`).run();
    transactionStack.push(txId);
    
    try {
      const result = await fn({ txId, depth });
      db.prepare(`RELEASE SAVEPOINT ${txId}`).run();
      transactionStack.pop();
      return result;
    } catch (error) {
      try {
        db.prepare(`ROLLBACK TO SAVEPOINT ${txId}`).run();
      } catch (rollbackError) {
        console.error('Savepoint rollback failed:', rollbackError);
      }
      transactionStack.pop();
      throw error;
    }
  }
}

function isDeadlockError(error) {
  return error?.message?.includes('database is locked') || 
         error?.message?.includes('SQLITE_BUSY');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getCurrentTransactionDepth() {
  return transactionStack.length;
}
```

### 3.3 Authentication Middleware (`/server/auth.mjs`)

**Issue:** Authentication logic scattered and not properly modularized.

**Recommendation:** Create dedicated authentication middleware:

```javascript
// /server/middleware/auth.js
import { cookies } from '../utils/cookies.js';
import { sessions } from '../services/sessions.js';
import { HttpError } from '../http/errors.js';

export const AUTH_CONFIG = {
  cookieName: 'crm_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  headerName: 'x-api-token',
};

export function createAuthMiddleware(options = {}) {
  const config = { ...AUTH_CONFIG, ...options };
  
  return async function authMiddleware(req, res, next) {
    try {
      const sessionToken = extractToken(req, config);
      
      if (!sessionToken) {
        req.auth = null;
        return next();
      }
      
      const session = await sessions.validate(sessionToken);
      
      if (!session) {
        req.auth = null;
        return next();
      }
      
      req.auth = {
        user: session.user,
        sessionToken,
        scopes: session.scopes || ['read', 'write'],
        via: session.via || 'cookie',
        expiresAt: session.expires_at,
      };
      
      // Refresh session if expiring soon
      const ttl = session.expires_at - Date.now();
      if (ttl < 24 * 60 * 60 * 1000) {
        sessions.refresh(sessionToken);
      }
      
      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      req.auth = null;
      next();
    }
  };
}

export function requireAuth() {
  return (req, res, next) => {
    if (!req.auth?.user) {
      throw new HttpError(401, 'Authentication required');
    }
    next();
  };
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.auth?.user) {
      throw new HttpError(401, 'Authentication required');
    }
    
    if (req.auth.user.is_admin) {
      return next();
    }
    
    if (!req.auth.permissions?.includes(permission)) {
      throw new HttpError(403, `Missing permission: ${permission}`);
    }
    
    next();
  };
}

export function requireModule(moduleName) {
  return (req, res, next) => {
    if (!req.auth?.user) {
      throw new HttpError(401, 'Authentication required');
    }
    
    if (req.auth.user.is_admin) {
      return next();
    }
    
    if (!req.auth.modules?.includes(moduleName)) {
      throw new HttpError(403, `No access to module: ${moduleName}`);
    }
    
    next();
  };
}

function extractToken(req, config) {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  
  // Check custom header
  const headerToken = req.headers[config.headerName.toLowerCase()];
  if (headerToken) {
    return headerToken;
  }
  
  // Check cookies
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const parsed = cookies.parse(cookieHeader);
    return parsed[config.cookieName];
  }
  
  return null;
}
```

### 3.4 Input Validation

**Issue:** No centralized input validation - each route validates manually.

**Recommendation:** Add validation middleware:

```javascript
// /server/middleware/validate.js
import { badRequest } from '../http/errors.js';

export function validate(schema) {
  return (req, res, next) => {
    const data = req.method === 'GET' ? req.query : req.body;
    const result = validateSchema(schema, data);
    
    if (!result.valid) {
      throw badRequest('Validation failed', result.errors);
    }
    
    req.validatedData = result.data;
    next();
  };
}

function validateSchema(schema, data) {
  const errors = [];
  const validated = {};
  
  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    
    // Required check
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push({ field, message: `${field} is required` });
      continue;
    }
    
    // Optional field with no value
    if (value === undefined || value === null || value === '') {
      validated[field] = rules.default ?? null;
      continue;
    }
    
    // Type check
    const typeResult = validateType(field, value, rules.type);
    if (!typeResult.valid) {
      errors.push(typeResult.error);
      continue;
    }
    
    // Custom validators
    if (rules.validate) {
      const customResult = rules.validate(value, data);
      if (customResult !== true) {
        errors.push({ field, message: customResult || `${field} is invalid` });
        continue;
      }
    }
    
    validated[field] = typeResult.value;
  }
  
  return {
    valid: errors.length === 0,
    errors,
    data: validated,
  };
}

function validateType(field, value, type) {
  switch (type) {
    case 'string':
      if (typeof value !== 'string') {
        return { valid: false, error: { field, message: `${field} must be a string` } };
      }
      return { valid: true, value };
    
    case 'number':
      const num = Number(value);
      if (isNaN(num)) {
        return { valid: false, error: { field, message: `${field} must be a number` } };
      }
      return { valid: true, value: num };
    
    case 'integer':
      const int = parseInt(value, 10);
      if (isNaN(int) || !Number.isInteger(int)) {
        return { valid: false, error: { field, message: `${field} must be an integer` } };
      }
      return { valid: true, value: int };
    
    case 'boolean':
      if (typeof value === 'boolean') return { valid: true, value };
      if (['true', '1', 'yes'].includes(String(value).toLowerCase())) {
        return { valid: true, value: true };
      }
      if (['false', '0', 'no'].includes(String(value).toLowerCase())) {
        return { valid: true, value: false };
      }
      return { valid: false, error: { field, message: `${field} must be a boolean` } };
    
    case 'email':
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return { valid: false, error: { field, message: `${field} must be a valid email` } };
      }
      return { valid: true, value };
    
    case 'date':
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        return { valid: false, error: { field, message: `${field} must be a valid date` } };
      }
      return { valid: true, value: date.toISOString() };
    
    case 'array':
      if (!Array.isArray(value)) {
        return { valid: false, error: { field, message: `${field} must be an array` } };
      }
      return { valid: true, value };
    
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { valid: false, error: { field, message: `${field} must be an object` } };
      }
      return { valid: true, value };
    
    default:
      return { valid: true, value };
  }
}

// Usage example:
// router.post('/api/deals', 
//   validate({
//     title: { type: 'string', required: true, maxLength: 200 },
//     value: { type: 'number', required: true, min: 0 },
//     currency: { type: 'string', default: 'USD' },
//     owner_id: { type: 'integer', required: true },
//     pipeline_id: { type: 'integer', required: true },
//     stage_id: { type: 'integer', required: true },
//   }),
//   async (req, res, ctx) => {
//     const deal = await createDeal(req.validatedData, ctx);
//     return deal;
//   }
// );
```

---

## 4. Security Improvements

### 4.1 SQL Injection Prevention

**Current Risk:** String interpolation in SQL queries.

**Example from `/server/rbac.mjs` Line 80:**
```javascript
const reachableGroups = descendantGroups(myGroups);
// ...
for (const r of all(
  `SELECT DISTINCT user_id FROM user_visibility_groups WHERE group_id IN (${reachableGroups.map(() => '?').join(',')})`,
  ...reachableGroups,
))
```

**Status:** ✓ Using parameterized queries correctly

**Recommendation:** Add ESLint rule to prevent future issues:

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    'no-template-curly-in-string': 'error',
    'security/detect-non-literal-fs-filename': 'warn',
  },
  plugins: ['security'],
};
```

### 4.2 XSS Prevention

**Issue:** User content rendered without escaping.

**Current Code (`/web/lib/dom.js` Line 29-30):**
```javascript
if (typeof children === 'string' || typeof children === 'number' || typeof children === 'boolean') {
  node.appendChild(document.createTextNode(String(children)));
}
```

**Status:** ✓ Text nodes are safe

**But watch for:** InnerHTML usage

**Found in `/web/app.js` Line 182:**
```javascript
v.innerHTML = '<div class="loading">Loading…</div>';
```

**Recommendation:** Replace with DOM methods:

```javascript
// Safe alternative
v.appendChild(el('div', { class: 'loading' }, ['Loading…']));
```

### 4.3 CSRF Protection

**Issue:** No CSRF token validation for state-changing operations.

**Recommendation:**

```javascript
// /server/middleware/csrf.js
import { cookies } from '../utils/cookies.js';
import { cryptoRandomString } from '../utils/crypto.js';
import { forbidden } from '../http/errors.js';

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

export function csrfProtection(options = {}) {
  const { exclude = [] } = options;
  
  return (req, res, next) => {
    // Skip for GET, HEAD, OPTIONS
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }
    
    // Skip excluded paths
    if (exclude.some(pattern => req.url.startsWith(pattern))) {
      return next();
    }
    
    const cookieToken = cookies.parse(req.headers.cookie || '')[CSRF_COOKIE_NAME];
    const headerToken = req.headers[CSRF_HEADER_NAME.toLowerCase()];
    
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw forbidden('Invalid CSRF token');
    }
    
    next();
  };
}

export function generateCsrfToken() {
  return cryptoRandomString(32);
}

export function attachCsrfToken(res, token) {
  res.setHeader('Set-Cookie', `${CSRF_COOKIE_NAME}=${token}; Path=/; SameSite=Strict; Secure`);
  res.setHeader('X-CSRF-Token', token);
}
```

### 4.4 Rate Limiting

**Issue:** No rate limiting on API endpoints.

**Recommendation:**

```javascript
// /server/middleware/rateLimit.js
const windows = new Map();
const CLEANUP_INTERVAL = 60000;

export function rateLimit(options = {}) {
  const {
    windowMs = 60000,
    maxRequests = 100,
    keyGenerator = defaultKeyGenerator,
    message = 'Too many requests, please try again later.',
  } = options;
  
  // Cleanup old entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of windows.entries()) {
      if (now - data.startTime > windowMs) {
        windows.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);
  
  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();
    
    let windowData = windows.get(key);
    
    if (!windowData || now - windowData.startTime > windowMs) {
      windowData = { startTime: now, count: 0 };
      windows.set(key, windowData);
    }
    
    windowData.count++;
    
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - windowData.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil((windowData.startTime + windowMs) / 1000));
    
    if (windowData.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil((windowData.startTime + windowMs - now) / 1000));
      res.statusCode = 429;
      res.end(JSON.stringify({ error: message }));
      return;
    }
    
    next();
  };
}

function defaultKeyGenerator(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
             req.headers['x-real-ip'] || 
             req.socket?.remoteAddress || 
             'unknown';
  return `ip:${ip}`;
}

// Stricter limits for auth endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 attempts per 15 minutes
  keyGenerator: req => `auth:${req.body?.email || 'anonymous'}`,
  message: 'Too many login attempts, please try again in 15 minutes.',
});
```

---

## 5. Performance Optimizations

### 5.1 Database Query Optimization

**Issue:** N+1 queries in list views.

**Current Pattern:** Loading records then related entities separately.

**Recommendation:** Use JOIN queries or DataLoader pattern:

```javascript
// /server/utils/dataloader.js
export class DataLoader {
  constructor(batchFn, options = {}) {
    this.batchFn = batchFn;
    this.cache = new Map();
    this.queue = [];
    this.batchSize = options.batchSize || 100;
    this.batchDelay = options.batchDelay || 10;
  }
  
  load(key) {
    if (this.cache.has(key)) {
      return Promise.resolve(this.cache.get(key));
    }
    
    return new Promise((resolve, reject) => {
      this.queue.push({ key, resolve, reject });
      
      if (this.queue.length >= this.batchSize) {
        this.dispatchQueue();
      } else if (this.queue.length === 1) {
        setTimeout(() => this.dispatchQueue(), this.batchDelay);
      }
    });
  }
  
  loadMany(keys) {
    return Promise.all(keys.map(key => this.load(key)));
  }
  
  async dispatchQueue() {
    const batch = this.queue.splice(0, this.batchSize);
    const keys = batch.map(item => item.key);
    
    try {
      const values = await this.batchFn(keys);
      
      keys.forEach((key, index) => {
        const value = values[index];
        this.cache.set(key, value);
        batch[index].resolve(value);
      });
    } catch (error) {
      batch.forEach(item => item.reject(error));
    }
  }
  
  clear(key) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}

// Usage in routes:
// const personLoader = new DataLoader(async (ids) => {
//   const rows = all(
//     'SELECT * FROM persons WHERE id IN (' + ids.map(() => '?').join(',') + ')',
//     ...ids
//   );
//   const map = new Map(rows.map(r => [r.id, r]));
//   return ids.map(id => map.get(id) || null);
// });
```

### 5.2 Frontend Rendering Optimization

**Issue:** Full table re-render on every state change.

**Current Code (`/web/modules/list.js` Line 108-134):**
```javascript
function render() {
  clear(view);
  const rows = state2.data || [];
  if (!rows.length) { /* ... */ }
  const table = renderTable(rows);
  view.appendChild(table);
}
```

**Recommendation:** Virtual scrolling for large lists:

```javascript
// /web/lib/virtualList.js
export function createVirtualList(container, options) {
  const {
    itemHeight = 40,
    overscan = 5,
    renderItem,
    onScroll,
  } = options;
  
  let items = [];
  let scrollTop = 0;
  let containerHeight = 0;
  
  const scroller = document.createElement('div');
  scroller.style.cssText = 'overflow-y: auto; height: 100%; position: relative;';
  
  const viewport = document.createElement('div');
  viewport.style.cssText = 'position: absolute; top: 0; left: 0; right: 0;';
  
  scroller.appendChild(viewport);
  container.appendChild(scroller);
  
  function updateItems(newItems) {
    items = newItems;
    scroller.style.height = `${items.length * itemHeight}px`;
    render();
  }
  
  function render() {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      items.length,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );
    
    viewport.style.transform = `translateY(${startIndex * itemHeight}px)`;
    viewport.innerHTML = '';
    
    for (let i = startIndex; i < endIndex; i++) {
      const item = renderItem(items[i], i);
      item.style.height = `${itemHeight}px`;
      viewport.appendChild(item);
    }
  }
  
  scroller.addEventListener('scroll', (e) => {
    scrollTop = e.target.scrollTop;
    containerHeight = e.target.clientHeight;
    render();
    onScroll?.({ scrollTop, startIndex, endIndex });
  });
  
  // Initial measurement
  containerHeight = scroller.clientHeight;
  
  return {
    updateItems,
    scrollToIndex: (index) => {
      scroller.scrollTop = index * itemHeight;
    },
    destroy: () => {
      container.removeChild(scroller);
    },
  };
}
```

### 5.3 Asset Optimization

**Issue:** No asset bundling, minification, or caching strategy.

**Recommendations:**

1. **Add Vite for bundling** (as shown in section 1.1)
2. **Implement service worker for caching:**

```javascript
// /web/sw.js
const CACHE_NAME = 'crm-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/lib/dom.js',
  '/lib/api.js',
  '/lib/ui.js',
  '/lib/router.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => 
      Promise.all(
        names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // API requests - network first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => 
        caches.match(request).then(resp => resp || new Response('Offline'))
      )
    );
    return;
  }
  
  // Static assets - cache first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
```

---

## 6. Testing Strategy

### 6.1 Unit Tests

**Current State:** No test files found.

**Recommendation:** Add Vitest for testing:

```javascript
// tests/unit/dom.test.js
import { describe, it, expect } from 'vitest';
import { el, clear } from '../../web/lib/dom.js';

describe('el()', () => {
  it('creates element with tag', () => {
    const div = el('div');
    expect(div.tagName).toBe('DIV');
  });
  
  it('sets className', () => {
    const div = el('div', { class: 'test' });
    expect(div.className).toBe('test');
  });
  
  it('sets styles', () => {
    const div = el('div', { style: { color: 'red', fontSize: '14px' } });
    expect(div.style.color).toBe('red');
    expect(div.style.fontSize).toBe('14px');
  });
  
  it('attaches event listeners', () => {
    const handler = vi.fn();
    const button = el('button', { onClick: handler });
    button.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });
  
  it('appends children', () => {
    const div = el('div', {}, ['text', el('span', {}, ['child'])]);
    expect(div.childNodes.length).toBe(2);
    expect(div.textContent).toBe('textchild');
  });
});

describe('clear()', () => {
  it('removes all children', () => {
    const parent = document.createElement('div');
    parent.innerHTML = '<span>1</span><span>2</span>';
    clear(parent);
    expect(parent.childNodes.length).toBe(0);
  });
});
```

### 6.2 Integration Tests

```javascript
// tests/integration/api.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api } from '../../web/lib/api.js';

describe('API Integration', () => {
  beforeAll(async () => {
    // Start test server
  });
  
  afterAll(async () => {
    // Stop test server
  });
  
  it('authenticates user', async () => {
    const response = await api.post('/api/auth/login', {
      email: 'test@example.com',
      password: 'testpass123',
    });
    
    expect(response.user).toBeDefined();
    expect(response.user.email).toBe('test@example.com');
  });
  
  it('fetches deals list', async () => {
    const response = await api.get('/api/deals', { limit: 10 });
    
    expect(response.data).toBeInstanceOf(Array);
    expect(response.meta).toBeDefined();
    expect(response.meta.total).toBeGreaterThanOrEqual(0);
  });
});
```

### 6.3 End-to-End Tests

```javascript
// tests/e2e/deals.spec.js
import { test, expect } from '@playwright/test';

test.describe('Deals Module', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.fill('[name="email"]', 'admin@crm.local');
    await page.fill('[name="password"]', 'admin1234');
    await page.click('button[type="submit"]');
  });
  
  test('displays deals list', async ({ page }) => {
    await page.click('a[href="#/deals"]');
    await expect(page.locator('h2')).toContainText('Deals');
    await expect(page.locator('.grid tbody tr')).toHaveCount.greaterThan(0);
  });
  
  test('creates new deal', async ({ page }) => {
    await page.click('a[href="#/deals"]');
    await page.click('button:has-text("New Deal")');
    
    await page.fill('[name="title"]', 'Test Deal');
    await page.fill('[name="value"]', '5000');
    await page.click('button:has-text("Create")');
    
    await expect(page.locator('.toast.success')).toBeVisible();
    await expect(page.locator('.grid')).toContainText('Test Deal');
  });
  
  test('filters deals by status', async ({ page }) => {
    await page.click('a[href="#/deals"]');
    await page.selectOption('select[name="status"]', 'won');
    
    await expect(page.locator('.grid tbody tr')).toHaveCount.greaterThan(0);
    
    // Verify all visible deals are won
    const statuses = await page.locator('.badge').allTextContents();
    statuses.forEach(status => {
      expect(status.toLowerCase()).toBe('won');
    });
  });
});
```

---

## 7. Documentation Improvements

### 7.1 API Documentation

**Current State:** No API documentation.

**Recommendation:** Add OpenAPI/Swagger spec:

```yaml
# docs/openapi.yaml
openapi: 3.0.3
info:
  title: CRM API
  version: 1.0.0
  description: REST API for the CRM application

servers:
  - url: http://localhost:4173/api
    description: Development server

components:
  securitySchemes:
    cookieAuth:
      type: apiKey
      in: cookie
      name: crm_session
    bearerAuth:
      type: http
      scheme: bearer

  schemas:
    Deal:
      type: object
      properties:
        id:
          type: integer
        title:
          type: string
          maxLength: 200
        value:
          type: number
          minimum: 0
        currency:
          type: string
          default: USD
        stage_id:
          type: integer
        owner_id:
          type: integer
        created_at:
          type: string
          format: date-time
        updated_at:
          type: string
          format: date-time

paths:
  /deals:
    get:
      summary: List deals
      security:
        - cookieAuth: []
        - bearerAuth: []
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            default: 1
        - name: limit
          in: query
          schema:
            type: integer
            default: 50
            maximum: 200
        - name: search
          in: query
          schema:
            type: string
        - name: sort
          in: query
          schema:
            type: string
            enum: [title, value, created_at, updated_at]
        - name: dir
          in: query
          schema:
            type: string
            enum: [asc, desc]
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/Deal'
                  meta:
                    type: object
                    properties:
                      total:
                        type: integer
                      page:
                        type: integer
                      limit:
                        type: integer
    
    post:
      summary: Create deal
      security:
        - cookieAuth: []
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - title
                - value
                - pipeline_id
                - stage_id
              properties:
                title:
                  type: string
                value:
                  type: number
                currency:
                  type: string
                pipeline_id:
                  type: integer
                stage_id:
                  type: integer
                owner_id:
                  type: integer
      responses:
        '201':
          description: Deal created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Deal'
        '400':
          description: Validation error
        '401':
          description: Unauthorized
        '403':
          description: Forbidden

  /deals/{id}:
    get:
      summary: Get deal by ID
      security:
        - cookieAuth: []
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Deal'
        '404':
          description: Deal not found
```

### 7.2 Developer Onboarding

**Current State:** Minimal README.

**Recommendation:** Expand documentation:

```markdown
# CRM Application - Developer Guide

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation
```bash
git clone https://github.com/yourorg/crm.git
cd crm
npm install
npm run dev
```

### Default Credentials
- Email: `admin@crm.local`
- Password: `admin1234`

## Architecture Overview

### Frontend
- Vanilla JavaScript (ES Modules)
- Hash-based routing
- Custom DOM helper library
- No framework dependencies

### Backend
- Node.js native HTTP server
- SQLite database (node:sqlite)
- ES Modules
- RBAC authorization

### Key Directories
- `/web` - Frontend application
- `/server` - Backend API
- `/server/routes` - API route handlers
- `/server/engines` - Background workers

## Development

### Running Tests
```bash
npm test           # Run all tests
npm run test:unit  # Unit tests only
npm run test:e2e   # E2E tests
```

### Code Style
```bash
npm run lint       # Check code style
npm run format     # Auto-fix formatting
```

### Database Migrations
```bash
npm run migrate    # Run pending migrations
npm run seed       # Seed test data
```

## API Reference

See [docs/API.md](docs/API.md) for complete API documentation.

## Common Tasks

### Adding a New Module
1. Create route in `/server/routes/`
2. Add frontend view in `/web/modules/`
3. Register route in `/server/index.mjs`
4. Add navigation item in `/web/app.js`
5. Update RBAC permissions in `/server/rbac.mjs`

### Adding Custom Fields
Custom fields are stored in JSON columns and managed through the admin interface.

### Background Jobs
Engines in `/server/engines/` run periodic tasks:
- Automations
- Email sending
- Webhooks
- Campaigns
- Sequences

## Troubleshooting

### Database Issues
```bash
# Reset database
rm -rf app/data/*.sqlite*
npm run seed
```

### Port Already in Use
```bash
PORT=4174 npm run dev
```

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

[Your License Here]
```

---

## 8. DevOps & Deployment

### 8.1 Environment Configuration

**Current State:** Hardcoded paths and settings.

**Recommendation:** Add environment configuration:

```javascript
// /server/config.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 4173,
  host: process.env.HOST || 'localhost',
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Database
  dbPath: process.env.CRM_DB_PATH || path.join(__dirname, '..', 'data', 'crm.sqlite'),
  dbPool: {
    max: parseInt(process.env.DB_POOL_MAX, 10) || 5,
    min: parseInt(process.env.DB_POOL_MIN, 10) || 1,
  },
  
  // Security
  sessionSecret: process.env.CRM_SESSION_SECRET || 'dev-secret-change-in-production',
  sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 7 * 24 * 60 * 60 * 1000,
  csrfEnabled: process.env.CSRF_ENABLED !== 'false',
  
  // File Upload
  uploadDir: process.env.CRM_UPLOAD_DIR || path.join(__dirname, '..', 'data', 'files'),
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE, 10) || 40 * 1024 * 1024,
  
  // Email
  smtpHost: process.env.SMTP_HOST,
  smtpPort: parseInt(process.env.SMTP_PORT, 10) || 587,
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  smtpFrom: process.env.SMTP_FROM || 'CRM <noreply@crm.local>',
  
  // Background Jobs
  jobInterval: parseInt(process.env.JOB_INTERVAL, 10) || 5000,
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  logFile: process.env.LOG_FILE || path.join(__dirname, '..', 'logs', 'crm.log'),
  
  // Feature Flags
  features: {
    automations: process.env.FEATURE_AUTOMATIONS !== 'false',
    webhooks: process.env.FEATURE_WEBHOOKS !== 'false',
    campaigns: process.env.FEATURE_CAMPAIGNS !== 'false',
    mail: process.env.FEATURE_MAIL !== 'false',
  },
};

// Validate required production settings
if (config.nodeEnv === 'production') {
  const required = ['CRM_SESSION_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Please set these before running in production.'
    );
  }
}
```

### 8.2 Docker Support

**Recommendation:** Add Dockerfile and docker-compose:

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY . .

# Create data directory
RUN mkdir -p /app/data/files /app/logs

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
USER nodejs

EXPOSE 4173

CMD ["node", "app/server/index.mjs"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  crm:
    build: .
    ports:
      - "4173:4173"
    environment:
      - NODE_ENV=production
      - CRM_SESSION_SECRET=${CRM_SESSION_SECRET:-change-me}
      - PORT=4173
    volumes:
      - crm-data:/app/data
      - crm-logs:/app/logs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:4173/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  crm-data:
  crm-logs:
```

### 8.3 CI/CD Pipeline

**Recommendation:** Add GitHub Actions workflow:

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  build:
    runs-on: ubuntu-latest
    needs: [lint, test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/

  deploy:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist/
      - name: Deploy to production
        run: |
          # Your deployment script here
          echo "Deploying..."
```

---

## 9. Monitoring & Observability

### 9.1 Logging

**Current State:** Basic console.error for errors.

**Recommendation:** Structured logging:

```javascript
// /server/utils/logger.js
import fs from 'node:fs';
import path from 'node:path';

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

class Logger {
  constructor(options = {}) {
    this.level = LOG_LEVELS[options.level || 'info'];
    this.logFile = options.logFile;
    this.service = options.service || 'crm';
  }
  
  log(level, message, meta = {}) {
    if (LOG_LEVELS[level] > this.level) return;
    
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...meta,
    };
    
    const line = JSON.stringify(entry) + '\n';
    
    // Console output
    const consoleMethod = level === 'error' ? 'error' : 
                       level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](line.trim());
    
    // File output
    if (this.logFile) {
      fs.appendFileSync(this.logFile, line);
    }
  }
  
  error(message, meta) { this.log('error', message, meta); }
  warn(message, meta) { this.log('warn', message, meta); }
  info(message, meta) { this.log('info', message, meta); }
  debug(message, meta) { this.log('debug', message, meta); }
  
  child(meta) {
    return {
      error: (msg, m) => this.error(msg, { ...meta, ...m }),
      warn: (msg, m) => this.warn(msg, { ...meta, ...m }),
      info: (msg, m) => this.info(msg, { ...meta, ...m }),
      debug: (msg, m) => this.debug(msg, { ...meta, ...m }),
    };
  }
}

export const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  logFile: process.env.LOG_FILE,
  service: 'crm-server',
});
```

### 9.2 Health Checks

**Recommendation:** Add health check endpoint:

```javascript
// /server/routes/health.mjs
import { db } from '../db.mjs';
import { version } from '../../package.json';

export function registerHealthRoutes(router) {
  router.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });
  
  router.get('/health/ready', async () => {
    try {
      // Check database connectivity
      db.prepare('SELECT 1').get();
      
      return {
        status: 'ready',
        checks: {
          database: 'ok',
        },
      };
    } catch (error) {
      return {
        status: 'not_ready',
        checks: {
          database: 'error',
        },
        error: error.message,
      };
    }
  });
  
  router.get('/health/live', () => {
    return { status: 'alive' };
  });
  
  router.get('/version', () => {
    return {
      version,
      node: process.version,
      platform: process.platform,
    };
  });
}
```

### 9.3 Metrics Collection

**Recommendation:** Add basic metrics:

```javascript
// /server/utils/metrics.js
const metrics = {
  requests: new Map(),
  errors: new Map(),
  latencies: [],
  startTime: Date.now(),
};

export function recordRequest(route, method, statusCode, latencyMs) {
  const key = `${method}:${route}:${statusCode}`;
  const count = metrics.requests.get(key) || 0;
  metrics.requests.set(key, count + 1);
  
  metrics.latencies.push(latencyMs);
  if (metrics.latencies.length > 1000) {
    metrics.latencies.shift();
  }
}

export function recordError(route, method, errorType) {
  const key = `${method}:${route}:${errorType}`;
  const count = metrics.errors.get(key) || 0;
  metrics.errors.set(key, count + 1);
}

export function getMetrics() {
  const latencies = metrics.latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  
  return {
    uptime: Date.now() - metrics.startTime,
    requests: Object.fromEntries(metrics.requests),
    errors: Object.fromEntries(metrics.errors),
    latency: {
      p50: Math.round(p50),
      p95: Math.round(p95),
      p99: Math.round(p99),
      avg: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) || 0,
    },
  };
}

// Middleware to record metrics
export function metricsMiddleware() {
  return (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const latency = Date.now() - start;
      const route = req.url.split('?')[0].split('/').slice(0, 4).join('/');
      recordRequest(route, req.method, res.statusCode, latency);
    });
    
    next();
  };
}
```

---

## 10. Priority Recommendations

### High Priority (Security & Stability)
1. **Add CSRF protection** - Critical for production
2. **Implement rate limiting** - Prevent abuse
3. **Add input validation middleware** - Prevent bad data
4. **Improve error handling** - Better debugging and user experience
5. **Add health checks** - Monitor application status

### Medium Priority (Maintainability)
1. **Set up testing framework** - Catch regressions early
2. **Add logging** - Production observability
3. **Refactor state management** - Reduce bugs
4. **Improve API client** - Retry logic, timeouts
5. **Add documentation** - Onboard developers faster

### Low Priority (Optimization)
1. **Add bundler** - Better performance
2. **Implement virtual scrolling** - Handle large lists
3. **Add service worker** - Offline support
4. **Database query optimization** - Faster responses
5. **Docker support** - Easier deployment

---

## Conclusion

This codebase demonstrates solid fundamentals with a clean architecture separating concerns between frontend and backend. The main areas for improvement are:

1. **Security hardening** - Add CSRF, rate limiting, and validation
2. **Developer experience** - Add testing, linting, and documentation
3. **Production readiness** - Add monitoring, logging, and deployment tooling
4. **Code quality** - Refactor duplicated code and improve error handling

Implementing these suggestions will make the application more secure, maintainable, and scalable while improving the developer experience.
