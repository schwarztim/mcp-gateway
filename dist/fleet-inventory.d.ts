import type { ToolHiveFleetConfig } from "./config.js";
export type FleetHealth = "available" | "degraded" | "unavailable" | "unknown";
export interface FleetRunConfig {
    path: string;
    image?: string;
    containerName?: string;
    baseName?: string;
    transport?: string;
    proxyMode?: string;
    group?: string;
    host?: string;
    port?: number;
    targetHost?: string;
    envKeys: string[];
    secretRefs: string[];
    labelPort?: string;
    labelTransport?: string;
}
export interface FleetStatusFile {
    path: string;
    status?: string;
    statusContext?: string;
    processId?: number;
    proxyProcessAlive?: boolean;
    createdAt?: string;
    updatedAt?: string;
}
export interface FleetDockerContainer {
    id: string;
    name: string;
    image?: string;
    state?: string;
    status?: string;
    labels: Record<string, string>;
    toolhiveName?: string;
    toolhivePort?: string;
    toolhiveTransport?: string;
}
export interface FleetMcpuExposure {
    exposed: boolean;
    type?: string;
    url?: string;
}
export interface FleetEndpointProbe {
    checked: boolean;
    url?: string;
    tcpOpen?: boolean;
    error?: string;
}
export interface FleetRepairHint {
    code: string;
    safeAutomatic: boolean;
    description: string;
}
export interface FleetEntry {
    name: string;
    health: FleetHealth;
    reasons: string[];
    runConfig?: FleetRunConfig;
    statusFile?: FleetStatusFile;
    docker?: FleetDockerContainer;
    mcpu: FleetMcpuExposure;
    endpoint: FleetEndpointProbe;
    repairHints: FleetRepairHint[];
}
export interface FleetInventorySummary {
    total: number;
    byHealth: Record<FleetHealth, number>;
    toolhiveStatuses: Record<string, number>;
    dockerStates: Record<string, number>;
    exposedInMcpu: number;
    withRunConfig: number;
    withStatusFile: number;
    withDockerContainer: number;
    safeAutomaticRepairHints: number;
}
export interface FleetInventory {
    generatedAt: string;
    source: "toolhive";
    paths: {
        appSupportDir: string;
        runconfigsDir: string;
        statusesDir: string;
        mcpuGeneratedConfig: string;
    };
    probeEnabled: boolean;
    dockerPsEnabled: boolean;
    summary: FleetInventorySummary;
    entries: FleetEntry[];
    errors: string[];
}
export declare function buildToolHiveFleetInventory(config?: Partial<ToolHiveFleetConfig>): Promise<FleetInventory>;
//# sourceMappingURL=fleet-inventory.d.ts.map