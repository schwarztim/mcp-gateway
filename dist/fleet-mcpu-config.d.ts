import type { FleetInventory, FleetRepairHint } from "./fleet-inventory.js";
export interface FleetMcpuServerConfig {
    type: "streamable-http" | "sse";
    url: string;
    description: string;
}
export interface FleetMcpuConfigEntry {
    name: string;
    included: boolean;
    health: string;
    url?: string;
    type?: FleetMcpuServerConfig["type"];
    reasons: string[];
    repairHints: FleetRepairHint[];
}
export interface FleetMcpuConfigReport {
    generatedAt: string;
    mode: "read-only";
    config: Record<string, FleetMcpuServerConfig>;
    summary: {
        totalCatalogEntries: number;
        included: number;
        omitted: number;
        degradedIncluded: number;
        safeAutomaticRepairHints: number;
    };
    entries: FleetMcpuConfigEntry[];
}
export declare function buildFleetMcpuConfig(inventory: FleetInventory): FleetMcpuConfigReport;
//# sourceMappingURL=fleet-mcpu-config.d.ts.map