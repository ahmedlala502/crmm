-- Pipedrive-class CRM :: relational schema
PRAGMA foreign_keys = ON;

-- ============ identity, access control ============
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, manager_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  timezone TEXT DEFAULT 'UTC',
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  signature TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT, user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS permission_sets (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  description TEXT, is_system INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS user_permission_sets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_set_id INTEGER NOT NULL REFERENCES permission_sets(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, permission_set_id)
);
CREATE TABLE IF NOT EXISTS visibility_groups (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  parent_id INTEGER REFERENCES visibility_groups(id) ON DELETE SET NULL,
  description TEXT
);
CREATE TABLE IF NOT EXISTS user_visibility_groups (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES visibility_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, token_prefix TEXT NOT NULL, token_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'read,write', last_used_at TEXT, revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ configuration ============
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pipelines (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, order_idx INTEGER NOT NULL DEFAULT 0,
  probability_enabled INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY, pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL, order_idx INTEGER NOT NULL DEFAULT 0,
  probability INTEGER NOT NULL DEFAULT 100, rotten_days INTEGER
);
CREATE TABLE IF NOT EXISTS pipeline_visibility (
  pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES visibility_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (pipeline_id, group_id)
);
CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY, entity TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'gray'
);
CREATE TABLE IF NOT EXISTS lost_reasons (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, symbol TEXT NOT NULL,
  rate REAL NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS activity_types (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, key_string TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT 'task', order_idx INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS taxes (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, percentage REAL NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS custom_fields (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  options TEXT DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 0,
  important INTEGER NOT NULL DEFAULT 0,
  read_only INTEGER NOT NULL DEFAULT 0,
  formula TEXT,
  pipeline_ids TEXT DEFAULT '[]',
  board_ids TEXT DEFAULT '[]',
  editable_by TEXT DEFAULT '[]',
  group_name TEXT,
  order_idx INTEGER NOT NULL DEFAULT 0,
  show_in_list INTEGER NOT NULL DEFAULT 0,
  show_in_detail INTEGER NOT NULL DEFAULT 1,
  show_in_add INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (entity, key)
);

-- ============ core records ============
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  address TEXT, domain TEXT, phone TEXT,
  label_ids TEXT DEFAULT '[]', cf TEXT DEFAULT '{}',
  visible_to INTEGER NOT NULL DEFAULT 3,
  archived INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  emails TEXT DEFAULT '[]', phones TEXT DEFAULT '[]',
  job_title TEXT, label_ids TEXT DEFAULT '[]', cf TEXT DEFAULT '{}',
  marketing_status TEXT NOT NULL DEFAULT 'no_consent',
  visible_to INTEGER NOT NULL DEFAULT 3,
  archived INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  value REAL DEFAULT 0, currency TEXT DEFAULT 'USD',
  source TEXT, label_ids TEXT DEFAULT '[]', cf TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  archive_reason TEXT, converted_deal_id INTEGER,
  expected_close_date TEXT, score REAL DEFAULT 0,
  visible_to INTEGER NOT NULL DEFAULT 3,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL,
  pipeline_id INTEGER NOT NULL REFERENCES pipelines(id),
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  value REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'open',
  probability INTEGER, expected_close_date TEXT,
  lost_reason_id INTEGER REFERENCES lost_reasons(id) ON DELETE SET NULL,
  lost_comment TEXT, source TEXT,
  label_ids TEXT DEFAULT '[]', cf TEXT DEFAULT '{}',
  score REAL DEFAULT 0,
  won_time TEXT, lost_time TEXT, close_time TEXT,
  stage_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  visible_to INTEGER NOT NULL DEFAULT 3,
  archived INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
  origin_lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id, status, deleted);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status, deleted);
CREATE INDEX IF NOT EXISTS idx_persons_org ON persons(org_id);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY, subject TEXT NOT NULL,
  type_key TEXT NOT NULL DEFAULT 'task',
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT, due_time TEXT, duration TEXT,
  done INTEGER NOT NULL DEFAULT 0, done_time TEXT,
  note TEXT, location TEXT, busy INTEGER NOT NULL DEFAULT 1,
  priority TEXT DEFAULT 'normal',
  guests TEXT DEFAULT '[]',
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  project_id INTEGER,
  cf TEXT DEFAULT '{}',
  deleted INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activities_due ON activities(done, due_date);
CREATE INDEX IF NOT EXISTS idx_activities_deal ON activities(deal_id);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY, entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
  content TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity, entity_id);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY, entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
  name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL DEFAULT 0, storage_path TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS followers (
  entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entity, entity_id, user_id)
);

