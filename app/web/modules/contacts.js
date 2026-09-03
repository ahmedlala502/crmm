import { el, clear } from '../lib/dom.js';
import { listView } from './list.js';
import { renderDetail } from './detail.js';
import { api, state, can } from '../lib/api.js';
import { drawer, modal, toast, apiAction, confirmDialog } from '../lib/ui.js';
import { go } from '../lib/router.js';

export function renderContacts(params = {}) {
  const wrap = el('div', {});
  const activeTab = params.tab === 'orgs' ? 'orgs' : 'people';

  const tabBar = el('div', { class: 'tabs', style: { marginBottom: '8px' } }, [
    el('div', { class: `tab ${activeTab === 'people' ? 'active' : ''}`, onClick: () => go('contacts?tab=people') }, ['People']),
    el('div', { class: `tab ${activeTab === 'orgs' ? 'active' : ''}`, onClick: () => go('contacts?tab=orgs') }, ['Organizations']),
    el('div', { class: 'spacer', style: { flex: '1' } }),
    can('contacts.merge') ? el('button', { class: 'btn sm', onClick: openDuplicatesModal }, ['⌗ Duplicates & Merge']) : null,
  ]);

  const viewContainer = el('div', {});

  if (activeTab === 'people') {
    viewContainer.appendChild(listView('person', {
      title: 'People',
      allowCreate: true,
      allowImport: true,
    }));
  } else {
    viewContainer.appendChild(listView('organization', {
      title: 'Organizations',
      allowCreate: true,
      allowImport: true,
    }));
  }

  wrap.append(tabBar, viewContainer);
  return wrap;
}

async function openDuplicatesModal() {
  const m = modal({ title: 'Find & Merge Duplicates', wide: true, body: el('div', { class: 'loading' }, ['Scanning for duplicates…']) });
  const body = m.querySelector('.body');

  try {
    const [dupPeople, dupOrgs] = await Promise.all([
      api.get('/api/admin/duplicates', { entity: 'person' }),
      api.get('/api/admin/duplicates', { entity: 'organization' }),
    ]);

    clear(body);

    const subTabs = el('div', { class: 'pill-tabs', style: { marginBottom: '12px' } }, [
      el('button', { class: 'active', onClick: (e) => switchSub('people', e.target) }, [`People (${dupPeople.length})`]),
      el('button', { onClick: (e) => switchSub('orgs', e.target) }, [`Organizations (${dupOrgs.length})`]),
    ]);

    const contentArea = el('div', {});

    function switchSub(type, btn) {
      subTabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderDupList(type === 'people' ? dupPeople : dupOrgs, type === 'people' ? 'person' : 'organization');
    }

    function renderDupList(groups, entityKey) {
      clear(contentArea);
      if (!groups.length) {
        contentArea.appendChild(el('div', { class: 'empty' }, [
          el('h3', {}, ['No duplicates found']),
          el('p', { class: 'muted' }, [`All ${entityKey} records appear distinct.`]),
        ]));
        return;
      }

      for (const g of groups) {
        const card = el('div', { class: 'card pad', style: { marginBottom: '10px' } });
        card.append(
          el('div', { class: 'inline', style: { marginBottom: '6px' } }, [
            el('strong', {}, [`Match: "${g.match_value}"`]),
            el('span', { class: 'badge amber' }, [g.reason || 'exact match']),
            el('span', { class: 'dim' }, [`${g.records.length} records`]),
          ])
        );

        const recList = el('div', { class: 'sidelist', style: { marginBottom: '10px' } });
        for (const r of g.records) {
          recList.appendChild(el('div', { class: 'item inline' }, [
            el('span', { style: { fontWeight: '600', width: '200px' } }, [r.name]),
            el('span', { class: 'muted truncate', style: { flex: '1' } }, [
              r.emails ? (typeof r.emails === 'string' ? r.emails : JSON.stringify(r.emails)) : (r.domain || r.address || ''),
            ]),
            el('button', { class: 'btn sm', onClick: () => mergeInto(entityKey, r.id, g.records.map((x) => x.id), m) }, ['Keep this (merge others)']),
          ]));
        }
        card.appendChild(recList);
        contentArea.appendChild(card);
      }
    }

    async function mergeInto(entityKey, winnerId, allIds, parentModal) {
      const losers = allIds.filter((id) => id !== winnerId);
      if (!await confirmDialog({
        title: 'Merge records?',
        body: `This will merge ${losers.length} record(s) into #${winnerId}. Secondary records will be deleted and linked activities/deals moved.`,
        okText: 'Merge',
        danger: true,
      })) return;

      for (const loserId of losers) {
        try {
          await apiAction(api.post('/api/admin/merge', {
            entity: entityKey,
            winner_id: winnerId,
            loser_id: loserId,
          }), `Merged #${loserId} into #${winnerId}`);
        } catch {}
      }
      parentModal.close();
      go('contacts');
    }

    renderDupList(dupPeople, 'person');
    body.append(subTabs, contentArea);
  } catch (err) {
    clear(body);
    body.appendChild(el('div', { class: 'empty' }, [el('p', { class: 'muted' }, [err.message])]));
  }
}
