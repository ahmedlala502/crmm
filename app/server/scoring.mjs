import { get, setting } from './db.mjs';

export const DEFAULT_SCORING = {
  enabled: true,
  weights: {
    value: 30,            // deal/lead value relative to the configured benchmark
    stage_progress: 20,   // how far through the pipeline
    activity_recency: 20, // recent logged activity
    next_step: 15,        // has a scheduled next activity
    engagement: 10,       // inbound email replies
    data_completeness: 5, // contact + org + close date present
  },
  value_benchmark: 50000,
  stale_days: 14,
};

export function scoringConfig() {
  const cfg = setting('deal_scoring', null);
  return { ...DEFAULT_SCORING, ...(cfg || {}), weights: { ...DEFAULT_SCORING.weights, ...(cfg?.weights || {}) } };
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const daysSince = (ts) => (ts ? (Date.now() - new Date(ts.replace(' ', 'T') + 'Z').getTime()) / 864e5 : null);

export function scoreDeal(deal) {
  const cfg = scoringConfig();
  if (!cfg.enabled) return 0;
  const w = cfg.weights;
  let score = 0;

  score += w.value * clamp01((deal.value || 0) / (cfg.value_benchmark || 1));

  const stage = deal.stage_id ? get('SELECT probability, order_idx, pipeline_id FROM stages WHERE id=?', deal.stage_id) : null;
  if (stage) {
    const total = get('SELECT COUNT(*) n FROM stages WHERE pipeline_id=?', stage.pipeline_id).n || 1;
    score += w.stage_progress * clamp01((stage.order_idx + 1) / total);
  }

  const lastDone = get(
    "SELECT done_time FROM activities WHERE deal_id=? AND done=1 AND deleted=0 ORDER BY done_time DESC LIMIT 1",
    deal.id,
  );
  const dsince = daysSince(lastDone?.done_time);
  if (dsince !== null) score += w.activity_recency * clamp01(1 - dsince / (cfg.stale_days || 14));

  const next = get(
    "SELECT id FROM activities WHERE deal_id=? AND done=0 AND deleted=0 AND due_date IS NOT NULL LIMIT 1",
    deal.id,
  );
  if (next) score += w.next_step;

  const replies = get(
    "SELECT COUNT(*) n FROM emails e JOIN email_threads th ON th.id=e.thread_id WHERE th.deal_id=? AND e.direction='in'",
    deal.id,
  ).n;
  score += w.engagement * clamp01(replies / 3);

  let complete = 0;
  if (deal.person_id) complete++;
  if (deal.org_id) complete++;
  if (deal.expected_close_date) complete++;
  score += w.data_completeness * (complete / 3);

  return Math.round(score);
}

export function scoreLead(lead) {
  const cfg = scoringConfig();
  if (!cfg.enabled) return 0;
  const w = cfg.weights;
  let score = 0;
  score += w.value * clamp01((lead.value || 0) / (cfg.value_benchmark || 1));
  const lastDone = get(
    "SELECT done_time FROM activities WHERE lead_id=? AND done=1 AND deleted=0 ORDER BY done_time DESC LIMIT 1",
    lead.id,
  );
  const dsince = daysSince(lastDone?.done_time);
  if (dsince !== null) score += w.activity_recency * clamp01(1 - dsince / (cfg.stale_days || 14));
  const next = get("SELECT id FROM activities WHERE lead_id=? AND done=0 AND deleted=0 LIMIT 1", lead.id);
  if (next) score += w.next_step;
  let complete = 0;
  if (lead.person_id) complete++;
  if (lead.org_id) complete++;
  if (lead.source) complete++;
  score += (w.data_completeness + w.stage_progress) * (complete / 3);
  const replies = get(
    "SELECT COUNT(*) n FROM emails e JOIN email_threads th ON th.id=e.thread_id WHERE th.lead_id=? AND e.direction='in'",
    lead.id,
  ).n;
  score += w.engagement * clamp01(replies / 3);
  return Math.round(score);
}

/** Why a record scored what it did — surfaced in the Pulse UI. */
export function explainScore(entityKey, row) {
  const cfg = scoringConfig();
  const reasons = [];
  if ((row.value || 0) >= cfg.value_benchmark) reasons.push('High value versus benchmark');
  const col = entityKey === 'deal' ? 'deal_id' : 'lead_id';
  const next = get(`SELECT id, due_date FROM activities WHERE ${col}=? AND done=0 AND deleted=0 ORDER BY due_date LIMIT 1`, row.id);
  if (!next) reasons.push('No next activity scheduled');
  else if (next.due_date < new Date().toISOString().slice(0, 10)) reasons.push('Next activity is overdue');
  if (!row.person_id) reasons.push('No contact person linked');
  if (entityKey === 'deal' && !row.expected_close_date) reasons.push('No expected close date');
  const last = get(`SELECT done_time FROM activities WHERE ${col}=? AND done=1 AND deleted=0 ORDER BY done_time DESC LIMIT 1`, row.id);
  const ds = daysSince(last?.done_time);
  if (ds === null) reasons.push('No activity has been completed yet');
  else if (ds > cfg.stale_days) reasons.push(`No contact for ${Math.round(ds)} days`);
  return reasons;
}
