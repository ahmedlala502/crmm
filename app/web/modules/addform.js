// Generic "add" / "edit" form for any entity. Renders a modal body.
import { el, clear } from '../lib/dom.js';
import { state } from '../lib/api.js';
import { formField, collectForm, apiAction } from '../lib/ui.js';

export function renderAddForm(entityKey, onSubmit, { bulk = false, record = null } = {}) {
  const e = state.meta?.entities.find((x) => x.key === entityKey);
  if (!e) return el('div', {}, ['Unknown entity ' + entityKey]);
  const wrap = el('form', { class: 'grid-2' });
  // core fields, skip computed / read-only system fields
  const skip = new Set(['id', 'created_at', 'updated_at', 'score', 'origin_lead_id', 'cf']);
  const fields = e.fields.filter((f) => !skip.has(f.key) && f.editable !== false);
  for (const f of fields) {
    wrap.appendChild(formField(f, record?.[f.key]));
  }
  // custom fields
  const customFields = (state.ref?.custom_fields || []).filter((f) => f.entity === entityKey && !f.read_only);
  if (customFields.length) {
    const head = el('h3', { style: { gridColumn: '1 / -1', marginTop: '6px' } }, ['Custom fields']);
    wrap.appendChild(head);
    for (const cf of customFields) {
      wrap.appendChild(formField(cf, record?.cf?.[cf.key], { entity: entityKey, custom: true }));
    }
  }
  // buttons
  const submit = el('button', { class: 'btn primary', type: 'submit' }, [bulk ? 'Apply to selection' : (record ? 'Save' : `Create ${e.label.toLowerCase()}`)]);
  wrap.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = collectForm(wrap, customFields);
    try { await onSubmit(values); } catch {}
  });
  const footer = el('div', { style: { gridColumn: '1 / -1', marginTop: '10px' } }, [submit]);
  wrap.appendChild(footer);
  return wrap;
}
