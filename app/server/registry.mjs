/**
 * Entity registry — one declarative description per record type.
 * Everything generic (list views, filters, columns, bulk ops, exports, custom
 * fields, audit, automation triggers, API) is driven from this file.
 */

const F = (key, label, type, extra = {}) => ({ key, label, type, editable: true, ...extra });

export const ENTITIES = {
  lead: {
    key: 'lead', table: 'leads', label: 'Lead', plural: 'Leads', module: 'leads',
    titleField: 'title', hasVisibility: true, hasCustomFields: true,
    softDelete: 'deleted', statusField: 'status',
    perms: { create: 'leads.create', edit: 'leads.edit', delete: 'leads.delete', bulk: 'leads.bulk_edit', export: 'leads.export' },
    fields: [
      F('title', 'Title', 'text', { required: true }),
      F('owner_id', 'Owner', 'user', { relation: 'users' }),
      F('person_id', 'Contact person', 'person', { relation: 'persons' }),
      F('org_id', 'Organization', 'organization', { relation: 'organizations' }),
      F('value', 'Value', 'monetary'),
      F('currency', 'Currency', 'currency'),
      F('source', 'Source', 'text'),
      F('label_ids', 'Labels', 'labels'),
      F('status', 'Status', 'select', { options: ['open', 'converted', 'archived', 'junk'], editable: false }),
      F('archive_reason', 'Archive reason', 'text'),
      F('expected_close_date', 'Expected close date', 'date'),
      F('score', 'Score', 'number', { editable: false }),
      F('visible_to', 'Visible to', 'visibility'),
      F('created_at', 'Created', 'datetime', { editable: false }),
      F('updated_at', 'Updated', 'datetime', { editable: false }),
    ],
    defaultColumns: ['title', 'org_id', 'person_id', 'value', 'source', 'owner_id', 'next_activity', 'created_at'],
  },

  deal: {
    key: 'deal', table: 'deals', label: 'Deal', plural: 'Deals', module: 'deals',
    titleField: 'title', hasVisibility: true, hasCustomFields: true,
    softDelete: 'deleted', statusField: 'status', archiveField: 'archived',
    perms: { create: 'deals.create', edit: 'deals.edit', delete: 'deals.delete', bulk: 'deals.bulk_edit', export: 'deals.export' },
    fields: [
      F('title', 'Title', 'text', { required: true }),
      F('pipeline_id', 'Pipeline', 'pipeline', { relation: 'pipelines' }),
      F('stage_id', 'Stage', 'stage', { relation: 'stages' }),
      F('owner_id', 'Owner', 'user', { relation: 'users' }),
      F('person_id', 'Contact person', 'person', { relation: 'persons' }),
      F('org_id', 'Organization', 'organization', { relation: 'organizations' }),
      F('value', 'Value', 'monetary'),
      F('currency', 'Currency', 'currency'),
      F('status', 'Status', 'select', { options: ['open', 'won', 'lost'], editable: false }),
      F('probability', 'Probability', 'number'),
      F('expected_close_date', 'Expected close date', 'date'),
      F('lost_reason_id', 'Lost reason', 'lost_reason', { relation: 'lost_reasons' }),
      F('lost_comment', 'Lost comment', 'textarea'),
      F('source', 'Source', 'text'),
      F('label_ids', 'Labels', 'labels'),
      F('score', 'Deal score', 'number', { editable: false }),
      F('won_time', 'Won time', 'datetime', { editable: false }),
      F('lost_time', 'Lost time', 'datetime', { editable: false }),
      F('stage_changed_at', 'Last stage change', 'datetime', { editable: false }),
      F('archived', 'Archived', 'boolean', { editable: false }),
      F('origin_lead_id', 'Converted from lead', 'lead', { editable: false }),
      F('visible_to', 'Visible to', 'visibility'),
      F('created_at', 'Created', 'datetime', { editable: false }),
      F('updated_at', 'Updated', 'datetime', { editable: false }),
    ],
    defaultColumns: ['title', 'org_id', 'value', 'stage_id', 'owner_id', 'next_activity', 'expected_close_date', 'status'],
  },

  person: {
    key: 'person', table: 'persons', label: 'Person', plural: 'People', module: 'contacts',
    titleField: 'name', hasVisibility: true, hasCustomFields: true,
    softDelete: 'deleted', archiveField: 'archived',
    perms: { create: 'contacts.create', edit: 'contacts.edit', delete: 'contacts.delete', bulk: 'contacts.bulk_edit', export: 'contacts.export' },
    fields: [
      F('name', 'Name', 'text', { required: true }),
      F('owner_id', 'Owner', 'user', { relation: 'users' }),
      F('org_id', 'Organization', 'organization', { relation: 'organizations' }),
      F('emails', 'Email', 'emails'),
      F('phones', 'Phone', 'phones'),
      F('job_title', 'Job title', 'text'),
      F('label_ids', 'Labels', 'labels'),
      F('marketing_status', 'Marketing status', 'select', { options: ['no_consent', 'subscribed', 'unsubscribed', 'bounced'] }),
      F('visible_to', 'Visible to', 'visibility'),
      F('created_at', 'Created', 'datetime', { editable: false }),
      F('updated_at', 'Updated', 'datetime', { editable: false }),
    ],
    defaultColumns: ['name', 'org_id', 'emails', 'phones', 'owner_id', 'open_deals', 'next_activity'],
  },

  organization: {
    key: 'organization', table: 'organizations', label: 'Organization', plural: 'Organizations', module: 'contacts',
    titleField: 'name', hasVisibility: true, hasCustomFields: true,
    softDelete: 'deleted', archiveField: 'archived',
    perms: { create: 'contacts.create', edit: 'contacts.edit', delete: 'contacts.delete', bulk: 'contacts.bulk_edit', export: 'contacts.export' },
    fields: [
      F('name', 'Name', 'text', { required: true }),
      F('owner_id', 'Owner', 'user', { relation: 'users' }),
      F('address', 'Address', 'text'),
      F('domain', 'Domain', 'text'),
      F('phone', 'Phone', 'text'),
      F('label_ids', 'Labels', 'labels'),
      F('visible_to', 'Visible to', 'visibility'),
      F('created_at', 'Created', 'datetime', { editable: false }),
      F('updated_at', 'Updated', 'datetime', { editable: false }),
    ],
    defaultColumns: ['name', 'domain', 'address', 'owner_id', 'people_count', 'open_deals'],
  },

  activity: {
    key: 'activity', table: 'activities', label: 'Activity', plural: 'Activities', module: 'activities',
    titleField: 'subject', hasVisibility: false, hasCustomFields: true, ownerField: 'assignee_id',
    softDelete: 'deleted',
    perms: { create: 'activities.create', edit: 'activities.edit', delete: 'activities.delete', bulk: 'activities.bulk_edit', export: 'activities.export' },
    fields: [
      F('subject', 'Subject', 'text', { required: true }),
      F('type_key', 'Type', 'activity_type', { relation: 'activity_types' }),
      F('assignee_id', 'Assigned to', 'user', { relation: 'users' }),
      F('due_date', 'Due date', 'date'),
      F('due_time', 'Due time', 'time'),
      F('duration', 'Duration', 'time'),
      F('done', 'Done', 'boolean'),
      F('priority', 'Priority', 'select', { options: ['low', 'normal', 'high'] }),
      F('location', 'Location', 'text'),
      F('busy', 'Busy', 'boolean'),
      F('note', 'Note', 'textarea'),
      F('deal_id', 'Deal', 'deal', { relation: 'deals' }),
      F('lead_id', 'Lead', 'lead', { relation: 'leads' }),
      F('person_id', 'Person', 'person', { relation: 'persons' }),
      F('org_id', 'Organization', 'organization', { relation: 'organizations' }),
      F('project_id', 'Project', 'project', { relation: 'projects' }),
      F('created_at', 'Created', 'datetime', { editable: false }),
    ],
    defaultColumns: ['subject', 'type_key', 'due_date', 'due_time', 'assignee_id', 'deal_id', 'person_id', 'done'],
  },

  product: {
    key: 'product', table: 'products', label: 'Product', plural: 'Products', module: 'products',
    titleField: 'name', hasVisibility: false, hasCustomFields: true, ownerField: 'owner_id',
    softDelete: 'deleted',
    perms: { create: 'products.create', edit: 'products.edit', delete: 'products.delete', bulk: 'products.edit', export: 'products.export' },
    fields: [
      F('name', 'Name', 'text', { required: true }),
      F('code', 'Code', 'text'),
      F('category', 'Category', 'text'),
      F('description', 'Description', 'textarea'),
      F('unit', 'Unit', 'text'),
      F('tax_id', 'Tax', 'tax', { relation: 'taxes' }),
      F('billing_frequency', 'Billing frequency', 'select', { options: ['one-time', 'weekly', 'monthly', 'quarterly', 'yearly'] }),
      F('billing_cycles', 'Billing cycles', 'number'),
      F('owner_id', 'Owner', 'user', { relation: 'users' }),
      F('active', 'Active', 'boolean'),
      F('created_at', 'Created', 'datetime', { editable: false }),
    ],
    defaultColumns: ['name', 'code', 'category', 'unit', 'billing_frequency', 'price', 'active'],
  },

  project: {
    key: 'project', table: 'projects', label: 'Project', plural: 'Projects', module: 'projects',
    titleField: 'title', hasVisibility: false, hasCustomFields: true, ownerField: 'owner_id',
    softDelete: 'deleted', statusField: 'status',
    perms: { create: 'projects.create', edit: 'projects.edit', delete: 'projects.delete', bulk: 'projects.edit', export: 'projects.export' },
    fields: [
      F('title', 'Title', 'text', { required: true }),
      F('board_id', 'Board', 'board', { relation: 'project_boards' }),
      F('phase_id', 'Phase', 'phase', { relation: 'project_phases' }),
      F('owner_id', 'Owner', 'user', { relation: 'users' }),
      F('deal_id', 'Deal', 'deal', { relation: 'deals' }),
      F('person_id', 'Person', 'person', { relation: 'persons' }),
      F('org_id', 'Organization', 'organization', { relation: 'organizations' }),
      F('status', 'Status', 'select', { options: ['open', 'on_hold', 'completed', 'canceled'] }),
      F('start_date', 'Start date', 'date'),
      F('end_date', 'End date', 'date'),
      F('description', 'Description', 'textarea'),
      F('label_ids', 'Labels', 'labels'),
      F('created_at', 'Created', 'datetime', { editable: false }),
    ],
    defaultColumns: ['title', 'org_id', 'phase_id', 'owner_id', 'start_date', 'end_date', 'progress', 'status'],
  },
};

