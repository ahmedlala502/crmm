import { all, get, run, insert, json, nowIso, setting } from '../db.mjs';
import { sendText, sendJson, notFound, badRequest, readBody } from '../http.mjs';
import { publicDocument, signDocument, documentHtml } from '../engines/documents.mjs';
import { unsubscribe } from '../engines/campaigns.mjs';
import { runReport, goalProgress } from '../engines/reports.mjs';
import { createRecord, systemContext } from '../records.mjs';

const PIXEL = Buffer.from('47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b', 'hex');

/** Routes reachable without a session. Registered on a separate router. */
export function registerPublicRoutes(router) {
  // open tracking
  router.get('/t/o/:id.png', async (req, res, { params }) => {
    const id = Number(String(params['id.png']).replace('.png', ''));
    if (id) run('UPDATE emails SET opens = opens + 1 WHERE id=?', id);
    res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': PIXEL.length, 'Cache-Control': 'no-store' });
    res.end(PIXEL);
    return { __raw: true };
  });

  router.get('/t/campaign/:id.png', async (req, res, { params }) => {
    const id = Number(String(params['id.png']).replace('.png', ''));
    if (id) run('UPDATE campaign_recipients SET opened = 1 WHERE id=?', id);
    res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': PIXEL.length, 'Cache-Control': 'no-store' });
    res.end(PIXEL);
    return { __raw: true };
  });

  // click tracking + redirect
  router.get('/t/c/:id', async (req, res, { params, query }) => {
    const id = Number(params.id);
    if (id) run('UPDATE emails SET clicks = clicks + 1 WHERE id=?', id);
    const target = query.u || '/';
    res.writeHead(302, { Location: target });
    res.end();
    return { __raw: true };
  });

  // documents
  router.get('/public/documents/:token', async (req, res, { params }) => {
    const doc = publicDocument(params.token);
    if (!doc) throw notFound('Document not found');
    sendText(res, 200, documentHtml(doc), 'text/html; charset=utf-8');
    return { __raw: true };
  });

  router.post('/public/documents/:token/sign', async (req, res, { params }) => {
    const raw = (await readBody(req)).toString('utf8');
    const name = new URLSearchParams(raw).get('name');
    if (!name) throw badRequest('Signature name required');
    const doc = signDocument(params.token, name);
    sendText(res, 200, documentHtml(doc), 'text/html; charset=utf-8');
    return { __raw: true };
  });

  // marketing unsubscribe
  router.get('/public/unsubscribe/:personId/:campaignId/:token', async (req, res, { params }) => {
    unsubscribe(Number(params.personId), Number(params.campaignId), params.token);
    sendText(res, 200,
      '<!doctype html><meta charset="utf-8"><title>Unsubscribed</title>' +
      '<div style="font:15px system-ui;max-width:520px;margin:80px auto;text-align:center">' +
      '<h1>You have been unsubscribed</h1><p>You will not receive further marketing email from us.</p></div>',
      'text/html; charset=utf-8');
    return { __raw: true };
  });

  // public read-only dashboard
  router.get('/public/dashboards/:token', async (req, res, { params }) => {
    const d = get('SELECT * FROM dashboards WHERE public_token=?', params.token);
    if (!d) throw notFound('Dashboard not found');
    const ctx = systemContext('public-dashboard');
    const tiles = json(d.layout, []).map((tile) => {
      try {
        if (tile.type === 'goal') {
          const goal = get('SELECT * FROM goals WHERE id=?', tile.goal_id);
          return { ...tile, data: goal ? goalProgress(ctx, goal) : null };
        }
        const report = get('SELECT * FROM reports WHERE id=?', tile.report_id);
        return { ...tile, name: report?.name, data: report ? runReport(ctx, json(report.config, {})) : null };
      } catch (err) {
        return { ...tile, error: err.message };
      }
    });
    sendJson(res, 200, { name: d.name, tiles, read_only: true });
    return { __raw: true };
  });

  // web form embed + submission
  router.get('/public/forms/:token', async (req, res, { params }) => {
    const form = get('SELECT * FROM web_forms WHERE token=? AND active=1', params.token);
    if (!form) throw notFound('Form not found');
    const fields = json(form.fields, []);
    const inputs = fields.map((f) =>
      `<label>${escapeHtml(f.label)}${f.required ? ' *' : ''}<br><input name="${escapeHtml(f.key)}" ${f.required ? 'required' : ''}></label>`).join('');
    sendText(res, 200,
      `<!doctype html><meta charset="utf-8"><title>${escapeHtml(form.name)}</title>
       <style>body{font:15px system-ui;max-width:460px;margin:60px auto}label{display:block;margin:12px 0}
       input{width:100%;padding:9px;border:1px solid #c9cdd6;border-radius:6px;margin-top:4px}
       button{margin-top:16px;padding:10px 18px;border:0;background:#1f6feb;color:#fff;border-radius:6px}</style>
       <h1>${escapeHtml(form.name)}</h1>
       <form method="POST" action="/public/forms/${form.token}">${inputs}<button>Submit</button></form>`,
      'text/html; charset=utf-8');
    return { __raw: true };
  });

  router.post('/public/forms/:token', async (req, res, { params }) => {
    const form = get('SELECT * FROM web_forms WHERE token=? AND active=1', params.token);
    if (!form) throw notFound('Form not found');
    const raw = (await readBody(req, 256 * 1024)).toString('utf8');
    const data = Object.fromEntries(new URLSearchParams(raw));
    const ctx = systemContext('web-form');
    ctx.user = get('SELECT * FROM users WHERE id=?', form.owner_id) || ctx.user;

    let person = null;
    if (data.email) {
      person = get('SELECT * FROM persons WHERE deleted=0 AND emails LIKE ?', `%${data.email}%`);
      if (!person) {
        person = createRecord('person', ctx, {
          name: data.name || data.email,
          emails: [{ label: 'work', value: data.email, primary: true }],
          owner_id: form.owner_id,
        }, { skipPerms: true, source: 'web_form', ignoreUnknown: true });
      }
    }
    let org = null;
    if (data.company) {
      org = get('SELECT * FROM organizations WHERE deleted=0 AND lower(name)=lower(?)', data.company)
        || createRecord('organization', ctx, { name: data.company, owner_id: form.owner_id }, { skipPerms: true, source: 'web_form' });
      if (person && !person.org_id) run('UPDATE persons SET org_id=? WHERE id=?', org.id, person.id);
    }
    const payload = {
      title: data.name ? `${data.name}${org ? ` — ${org.name}` : ''}` : `Web form ${form.name}`,
      person_id: person?.id ?? null, org_id: org?.id ?? null,
      owner_id: form.owner_id, source: `Web form: ${form.name}`,
      value: data.value ? Number(data.value) : 0,
    };
    const record = form.target === 'deal'
      ? createRecord('deal', ctx, { ...payload, pipeline_id: form.pipeline_id || undefined }, { skipPerms: true, source: 'web_form', ignoreUnknown: true })
      : createRecord('lead', ctx, payload, { skipPerms: true, source: 'web_form', ignoreUnknown: true });
    if (data.message) {
      insert('notes', { entity: form.target, entity_id: record.id, content: data.message, user_id: form.owner_id });
    }
    run('UPDATE web_forms SET submissions = submissions + 1 WHERE id=?', form.id);
    sendText(res, 200,
      '<!doctype html><meta charset="utf-8"><title>Thanks</title>' +
      '<div style="font:15px system-ui;max-width:520px;margin:80px auto;text-align:center">' +
      '<h1>Thank you</h1><p>We have received your details and will be in touch.</p></div>',
      'text/html; charset=utf-8');
    return { __raw: true };
  });

  router.get('/public/health', async (req, res) => {
    sendJson(res, 200, { ok: true, time: nowIso(), company: setting('company_name', 'CRM') });
    return { __raw: true };
  });
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
