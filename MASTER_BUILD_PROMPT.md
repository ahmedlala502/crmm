You are a senior product architect, CRM engineer, UX lead and workflow-automation engineer.

Build a production-quality, Pipedrive-class CRM application. Do NOT create a superficial dashboard or a pixel-copy of Pipedrive branding. Reproduce the underlying product mechanics: configurable data model, pipeline workflow, activity-first operations, automation, permissions, reporting, integrations and admin configuration.

PRIMARY PRODUCT PRINCIPLES
1. Everything important must be configurable from the UI; avoid hardcoded business logic.
2. Every operational record must have owner, status, timestamps, history and permissions.
3. Use one coherent relational data model across leads, deals, people, organizations, activities, products and projects.
4. Support both visual workflow views and spreadsheet-style list views.
5. Every module must support filters, saved views, search, bulk operations and export where relevant.
6. Build auditability: changelog, automation execution history, import history and error reasons.
7. Keep the interface wide, fast, clean and information-dense. Avoid giant cards, excessive empty space and one-page infinite-scroll layouts.
8. Build desktop-first responsive UI with optional light/dark mode.
9. Do not include onboarding tours, tutorial videos, academy/training screens or marketing-site content.
10. Do not fake functionality with static buttons. Any visible action must work end-to-end or be hidden until implemented.

CORE NAVIGATION
- Home / Pulse
- Leads
- Deals
- Contacts
- Activities
- Mail
- Products
- Projects
- Insights
- Automations
- Campaigns
- Admin / Settings

DATA MODEL
Implement:
- Lead
- Deal
- Person
- Organization
- Activity
- Product
- Project
- Task
- Note
- File/Document
- Pipeline
- Stage
- Label
- CustomField
- Filter
- Automation
- AutomationExecution
- Sequence
- SequenceEnrollment
- User
- Team
- PermissionSet
- VisibilityGroup
- Report
- Dashboard
- Goal
- ImportJob
- AuditEvent
- WebhookEndpoint

LEADS
Create a dedicated Leads Inbox for opportunities not yet ready for a pipeline. Support create/edit/archive/delete, labels, source, owner, value, contact links, notes, activities, emails, files, custom fields, filters, bulk operations, duplicate detection, sequence enrollment and Lead -> Deal conversion.

DEALS + PIPELINES
Support unlimited configurable pipelines and ordered stages. Use Kanban drag-and-drop plus List, Forecast and Archive views. Deals must support owner, contact, organization, value, currency, stage, status, expected close date, probability, labels, source, lost reason, products, activities, email, notes, files, followers, custom fields and full history.
Show activity urgency directly on deal cards: overdue, due today, no activity, future activity.
Allow stage probabilities, deal card configuration, pipeline visibility and won/lost handling.

DETAIL VIEW
For leads/deals/contacts/projects, use a structured detail screen with:
- summary
- editable fields
- linked entities
- activity timeline
- email conversations
- notes
- files/documents
- products where relevant
- history/changelog
- followers
- contextual quick actions

ACTIVITIES + CALENDAR
Implement calls, meetings, tasks, emails and custom activity types. Support assignee, due date/time, duration, priority, busy/free, location, guests, description, linked records, recurring/scheduled behavior where appropriate, calendar/list views, completion, bulk creation and one/two-way external calendar sync architecture. Include meeting-scheduler availability links.

PULSE / PRIORITIZATION
Create a smart operational feed that surfaces records requiring action. Add:
- configurable deal scoring
- prioritization
- next-step feed
- missing-data signals
- sequences
- optional enrichment
Sequences support leads or deals and contain timed steps such as manual email, automated email and activity creation. Support manual, bulk and automation-based enrollment.

EMAIL
Create Sales Inbox behavior with personal/team inbox concepts, threaded conversations and item linking. Include:
- email templates
- signatures
- merge fields
- scheduling
- open tracking
- click tracking
- group email
- automated email
- shared/private visibility
- email-as-activity
- email reports
- AI drafting
- AI thread summary
- AI suggested replies
Provider integrations should use adapters so Gmail, Outlook/Office 365, Exchange/IMAP can be connected later.

PRODUCTS + REVENUE
Create product/service catalog with codes, categories, descriptions, pricing, currencies, units, taxes and custom fields. Products can be attached to deals with quantity, price, discount and tax.
Support recurring products and installments and derive MRR, ARR, ACV and TCV where applicable.
Add product/revenue forecasting and product-based reporting.

PROJECTS
Create post-sale delivery workspaces with boards, phases, tasks, milestones, labels, owners, due dates, dependencies and Gantt/timeline view. Allow Deal -> Project handoff and project templates. Support project import/export and automation triggers. Add an optional AI health summary showing progress, risks, blockers and recommended actions.

INSIGHTS
Build a report builder with:
- entity/report type
- filters
- measure
- group-by
- segment-by
- chart type
- detailed table view
- custom fields
- cross-entity linked data where possible
Report categories include deals, leads, activities, emails, contacts, products/revenue, projects and campaigns.
Create resizable/reorderable dashboards, internal sharing, public view-only link, chart/table export and goal tracking.
Goals support deal count/value, progressed/won deals, activity count and expected revenue.
Add natural-language AI report generation.

