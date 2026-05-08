import type { Tool } from "@modelcontextprotocol/sdk/types.js";
export declare const MUX_TOOL_NAMES: {
    readonly searchTools: "gateway_search_tools";
    readonly callTool: "gateway_call_tool";
    readonly backendStatus: "gateway_backend_status";
    readonly fleetInventory: "gateway_fleet_inventory";
    readonly mcpuConfig: "gateway_mcpu_config";
};
export type MuxToolName = (typeof MUX_TOOL_NAMES)[keyof typeof MUX_TOOL_NAMES];
export declare function isMuxToolName(name: string): name is MuxToolName;
export declare function getMuxTools(): Tool[];
//# sourceMappingURL=mux-tools.d.ts.map