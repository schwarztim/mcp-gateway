export const MUX_TOOL_NAMES = {
    searchTools: "gateway_search_tools",
    callTool: "gateway_call_tool",
    backendStatus: "gateway_backend_status",
    fleetInventory: "gateway_fleet_inventory",
    mcpuConfig: "gateway_mcpu_config",
};
export function isMuxToolName(name) {
    return Object.values(MUX_TOOL_NAMES).includes(name);
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
export function extractCallToolArgs(args) {
    const target = typeof args.tool === "string" ? args.tool : "";
    const targetArgs = typeof args.arguments === "object" &&
        args.arguments !== null &&
        !Array.isArray(args.arguments)
        ? args.arguments
        : {};
    return { target, targetArgs };
}
export function getMuxTools() {
    return [
        {
            name: MUX_TOOL_NAMES.searchTools,
            description: "Search the gateway's connected backend tools without exposing every backend tool schema in tools/list.",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Case-insensitive search text for tool name, description, or backend." },
                    backend: { type: "string", description: "Optional backend name filter." },
                    limit: { type: "number", description: "Maximum matches to return.", default: 25 },
                },
            },
        },
        {
            name: MUX_TOOL_NAMES.callTool,
            description: "Call a namespaced backend tool returned by gateway_search_tools. Large responses are compacted by the gateway.",
            inputSchema: {
                type: "object",
                properties: {
                    tool: { type: "string", description: "Namespaced tool name to call." },
                    arguments: { type: "object", description: "Arguments to pass to the backend tool.", additionalProperties: true },
                    maxOutputChars: {
                        type: "number",
                        description: "Optional response text budget. Defaults to the gateway safe cap.",
                    },
                },
                required: ["tool"],
            },
        },
        {
            name: MUX_TOOL_NAMES.backendStatus,
            description: "Return gateway backend connection status and registered tool counts.",
            inputSchema: {
                type: "object",
                properties: {
                    backend: { type: "string", description: "Optional backend name filter." },
                    limit: { type: "number", description: "Maximum backends to return.", default: 25 },
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
                    limit: { type: "number", description: "Maximum compact fleet entries to return.", default: 25 },
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
                    limit: { type: "number", description: "Maximum config/entry previews to return.", default: 25 },
                },
            },
        },
    ];
}
//# sourceMappingURL=mux-tools.js.map