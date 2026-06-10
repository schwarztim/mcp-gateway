import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const MUX_TOOL_NAMES = {
  searchTools: "gateway_search_tools",
  describeTool: "gateway_describe_tool",
  callTool: "gateway_call_tool",
  fetchArtifact: "gateway_fetch_artifact",
  backendStatus: "gateway_backend_status",
  fleetInventory: "gateway_fleet_inventory",
  mcpuConfig: "gateway_mcpu_config",
  reconnectBackend: "gateway_reconnect_backend",
} as const;

export type MuxToolName = (typeof MUX_TOOL_NAMES)[keyof typeof MUX_TOOL_NAMES];

export function isMuxToolName(name: string): name is MuxToolName {
  return Object.values(MUX_TOOL_NAMES).includes(name as MuxToolName);
}

/**
 * Pure helper that extracts the target tool name and forwarded arguments from
 * gateway_call_tool input args. Exported for unit testing.
 *
 * The `arguments` field must be a plain object nested under the `arguments` key —
 * extra top-level properties are intentionally ignored. This documents the
 * original failure mode: passing pageId at the top level (instead of under
 * `arguments`) silently produces an empty targetArgs and causes the backend to
 * receive no arguments (e.g. Confluence 404).
 */
export function extractCallToolArgs(args: Record<string, unknown>): {
  target: string;
  targetArgs: Record<string, unknown>;
} {
  const target = typeof args.tool === "string" ? args.tool : "";
  const targetArgs =
    typeof args.arguments === "object" &&
    args.arguments !== null &&
    !Array.isArray(args.arguments)
      ? (args.arguments as Record<string, unknown>)
      : {};
  return { target, targetArgs };
}

export function getMuxTools(): Tool[] {
  return [
    {
      name: MUX_TOOL_NAMES.searchTools,
      description: "Search connected backend tools without exposing every backend tool schema in tools/list. Requires query or backend filter.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Case-insensitive search text for tool name, description, or backend." },
          backend: { type: "string", description: "Optional backend name filter." },
          limit: { type: "number", description: "Maximum matches to return.", default: 10 },
        },
      },
    },
    {
      name: MUX_TOOL_NAMES.describeTool,
      description: "Describe one namespaced backend tool returned by gateway_search_tools. Full schema is capped and referenced if oversized.",
      inputSchema: {
        type: "object",
        properties: {
          tool: { type: "string", description: "Namespaced tool name to describe." },
        },
        required: ["tool"],
      },
    },
    {
      name: MUX_TOOL_NAMES.callTool,
      description: "Call one namespaced backend tool returned by gateway_search_tools. Large responses are compacted with artifact refs. Safety contract: tools classified as WRITE, SIDE_EFFECT, HUMAN_OUTBOUND, PRODUCTION, or VAULT_VALUE require confirmed:true to authorize the call. Blocking is the default posture: an unconfirmed write-class call returns a confirmationRequired response with a redacted argument preview and is not dispatched. READ tools need no confirmation. UNCLASSIFIED tools (no manifest entry, no write-verb match) proceed with a logged warning in every mode. In advisory mode unconfirmed write-class calls are logged but still proceed.",
      inputSchema: {
        type: "object",
        properties: {
          tool: { type: "string", description: "Namespaced tool name to call." },
          arguments: { type: "object", description: "Arguments to pass to the backend tool.", additionalProperties: true },
          maxOutputChars: {
            type: "number",
            description: "Optional response text budget. Defaults to the gateway facade cap and is bounded by a hard max.",
          },
          confirmed: {
            type: "boolean",
            description: "Set true to authorize a tool the gateway classifies as WRITE/SIDE_EFFECT/HUMAN_OUTBOUND/PRODUCTION/VAULT_VALUE. READ and UNCLASSIFIED tools need no confirmation.",
          },
        },
        required: ["tool"],
      },
    },
    {
      name: MUX_TOOL_NAMES.fetchArtifact,
      description: "Fetch a capped page from an oversized response artifact previously returned by the gateway.",
      inputSchema: {
        type: "object",
        properties: {
          artifactId: { type: "string", description: "Artifact ID returned by another gateway tool." },
          offset: { type: "number", description: "Character offset to start reading from.", default: 0 },
          maxChars: { type: "number", description: "Maximum characters to return.", default: 8000 },
        },
        required: ["artifactId"],
      },
    },
    {
      name: MUX_TOOL_NAMES.backendStatus,
      description: "Return compact gateway backend health counts. Backend lists are returned only with a filter or includeBackends=true.",
      inputSchema: {
        type: "object",
        properties: {
          backend: { type: "string", description: "Optional backend name filter." },
          limit: { type: "number", description: "Maximum backends to return when listing.", default: 10 },
          includeBackends: { type: "boolean", description: "Include a capped backend list. Defaults to false unless backend is set.", default: false },
          includeErrors: { type: "boolean", description: "Include truncated backend error text.", default: false },
          includeDescriptions: { type: "boolean", description: "Include truncated backend descriptions.", default: false },
        },
      },
    },
    {
      name: MUX_TOOL_NAMES.fleetInventory,
      description: "Return the read-only ToolHive fleet inventory or summary, including degraded backend reasons and repair hints.",
      inputSchema: {
        type: "object",
        properties: {
          summaryOnly: { type: "boolean", description: "Return only summary counts and source paths. Defaults to true.", default: true },
          includeEntries: { type: "boolean", description: "Return a capped compact entry list. Full raw inventory is available only through the local admin API.", default: false },
          limit: { type: "number", description: "Maximum compact fleet entries to return.", default: 10 },
          probe: { type: "boolean", description: "Run TCP endpoint checks while building the inventory.", default: false },
        },
      },
    },
    {
      name: MUX_TOOL_NAMES.mcpuConfig,
      description: "Generate a read-only MCPU-compatible server config from the durable ToolHive fleet catalog, preserving degraded entries with reasons.",
      inputSchema: {
        type: "object",
        properties: {
          probe: { type: "boolean", description: "Run TCP endpoint checks while building the source inventory.", default: false },
          configOnly: { type: "boolean", description: "Return a capped compact mcpServers-compatible config preview.", default: false },
          includeEntries: { type: "boolean", description: "Include a capped compact source-entry preview.", default: false },
          limit: { type: "number", description: "Maximum config/entry previews to return.", default: 10 },
        },
      },
    },
    {
      name: MUX_TOOL_NAMES.reconnectBackend,
      description: "Force a fresh transport session to one backend without bouncing the whole gateway. Use after a backend container restart (cookie reauth, image upgrade) when the gateway is still holding a stale session and tool calls return -32001 'Session not found'. Other backends are untouched.",
      inputSchema: {
        type: "object",
        properties: {
          backend: { type: "string", description: "Backend name to reconnect (e.g. 'servicenow')." },
        },
        required: ["backend"],
      },
    },
  ];
}