/** Computed (read-only) columns that list views may render. */
export const COMPUTED_COLUMNS = {
  next_activity: { label: 'Next activity', entities: ['lead', 'deal', 'person', 'organization'] },
  last_activity: { label: 'Last activity', entities: ['lead', 'deal', 'person', 'organization'] },
  open_deals: { label: 'Open deals', entities: ['person', 'organization'] },
  people_count: { label: 'People', entities: ['organization'] },
  price: { label: 'Price', entities: ['product'] },
  progress: { label: 'Progress', entities: ['project'] },
  weighted_value: { label: 'Weighted value', entities: ['deal'] },
  products_total: { label: 'Products total', entities: ['deal'] },
};

export function entity(key) {
  const e = ENTITIES[key];
  if (!e) throw new Error(`Unknown entity: ${key}`);
  return e;
}
export function entityList() {
  return Object.values(ENTITIES);
}
export function fieldDef(entityKey, fieldKey) {
  return entity(entityKey).fields.find((f) => f.key === fieldKey) || null;
}

/** Operators available per field type, used by the filter UI. */
export const OPERATORS = {
  text: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'],
  textarea: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  monetary: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  date: ['eq', 'neq', 'after', 'before', 'between', 'relative', 'is_empty', 'is_not_empty'],
  datetime: ['after', 'before', 'between', 'relative', 'is_empty', 'is_not_empty'],
  time: ['eq', 'after', 'before', 'is_empty', 'is_not_empty'],
  boolean: ['eq'],
  select: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  multiselect: ['has', 'not_has', 'is_empty', 'is_not_empty'],
  labels: ['has', 'not_has', 'is_empty', 'is_not_empty'],
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
  address: ['contains', 'is_empty', 'is_not_empty'],
  formula: ['eq', 'neq', 'gt', 'lt', 'between'],
  daterange: ['is_empty', 'is_not_empty'],
  timerange: ['is_empty', 'is_not_empty'],
};

export const OPERATOR_LABELS = {
  eq: 'is', neq: 'is not', contains: 'contains', not_contains: 'does not contain',
  starts_with: 'starts with', is_empty: 'is empty', is_not_empty: 'is not empty',
  gt: 'greater than', gte: 'at least', lt: 'less than', lte: 'at most',
  between: 'between', in: 'is any of', not_in: 'is none of',
  after: 'after', before: 'before', relative: 'is in',
  has: 'includes', not_has: 'does not include',
};

export const RELATIVE_RANGES = [
  'today', 'yesterday', 'tomorrow', 'this_week', 'last_week', 'next_week',
  'this_month', 'last_month', 'next_month', 'this_quarter', 'this_year',
  'last_7_days', 'last_30_days', 'last_90_days', 'next_7_days', 'next_30_days', 'overdue',
];
