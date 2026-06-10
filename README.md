# MCP Gateway

MCP Gateway is a local-first gateway for large Model Context Protocol fleets. It lets Claude Code, Copilot CLI, and other MCP clients connect to one stable Streamable HTTP endpoint while the gateway manages many backend MCP servers behind a compact mux surface.

The main goal is context control: clients can list only a few gateway tools, search backend tools on demand, and call the selected backend tool without loading hundreds of backend tool schemas into every session.

## What it provides

- **One client endpoint**: `http://127.0.0.1:3100/mcp` for Streamable HTTP clients, plus legacy `/sse` support.
- **Facade mux mode**: expose only gateway tools instead of every backend tool schema, resource list, or prompt list.
- **Dynamic backend ingestion**: read the MCPU-generated ToolHive config and connect reachable HTTP MCP backends automatically.
- **Read-only fleet inventory**: inspect ToolHive runconfigs, status files, generated MCPU exposure, optional Docker state, and endpoint health.
- **Stable reload behavior**: reload config or fleet entries without dropping the whole gateway.
- **Backend reconnects**: health monitor reconnects failed backends and re-registers tools.
- **Resilience harness**: simulates 500 fleet entries to keep context surface and degradation behavior honest.

## Gateway mux tools

When `gateway.tool_exposure` is set to `mux`, clients see only:

| Tool | Purpose |
|---|---|
| `gateway_search_tools` | Search connected backend tools without exposing every backend schema in `tools/list`; empty inventory dumps are refused. |
| `gateway_describe_tool` | Lazily describe one selected backend tool schema. |
| `gateway_call_tool` | Call a namespaced backend tool returned by search. |
| `gateway_fetch_artifact` | Fetch a capped page from an oversized result artifact. |
| `gateway_backend_status` | Show backend connection state, tool counts, and quarantined stdio fleet entries. |
| `gateway_fleet_inventory` | Inspect the read-only ToolHive fleet catalog. |
| `gateway_mcpu_config` | Generate a read-only MCPU-compatible fleet config report. |

## Quick start

```bash
npm install
npm run build
npm run start:fleet
```

The included `config.fleet.yaml` starts a local mux gateway on `127.0.0.1:3100` and auto-ingests HTTP MCP backends from `~/.config/mcpu/config.generated.json`.

## Configuration

```yaml
gateway:
  port: 3100
  host: "127.0.0.1"
  name: "mcp-gateway"
  tool_exposure: "mux"
  streamable_http_stateless: true
  streamable_http_json_response: true

fleet:
  enabled: true
  toolhive:
    mcpu_generated_config: "~/.config/mcpu/config.generated.json"
    docker_ps: true
    endpoint_probe: false
    auto_ingest: true
    ingest_namespace_prefix: ""
    ingest_skip:
      - mcpu
      - inspector

backends: {}
```

`gateway.tool_exposure` modes:

| Mode | Behavior |
|---|---|
| `mux` | Expose only the compact gateway tools. Recommended for large fleets. |
| `namespaced` | Expose all backend tools directly with namespace prefixes. |
| `both` | Expose gateway tools and all backend tools. |

In `mux` mode, backend resources and prompts are also hidden from client list calls. Large responses are capped by default, stored as in-memory artifacts, and can be paged explicitly with `gateway_fetch_artifact`. Streamable HTTP is stateless by default so stale client session IDs after a gateway restart do not keep producing `Session not found`.

Static backends can still be configured under `backends` using `http` (Streamable HTTP) or `sse` transports. `stdio` is not a representable backend transport: any `transport: stdio` entry is stripped at config load with a console error naming the backend (reason `stdio-unsupported`, remedy: re-front it behind streamable-http) and the gateway boots on without it, while `command:`-style entries found during fleet ingestion are quarantined into a `quarantined[]` list surfaced by `gateway_backend_status` instead of being connected.

## Safety gating

