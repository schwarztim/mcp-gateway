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
            description: "Call a namespaced backend tool returned by gateway_search_tools.",
            inputSchema: {
                type: "object",
                properties: {
                    tool: { type: "string", description: "Namespaced tool name to call." },
                    arguments: { type: "object", description: "Arguments to pass to the backend tool.", additionalProperties: true },
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
                },
            },
        },
        {
            name: MUX_TOOL_NAMES.fleetInventory,
            description: "Return the read-only ToolHive fleet inventory or summary, including degraded backend reasons and repair hints.",
            inputSchema: {
                type: "object",
                properties: {
                    summaryOnly: { type: "boolean", description: "Return only summary counts and source paths.", default: true },
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
                    configOnly: { type: "boolean", description: "Return only the mcpServers-compatible config object.", default: false },
                },
            },
        },
    ];
}
//# sourceMappingURL=mux-tools.js.map