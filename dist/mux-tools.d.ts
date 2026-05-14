import type { Tool } from "@modelcontextprotocol/sdk/types.js";
export declare const MUX_TOOL_NAMES: {
    readonly searchTools: "gateway_search_tools";
    readonly describeTool: "gateway_describe_tool";
    readonly callTool: "gateway_call_tool";
    readonly fetchArtifact: "gateway_fetch_artifact";
    readonly backendStatus: "gateway_backend_status";
    readonly fleetInventory: "gateway_fleet_inventory";
    readonly mcpuConfig: "gateway_mcpu_config";
};
export type MuxToolName = (typeof MUX_TOOL_NAMES)[keyof typeof MUX_TOOL_NAMES];
export declare function isMuxToolName(name: string): name is MuxToolName;
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
export declare function extractCallToolArgs(args: Record<string, unknown>): {
    target: string;
    targetArgs: Record<string, unknown>;
};
export declare function getMuxTools(): Tool[];
//# sourceMappingURL=mux-tools.d.ts.map