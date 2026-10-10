# Service desk product architecture

Status: initial product plan and implementation boundary, 4 October 2026.
This plan precedes the UI implementation. It is based on repository artifacts;
no production database introspection or workflow execution was performed.

## A. Product specification

The product is an operating workspace for IT businesses with 1–50 technicians.
Its home answers “what should I do next?” through ranked decisions and work.
Customer relationships and device history are the context for every incident.
AI assists understanding and retrieval; deterministic services own identity,
authorization, validation, writes, state transitions and idempotency.

| User | Job to be done | Primary workflow |
| --- | --- | --- |
| Technician | Diagnose quickly with customer and device context | Queue → cockpit → diagnostics → verified resolution |
| Dispatcher | Unblock work and balance capacity | Pending decisions → deterministic identity review → assignment |
| Owner/admin | See service risk, run a healthy business, migrate safely | Operational exceptions → business answers → imports and audit |
| Viewer | Understand authorized customer/service state | Read-only customer, ticket and asset history |

Principles: action before metrics; one workspace per task; explicit state and
provenance; facts separate from inference; no autonomous production learning;
human confirmation for consequential suggestions; portable, reversible imports.
Do not measure individual keystrokes or time online. Skill routing supports work.

Success measures (future instrumentation, no invented baselines): median queue to
first meaningful action; time to verified resolution; clicks to contextual work;
operator wait duration; reopen/recurrence rate; SLA breaches; suggestion acceptance
and verified accuracy by model/prompt version; import reconciliation accuracy;
export completeness. Measure by category and cohort with minimum sample sizes.

## B. Information architecture

Persistent navigation: Command Center, Tickets, Customers, Assets, Schedule,
Knowledge, Business, Automations. Workspace utilities: Migration Center, Settings.
Global Ctrl/Cmd+K combines navigation and permission-scoped entity search.

Initial routes: `/`, `/tickets`, `/tickets/:id`, `/customers`, `/customers/:id`,
`/assets`, `/assets/:id`, `/automations`, `/settings`. Reserved future surfaces:
`/schedule`, `/knowledge`, `/business`, `/migration`.

Customer → contacts, sites, contracts, assets and service history. Ticket → customer,
contact, optional asset, events, messages, work logs, parts, attachments, observations,
resolution. Asset → owning customer, site and incident/repair timeline. All links
retain stable IDs. Intake is a separate process: an intake is not an open ticket.

## C. Repository evidence and data model review

Sources: `deployment/ticket-postgres/migrations/001_schema.sql`,
`002_phase1_operations.sql`, `003_grants.sql`,
`004_phase2a_worker.proposed.sql`, `005_v1_completion.sql`;
`planning/ticket-intake-v1/phase2a-extraction.schema.json`;
`TI-02 Intake Worker.proposed.json`; production application and controlled
integration reports. A migration file does not prove that migration is deployed.
004's production application report records application; 005's deployment is
not established by the inspected evidence. The initial reader uses 001 columns.

| Existing entity | Actual contract | Product projection |
| --- | --- | --- |
| clients | UUID, company/individual, display_name, active, timestamps | Customers; no organization tenancy implied |
| client_contacts | client_id, display_name, validated email, source, active | Contacts; syntactic validation remains backend-owned |
| processed_messages | Telegram provenance, text/voice, received/handled/ignored/needs_operator | Ingress receipt; never expose bot/operator/chat IDs |
| intakes | revision, state, transcript, validated extraction, resolved identity, final priority | Intake progress and source context |
| pending_interactions | email/client_selection/details/priority_confirmation; open/resolved/cancelled | Human decision queue; replies remain in Telegram initially |
| tickets | intake/client/contact, summary, description, category, priority, structured_data | Persisted incident, immutable IDs from database |
| work_items | stage, queued/leased/succeeded/needs_operator/cancelled, attempts | Read-only operational projection; no browser leases |
| outbox | queued/leased/sent/uncertain/needs_operator/cancelled, attempts | Delivery state; uncertain is never “sent” or “failed” |

Ticket statuses are exactly `open`, `in_progress`, `resolved`, `closed`.
Priorities are `low`, `normal`, `high`, `critical`. Repair states require a separate
reviewed lifecycle, not a frontend rename of these states. Intake can intentionally
wait for client selection, email, details or priority confirmation. `queued` is
waiting work, `leased` is claimed work, not proof that a provider is healthy.
TI-02 checkpoints advance one stage, with extraction eventually queuing
resolve_client. A completed extract does not prove ticket creation. Ingress
lookup exposes receipt/intake/work identifiers and statuses, not a product API.
The browser never uses those worker RPCs. TI-01 stays on its production webhook.

Missing entities, in dependency order:
1. Workspace membership and authenticated principals; permission policy; tenant
   scoping if multiple IT businesses share deployment. clients are customers,
   not tenants. Single workspace reader is the initial deployment constraint.
