# IT service desk interface study

4 October 2026. User rejected the previous visual design. This pass reviewed official product documentation and viewed the publishers' actual interface screenshots, rather than browsing design-gallery mockups.

## Primary visual references

Freshservice's documented ticket list screenshot: https://s3.amazonaws.com/cdn.freshdesk.com/data/helpdesk/attachments/production/50006717949/original/fCP1SuT7M1y80ucCs4N_yGwvzgjNDd7QBg.png?1666363545=
Source: https://support.freshservice.com/support/solutions/articles/50000000126-understanding-ticket-views

Observed: subject takes the largest share of the table; row text has clear contrast; metadata follows the subject; functional toolbar sits above rows; columns and density are user-configurable. The publisher's screenshot is an illustrative example, not proof of its newest account UI. Documentation explains row/column organization, column visibility/order/resize, custom views and inline editing.

Zendesk's documented agent workspace screenshot: https://zen-marketing-documentation.s3.amazonaws.com/docs/en/uc_sample_ticket_mce.png
Source: https://support.zendesk.com/hc/en-us/articles/4408821259930-About-the-Zendesk-Agent-Workspace

Observed: one continuous work surface with vertical boundaries. Ticket properties, conversation and customer context have different roles. Conversation takes the central width; record navigation and status have a clear hierarchy. Context is adjacent to work, not a stack of dashboard cards. This is a publisher-provided sample, not a logged-in account inspection.

## Additional workflow references

Jira Service Management queues: https://support.atlassian.com/jira-service-management-cloud/docs/what-are-queues/
Queues prioritize incoming work, provide text search/filter controls and default to list views. Named queues and counts are a navigation model, not merely dashboard totals.

Zendesk views: https://support.zendesk.com/hc/en-us/articles/4408888828570-Creating-views-to-build-customized-lists-of-tickets
Saved views group tickets by conditions and support daily workload navigation.

GLPI ticket management: https://help.glpi-project.org/documentation/modules/assistance/tickets/ticketmanagement
Separates description, properties, actors, linked items, service levels and processing/history. Follow-ups and actions require actual persistence and permissions.

## Applied changes

- Replaced the Command Center card grid with named queue navigation, real counts and a subject-led work table; activity is a separate queue view.
- Reworked Tickets around view navigation and a readable default six-column table. All previous fields remain selectable under Columns. Column preferences persist in this browser.
- Added named saved views with local removal, sortable headers and retained server-side filters, pagination, density and keyboard rows.
- Raised working text from 9–11px to 12–14px, increased contrast, and used familiar system typography. The sidebar is graphite and the work surface white.
- Replaced the cockpit card stack with continuous property, record and customer-context panes. Record/Activity/Original transcript tabs use real source data. Intake extraction is clearly identified; unknown fields are collapsed and labelled in plain language.
- Missing backend capability remains explicit. No fake composer, assignment control, SLA deadline, user avatar photo, bulk mutation or reply function was introduced. The requester initial is derived from the stored name.
- Production reads and the n8n pipeline are unchanged. No database or workflow mutation occurred.

Root and frontend check suites pass. Browser verification covers actual records, queue navigation, column visibility, server filtering, saved-view naming/removal, ticket tabs and mobile layout. Current review screenshots use the reference-led prefix; earlier screenshot files depict superseded iterations.
