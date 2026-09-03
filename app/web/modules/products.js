// Products — catalog list, price editor per currency, linked deals, revenue summary.
import { el, clear } from '../lib/dom.js';
import { listView } from './list.js';
import { api, state, can, defaultCurrency } from '../lib/api.js';
import { modal, toast, apiAction, money, fmtDate } from '../lib/ui.js';
import { go } from '../lib/router.js';

export function renderProducts(params = {}) {
  const wrap = el('div', {});

  // revenue strip
  const revBar = el('div', { class: 'cards cols-4', style: { marginBottom: '12px' } });
  api.get('/api/revenue/summary').then((s) => {
    clear(revBar);
    revBar.append(
      stat('MRR', money(s.mrr), 'Recurring monthly'),
      stat('ARR', money(s.arr), 'Recurring annualised'),
      stat('ACV', money(s.acv), 'Avg contract value'),
      stat('TCV', money(s.tcv), 'Total contract value'),
    );
  }).catch(() => {});

  const list = listView('product', { title: 'Products', allowCreate: true, allowImport: true });
  wrap.append(revBar, list);
  return wrap;
}

function stat(k, v, sub) {
  return el('div', { class: 'card stat' }, [
    el('div', { class: 'k' }, [k]),
    el('div', { class: 'v' }, [String(v)]),
    el('div', { class: 'sub' }, [sub]),
  ]);
}

// ---- product detail drawer used via the list; prices + linked deals panels ----
export function renderProductExtras(productId, reload) {
  const wrap = el('div', {});
  const pricesCard = el('div', { class: 'card pad', style: { marginBottom: '10px' } }, [
    el('h3', { style: { marginBottom: '6px' } }, ['Prices per currency']),
    el('div', { class: 'loading' }, ['Loading…']),
  ]);
  const dealsCard = el('div', { class: 'card pad' }, [
    el('h3', { style: { marginBottom: '6px' } }, ['Attached to deals']),
    el('div', { class: 'loading' }, ['Loading…']),
  ]);
  load();
  async function load() {
    try {
      const prices = await api.get(`/api/products/${productId}/prices`).catch(() => []);
      const table = el('table', { class: 'grid' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['Currency']), el('th', { class: 'num' }, ['Price']), el('th', { class: 'num' }, ['Cost'])])]),
        el('tbody', {}, (Array.isArray(prices) ? prices : (prices.prices || [])).map((p) => el('tr', {}, [
          el('td', {}, [p.currency]),
          el('td', { class: 'num' }, [String(p.price)]),
          el('td', { class: 'num' }, [p.cost == null ? '—' : String(p.cost)]),
        ]))),
      ]);
      clear(pricesCard);
      pricesCard.append(
        el('h3', { style: { marginBottom: '6px' } }, ['Prices per currency']),
        table,
        el('button', { class: 'btn sm', style: { marginTop: '8px' }, onClick: () => editPrices(productId, load) }, ['✎ Edit prices']),
      );
      const deals = await api.get(`/api/products/${productId}/deals`);
      clear(dealsCard);
      const list = el('div', { class: 'sidelist', style: { border: '0' } });
      for (const d of deals) {
        list.appendChild(el('div', { class: 'item' }, [
          el('a', { class: 'cell-link', href: `#/deals/${d.id}` }, [d.title]),
          el('div', { class: 'muted', style: { fontSize: '11px' } }, [`${d.quantity} × ${d.price} ${d.currency} · ${d.status}`]),
        ]));
      }
      if (!deals.length) list.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, ['Not attached to any deal yet.'])]));
      dealsCard.append(el('h3', { style: { marginBottom: '6px' } }, ['Attached to deals']), list);
    } catch (err) {
      clear(pricesCard); pricesCard.appendChild(el('div', { class: 'muted' }, [err.message]));
      clear(dealsCard);
    }
  }
  wrap.append(pricesCard, dealsCard);
  return wrap;
}

async function editPrices(productId, done) {
  let current = [];
  try { current = await api.get(`/api/products/${productId}/prices`).catch(() => []); current = Array.isArray(current) ? current : (current.prices || []); } catch {}
  const rows = el('div', {});
  function addRow(p = {}) {
    const currency = el('select', {}, (state.ref?.currencies || []).map((c) => el('option', { value: c.code, selected: p.currency === c.code }, [c.code])));
    const price = el('input', { type: 'number', step: '0.01', value: p.price ?? 0, style: { width: '120px' } });
    const cost = el('input', { type: 'number', step: '0.01', value: p.cost ?? '', style: { width: '120px' } });
    const rm = el('button', { class: 'btn sm ghost', onClick: () => row.remove() }, ['✕']);
    const row = el('div', { class: 'inline', style: { marginBottom: '6px' } }, [currency, price, cost, rm]);
    row._get = () => ({ currency: currency.value, price: Number(price.value || 0), cost: cost.value === '' ? null : Number(cost.value) });
    rows.appendChild(row);
  }
  (current.length ? current : [{ currency: defaultCurrency(), price: 0 }]).forEach(addRow);
  const m = modal({ title: 'Product prices', body: el('div', {}, [rows, el('button', { class: 'btn sm', style: { marginTop: '6px' }, onClick: () => addRow() }, ['＋ Add price row'])]), footer: [
    el('button', { class: 'btn ghost', onClick: () => m.close() }, ['Cancel']),
    el('button', { class: 'btn primary', onClick: async () => {
      try {
        const prices = [...rows.children].map((r) => r._get());
        await apiAction(api.put(`/api/products/${productId}/prices`, { prices }), 'Prices saved');
        m.close(); done();
      } catch {}
    } }, ['Save']),
  ] });
}