2. Ticket events/messages/work logs, technician assignment, optimistic revision,
   command receipts and audit. Capture append-only events transactionally.
3. Sites, assets, specifications, warranty, asset events and explicit ticket links.
4. Contract calendars, SLA policy snapshots/deadlines, repair lifecycle, quotes,
   approvals, part inventory/suppliers/costs and structured resolution.
5. Knowledge drafts/articles/source evidence and approval state; recurring pattern
   candidates with sample counts, time windows and reviewed recommendations.
6. Imports, mappings, external identities, conflicts and rollback change ledger.
7. Verified AI feedback and offline evaluation runs/deployment records.

Recommended feedback record: id, workspace_id, ticket_id, observation_id, field,
predicted_value, corrected_value, confidence, model_version, prompt_version,
context_reference, actor_id, occurred_at, verification_state, outcome_reference.
Keep immutable prediction evidence; outcome verification is a subsequent event.
Never allow an observation to resolve a database identity by itself.

Migration model: import_runs (source, mode, cursor, state, reconciliation),
mapping_versions, source_objects and external_identities with a unique
(workspace, source_system, source_object_type, source_object_id),
import_conflicts and import_changes (before/after revision, batch and action).
Store source_import_id, source_payload_reference and imported_at. Preserve original
timestamps, relationships, attachment checksums and timezone assumptions. Rollback
must detect subsequent human changes instead of overwriting them. No destructive
delete or automatic source cutover. Export canonical JSON/CSV plus attachments
manifest and audit; document omissions and reconcile record counts.

## D. Frontend and backend boundary

Isolated `frontend/` Next.js App Router + React + TypeScript application.
Root MCP package and workflows remain independent. CSS variables provide the
initial design system; a grid library and Tailwind are unnecessary for this small
read-only slice. Add accessible primitives as interaction complexity grows.

Server-only node-postgres adapter uses an independently provisioned reader role,
explicit column lists and a repeatable-read, read-only transaction. No existing
credentials are copied. No schema or grants are applied automatically. Sensitive
audio, payloads, Telegram IDs, tokens, fencing, metadata and raw error text never
enter the browser contract. Database failure returns unavailable, not sample data.
Initial API `/api/v1/snapshot` is a NEW read-only BFF projection, not an existing
backend contract. It returns version, source, capturedAt and bounded results; the
UI computes counts from those loaded results.
The initial implementation caps each collection at 200 rows and flags truncation.
Queue ranking is deterministic: critical incidents, unresolved interactions, delivery uncertainty,
operator intervention, high tickets, then oldest open ticket. No SLA or
confidence is inferred from absent fields. All displayed counts are labelled as
loaded scope when truncated. One coherent snapshot avoids mixed queue revisions.

Initial live access uses HTTP Basic authentication over TLS for a restricted
single-workspace observer. This is a bootstrap gate, not role-based production
identity. All live pages and API routes fail closed without configured credentials.
Never expose this bootstrap observer to a multi-tenant or public deployment.
Phase 1 completion replaces it with a reviewed identity provider and server-enforced
memberships/roles. Permission checks belong in every data and command service.

Proposed eventual `/api/v1/tickets`, `/customers`, `/assets`, `/search`,
`/ticket-events`, `/knowledge`, `/imports` support scoped cursor pagination.
Write commands require authenticated actor, deterministic validation, expected
revision, idempotency key and transactional audit, with conflict receipts. Browser
commands must not call n8n or worker functions. Operator replies need a new audited
command service; until then the UI instructs users to use the existing Telegram path.

Server components load the snapshot. Local state controls panels and palette;
URL state controls list query/status. Explicit refresh re-fetches server state.
No optimistic queue transitions. Initial delivery has no automatic polling/SSE.
Later use authenticated SSE transactional event cursors, reconnect/backoff and
scoped cache invalidation; show stale/reconnecting and reconcile missing sequences.
Search initially covers loaded tickets/customers/contacts; it explicitly labels its
scope. PostgreSQL full-text/trigram indexes and ACL-scoped pagination follow.

Component boundaries: AppShell, PageHeading, ConnectionBanner, ActionQueue,
TicketTable, TicketWorkspace, CustomerDirectory/Detail, AutomationHealth,
EvidenceBlock, StateChip, EmptyState, CommandPalette. Errors and unsupported
capabilities have useful explanations instead of pretend data/actions.

## E. Wireframe plan

**Command Center:** narrow persistent sidebar, command search and workspace header;
editorial heading; three compact operational counts with labels; main ranked action
rows with reason, exact state, customer and one linked next action. Right column
shows intake progress and delivery exceptions. Quiet footer shows snapshot/source.
No charts. Schedule/workload appear only after those contracts exist.

