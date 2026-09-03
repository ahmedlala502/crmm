import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, sendJson, serveStatic, readJson, HttpError, unauthorized } from './http.mjs';
import { userFromRequest } from './auth.mjs';
import { buildContext } from './rbac.mjs';
import { startWorker } from './jobs.mjs';
import { initAutomations, automationTick } from './engines/automations.mjs';
import { initWebhooks } from './engines/webhooks.mjs';
import { initMailer } from './engines/mailer.mjs';
import { initCampaigns } from './engines/campaigns.mjs';
import { sequenceTick } from './engines/sequences.mjs';
import { ensureSeed } from './seed.mjs';

import { registerAuthRoutes } from './routes/auth.mjs';
import { registerRecordRoutes } from './routes/records.mjs';
import { registerSalesRoutes } from './routes/sales.mjs';
import { registerWorkRoutes } from './routes/work.mjs';
import { registerCommsRoutes } from './routes/comms.mjs';
import { registerInsightsRoutes } from './routes/insights.mjs';
import { registerAutomationRoutes } from './routes/automations.mjs';
import { registerAdminRoutes } from './routes/admin.mjs';
import { registerPublicRoutes } from './routes/public.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', 'web');
const PORT = Number(process.env.PORT || 4173);

// engines subscribe to the event bus before any request is served
initMailer();
initAutomations();
initWebhooks();
initCampaigns();
ensureSeed();

const publicRouter = new Router();
registerPublicRoutes(publicRouter);

const apiRouter = new Router();
registerAuthRoutes(apiRouter);
registerRecordRoutes(apiRouter);
registerSalesRoutes(apiRouter);
registerWorkRoutes(apiRouter);
registerCommsRoutes(apiRouter);
registerInsightsRoutes(apiRouter);
registerAutomationRoutes(apiRouter);
registerAdminRoutes(apiRouter);

const OPEN_ROUTES = new Set(['POST /api/auth/login', 'POST /api/auth/logout']);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams);

  try {
    // 1) public (unauthenticated) routes
    const pub = publicRouter.match(req.method, pathname);
    if (pub) {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-type']?.includes('json')
        ? await readJson(req) : {};
      const out = await pub.handler(req, res, { params: pub.params, query, body });
      if (!out?.__raw) sendJson(res, 200, out);
      return;
    }

    // 2) API routes
    if (pathname.startsWith('/api/')) {
      const match = apiRouter.match(req.method, pathname);
      if (!match) return sendJson(res, 404, { error: `No route for ${req.method} ${pathname}` });

      const auth = userFromRequest(req);
      const routeKey = `${req.method} ${pathname}`;
      if (!auth && !OPEN_ROUTES.has(routeKey)) throw unauthorized();
      const ctx = auth ? { ...buildContext(auth.user), sessionToken: auth.sessionToken, via: auth.via } : null;
      if (ctx && auth.via === 'token' && !auth.scopes.includes('write') && req.method !== 'GET') {
        throw new HttpError(403, 'This API token is read-only');
      }

      const isJson = req.headers['content-type']?.includes('json');
      const wantsBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
      const streamingRoute = pathname.endsWith('/files') || pathname.includes('/import/analyse');
      const body = wantsBody && isJson && !streamingRoute ? await readJson(req) : {};

      const out = await match.handler(req, res, { params: match.params, query, body, ctx, auth });
      if (!out?.__raw) sendJson(res, 200, out);
      return;
    }

    // 3) static SPA
    if (serveStatic(res, WEB_DIR, pathname)) return;
    if (!path.extname(pathname)) {
      if (serveStatic(res, WEB_DIR, '/index.html')) return;
    }
    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message, detail: err.detail ?? null });
    } else {
      console.error(`[error] ${req.method} ${pathname}:`, err);
      sendJson(res, 500, { error: err.message || 'Internal server error' });
    }
  }
});

startWorker(5000, [automationTick, sequenceTick]);

server.listen(PORT, () => {
  console.log(`\n  CRM running:  http://localhost:${PORT}`);
  console.log(`  Sign in with: admin@crm.local / admin1234\n`);
});
