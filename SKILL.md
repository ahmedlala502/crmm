---
name: pipedrive-class-crm-builder
description: Design, build, audit or extend a configurable CRM using Pipedrive-class product mechanics: leads, deals, pipelines, activities, contacts, email, products, projects, automation, reports, permissions, imports, API and admin configuration. Excludes onboarding/training/video features.
---

# Pipedrive-Class CRM Builder Skill

## Mission
When asked to create, improve, inspect, audit or extend a CRM, use this skill to enforce a complete operational product model rather than a shallow dashboard.

## Core rule
Treat CRM functionality as five connected engines:
1. Data engine
2. Workflow/pipeline engine
3. Activity/communication engine
4. Automation engine
5. Reporting/access-control engine

Never implement one engine in isolation when the requested feature logically touches another.

## Mandatory entities
Lead, Deal, Person, Organization, Activity, Product, Project, Task, Note, File, Pipeline, Stage, CustomField, Filter, Automation, Sequence, User, PermissionSet, VisibilityGroup, Report, Dashboard, Goal, AuditEvent.

## Mandatory behaviors
- Multiple pipelines and configurable stages.
- Kanban + list + forecast/archive views.
- Detail view with linked context and history.
- Custom fields with required/important/pipeline-specific/formula/read-only rules.
- Advanced filters and saved views.
- Bulk operations.
- Activity/calendar system.
- Email thread linking and templates.
- Automation triggers/conditions/actions/if-else/delay/wait/webhooks/history.
- Reports/goals/dashboards.
- Import/export/duplicates/errors/revert.
- Users/permissions/visibility/pipeline visibility.
- API/webhooks/integration adapters.
- Audit trail and security controls.

## Product design rules
- Do not create fake buttons.
- Do not hardcode workflow names, stage names, roles or custom fields if they can be settings.
- Keep UI wide and operationally dense.
- Use a left navigation and modular pages; avoid one long infinite page.
- Make list views powerful, not decorative.
- Use reusable detail panels/drawers.
- Keep actions contextual.
- Always show owner, status, next action and dates where relevant.
- Preserve history for material changes.
- Enforce permissions server-side.

## CRM workflow behavior
### Leads
Keep unqualified opportunities outside active pipelines. Support qualification, activities, labels, source, filters, archive and conversion to deal.

### Deals
Deal belongs to one pipeline/stage at a time. Support owner, value, expected close, contact/org, products, labels, activities, communication, history and won/lost.

### Activities
Make next-action discipline visible. Surface overdue, today, no-next-action and future states.

### Pulse
Provide prioritized work feed, scoring and sequences.

### Products
Allow catalog, deal attachment, recurring/installation billing and revenue metrics.

### Projects
Allow post-sale handoff with boards/phases/tasks/dependencies/timeline.

## Automation specification
Each automation must persist:
- name
- owner
- enabled status
- trigger
- conditions
- actions
- delays/waits
- branching
- execution count
- execution logs
- failure reason
- timestamps

Support idempotency and guard against recursion.

## Permissions specification
Always separate:
- access rights: which application/module
- permission sets: which actions
- visibility groups: which records

Do not treat client-side hiding as authorization.

## Data quality specification
Imports must have mapping, preview, validation, duplicate strategy, results summary and skipped-row reasons.
Custom fields must have type metadata and validation.
Bulk edits must show impact and automation consequences.

## Reporting specification
Reports must be driven from real record data, not mocked KPIs.
Support filter, measure, group, segment, visualization and table detail.
Dashboards contain reusable reports/goals.
Exports must respect visibility.

## AI specification
AI is optional and provider-agnostic.
Use AI for import mapping, report creation, email assistance, summaries, recommendations and project health.
Never make core record CRUD, workflow movement, permissions or reporting dependent on an LLM.

## Exclusions
Do not build:
- onboarding tours
- training academy
- tutorial videos
- demo videos
- marketing landing pages
unless the user explicitly asks.

## Completion check
Before calling the CRM complete, verify:
- create/read/update/archive/delete core records
- pipeline drag/move works
- permissions are enforced
- filters persist
- bulk edits work safely
- automations execute and log
- imports report failures
- reports match underlying data
- audit history exists
- no visible dead controls