AUTOMATIONS
Build a visual automation engine.
Triggers:
- record created
- record updated
- specific field updated
- date/date-time trigger
Conditions:
- AND / OR groups
- previous value/current value when applicable
Actions:
- create/update record
- assign owner/team
- move stage
- create activity
- send email
- enroll in sequence
- create project/task
- call webhook
Logic:
- if/else
- delay
- wait-until-condition
- enable/disable
- test mode
- execution history
- failure reason
- retry where safe
Webhook action supports POST/PUT/DELETE, headers/auth, dynamic fields, key-value body and raw JSON.

CUSTOM FIELDS / DATA CONFIGURATION
Build a central Data Fields manager for leads/deals, people, organizations, activities, products and projects.
Field types should include text, long text, numeric, monetary, date, date range, time, time range, single-select, multi-select, user, person, organization, phone, address and formula/calculated fields.
Support:
- required fields
- important fields
- pipeline-specific deal fields
- board-specific project fields
- per-permission-set editability/read-only
- field grouping/order
- visibility in detail view/list view/reports/API

FILTERS + LIST VIEWS
Every major entity gets a wide spreadsheet-style list view with configurable columns, inline edit where safe, sorting, quick filters, advanced ALL/ANY filters, saved private/shared filters and bulk operations.
Bulk actions can include edit, owner/stage change, archive/delete, activity scheduling, email, sequence enrollment and conversion depending on entity.
Before large bulk changes, show impact summary and whether automations will execute.

IMPORT / EXPORT / DATA QUALITY
Support CSV/XLS/XLSX import with:
- AI/automatic field mapping
- manual mapping
- preview
- custom field mapping
- linked records
- duplicate handling
- create/update/merge behavior
- validation
- skipped-row report with exact reason
- import summary
- import history
- rollback/revert capability where feasible
Support CSV/XLSX exports and respect record visibility.
Add duplicate detection/merge and full audit logs.

ACCESS CONTROL
Use three layers:
1. Module/access rights
2. Permission sets for actions
3. Visibility groups for records
Support nested groups, item visibility and pipeline visibility.
Admin controls must cover create/edit/delete, export, bulk edit, field management, pipeline management, automation management and reporting access.

SECURITY
Include:
- 2FA-ready auth
- SSO architecture
- password/session policies
- IP/time restriction hooks
- session/device list
- security events
- login history
- security alerts
- admin security dashboard
- audit trail
- sandbox/test workspace concept

SMART DOCUMENTS
Add template-based quote/proposal/contract generation using CRM merge fields and product tables. Support cloud-storage adapter architecture for Google Drive, OneDrive and SharePoint, trackable share links, versions, view tracking and e-signature integration hooks.

CAMPAIGNS
Create an optional email-marketing module with:
- marketing consent/status
- sender identities
- domain authentication
- recipient filters
- subject/preview
- merge fields
- visual email builder
- reusable templates
- HTML import
- open/click tracking
- notifications
- scheduling
- automated campaigns
- unsubscribe handling
- single/double opt-in
- performance/conversion reports
- segmentation

LEAD GENERATION
Create optional modules for:
- embeddable Web Forms -> lead/deal creation
- Chatbot playbooks -> qualification/routing
- Live Chat handoff
- Prospector adapter for external B2B data
- Web Visitors adapter for company-level visitor identification

AI
Create an AI service layer, provider-agnostic and optional:
- import mapping
- natural-language reports
- email drafting
- email summaries with sentiment/action items
- suggested replies
- next-step recommendations
- project health summaries
Every AI feature can be enabled/disabled by admin. Never make core CRM functions depend on AI.

ADMIN / CONFIGURATION CENTER
Create dedicated settings sections for:
- pipelines/stages/probabilities
- labels
- activity types
- lost reasons
- currencies
- products/taxes
- custom fields
- data quality rules
- users/teams
- permission sets
- visibility groups
- pipeline visibility
- email/calendar
- automations
- sequences
- webhooks
- integrations
- API/OAuth credentials
- AI feature toggles
- import/export history
- audit/security logs

API + INTEGRATIONS
Provide a versioned REST API with CRUD for major entities, search, filters, pagination, custom fields, webhooks and OAuth/token authentication. Separate integration adapters from core business logic. Store secrets securely and never expose credentials in the frontend.

UX REQUIREMENTS
- Wide content area; tables and charts should use available width.
- Left sidebar navigation with collapsible groups.
- Persistent filters and saved views.
- Command palette/global search.
- Keyboard-friendly list views.
- Drag-and-drop pipeline.
- Clear status colors, but do not depend on color alone.
- Detail drawers for quick edits plus full detail pages for deep work.
- Dense information hierarchy suitable for operations teams.
- Responsive desktop/tablet/mobile.
- Light and dark appearance.
- Accessibility: keyboard navigation, labels, focus states, semantic markup.
- Empty/error/loading states for every module.

TECHNICAL QUALITY
- Modular architecture.
- Strong types/schema validation.
- RBAC/visibility enforced server-side.
- Transactions for multi-record workflow operations.
- Idempotent webhooks/imports where possible.
- Queue long-running jobs.
- Pagination and indexing from day one.
- Optimistic UI only when safe.
- Background jobs for email, imports, automations and exports.
- Structured logs.
- Error monitoring hooks.
- Test critical workflows.
- Seed realistic demo data.

DELIVERY
Do not return only a feature list. Build the actual application architecture and working UI.
Start by defining:
1. information architecture
2. relational schema
3. permission model
4. automation model
5. page map
6. API boundaries
Then implement the working product in logical phases, ensuring every visible feature is functional.
