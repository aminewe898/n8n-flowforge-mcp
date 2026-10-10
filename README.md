# n8n-workflow-builder

GitHub repository: [n8n-flowforge-mcp](https://github.com/aminewe898/n8n-flowforge-mcp).
The package and MCP server retain the name `n8n-workflow-builder`.

This repository includes the MCP V2 server, the service-desk frontend, deployment
source, examples, tests, and documentation. Local environment files, secret files,
production evidence, dependencies, build output, and the separately versioned
`release/relay` repository are excluded. Configure your own environment after cloning.

A small local TypeScript MCP server giving Codex eight controlled tools for a
self-hosted n8n instance. New workflows stay inactive. Dry-run is enabled by default.
No real n8n workflow was created or activated while building this project.

## Install and verify

Requires Node.js 22.15 or newer and npm. Node 24 is recommended for this project.
From PowerShell:

```powershell
Set-Location 'C:\Users\amine\Documents\n8n-codex-builder'
npm ci
npm run check
```

Commands:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TypeScript check |
| `npm run test:milestone` | List/get/validate/dry-run-create milestone |
| `npm test` | All mocked API, safety, and MCP tests |
| `npm run build` | Compile to dist/ |
| `npm start` | Start stdio server using inherited environment |
| `npm run start:env` | Start using an explicitly configured local .env |
| `npm run check` | Type check, all tests, then build |

The milestone is covered by an MCP client using linked transports. Another test spawns
the actual stdio server and verifies the handshake and tool calls. Timeout/redirect
tests use temporary loopback HTTP servers. Tests never call a real n8n instance.

## Configure the environment

Secrets come only from environment variables. `.env.example` is a template; the server
does not automatically load `.env`. Native Node `--env-file` is an optional explicit loader.

| Variable | Meaning |
| --- | --- |
| `N8N_BASE_URL` | Instance URL, optionally with a path prefix or `/api/v1` |
| `N8N_API_KEY` | Required API key; never printed |
| `N8N_DRY_RUN` | `true` (default) or `false` |
| `N8N_REQUEST_TIMEOUT_MS` | Integer 1–120000, default 15000 |

Use the final URL directly: redirects are refused to protect the authentication header.
Use HTTPS for non-local instances. URLs containing embedded credentials are rejected.

In n8n, open **Settings → n8n API → Create an API key**, choose a label and expiration,
then copy the key. Where scoped keys are available, grant only `workflow:list`,
`workflow:read`, `execution:read`, plus `workflow:create` and `workflow:update` when
you later enable writes. Do not grant workflow activation or deletion scopes.
Non-Enterprise keys may have broader rights; this server still limits exposed operations.
See the [official authentication guide source](https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/n8n-api/authentication.md).

Set variables for this PowerShell session without putting the key in command history:

```powershell
$env:N8N_BASE_URL = 'http://localhost:5678'
$env:N8N_DRY_RUN = 'true'
$keyInput = Read-Host 'n8n API key' -AsSecureString
$env:N8N_API_KEY = [System.Net.NetworkCredential]::new('', $keyInput).Password
Remove-Variable keyInput
npm start
```

`npm start` waits for MCP messages on stdin. It is not an interactive terminal app.
Press Ctrl+C to stop it. For a local file instead, copy `.env.example` to `.env`,
configure it privately, and run `npm run start:env`. Never commit the file or paste
its contents into a chat. A dry-run create is entirely local; reads and dry-run
updates still need access to n8n.

## Connect to current Codex Desktop or CLI

The [official Codex MCP documentation](https://developers.openai.com/codex/mcp)
confirms that local desktop, CLI, and IDE clients share MCP configuration on the
same host. Add this block to `C:\Users\amine\.codex\config.toml`, preserving all
existing entries. Alternatively use `.codex/config.toml` in a trusted project.

```toml
[mcp_servers.n8n-workflow-builder]
command = "node"
args = ["C:/Users/amine/Documents/n8n-codex-builder/dist/index.js"]
cwd = "C:/Users/amine/Documents/n8n-codex-builder"
env_vars = ["N8N_BASE_URL", "N8N_API_KEY", "N8N_DRY_RUN", "N8N_REQUEST_TIMEOUT_MS"]
startup_timeout_sec = 10
tool_timeout_sec = 60
```

Codex must inherit the configured environment. Launch CLI from that PowerShell
session. For Desktop, fully quit it and launch it from an environment containing
these variables, or use the explicit env-file option below if your launcher does
not inherit the shell environment. Existing desktop processes do not gain new
environment variables from an unrelated terminal.

Optional local `.env` configuration: replace `args` with this array (do not put the
key in TOML):

```toml
args = ["--env-file=C:/Users/amine/Documents/n8n-codex-builder/.env", "C:/Users/amine/Documents/n8n-codex-builder/dist/index.js"]
```

Alternatively register the command with the CLI, then add `env_vars` to its generated
table as above:

```powershell
codex mcp add n8n-workflow-builder -- node 'C:\Users\amine\Documents\n8n-codex-builder\dist\index.js'
codex mcp list
codex
```

Do not use both registration methods to create duplicate entries. In the CLI, `/mcp`
shows server status. Reopen the desktop chat after updating configuration. Use an
absolute path to `node.exe` in `command` if Node is missing from the app's PATH.
This project does not modify your Codex configuration automatically.

## Tools and usage

| Tool | Behavior |
| --- | --- |
| `list_workflows` | Concise page of ID, name, active; optional limit (1–250) and cursor |
| `get_workflow` | Workflow JSON with secret heuristics and credential references |
| `validate_workflow` | Local `{ valid, errors, warnings }` |
| `create_workflow` | Validate, sanitize, create, fetch back, verify inactive content |
| `update_workflow` | Fetch target, validate full replacement, summarize, write, fetch back |
| `get_execution` | Execution metadata and node run timing/status; raw data omitted |
| `diagnose_execution` | Failed-node evidence, normalized technical errors and sanitized diagnostics; read-only |
| `workflow_diff` | Fetch current workflow, validate proposedWorkflow, compare locally; no update |

Create/update accept a `workflow` object, not a JSON string. Required fields are
`name`, `nodes`, `connections`, `settings`. Nodes require name, type, positive
typeVersion (including fractional versions), two-number position, and parameters.
Credential references accept existing `{ id, name? }` only, never secret data.
Start with [examples/manual-workflow.json](examples/manual-workflow.json).

Updates also require `workflowId`; optional `expectedVersionId` detects an already
stale version. They are full replacements: omitted optional data may be removed.
Removing any existing node is rejected unless `allowNodeRemoval: true` is explicitly
passed. That option is destructive. `maxChangedNodes` optionally limits the sum of
nodes added, removed and modified. Keep all desired nodes and optional data.
Unsupported top-level/server-managed and node fields are removed with warnings.
Unsupported settings are rejected so they cannot silently disappear. Supported
optional fields include staticData, pinData, and nodeGroups. This server deliberately
does not offer folder/project transfers or sharing changes.

Dry-run writes return the proposed operation, workflow name, validation, redacted
sanitized payload, and before/after summary. They never issue POST or PUT, including
at the client layer. To enable actual writes later, explicitly set `N8N_DRY_RUN=false`
and restart the MCP server. Activation is always a separate manual action in n8n.

Example prompts:

- “List the first 25 n8n workflows. Continue pagination if needed.”
- “Inspect workflow ID X and explain its nodes and connections.”
- “Validate this workflow JSON and fix structural errors.”
- “Dry-run a Telegram voice support workflow that transcribes audio, sends it to an LLM, and creates a ticket. Use current official node documentation and tell me which credentials I need.”
- “Dry-run an update to workflow X. Retain all existing behavior and add this step. Show the before/after summary.”
- “Inspect execution 123 and identify the failing node from the execution summary.”

## Security and limitations

There are no tools for activation, deletion, credential management, execution retries,
arbitrary HTTP, shell/database access, Docker management, or installation changes.
Read-only tools have read-only annotations. Create modifies state and is not
idempotent; update is marked destructive because replacement can remove nodes.
All output uses stdout only for MCP; structured audit logs go to stderr with tool,
ID/name when available, success/failure, and validation error count. Logs exclude
payloads, authentication headers, credentials, and upstream error bodies.

Creation omits the read-only active field; n8n creates an inactive draft and the server
checks read-back. Updates reject active workflows and use `publishIfActive=false`.
Read-back verifies identity, inactive state, and submitted content, permitting n8n
to add defaults. Per-workflow locks prevent simultaneous updates in this process,
and an extra pre-write read checks for changes. Cross-client edits cannot be made
atomic by this wrapper: avoid concurrent manual edits or activation during writes.
On unexpected activation, it reports failure; it cannot automatically deactivate.

Requests time out, refuse redirects, and do not retry mutations. If a write times out,
returns an invalid response, or fails read-back, it may already have succeeded.
Inspect n8n before retrying, especially creation, to avoid duplicates.

Workflow read/preview redaction is heuristic. Unknown secrets hardcoded in arbitrary
code or innocuously named parameters cannot reliably be detected; keep secrets in
n8n credentials, never in workflow JSON. Redaction placeholders throughout writable fields are
rejected on writes. Execution summaries omit all raw item data, error messages,
custom data, binary content, and workflow snapshots rather than trusting heuristics
on arbitrary execution payloads. Use n8n's UI for detailed payload debugging.

Structural validation checks shapes, uniqueness, connection references, simple
expression delimiter mistakes, and common trigger omissions. It never evaluates
expressions and cannot confirm credential existence, node installation, node-specific
schemas, or successful execution. The agent must consult current node docs and
configure missing credentials manually. This server manages workflow definitions;
it does not run node code or execute workflows.

## Troubleshooting

- Startup failure: check Node version, required environment variables, valid URL,
  `N8N_DRY_RUN` spelling, and timeout range. Verify locally with `npm start`.
- HTTP 401/403: check key expiration, scopes, project permissions, and API availability.
- HTTP 404: check the instance prefix, workflow/execution ID, and public API version.
- HTTP 400: inspect sanitized payload; installed n8n may differ from current upstream.
  See its local API reference and the [research record](docs/research.md).
- Timeout: check reachability and timeout setting. Increase Codex tool timeout if
  using a large request timeout; update can use four sequential API requests.
- Redirection error: set the final canonical instance URL directly.
- Active update rejected: deactivate manually in n8n before asking for an update.
- Redacted value rejected: restore the intended value privately or use credentials;
  never submit placeholders as actual configuration.
- Read-back mismatch: inspect the indicated workflow manually before retrying.
- No tools in Codex: run build, check absolute paths and forwarded environment,
  restart the MCP connection, and inspect `codex mcp list` or `/mcp`.

Documentation and API schemas were verified on 2026-10-03. See
[docs/research.md](docs/research.md) for exact official sources and version notes.

## V2: Debugging and repair

1. Create an inactive workflow using the existing controlled process.
2. Execute it manually in n8n.
3. Copy the execution ID from n8n.
4. Ask Codex to call `diagnose_execution`.
5. Codex inspects the workflow and proposes a minimal repair to the failed node.
6. MCP validates the complete proposal and previews it with `workflow_diff`.
7. MCP updates the inactive workflow with version, removal and change-limit checks,
   then fetches it back to verify the submitted content.
8. Execute again manually in n8n and provide the new execution ID for another diagnosis.

V2 adds no execution, retry or webhook-calling capability. It never automatically
activates or deletes workflows. Your existing six tools, dry-run defaults, API
handling, locks, stale checks, verification and Codex MCP configuration remain.
No real n8n operations were performed while implementing V2.

Examples to paste into Codex (replace the example IDs with your actual IDs):

> Use n8n-workflow-builder to call diagnose_execution for execution 123. Identify
> the failing node and explain the available sanitized technical evidence. Do not
> execute, retry, activate or modify any workflow.

> Use n8n-workflow-builder to repair inactive workflow wf-1 after execution 123.
> Diagnose it first, inspect the full workflow, consult current official node docs,
> and repair only the failing node. Preserve all other nodes, connections, settings
> and optional data. Validate the complete proposal and show workflow_diff. Update
> with the fetched expectedVersionId and maxChangedNodes: 1; do not allow node
> removal. Fetch and verify the repair, then tell me to execute manually in n8n.

`diagnose_execution` accepts `{ "executionId": "123" }`. It returns metadata,
optional failedNode/error, per-run nodeStatuses with runIndex, and omission warnings.
HTTP status is normalized only from the documented error httpCode. Categories are
local classifications of known error names. Missing fields are omitted. Repeated
node runs stay separate; no success status or failed node is invented.

The dedicated diagnostic sanitizer redacts obvious secret fields and inline
authorization strings, cookies, credential URLs and email addresses. It also masks
known sensitive values echoed from nested objects. Error messages/descriptions
are retained only when they match conservative technical phrases or entirely
redacted authorization assignments. Arbitrary prose and dumps are omitted, even
under message/description. It never returns item data, request/response bodies,
headers, binary data, environment values, credential objects or full snapshots.
Node labels are untrusted metadata and can contain user-defined text; keep secrets
in credentials. Diagnostic omission is intentional; inspect payloads privately in
n8n when necessary. Data may also be unavailable due to storage, size limits or
n8n redaction; the server does not request reveal or ignore size limits.

`workflow_diff` accepts `{ "workflowId": "wf-1", "proposedWorkflow": { ... } }`.
It performs one GET and local validation/comparison, returning valid,
validationErrors, validationWarnings and, for valid proposals, changes. Node IDs
identify nodes when present (names are the fallback). Renaming a stable ID modifies
one node; replacing/omitting an existing ID counts as removal plus addition.
It reports changed node field names, port-specific added/removed connections,
setting keys and otherChangedFields; it never dumps changed parameter values.
Object key and node ordering are ignored. Connection order is compared as a multiset
within each output port, retaining duplicate edges. Invalid proposals get no diff.

`update_workflow` retains the V1 `workflow` parameter and also accepts
`proposedWorkflow` as an alias. Pass exactly one of them:

```json
{
  "workflowId": "wf-1",
  "workflow": { "name": "Full workflow", "nodes": [], "connections": {}, "settings": {} },
  "expectedVersionId": "version-from-get_workflow",
  "maxChangedNodes": 1,
  "allowNodeRemoval": false
}
```

This illustrates the input shape; an actual repair must include the full desired
node list. `allowNodeRemoval: true` explicitly permits loss of removed nodes and
their behavior. It does not override validation, inactivity, identity, placeholder,
version or change-limit checks. Guards also apply during dry-run. A limit of zero
permits no node changes; connection/settings/optional-data changes must still be
reviewed in the diff. Dry-run returns updated:false, the existing preview fields,
changes, warnings and versionInformation. A verified real update returns
updated:true, versionInformation (before/after only when available), changes and
warnings, plus V1 read-back verification/summary fields.

The public n8n controller currently skips its internal version conflict check.
expectedVersionId and the second full-state read are local safeguards, not an
atomic compare-and-swap. Avoid simultaneous edits or activation across clients.
Keep N8N_DRY_RUN=true during development; this upgrade does not change your env
files or enable writes. Reconnect/restart the MCP server to load the rebuilt V2
tools. The existing configured environment determines its dry-run setting.

V2 development first passed typecheck, all 64 read-only milestone tests and build,
then integrated update protections. The full suite retains all 31 V1 tests, with
catalog expectations expanded to eight tools. Security regression tests serialize
MCP responses containing fake secrets and fail on any leaked fixture secret.
See [V2 research](docs/research-v2.md) for current official contracts and assumptions.
