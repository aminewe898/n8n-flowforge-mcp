# Relay service console

Separate Next.js frontend and read-only BFF for the existing ticket system. No runtime demo mode or fixture fallback exists. n8n workflows and the database schema are unchanged.

## Run on this desktop

The ignored .env.local contains SERVICE_DESK_MODE=live and SERVICE_DESK_TRANSPORT=local-docker, with no secrets. From frontend run npm ci, npm run build, then npm run start. Open http://127.0.0.1:3100. npm run dev uses the same loopback address. Docker Desktop and ticket-postgres-v1 must be running.

The local transport runs a fixed server-side Docker/psql command over the existing trusted socket, changes session authorization to ticket_owner, and executes REPEATABLE READ READ ONLY transactions. No credentials are read or changed, ports published, or writes exposed. Docker access is broadly privileged; ticket_owner is not a dedicated least-privilege reader. This is a desktop observer only. Never deploy this transport behind a proxy or on a network. Host/origin/forwarding checks constrain requests but do not provide an identity system.

For network deployment use transport pg, an independently provisioned SELECT-only role, SERVICE_DESK_DATABASE_URL, SERVICE_DESK_AUTH_USER and SERVICE_DESK_AUTH_PASSWORD in the server secret environment. Use TLS and private database networking. Roles and grants are not provisioned by this app. Basic authentication is an initial observer gate; multi-user operations require identity, membership and permission checks.

## Read API

All routes are GET-only, dynamic and no-store. Authentication fails with 401; backend unavailable returns 503; invalid filters/IDs return 400; missing records return 404. No production writes or worker commands exist.

| Endpoint under /api/v1 | Contract |
| --- | --- |
| tickets | q/status/priority/clientId/sort, page/limit, full matching total; maximum 200 per page |
| tickets/:id | Joined ticket, intake source and up to 200 chronological related timestamp events |
| clients | Name/contact/email search, pagination, full contact and open-ticket counts |
| clients/:id | Client, up to 200 contacts and latest 200 tickets; full history link |
| interactions | Status filter, latest 200 |
| activity | Latest 100 recorded timestamp events with provenance |
| automation-health | Nine logical service projections with full database counts/checkpoints |
| snapshot | Bounded overview (200 per collection), full summary/service counts, truncation flag |
| assets | 501, supported:false, empty data; no asset schema exists |

SQL accepts bounded validated values and allowlisted sorts. pg uses bound parameters; fixed local SQL uses escaped literals. Snapshots deduplicate for two seconds. SWR polls every 15 seconds while visible/online and revalidates on focus. Failures and retry are visible. Command search covers the bounded snapshot; ticket/customer list search covers the database. Saved views and sidebar preference persist locally in this browser.

Only selected columns reach the browser. Credentials, leases, raw worker/provider payloads, audio paths and Telegram routing IDs are excluded. Extracted context is a model suggestion with unknown confidence. Activity is persisted timestamp evidence, not a complete audit log; observations do not certify worker liveness. Latency remains unknown without a measurement model. Assets, SLA, assignments, notes and mutations remain explicitly unavailable where absent.

## Checks

npm run check runs TypeScript, 11 isolated tests, production build and loopback failure/auth/filter/unsupported/write smoke checks. Tests never contact production. Run repository root npm run check too. User-authorized production read verification is documented in ../docs/service-desk/implementation-report.md.

Ticket column visibility persists in this browser; Subject and ID always remain visible. Saved views now accept a name and can be removed locally. Command Center presents named queues with real counts and a separate recorded-activity view. Ticket records use Record, Activity and Original transcript tabs. The interface reference study and current screenshots are in ../docs/service-desk/interface-study.md.
