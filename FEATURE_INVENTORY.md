# Pipedrive Functional Feature Inventory — Sep 3, 2026

Scope: product mechanics and configuration patterns. Excludes onboarding courses/tutorial videos.
Goal: use as a functional reference for building a Pipedrive-class CRM, not as a pixel-for-pixel brand clone.

## 1. Core information architecture
- Global workspace shell
  - Left navigation
  - Global search
  - Quick create
  - Notifications
  - User/account menu
  - Settings / tools and apps
- Main workspaces
  - Pulse
  - Leads
  - Deals
  - Contacts
  - Activities
  - Sales Inbox / Email
  - Products
  - Projects
  - Insights
  - Campaigns (optional module/add-on)
  - Lead generation tools (optional module/add-on)

## 2. CRM data model
### Lead
- Title
- Person and/or organization link
- Owner
- Value / currency
- Source / source channel
- Labels
- Notes
- Activities
- Email history
- Files
- Custom fields
- Visibility
- Archive/delete
- Convert to deal

### Deal
- Title
- Person
- Organization
- Owner
- Pipeline
- Stage
- Status: open / won / lost
- Value / currency
- Probability
- Expected close date
- Won/lost dates
- Lost reason
- Labels
- Source
- Products
- Activities
- Emails
- Notes
- Files / documents
- Followers
- Custom fields
- History/changelog
- Archive
- Convert back to lead

### Person
- Name
- Email(s)
- Phone(s)
- Organization
- Owner
- Labels
- Marketing status
- Activity/email history
- Leads/deals/projects
- Custom fields
- Visibility

### Organization
- Name
- Address
- Website
- LinkedIn
- Industry
- Annual revenue
- Employees
- Owner
- Labels
- People
- Deals/leads/projects
- Organization relationships
- Custom fields
- Visibility

### Activity
- Subject
- Type
- Owner/assignee
- Due date/time
- Duration
- Busy/free
- Priority
- Location
- Guests
- Description/note
- Done/open state
- Links to deal, lead, person, organization, project
- Custom activity types

### Product
- Name
- Code
- Category
- Description
- Unit
- Tax
- Prices / currencies
- Billing frequency
- Active status
- Owner
- Visibility
- Images/files
- Custom fields
- Link to deals
- Recurring product or installments
- MRR / ARR / ACV / TCV-derived revenue

### Project
- Title
- Board
- Phase
- Status
- Owner
- Start/end dates
- Labels
- Linked deal/contact/org
- Tasks
- Milestones
- Dependencies
- Gantt/timeline
- Custom fields
- Project health summary

## 3. Leads Inbox
- Dedicated pre-pipeline lead area
- Lead list
- Search, sort, quick filters and advanced filters
- Multiple color labels
- Archive / restore / delete
- Bulk edit
- Bulk activities
- Group email
- Add to sequence
- Convert lead -> deal
- Duplicate handling
- Lead source tracking
- API/import capture

## 4. Deal pipeline engine
- Multiple pipelines
- Configurable ordered stages
- Drag-and-drop deal movement
- Deal cards configurable by important fields
- Stage probability
- Pipeline visibility by group
- Pipeline/list/forecast/archive views
- Filters
- Activity indicators:
  - overdue
  - due today
  - no activity
  - future activity
- Deal detail page
- Progress bar and time-in-stage
- Won/lost handling
- Lost reasons
- Expected close date
- History/changelog
- Bulk edit/move/archive/delete
- Deal labels
- Followers

## 5. Activities & calendar
- Calls, meetings, tasks, emails + custom activity types
- Calendar view
- Activities list view
- One-way/two-way external calendar sync
- Meeting scheduler / availability links
- Guest invitations
- Busy/free behavior
- Bulk activity creation
- Mark done
- Activity-linked entity history
- Email-as-activity tracking
- Activity performance reporting

## 6. Pulse / prioritization
- Smart feed of next actions
- Custom deal scoring
- Scoring criteria based on CRM data
- Sequences for leads/deals
- Sequence steps:
  - manual email
  - automated email
  - activity/follow-up task
  - wait/timing logic
- Enrollment manually, in bulk or by automation
- Data enrichment
- Prioritization and focus views

## 7. Email / Sales Inbox
- Personal inbox sync
- Shared/team inbox
- Gmail / Outlook / Exchange / IMAP support
- Threaded conversations
- Link email thread to deal/lead/project/contact/org
- Shared vs private email visibility
- Templates
- Signatures
- Merge fields
- Scheduling
- Open tracking
- Link-click tracking
- Group email
- Automated email
- Email-as-activity
- Email performance reports
- AI email creation
- AI thread summarization
- AI suggested replies

## 8. Products & revenue
- Product/service catalog
- Multi-price / currency support
- Add product to deal
- Quantity / price / discount / tax
- Recurring billing
- Installments
- Predicted product revenue
- Revenue forecast
- Product reports
- Quote/document population

## 9. Projects / post-sale delivery
- Boards and phases
- Project templates
- Tasks
- Milestones
- Owners
- Due dates
- Labels
- Dependencies
- Gantt/timeline
- Bulk project operations
- Import/export
- Deal -> project handoff
- Automation-triggered project creation
- AI health summary / risk snapshot