-- ============ products & revenue ============
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT, category TEXT,
  description TEXT, unit TEXT DEFAULT 'unit',
  tax_id INTEGER REFERENCES taxes(id) ON DELETE SET NULL,
  billing_frequency TEXT NOT NULL DEFAULT 'one-time',
  billing_cycles INTEGER,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cf TEXT DEFAULT '{}', active INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS product_prices (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  currency TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0,
  UNIQUE (product_id, currency)
);
CREATE TABLE IF NOT EXISTS deal_products (
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0, discount_type TEXT NOT NULL DEFAULT 'percentage',
  tax REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
  billing_frequency TEXT NOT NULL DEFAULT 'one-time', billing_cycles INTEGER,
  billing_start_date TEXT, comments TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ projects ============
CREATE TABLE IF NOT EXISTS project_boards (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, order_idx INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS project_phases (
  id INTEGER PRIMARY KEY, board_id INTEGER NOT NULL REFERENCES project_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL, order_idx INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL,
  board_id INTEGER NOT NULL REFERENCES project_boards(id),
  phase_id INTEGER REFERENCES project_phases(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  description TEXT, status TEXT NOT NULL DEFAULT 'open',
  start_date TEXT, end_date TEXT,
  label_ids TEXT DEFAULT '[]', cf TEXT DEFAULT '{}',
  template_id INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id INTEGER REFERENCES project_phases(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT, done INTEGER NOT NULL DEFAULT 0, done_time TEXT,
  is_milestone INTEGER NOT NULL DEFAULT 0,
  parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  depends_on TEXT DEFAULT '[]',
  order_idx INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS project_templates (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, board_id INTEGER, payload TEXT NOT NULL DEFAULT '{}'
);

-- ============ mail ============
CREATE TABLE IF NOT EXISTS email_threads (
  id INTEGER PRIMARY KEY, subject TEXT NOT NULL,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  shared INTEGER NOT NULL DEFAULT 1,
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  read INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL DEFAULT 'out',
  from_email TEXT NOT NULL, from_name TEXT,
  to_emails TEXT NOT NULL DEFAULT '[]', cc_emails TEXT DEFAULT '[]', bcc_emails TEXT DEFAULT '[]',
  subject TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',
  scheduled_at TEXT, sent_at TEXT,
  track_opens INTEGER NOT NULL DEFAULT 0, track_clicks INTEGER NOT NULL DEFAULT 0,
  opens INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  template_id INTEGER, error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '', shared INTEGER NOT NULL DEFAULT 1,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ automation + sequences ============
CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  test_mode INTEGER NOT NULL DEFAULT 0,
  trigger_config TEXT NOT NULL DEFAULT '{}',
  conditions TEXT NOT NULL DEFAULT '{"match":"all","rules":[]}',
  steps TEXT NOT NULL DEFAULT '[]',
  exec_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT, last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS automation_executions (
  id INTEGER PRIMARY KEY,
  automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  entity TEXT, entity_id INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  log TEXT NOT NULL DEFAULT '[]', error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_autoexec ON automation_executions(automation_id, id DESC);
CREATE TABLE IF NOT EXISTS automation_waits (
  id INTEGER PRIMARY KEY, automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  execution_id INTEGER NOT NULL REFERENCES automation_executions(id) ON DELETE CASCADE,
  entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  resume_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'delay', wait_condition TEXT,
  expires_at TEXT, ctx TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS sequences (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, entity TEXT NOT NULL DEFAULT 'lead',
  steps TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id INTEGER PRIMARY KEY, sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
  step_idx INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  next_run_at TEXT, log TEXT NOT NULL DEFAULT '[]',
  enrolled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ insights ============
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, entity TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}', owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  shared INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS dashboards (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, layout TEXT NOT NULL DEFAULT '[]',
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL, shared INTEGER NOT NULL DEFAULT 1,
  public_token TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  metric TEXT NOT NULL,
  target REAL NOT NULL DEFAULT 0,
  interval TEXT NOT NULL DEFAULT 'monthly',
  assignee_type TEXT NOT NULL DEFAULT 'company',
  assignee_id INTEGER, pipeline_id INTEGER, currency TEXT DEFAULT 'USD',
  start_date TEXT, end_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS filters (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, entity TEXT NOT NULL,
  conditions TEXT NOT NULL DEFAULT '{"match":"all","rules":[]}',
  columns TEXT DEFAULT '[]', sort TEXT DEFAULT '{}',
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ campaigns & lead gen ============
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, subject TEXT DEFAULT '', preview_text TEXT DEFAULT '',
  body TEXT DEFAULT '', sender_name TEXT, sender_email TEXT,
  recipient_filter TEXT DEFAULT '{"match":"all","rules":[]}',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT, sent_at TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES persons(id) ON DELETE CASCADE,
  email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  opened INTEGER NOT NULL DEFAULT 0, clicked INTEGER NOT NULL DEFAULT 0,
  unsubscribed INTEGER NOT NULL DEFAULT 0, sent_at TEXT
);
CREATE TABLE IF NOT EXISTS web_forms (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, target TEXT NOT NULL DEFAULT 'lead',
  fields TEXT NOT NULL DEFAULT '[]', token TEXT NOT NULL UNIQUE,
  pipeline_id INTEGER, owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submissions INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ documents ============
CREATE TABLE IF NOT EXISTS document_templates (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'quote',
  content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, template_id INTEGER REFERENCES document_templates(id) ON DELETE SET NULL,
  entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  share_token TEXT, views INTEGER NOT NULL DEFAULT 0, signed_at TEXT, signer_name TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ integration & ops ============
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
  event TEXT NOT NULL DEFAULT '*.*', method TEXT NOT NULL DEFAULT 'POST',
  headers TEXT DEFAULT '{}', secret TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY, endpoint_id INTEGER REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event TEXT NOT NULL, payload TEXT NOT NULL, status_code INTEGER, error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY, entity TEXT NOT NULL, filename TEXT NOT NULL,
  mapping TEXT NOT NULL DEFAULT '{}', duplicate_strategy TEXT NOT NULL DEFAULT 'create',
  status TEXT NOT NULL DEFAULT 'pending',
  total INTEGER NOT NULL DEFAULT 0, created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]', created_ids TEXT NOT NULL DEFAULT '[]',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY, user_id INTEGER, actor TEXT,
  entity TEXT NOT NULL, entity_id INTEGER, action TEXT NOT NULL,
  changes TEXT DEFAULT '{}', ip TEXT, source TEXT DEFAULT 'app',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity, entity_id, id DESC);
CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY, user_id INTEGER, email TEXT, kind TEXT NOT NULL,
  ip TEXT, user_agent TEXT, detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  run_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, run_at);
