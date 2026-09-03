// Pulse — today/dashboard view.
import { el, clear } from '../lib/dom.js';
import { api, state, hasModule } from '../lib/api.js';
import { badge, fmtDate, money, relTime, statusBadge } from '../lib/ui.js';
import { sparkline, lineChart, barChart, donutChart, legend } from '../lib/charts.js';
import { go } from '../lib/router.js';

export async function renderPulse() {
  const wrap = el('div', {});
  wrap.innerHTML = '<div class="loading">Loading pulse…</div>';

  try {
    const [pulse, dash, summary] = await Promise.all([
      api.get('/api/pulse', { mine: false }),
      api.get('/api/pulse', { mine: true }),
      api.get('/api/dashboard/summary'),
    ]);

    clear(wrap);

    // header KPIs
    const kpi = el('div', { class: 'cards cols-4', style: { marginBottom: '14px' } }, [
      stat('Open deals', summary.open_deals, money(summary.open_value, 'USD'), 'blue'),
      stat('Won this month', summary.won_this_month, money(summary.won_value_this_month, 'USD'), 'green'),
      stat('Win rate', `${summary.win_rate}%`, `${summary.lost_this_month} lost`, 'purple'),
      stat('Open leads', summary.open_leads, 'In pipeline', 'amber'),
    ]);
    wrap.appendChild(kpi);

    // two-column: overdue + today + counts
    const top = el('div', { class: 'split', style: { marginBottom: '14px' } });
    const overdue = el('div', { class: 'card' }, [
      el('header', {}, [el('h2', {}, ['Overdue activities']), el('span', { class: 'badge red', style: { marginLeft: '8px' } }, [String(pulse.counts.overdue)]), el('div', { class: 'spacer' })]),
      el('div', { class: 'body', style: { padding: 0 } }, [
        el('div', { class: 'sidelist' }, pulse.overdue.length
          ? pulse.overdue.slice(0, 20).map((a) => activityRow(a, true))
          : [el('div', { class: 'empty' }, ['No overdue activities.'])],
        ),
      ]),
    ]);
    const today = el('div', { class: 'card' }, [
      el('header', {}, [el('h2', {}, ['Due today']), el('span', { class: 'badge amber', style: { marginLeft: '8px' } }, [String(pulse.counts.today)]), el('div', { class: 'spacer' })]),
      el('div', { class: 'body', style: { padding: 0 } }, [
        el('div', { class: 'sidelist' }, pulse.due_today.length
          ? pulse.due_today.slice(0, 20).map((a) => activityRow(a, false))
          : [el('div', { class: 'empty' }, ['Nothing scheduled today.'])],
        ),
      ]),
    ]);
    top.append(overdue, today);
    wrap.appendChild(top);

    // hot deals & leads
    const hot = el('div', { class: 'split', style: { marginBottom: '14px' } });
    hot.append(
      card('Hot deals', pulse.hot_deals, (d) => el('div', { class: 'sidelist', style: { border: '0' } }, [
        el('div', { class: 'item' }, [
          el('a', { class: 'cell-link', href: `#/deals/${d.id}` }, [d.title]),
          el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '3px' } }, [
            money(d.value, d.currency), ' · ', d.stage?.name || '', ' · ', d.owner?.name || '',
          ]),
        ]),
        d.score_factors && d.score_factors.length ? el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '3px' } }, [d.score_factors.slice(0, 2).map((f) => f.label).join(' · ')]) : null,
      ].filter(Boolean))),
      card('Hot leads', pulse.hot_leads, (l) => el('div', { class: 'sidelist', style: { border: '0' } }, [
        el('div', { class: 'item' }, [
          el('a', { class: 'cell-link', href: `#/leads/${l.id}` }, [l.title]),
          el('div', { class: 'muted', style: { fontSize: '11px' } }, [money(l.value, l.currency), ' · ', l.organization?.name || '']),
        ]),
      ])),
    );
    wrap.appendChild(hot);

    // no next step & missing data
    const cols2 = el('div', { class: 'split', style: { marginBottom: '14px' } });
    cols2.append(
      card('Deals with no next step', pulse.no_next_step, (d) => el('div', { class: 'sidelist', style: { border: '0' } }, [
        el('div', { class: 'item' }, [el('a', { class: 'cell-link', href: `#/deals/${d.id}` }, [d.title]), el('div', { class: 'muted', style: { fontSize: '11px' } }, [money(d.value, d.currency), ' · ', d.stage?.name || ''])]),
      ])),
      card('Missing data on open deals', pulse.missing_data, (m) => el('div', { class: 'sidelist', style: { border: '0' } }, [
        el('div', { class: 'item' }, [el('a', { class: 'cell-link', href: `#/deals/${m.id}` }, [m.title]), el('div', { class: 'muted', style: { fontSize: '11px' } }, [m.issue])]),
      ])),
    );
    wrap.appendChild(cols2);

    // active sequences
    if (pulse.active_sequences.length) {
      wrap.appendChild(el('h2', { style: { marginTop: '8px' } }, ['Active sequences']));
      const seqs = el('div', { class: 'cards cols-3' });
      for (const s of pulse.active_sequences) {
        seqs.appendChild(el('div', { class: 'card pad' }, [
          el('strong', {}, [s.sequence_name]),
          el('div', { class: 'muted', style: { fontSize: '11px' } }, [`Next run: ${fmtDate(s.next_run_at)}`]),
        ]));
      }
      wrap.appendChild(seqs);
    }
  } catch (err) {
    wrap.innerHTML = '';
    wrap.appendChild(el('div', { class: 'empty' }, [el('h3', {}, ['Could not load pulse']), el('p', { class: 'muted' }, [err.message])]));
  }
  return wrap;
}

function stat(k, v, sub, color) {
  return el('div', { class: 'card stat' }, [
    el('div', { class: 'k' }, [k]),
    el('div', { class: 'v' }, [String(v)]),
    sub ? el('div', { class: 'sub' }, [sub]) : null,
  ].filter(Boolean));
}
function card(title, items, render) {
  return el('div', { class: 'card' }, [
    el('header', {}, [el('h2', {}, [title]), el('div', { class: 'spacer' }), el('span', { class: 'badge' }, [String(items.length)])]),
    el('div', { class: 'body', style: { padding: 0 } }, items.length ? items.map(render) : [el('div', { class: 'empty' }, ['Nothing here.'])]),
  ]);
}
function activityRow(a, overdue) {
  return el('div', { class: 'item' }, [
    el('a', { class: 'cell-link', href: a.deal_id ? `#/deals/${a.deal_id}` : (a.lead_id ? `#/leads/${a.lead_id}` : '#') }, [a.subject]),
    el('div', { class: 'muted', style: { fontSize: '11px' } }, [overdue ? 'Overdue · ' : 'Today · ', a.due_time || '', a.assignee ? ` · ${a.assignee.name}` : '']),
  ]);
}