**Ticket workspace:** header with ticket number, summary, stored priority/status;
left customer/contact and available asset context; center persisted description,
source transcript and extraction provenance; right explicitly tagged suggestions
and missing information. No invented event times: created/updated facts form an
initial record history, not a conversation timeline. Notes/status changes are
future commands. Mobile stacks customer, work and intelligence in that order.

**Customers:** compact searchable directory, kind, active state and observed open
work. **Customer detail:** identity/contact block, linked open and resolved tickets;
environment/contract/history regions become available when persisted. Never show
estimated value or invented satisfaction. An empty relationship is explicit.

**Assets:** future table with model, serial, customer, site, warranty and repeated
issues. **Asset detail:** identity and specs on left, maintenance/incident chronology
center, recurring pattern with sample counts/evidence right. Initial live empty
state explains absent entity; demonstration assets remain labelled fixtures.

**Migration Center:** source selection → preview → versioned mapping → conflict
review → read-only dry run → explicit import → reconciliation/rollback. Show exact
invalid rows and source links. Incremental sync/cutover later, never decorative
“import complete” feedback. Initial screen documents capability dependencies.

**Automation health:** observed stage/state/attempt rows, intentionally waiting
operator interactions and uncertain deliveries; no “healthy” based on no errors.
Technical users eventually get sanitized diagnostic drilldown. No retry/activation.

**Owner:** action-oriented risk/customer recurrence/revenue in work, with date range,
data freshness and evidence links. Initial screen explains missing costs/SLA data;
no fabricated financial charts. **Schedule:** persisted bookings/assignments only.

## F. Design system

Warm off-white canvas, white cards, graphite sidebar, emerald primary action;
amber for waiting, red for human attention, blue for derived evidence. System sans
font stack avoids external font dependencies. Body 14px, metadata 12px, headings
28–34px. Spacing scale 4/8/12/16/24/32; card radii 10–14px; subtle borders.
Queue rows are compact but have at least 44px interactive targets. Tables use stable
headers, aligned IDs/status and truncation with full detail on opening. Panel content
wraps long identifiers. No full-row hidden writes or hover-only critical actions.

Status chips contain text and optional dot; never color alone. FACT = recorded
database/source evidence; DERIVED = deterministic aggregation with provenance;
SUGGESTION = model output with reasons and unknown confidence preserved;
ACTION = a human command, only enabled when supported. Percentage confidence is
shown only from an actual calibrated measure; do not map missing values to zero.
Palette uses native modal dialog, autofocus, Escape, Tab containment, restore focus,
search result links and navigation. Respect reduced motion, focus-visible, contrast.
Desktop cockpit uses three columns; tablet two; mobile one and compact navigation.

## G. Build phases, cut line and risks

0. Evidence review and this plan → independent frontend + safe read projection.
1a. Initial deliverable: operational reader, command center, ticket list/cockpit,
customers, automation health, loaded-record search, source/error states, responsive
shell, bootstrap live gate, explicit demo fixtures, local tests/build. Read-only.
1b. COMPLETE operational MVP: identity/membership, ticket event API, audited notes
and lifecycle commands, assets, dispatch/assignment, permission-aware full search,
settings, protected SSE. Dependencies: reviewed additive schema and command API.
2. Retrieval, recurring patterns, priority explanations, feedback ledger,
verified resolution capture and reviewed knowledge drafts. No automatic retraining.
3. CSV/Excel migration with dry run, provenance, conflict review, idempotent import,
history, exports and guarded rollback. Match by deterministic rules; humans review
ambiguous IDs. Validate files and attachments before any writes.
4. Jira/Zendesk/Freshservice adapters, incremental cursors, mirror reconciliation,
final-delta cutover and explicit approval. Provider-specific fields stay in adapters.
5. Contract/SLA-aware operational business answers and workload/skill routing.

MVP excludes automatic retraining, billing engine, advanced vendor importers and
enterprise CMDB. The current slice is not the complete Phase 1 MVP. Risks:
unknown deployed migration state; grants/HBA currently support ticket_n8n only;
no browser identity service; transcript PII; missing audits and event ordering;
bounded reader/search completeness; no multi-tenant data isolation; semantic
confusion between intake and ticket; Basic auth unsuitable as long-term roles.
Mitigate by explicit source states, independent reader provisioning, sanitized
contract, read-only MVP slice and sequential reviewed backend additions.

## H. Verification and documentation sources

Use local fixtures/fake dependencies only; never exercise real workflows in tests.
Check root with `npm run check`; frontend with its own check and production build.
Verify disconnected and unavailable states, queue ranking, links/filter URL state,
authentication rejection, narrow serialized contract and responsive layout.
No production queries or credentials are needed for local review.

Current documentation fetched through Context7:
- Next.js App Router installation/proxy: https://nextjs.org/docs/app
- node-postgres transactions: https://node-postgres.com/features/transactions
- node-postgres pool: https://node-postgres.com/apis/pool
- React effects: https://react.dev/reference/react/useEffect
