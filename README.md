# MCP Gateway

A proxy/gateway that aggregates multiple MCP (Model Context Protocol) servers behind a single SSE/HTTP endpoint. Supports dynamic reload of individual backends without disconnecting clients.

## Features

- **Unified endpoint** — Expose all your MCP backends through one SSE URL
- **Tool namespacing** — Tools prefixed with backend namespace to avoid conflicts (e.g. `sn_incidents_list`, `gh_search_code`)
- **Dynamic reload** — Restart/reload individual backends via admin API without dropping client connections
- **Hot config reload** — Edit `config.yaml` and changes apply automatically
- **Health monitoring** — Periodic health checks with auto-reconnect on failure
- **Stdio + SSE backends** — Connect to both local stdio-based and remote SSE-based MCP servers
- **Admin REST API** — Status, reload, enable/disable backends at runtime

## Quick Start

```bash
npm install
npx tsx src/index.ts
# or after building:
npm run build && node dist/index.js
```

The gateway starts on `http://localhost:3100` by default.

## Configuration

Edit `config.yaml`:

```yaml
gateway:
  port: 3100
  host: "0.0.0.0"
  name: "mcp-gateway"

backends:
  servicenow:
    transport: stdio
    command: "node"
    args: ["path/to/servicenow-mcp/dist/index.js"]
    env:
      SERVICENOW_INSTANCE_URL: "${SERVICENOW_INSTANCE_URL}"
    namespace: "sn"
    enabled: true
    restart_policy: "on-failure"

  github:
    transport: stdio
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
    namespace: "gh"
    enabled: true

  akamai:
    transport: sse
    url: "http://akamai-mcp:3001/sse"
    namespace: "akamai"
    enabled: true
    reconnect_interval: 5
```

### Environment Variables

Use `${VAR}` syntax in config values. They're resolved from `process.env` at load time.

## Connecting Clients

Point your MCP client (Claude Desktop, Copilot CLI, etc.) to the gateway's SSE endpoint:

```
http://localhost:3100/sse
```

All backend tools appear namespaced: `{namespace}_{tool_name}`

## Admin API

| Endpoint | Method | Description |
|---|---|---|
| `/admin/status` | GET | Gateway status + tool counts |
| `/admin/backends` | GET | List all backends with status |
| `/admin/reload/:name` | POST | Restart a specific backend |
| `/admin/enable/:name` | POST | Enable a disabled backend |
| `/admin/disable/:name` | POST | Disable a backend |
| `/admin/reload-config` | POST | Reload config.yaml |

### Examples

```bash
# Check status
curl http://localhost:3100/admin/status

# Reload the ServiceNow backend
curl -X POST http://localhost:3100/admin/reload/servicenow

# Disable a backend temporarily
curl -X POST http://localhost:3100/admin/disable/akamai

# Reload entire config (picks up new backends)
curl -X POST http://localhost:3100/admin/reload-config
```

## Docker

```bash
docker compose up -d
```

Mount your `config.yaml` and pass environment variables through `docker-compose.yml`.

## Architecture

```
Client (Claude/Copilot)
    │ SSE
    ▼
┌─────────────────────────┐
│     MCP Gateway         │
│  ┌───────────────────┐  │
│  │  Tool Registry    │  │ ← namespaced tool aggregation
│  └───────────────────┘  │
│  ┌──────┐ ┌──────┐      │
│  │stdio │ │ sse  │ ...  │ ← backend connections
│  └──────┘ └──────┘      │
└─────────────────────────┘
    │           │
    ▼           ▼
  Local MCP   Remote MCP
  (process)   (HTTP/SSE)
```

## License

MIT