## 10. Insights, reporting & goals
- Report builder
- AI prompt-to-report
- Filters
- Measures
- Group-by
- Segment-by
- Table view
- Default + custom field reporting
- Cross-entity linked-data reports
- Report areas:
  - deals
  - leads
  - activities
  - emails
  - contacts
  - campaigns
  - products/revenue
  - projects
- Dashboards
- Drag/reorder/resize widgets
- Dashboard sharing internally
- Public view-only link
- Export chart/table
- Goals:
  - deal count/value
  - progressed/won deals
  - activity count
  - expected revenue
- Forecasting
- Conversion
- Duration
- Funnel/progress
- Sales cycle analysis

## 11. Automation engine
- Event triggers:
  - created
  - updated
  - deleted/changed where supported
- Date-based triggers
- Field-specific update trigger
- Conditions:
  - passive state conditions
  - active/change conditions
  - AND/OR logic
- Actions:
  - create/update items
  - move deal
  - assign owner
  - create activity
  - send email
  - enroll in sequence
  - create project/task where supported
  - webhook request
- If/else branching
- Delay
- Wait-for-condition
- Webhook action
  - POST / PUT / DELETE
  - key-value or raw JSON body
  - reusable endpoint/auth config
- Execution history
- Failure reason
- Enable/disable
- Usage limits and guardrails
- Admin warning before bulk changes trigger large automations

## 12. Data fields / customization
Entities support default/system/custom fields.
Custom field types should include at minimum:
- text
- long text
- numeric
- monetary
- date
- date range
- time
- time range
- single option
- multiple option
- user
- organization
- person
- phone
- address
- autocomplete
- formula where relevant

Configuration:
- Required fields
- Important fields
- Pipeline-specific deal fields
- Board-specific project fields
- Formula/calculated fields
- Per-permission-set read-only/editability
- Ordering and grouping in detail view
- Custom labels and colors

## 13. Search, filters & bulk operations
- Global search
- Entity search
- Quick filters
- Advanced filters with ALL/ANY condition groups
- Private/shared filters
- Sort
- Column customization
- Saved views
- Bulk field update
- Bulk stage/owner changes
- Bulk archive/delete
- Bulk send email
- Bulk schedule activity
- Bulk sequence enrollment
- Bulk convert lead/deal where relevant
- Automation execution warning

## 14. Import/export & data quality
- CSV/XLS/XLSX import
- AI-assisted field mapping
- Preview before import
- Create/update linked entities
- Duplicate detection
- Merge duplicates
- Import result summary
- Skip/error file with reason
- Import rollback/revert window
- CSV/XLSX export
- Export respects visibility permissions
- Changelog/audit history
- Data validation
- Required/important field rules

## 15. Users, access & security
Three-layer access model:
1. App/access rights — which modules user can access
2. Permission sets — what user can do
3. Visibility groups — what records user can see

Include:
- Roles
- Owners/followers
- Team/group visibility
- Nested visibility groups
- Item visibility
- Pipeline visibility
- Data field edit restrictions
- Admin permission sets
- 2FA
- SSO
- Password/security rules
- IP/time access restrictions
- Security alerts
- Security dashboard
- Active devices/sessions
- Login history
- Audit/security change history
- Sandbox/test account concept

## 16. Smart Docs / document workflow
- Templates
- Merge CRM fields into documents
- Quotes/proposals/contracts
- Product table population
- Google Drive / OneDrive / SharePoint connection
- Trackable share links
- View notifications
- Versions
- E-signatures

## 17. Campaigns / email marketing
- Marketing contact status and consent
- Sender identities
- Domain authentication
- Recipient filters
- Subject + preview text
- Merge fields
- Drag/drop email builder
- Saved templates
- HTML upload
- Open/click tracking
- Engagement notifications
- Schedule/send
- Automated campaigns
- Unsubscribe flow
- Single/double opt-in
- Performance reporting
- Conversion reporting
- Segmentation

## 18. Lead generation
Optional feature pack:
- Web Forms
  - embeddable/shareable
  - custom fields
  - create lead/deal
  - owner routing/notification
- Chatbot
  - playbook flow
  - custom questions/answers/actions
  - qualification
  - handoff to human
- Live Chat
- Prospector
  - search/filter external B2B profiles
  - reveal contact details using credits
- Web Visitors
  - company identification
  - pages visited / source / engagement

## 19. AI layer
- AI import mapping
- Natural-language report builder
- AI email writing
- Email summary + sentiment + readiness + action items
- Suggested replies
- Smart app/integration recommendations
- Sales assistant / next-step guidance
- Project health summary
- AI features individually enabled/disabled by admin

## 20. API & integrations
- REST API
- API token and OAuth 2.0
- Webhooks
- CRUD for major entities
- Custom fields through API
- Pagination
- Search
- Filters
- Marketplace integrations
- External automation platforms
- Integration logs/error states
- Webhook delivery/execution history

## 21. Configuration center
Build a dedicated admin configuration area for:
- Pipelines and stages
- Stage probabilities
- Activity types
- Custom fields
- Required/important rules
- Labels
- Lost reasons
- Products/tax
- Currencies
- Email settings
- Calendar sync
- Automations
- Webhooks
- Users
- Permission sets
- Visibility groups
- Pipeline visibility
- Security
- AI feature toggles
- Import/export
- Integrations
- API credentials
- Audit log

## 22. Explicitly excluded
- Onboarding tours
- Academy/training modules
- Tutorial videos
- Demo videos
- Marketing website pages
