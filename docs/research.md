# Documentation verification — 2026-10-03

Research was completed before implementation using Context7 and primary sources.
Context7 IDs: `/n8n-io/n8n-docs`, `/modelcontextprotocol/typescript-sdk/__branch__v1.x`,
and `/openai/codex`. npm metadata was also checked for the requested SDK package.
The lockfile records the installed dependency versions.

## n8n public API

- [Authentication, official docs source](https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/n8n-api/authentication.md)
- [OpenAPI root](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/openapi.yml)
- [Create endpoint](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/workflows/spec/paths/createWorkflow.generated.yml)
- [Update endpoint](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/workflows/spec/paths/updateWorkflow.generated.yml)
- [Get endpoint](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/workflows/spec/paths/getWorkflow.generated.yml)
- [List endpoint](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/workflows/spec/paths/getWorkflows.generated.yml)
- [Execution endpoint](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/executions/spec/paths/getExecution.generated.yml)
- [Workflow schema](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/workflows/spec/schemas/workflow.yml)
- [Node schema](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/workflows/spec/schemas/node.yml)
- [Settings schema](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/workflows/spec/schemas/workflowSettings.yml)

The implementation uses `X-N8N-API-KEY`, `/api/v1/workflows`,
`/api/v1/workflows/{id}`, and `/api/v1/executions/{id}`. Create uses POST; update
uses PUT. Workflow writes require name, nodes, connections, and settings.
The API marks active as read-only. Updates use publishIfActive=false to avoid
automatic republication. List supports limit and opaque cursor pagination.

The generated endpoint schemas are the primary contract where shared schemas differ.
Only a conservative subset of writable fields is exposed; project/folder moves and
sharing changes are deliberately not supported. The instance's installed version may
lag current upstream; no live compatibility claim is made without testing that instance.

## MCP and Codex

- [Official MCP SDK v1 README](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md)
- [Official MCP server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/docs/server.md)
- [Official Codex MCP documentation](https://developers.openai.com/codex/mcp)

Use `McpServer.registerTool`, Zod schemas, tool annotations, and `StdioServerTransport`.
The requested `@modelcontextprotocol/sdk` package is the v1 SDK line (installed 1.32.0).
The repository also has a separately packaged v2 line; examples from that line must
not be mixed into this package. Local stdio remains supported; no deprecated SSE or
Codex-as-MCP-server architecture is used. This is an external tool server consumed by Codex.

Codex configuration uses `[mcp_servers.NAME]`, command, args, cwd, and env_vars.
Desktop, CLI, and IDE share host configuration. Secrets are forwarded from the
environment rather than stored in the TOML file.
