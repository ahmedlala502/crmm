import { el, clear } from '../lib/dom.js';
import { listView } from './list.js';
import { renderDetail } from './detail.js';
import { api } from '../lib/api.js';
import { toast, modal, apiAction } from '../lib/ui.js';
import { go } from '../lib/router.js';

export function renderLeadsList() {
  return listView('lead', {
    title: 'Leads',
    extraParams: { status: 'open' },
    extraColumns: undefined,
    customFilters: [
      {
        key: 'source', label: 'Source', placeholder: 'All sources',
        options: uniqueSources(),
        onChange: (v) => listView._src = v,
      },
    ],
  });
}

function uniqueSources() {
  // quick best-effort; we re-load if the user filters
  return [];
}

export async function renderLeadDetail(id) {
  return renderDetail('lead', Number(id));
}
