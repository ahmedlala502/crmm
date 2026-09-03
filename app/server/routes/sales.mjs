import { all, get, insert, update, run, json, tx, nowIso } from '../db.mjs';
import { queryEntity, hydrate, activitySummary, activityState } from '../query.mjs';
import { createRecord, updateRecord, getRecord, systemContext } from '../records.mjs';
import { assertCan, can, canSeePipeline, visibilityClause } from '../rbac.mjs';
import { badRequest, notFound, toInt, toBool } from '../http.mjs';
import { audit } from '../audit.mjs';
import { emit } from '../events.mjs';
import { forecast } from '../engines/reports.mjs';
import { explainScore } from '../scoring.mjs';
import { enrollmentsFor } from '../engines/sequences.mjs';

export function registerSalesRoutes(router) {
  // ---------- pipeline board ----------
  router.get('/api/pipeline/:pipelineId/board', async (req, res, { ctx, params, query }) => {
    const pipelineId = Number(params.pipelineId);
    if (!canSeePipeline(ctx, pipelineId)) throw notFound('Pipeline not visible');
    const pipeline = get('SELECT * FROM pipelines WHERE id=?', pipelineId);
    if (!pipeline) throw notFound('Pipeline not found');
    const stages = all('SELECT * FROM stages WHERE pipeline_id=? ORDER BY order_idx', pipelineId);

    const conditions = query.conditions ? JSON.parse(query.conditions) : null;
    const scopeParts = ['t.pipeline_id = ?', 't.archived = 0', "t.status = 'open'"];
    const scopeParams = [pipelineId];
    if (query.owner_id) { scopeParts.push('t.owner_id = ?'); scopeParams.push(Number(query.owner_id)); }
    if (toBool(query.include_closed)) scopeParts[2] = '1=1';

    const result = queryEntity('deal', ctx, {
      conditions,
      search: query.search || '',
      scope: { sql: scopeParts.join(' AND '), params: scopeParams },
      limit: 2000,
      sort: { field: 'stage_changed_at', dir: 'desc' },
    });
    const deals = hydrate('deal', result.rows);
    const byStage = {};
    for (const s of stages) byStage[s.id] = [];
    for (const d of deals) (byStage[d.stage_id] ||= []).push(d);

    return {
      pipeline,
      stages: stages.map((s) => {
        const list = byStage[s.id] || [];
        return {
          ...s,
          deals: list,
          count: list.length,
          total_value: list.reduce((sum, d) => sum + (d.value || 0), 0),
          weighted_value: list.reduce((sum, d) => sum + (d.weighted_value || 0), 0),
          rotten: list.filter((d) => s.rotten_days && daysSince(d.stage_changed_at) > s.rotten_days).length,
        };
      }),
      totals: {
        count: deals.length,
        value: deals.reduce((s, d) => s + (d.value || 0), 0),
        weighted: deals.reduce((s, d) => s + (d.weighted_value || 0), 0),
      },
    };
  });

  router.post('/api/deals/:id/move', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'deals.edit');
    const deal = updateRecord('deal', ctx, Number(params.id), { stage_id: Number(body.stage_id) });
    return hydrate('deal', [deal])[0];
  });

  router.post('/api/deals/:id/status', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'deals.edit');
    const status = body.status;
    if (!['open', 'won', 'lost'].includes(status)) throw badRequest('status must be open, won or lost');
    const patch = { status };
    if (status === 'lost') {
      patch.lost_reason_id = body.lost_reason_id ? Number(body.lost_reason_id) : null;
      patch.lost_comment = body.lost_comment || null;
    }
    const deal = updateRecord('deal', ctx, Number(params.id), patch, { allowSystemFields: true });
    return hydrate('deal', [deal])[0];
  });

  router.get('/api/deals/:id/score', async (req, res, { ctx, params }) => {
    const deal = getRecord('deal', ctx, Number(params.id));
    return { score: deal.score, factors: explainScore('deal', deal) };
  });

  // ---------- deal products ----------
  router.get('/api/deals/:id/products', async (req, res, { ctx, params }) => {
    getRecord('deal', ctx, Number(params.id));
    return all('SELECT * FROM deal_products WHERE deal_id=? ORDER BY id', Number(params.id));
  });

  router.post('/api/deals/:id/products', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'deals.edit');
    const deal = getRecord('deal', ctx, Number(params.id));
    const product = body.product_id ? get('SELECT * FROM products WHERE id=?', body.product_id) : null;
    const price = body.price ?? (product ? get('SELECT price FROM product_prices WHERE product_id=? AND currency=?', product.id, deal.currency)?.price ?? 0 : 0);
    const id = insert('deal_products', {
      deal_id: deal.id,
      product_id: product?.id ?? null,
      name: body.name || product?.name || 'Item',
      quantity: Number(body.quantity ?? 1),
      price: Number(price),
      discount: Number(body.discount ?? 0),
      discount_type: body.discount_type || 'percentage',
      tax: Number(body.tax ?? (product?.tax_id ? get('SELECT percentage FROM taxes WHERE id=?', product.tax_id)?.percentage ?? 0 : 0)),
      currency: deal.currency,
      billing_frequency: body.billing_frequency || product?.billing_frequency || 'one-time',
      billing_cycles: body.billing_cycles ?? product?.billing_cycles ?? null,
      billing_start_date: body.billing_start_date || null,
      comments: body.comments || null,
    });
    syncDealValue(ctx, deal.id, body.sync_value !== false);
    audit({ ctx, entity: 'deal', entityId: deal.id, action: 'product_added', changes: { product: body.name || product?.name } });
    return get('SELECT * FROM deal_products WHERE id=?', id);
  });

  router.patch('/api/deal-products/:id', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'deals.edit');
    const dp = get('SELECT * FROM deal_products WHERE id=?', params.id);
    if (!dp) throw notFound('Deal product not found');
    getRecord('deal', ctx, dp.deal_id);
    update('deal_products', dp.id, {
      name: body.name, quantity: body.quantity, price: body.price,
      discount: body.discount, discount_type: body.discount_type, tax: body.tax,
      billing_frequency: body.billing_frequency, billing_cycles: body.billing_cycles,
      billing_start_date: body.billing_start_date, comments: body.comments,
    });
    syncDealValue(ctx, dp.deal_id, body.sync_value !== false);
    return get('SELECT * FROM deal_products WHERE id=?', dp.id);
  });

  router.delete('/api/deal-products/:id', async (req, res, { ctx, params }) => {
    assertCan(ctx, 'deals.edit');
    const dp = get('SELECT * FROM deal_products WHERE id=?', params.id);
    if (!dp) throw notFound('Deal product not found');
    getRecord('deal', ctx, dp.deal_id);
    run('DELETE FROM deal_products WHERE id=?', dp.id);
    syncDealValue(ctx, dp.deal_id, true);
    return { ok: true };
  });

  // ---------- product catalogue prices ----------
  router.put('/api/products/:id/prices', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'products.edit');
    const productId = Number(params.id);
    if (!get('SELECT id FROM products WHERE id=?', productId)) throw notFound('Product not found');
    tx(() => {
      run('DELETE FROM product_prices WHERE product_id=?', productId);
      for (const p of body.prices || []) {
        insert('product_prices', { product_id: productId, currency: p.currency, price: Number(p.price || 0), cost: Number(p.cost || 0) });
      }
    });
    return all('SELECT * FROM product_prices WHERE product_id=?', productId);
  });

  router.get('/api/products/:id/deals', async (req, res, { ctx, params }) => {
    const rows = all(
      `SELECT d.id, d.title, d.value, d.currency, d.status, dp.quantity, dp.price
       FROM deal_products dp JOIN deals d ON d.id = dp.deal_id
       WHERE dp.product_id=? AND d.deleted=0 ORDER BY d.id DESC LIMIT 100`, Number(params.id),
    );
    return rows;
  });

  router.get('/api/revenue/summary', async (req, res, { ctx }) => {
    const recurring = all(
      `SELECT dp.billing_frequency, COALESCE(SUM(dp.quantity * dp.price * (1 - CASE WHEN dp.discount_type='percentage' THEN dp.discount/100.0 ELSE 0 END)),0) AS amount
       FROM deal_products dp JOIN deals d ON d.id=dp.deal_id
       WHERE d.deleted=0 AND d.status='won' AND dp.billing_frequency <> 'one-time'
       GROUP BY dp.billing_frequency`,
    );
    const perMonth = { weekly: 4.345, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
    const mrr = recurring.reduce((s, r) => s + r.amount * (perMonth[r.billing_frequency] ?? 0), 0);
    const oneTime = get(
      `SELECT COALESCE(SUM(dp.quantity * dp.price),0) v FROM deal_products dp JOIN deals d ON d.id=dp.deal_id
       WHERE d.deleted=0 AND d.status='won' AND dp.billing_frequency='one-time'`,
    ).v;
    const wonDeals = get("SELECT COUNT(*) n, COALESCE(SUM(value),0) v FROM deals WHERE deleted=0 AND status='won'");
    return {
      mrr: Math.round(mrr),
      arr: Math.round(mrr * 12),
      one_time_revenue: Math.round(oneTime),
      acv: wonDeals.n ? Math.round((mrr * 12 + oneTime) / wonDeals.n) : 0,
      tcv: Math.round(wonDeals.v),
      won_deals: wonDeals.n,
      by_frequency: recurring,
    };
  });

  router.get('/api/forecast', async (req, res, { ctx, query }) =>
    forecast(ctx, { pipelineId: query.pipeline_id ? Number(query.pipeline_id) : null, months: toInt(query.months, 6) }));

  // ---------- lead conversion ----------
  router.post('/api/leads/:id/convert', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'leads.convert');
    assertCan(ctx, 'deals.create');
    const lead = getRecord('lead', ctx, Number(params.id));
    if (lead.status === 'converted') throw badRequest('Lead was already converted');
    const deal = tx(() => {
      const created = createRecord('deal', ctx, {
        title: body.title || lead.title,
        pipeline_id: body.pipeline_id ? Number(body.pipeline_id) : undefined,
        stage_id: body.stage_id ? Number(body.stage_id) : undefined,
        owner_id: lead.owner_id,
        person_id: lead.person_id,
        org_id: lead.org_id,
        value: lead.value,
        currency: lead.currency,
        source: lead.source,
        label_ids: json(lead.label_ids, []),
        expected_close_date: lead.expected_close_date,
        origin_lead_id: lead.id,
        cf: json(lead.cf, {}),
      }, { ignoreUnknown: true, allowSystemFields: true });
      update('leads', lead.id, { status: 'converted', converted_deal_id: created.id, updated_at: nowIso() });
      run('UPDATE activities SET deal_id=? WHERE lead_id=?', created.id, lead.id);
      run('UPDATE email_threads SET deal_id=? WHERE lead_id=?', created.id, lead.id);
      run("UPDATE notes SET entity='deal', entity_id=? WHERE entity='lead' AND entity_id=?", created.id, lead.id);
      audit({ ctx, entity: 'lead', entityId: lead.id, action: 'converted', changes: { deal_id: created.id } });
      return created;
    });
    emit('lead.converted', { entity: 'lead', id: lead.id, record: get('SELECT * FROM leads WHERE id=?', lead.id), depth: 0, actor: ctx.user });
    return hydrate('deal', [deal])[0];
  });

  router.post('/api/leads/:id/archive-lead', async (req, res, { ctx, params, body }) => {
    assertCan(ctx, 'leads.edit');
    const lead = getRecord('lead', ctx, Number(params.id));
    update('leads', lead.id, {
      status: body.status === 'junk' ? 'junk' : 'archived',
      archive_reason: body.reason || null, updated_at: nowIso(),
    });
    audit({ ctx, entity: 'lead', entityId: lead.id, action: 'archived', changes: { reason: body.reason } });
    return get('SELECT * FROM leads WHERE id=?', lead.id);
  });

  router.post('/api/leads/:id/reopen', async (req, res, { ctx, params }) => {
    assertCan(ctx, 'leads.edit');
    const lead = getRecord('lead', ctx, Number(params.id));
    update('leads', lead.id, { status: 'open', archive_reason: null, updated_at: nowIso() });
    return get('SELECT * FROM leads WHERE id=?', lead.id);
  });

  // ---------- pulse ----------
  router.get('/api/pulse', async (req, res, { ctx, query }) => {
    const today = new Date().toISOString().slice(0, 10);
    const mine = toBool(query.mine, true) ? ctx.user.id : null;
    const v = visibilityClause(ctx, 't');

    const overdue = hydrate('activity', all(
      `SELECT * FROM activities t WHERE deleted=0 AND done=0 AND due_date < ?
       ${mine ? 'AND assignee_id = ?' : ''} ORDER BY due_date LIMIT 50`,
      today, ...(mine ? [mine] : []),
    ), { withActivity: false });

    const dueToday = hydrate('activity', all(
      `SELECT * FROM activities t WHERE deleted=0 AND done=0 AND due_date = ?
       ${mine ? 'AND assignee_id = ?' : ''} ORDER BY COALESCE(due_time,'23:59') LIMIT 50`,
      today, ...(mine ? [mine] : []),
    ), { withActivity: false });

    const noNextStep = hydrate('deal', all(
      `SELECT t.* FROM deals t WHERE t.deleted=0 AND t.status='open' AND t.archived=0
        AND ${v.sql} ${mine ? 'AND t.owner_id = ?' : ''}
        AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.deal_id=t.id AND a.done=0 AND a.deleted=0)
       ORDER BY t.score DESC, t.value DESC LIMIT 25`,
      ...v.params, ...(mine ? [mine] : []),
    ));

    const hotDeals = hydrate('deal', all(
      `SELECT t.* FROM deals t WHERE t.deleted=0 AND t.status='open' AND t.archived=0 AND ${v.sql}
       ${mine ? 'AND t.owner_id = ?' : ''} ORDER BY t.score DESC LIMIT 10`,
      ...v.params, ...(mine ? [mine] : []),
    )).map((d) => ({ ...d, score_factors: explainScore('deal', d) }));

    const hotLeads = hydrate('lead', all(
      `SELECT t.* FROM leads t WHERE t.deleted=0 AND t.status='open' AND ${v.sql}
       ${mine ? 'AND t.owner_id = ?' : ''} ORDER BY t.score DESC LIMIT 10`,
      ...v.params, ...(mine ? [mine] : []),
    ));

    const missingData = all(
      `SELECT t.id, t.title, 'deal' AS entity,
        CASE WHEN t.person_id IS NULL THEN 'No contact person'
             WHEN t.expected_close_date IS NULL THEN 'No expected close date'
             WHEN t.value = 0 THEN 'No value set' END AS issue
       FROM deals t WHERE t.deleted=0 AND t.status='open' AND ${v.sql}
        AND (t.person_id IS NULL OR t.expected_close_date IS NULL OR t.value = 0)
       ${mine ? 'AND t.owner_id = ?' : ''} LIMIT 25`,
      ...v.params, ...(mine ? [mine] : []),
    );

    const rotten = hydrate('deal', all(
      `SELECT t.* FROM deals t JOIN stages s ON s.id=t.stage_id
       WHERE t.deleted=0 AND t.status='open' AND t.archived=0 AND s.rotten_days IS NOT NULL
         AND julianday('now') - julianday(t.stage_changed_at) > s.rotten_days AND ${v.sql}
       ${mine ? 'AND t.owner_id = ?' : ''} ORDER BY t.stage_changed_at LIMIT 20`,
      ...v.params, ...(mine ? [mine] : []),
    ));

    const sequences = all(
      `SELECT se.*, s.name AS sequence_name FROM sequence_enrollments se JOIN sequences s ON s.id=se.sequence_id
       WHERE se.status='active' ORDER BY se.next_run_at LIMIT 20`,
    );

    return {
      counts: {
        overdue: overdue.length,
        today: dueToday.length,
        no_next_step: noNextStep.length,
        rotten: rotten.length,
      },
      overdue, due_today: dueToday, no_next_step: noNextStep,
      hot_deals: hotDeals, hot_leads: hotLeads, missing_data: missingData,
      rotten, active_sequences: sequences,
    };
  });

  router.get('/api/dashboard/summary', async (req, res, { ctx }) => {
    const v = visibilityClause(ctx, 't');
    const open = get(`SELECT COUNT(*) n, COALESCE(SUM(t.value),0) v FROM deals t WHERE t.deleted=0 AND t.status='open' AND ${v.sql}`, ...v.params);
    const won = get(`SELECT COUNT(*) n, COALESCE(SUM(t.value),0) v FROM deals t WHERE t.deleted=0 AND t.status='won' AND t.won_time >= date('now','start of month') AND ${v.sql}`, ...v.params);
    const lost = get(`SELECT COUNT(*) n FROM deals t WHERE t.deleted=0 AND t.status='lost' AND t.lost_time >= date('now','start of month') AND ${v.sql}`, ...v.params);
    const leads = get(`SELECT COUNT(*) n FROM leads t WHERE t.deleted=0 AND t.status='open' AND ${v.sql}`, ...v.params);
    const activitiesToday = get("SELECT COUNT(*) n FROM activities WHERE deleted=0 AND done=0 AND due_date = date('now')");
    return {
      open_deals: open.n, open_value: open.v,
      won_this_month: won.n, won_value_this_month: won.v,
      lost_this_month: lost.n,
      win_rate: (won.n + lost.n) ? Math.round((won.n / (won.n + lost.n)) * 100) : 0,
      open_leads: leads.n,
      activities_today: activitiesToday.n,
    };
  });
}

function daysSince(ts) {
  if (!ts) return 0;
  return (Date.now() - new Date(String(ts).replace(' ', 'T') + 'Z').getTime()) / 864e5;
}

/** Keeps deal.value in sync with attached products (Pipedrive behaviour). */
function syncDealValue(ctx, dealId, enabled) {
  if (!enabled) return;
  const items = all('SELECT * FROM deal_products WHERE deal_id=?', dealId);
  const total = items.reduce((sum, i) => {
    const gross = i.quantity * i.price;
    const disc = i.discount_type === 'percentage' ? gross * (i.discount / 100) : i.discount;
    const net = gross - disc;
    return sum + net + net * (i.tax / 100);
  }, 0);
  updateRecord('deal', ctx, dealId, { value: Math.round(total * 100) / 100 }, { skipPerms: true, source: 'products' });
}
