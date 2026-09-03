// Filter builder UI for any entity. Conditions shape: { match: 'all'|'any', rules: [{ field, op, value }] }
import { el, clear } from '../lib/dom.js';
import { state } from '../lib/api.js';
import { modal } from '../lib/ui.js';

const OP_LABELS = {
  eq: 'is', neq: 'is not', contains: 'contains', not_contains: 'does not contain',
  starts_with: 'starts with', is_empty: 'is empty', is_not_empty: 'is not empty',
  gt: 'greater than', gte: 'at least', lt: 'less than', lte: 'at most',
  between: 'between', in: 'is any of', not_in: 'is none of',
  after: 'after', before: 'before', relative: 'is in',
  has: 'includes', not_has: 'does not include',
};

const OP_BY_TYPE = {
  text: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'],
  textarea: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  monetary: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  date: ['eq', 'neq', 'after', 'before', 'between', 'relative', 'is_empty', 'is_not_empty'],
  datetime: ['after', 'before', 'relative', 'is_empty', 'is_not_empty'],
  time: ['eq', 'after', 'before'],
  boolean: ['eq'],
  select: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  user: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  person: ['eq', 'neq', 'in', 'is_empty', 'is_not_empty'],
  organization: ['eq', 'neq', 'in', 'is_empty', 'is_not_empty'],
  deal: ['eq', 'neq', 'is_empty', 'is_not_empty'],
  lead: ['eq', 'neq', 'is_empty', 'is_not_empty'],
  project: ['eq', 'neq', 'is_empty', 'is_not_empty'],
  pipeline: ['eq', 'neq', 'in', 'not_in'],
  stage: ['eq', 'neq', 'in', 'not_in'],
  currency: ['eq', 'neq', 'in'],
  visibility: ['eq', 'neq'],
  activity_type: ['eq', 'neq', 'in', 'not_in'],
  lost_reason: ['eq', 'neq', 'is_empty', 'is_not_empty'],
  tax: ['eq', 'neq'],
  board: ['eq', 'neq', 'in'],
  phase: ['eq', 'neq', 'in'],
  emails: ['contains', 'is_empty', 'is_not_empty'],
  phones: ['contains', 'is_empty', 'is_not_empty'],
  labels: ['has', 'not_has', 'is_empty', 'is_not_empty'],
};

const RELATIVE = ['today', 'yesterday', 'tomorrow', 'this_week', 'last_week', 'next_week', 'this_month', 'last_month', 'next_month', 'this_quarter', 'this_year', 'last_7_days', 'last_30_days', 'last_90_days', 'next_7_days', 'next_30_days', 'overdue'];

export function renderFilter(entityKey, current, onApply) {
  const e = state.meta?.entities.find((x) => x.key === entityKey);
  if (!e) return el('div', {}, ['Unknown entity']);
  const fields = e.fields;
  const customFields = (state.ref?.custom_fields || []).filter((f) => f.entity === entityKey);
  const allFields = [...fields, ...customFields.map((f) => ({ key: f.key, label: f.name, type: f.type }))];
  const cfg = current || { match: 'all', rules: [] };

  const wrap = el('div', {});
  const matchSel = el('select', {}, [
    el('option', { value: 'all', selected: cfg.match === 'all' }, ['Match ALL of the rules']),
    el('option', { value: 'any', selected: cfg.match === 'any' }, ['Match ANY of the rules']),
  ]);
  const rulesEl = el('div', { class: 'rules' });

  function renderRule(rule, idx) {
    const r = el('div', { class: 'rule' });
    const fieldSel = el('select', {}, allFields.map((f) => el('option', { value: f.key, selected: f.key === rule.field }, [f.label])));
    const opSel = el('select', {});
    const fld = allFields.find((f) => f.key === rule.field) || allFields[0];
    const ops = OP_BY_TYPE[fld.type] || OP_BY_TYPE.text;
    for (const op of ops) opSel.appendChild(el('option', { value: op, selected: op === rule.op }, [OP_LABELS[op] || op]));
    const valInput = el('input', { type: 'text', value: rule.value || '' });
    fieldSel.addEventListener('change', () => {
      rule.field = fieldSel.value;
      const newType = allFields.find((f) => f.key === rule.field).type;
      clear(opSel);
      for (const op of (OP_BY_TYPE[newType] || OP_BY_TYPE.text)) opSel.appendChild(el('option', { value: op, selected: op === rule.op }, [OP_LABELS[op] || op]));
      if (newType === 'date' || newType === 'datetime') valInput.type = 'date';
      else if (newType === 'number' || newType === 'monetary') valInput.type = 'number';
      else valInput.type = 'text';
    });
    opSel.addEventListener('change', () => { rule.op = opSel.value; });
    valInput.addEventListener('input', () => { rule.value = valInput.value; });
    const del = el('button', { class: 'btn sm ghost', onClick: () => { cfg.rules.splice(idx, 1); renderRules(); } }, ['✕']);
    r.append(fieldSel, opSel, valInput, del);
    return r;
  }
  function renderRules() {
    clear(rulesEl);
    if (!cfg.rules.length) rulesEl.appendChild(el('div', { class: 'muted' }, ['No rules. Add one below.']));
    cfg.rules.forEach((r, i) => rulesEl.appendChild(renderRule(r, i)));
  }
  renderRules();
  const addBtn = el('button', { class: 'btn sm', onClick: () => { cfg.rules.push({ field: allFields[0].key, op: 'eq', value: '' }); renderRules(); } }, ['＋ Add rule']);
  const apply = el('button', { class: 'btn primary', onClick: () => { cfg.match = matchSel.value; onApply({ ...cfg, rules: cfg.rules.filter((r) => r.field) }); } }, ['Apply']);
  const clearBtn = el('button', { class: 'btn ghost', onClick: () => onApply(null) }, ['Clear']);
  wrap.append(
    el('div', { class: 'inline', style: { marginBottom: '8px' } }, [matchSel, addBtn, el('div', { class: 'spacer', style: { flex: '1' } }), clearBtn, apply]),
    rulesEl,
  );
  return wrap;
}
