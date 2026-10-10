# V2 research — 2026-10-03

Research completed before code changes. Context7 resolved n8n to
`/n8n-io/n8n-docs` and `/n8n-io/n8n`, and MCP to
`/modelcontextprotocol/typescript-sdk`. Broad results included n8n's separate
native MCP implementation and SDK v2 examples, so exact contracts were checked
against current official sources below. No real instance was contacted.

## Executions and error/run structures

[Public GET execution schema](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/executions/spec/paths/getExecution.generated.yml):
`GET /api/v1/executions/{executionId}?includeData=true` requires execution:read.
Metadata includes string id/workflowId, status, nullable startedAt/stoppedAt,
and optional detailed data/workflowData. Data can be absent because of size limits
or redaction. We do not request reveal privileges or override size limits.
404 means missing/inaccessible execution. Detailed data is intentionally an open
object in OpenAPI, so the following official runtime interfaces establish its shape.

[Run data v1](https://github.com/n8n-io/n8n/blob/master/packages/workflow/src/run-execution-data/run-execution-data.v1.ts)
and [legacy v0](https://github.com/n8n-io/n8n/blob/master/packages/workflow/src/run-execution-data/run-execution-data.v0.ts):
`data.resultData` contains optional error, runData, lastNodeExecuted, and in v1
optional redactedError. Both versions share those paths; missing version denotes v0.
Unknown data versions must not be interpreted speculatively.

[Runtime interfaces](https://github.com/n8n-io/n8n/blob/master/packages/workflow/src/interfaces.ts):
IRunData maps node names to ITaskData arrays. Each task can have executionTime,
executionStatus, error and redactedError; item data and metadata are excluded.
Repeated runs are reported individually with runIndex, not collapsed into an
invented success/failure. A terminal error's node is strongest evidence; a unique
errored run is a fallback. lastNodeExecuted alone does not prove failure.
IWorkflowBase has optional versionId, activeVersionId and versionCounter.
IRedactedErrorInfo stores the original error class in type (not name), plus
optional httpCode; it deliberately excludes free-text messages/descriptions.

[NodeError](https://github.com/n8n-io/n8n/blob/master/packages/workflow/src/errors/abstract/node.error.ts)
stores a full node and can store arbitrary upstream causes.
[NodeApiError](https://github.com/n8n-io/n8n/blob/master/packages/workflow/src/errors/node-api.error.ts)
uses nullable string httpCode, message and description; its description can be
copied from response data. [NodeOperationError](https://github.com/n8n-io/n8n/blob/master/packages/workflow/src/errors/node-operation.error.ts)
can also hold arbitrary descriptions. Therefore field selection alone is unsafe:
only bounded sanitized technical messages are retained; uncertain prose is omitted.
Error category is a local normalization from known error names, not an API field.

## Workflow updates/version identifiers

[Generated PUT contract](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/workflows/spec/paths/updateWorkflow.generated.yml):
writes supply a workflow definition; versionId is read-only. publishIfActive defaults
true upstream; the existing client always sends false. We retain the full-replacement
contract, inactive-only guard, and manual activation policy. A publishing-related
403 can occur after saving a draft, so uncertain writes are not retried.

[Official public controller](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/controllers/workflows.public.controller.ts)
calls update with forceSave:true, explicitly skipping version conflict checks.
expectedVersionId is our local precondition, not an atomic API compare-and-swap.
The existing per-workflow lock and second pre-write read remain essential, but
cannot eliminate cross-process/manual-edit races. Returned version information
is included only when present. No new speculative headers or write fields are added.

## MCP SDK and Codex

[SDK v1 README](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md)
and [v1 server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/docs/server.md)
confirm McpServer.registerTool, Zod schemas, annotations, isError responses and
local stdio. Preserve installed @modelcontextprotocol/sdk 1.32.0 and Zod 4.6.5;
project V2 does not require migrating to the separately packaged SDK v2.

[Official Codex MCP guidance](https://developers.openai.com/codex/mcp)
was fetched through OpenAI Docs. Local stdio and inherited environment configuration
remain supported. Server instructions should put essential constraints in their
first 512 characters. Annotations are hints; enforce safety in handlers. Existing
Codex configuration and environment files are preserved.

## Compatibility limits

Current upstream is not proof of the self-hosted instance's installed version.
Tests use official-shape fixtures, mocks, and loopback servers only. Missing details
are reported as unavailable, never synthesized. Diagnostic text uses conservative
recognition; arbitrary prose, payload dumps and unknown error names are omitted.
workflow_diff performs one read and local comparison, never a write. Full node
IDs are preferred for matching; ID changes count as removal plus addition.