Every dispatch path is gated: the safety gate fires for both `gateway_call_tool` and direct namespaced tool calls, and `safety.enforce` defaults to `"blocking"`. Tool classification is graduated:

- **Manifested tools** use the class declared in their manifest (`manifests/*.json`).
- **Unmanifested tools** whose names contain a write-class verb (the built-in list plus extensions such as `execute`, `run`, `deploy`, `merge`, `revoke`, `kill`, and other mutating verbs) are classified WRITE and gated.
- **Unmanifested verb-less tools** are UNCLASSIFIED: the call proceeds with a warning and telemetry in all modes, and boot logs a per-backend report of unclassified tools — use it to draft the missing manifests.

A blocking deny returns `{ confirmationRequired: true, tool, safetyClass, source, reason, redactedArguments }`. Direct-path denials additionally include `remedy: "invoke via gateway_call_tool with confirmed:true"`, since the direct path has no confirmation envelope.

Dispatch decisions can be recorded to a JSONL decision log (off by default; fail-open on write errors):

```yaml
safety:
  enforce: "blocking"
  decision_log:
    enabled: false
    path: "~/.mcp-gateway/decisions.jsonl"
```

When enabled, each dispatch decision writes one line: `{ ts, path, tool, backend, safetyClass, source, decision, enforce }`.

## Client setup

Point Claude Code, Copilot CLI, or any Streamable HTTP MCP client at:

```text
http://127.0.0.1:3100/mcp
```

Keep existing MCPU/ToolHive registrations in place until the gateway has proven stable in your environment. The gateway is designed to run alongside them first, then replace direct fleet access when you are ready.

## Admin API

Admin routes are restricted to loopback clients by default. If the gateway is exposed beyond loopback, set `MCP_GATEWAY_ADMIN_TOKEN` and pass `Authorization: Bearer <token>`.

| Endpoint | Method | Description |
|---|---|---|
| `/admin/status` | GET | Gateway status and tool counts. |
| `/admin/backends` | GET | List all backends with status. |
| `/admin/reload/:name` | POST | Restart a specific backend. |
| `/admin/enable/:name` | POST | Enable a disabled backend. |
| `/admin/disable/:name` | POST | Disable a backend. |
| `/admin/reload-config` | POST | Reload the gateway config file. |
| `/admin/fleet/summary` | GET | ToolHive fleet counts, health summary, and source paths. |
| `/admin/fleet/inventory` | GET | Full read-only ToolHive fleet catalog; add `?probe=true` for TCP endpoint checks. |
| `/admin/fleet/mcpu-config` | GET | Read-only MCPU-compatible config report; add `?configOnly=true` for only the config object. |
| `/admin/fleet/backends` | GET | List auto-ingested fleet backends. |
| `/admin/fleet/reload` | POST | Re-read generated MCPU config and refresh fleet backends. |

## Validation

```bash
npm run build         # tsc — must be clean
npm run test:unit     # vitest --project unit — fast unit suite
npm run test:e2e      # vitest --project e2e — wire-level invariant suite (real gateway + real backends)
npm test              # both projects
npm run harness       # resilience harness (simulated fleet)
```

`npm run test:e2e` boots a real gateway against real in-process MCP backends and proves the phase-0 invariants by name: meta + namespaced tool exposure, mux and direct round-trips, the WRITE confirmation gate (identical on both paths), stdio config/fleet quarantine, and unclassified warn-and-proceed. The post-integration cases run under `GW_E2E_FULL=1`.

The harness verifies:

- 500 simulated fleet entries remain represented.
- Degraded entries stay discoverable with reasons.
- The client-facing mux surface remains fewer than 10 facade tools.
- Changed backend ports are resolved from the latest fleet state.

## Repository READMEs

- `README.github.md` contains the public/open-source publication notes.
- `README.stash.md` contains internal Stash deployment notes and live fleet wiring guidance.

## License

MIT