import type { HttpBackendConfig, SseBackendConfig, StdioBackendConfig, ToolHiveFleetConfig } from "./config.js";
import type { Logger } from "./logger.js";
export type FleetBackendConfig = HttpBackendConfig | SseBackendConfig | StdioBackendConfig;
export interface FleetIngestResult {
    backends: Record<string, FleetBackendConfig>;
    skipped: Array<{
        name: string;
        reason: string;
    }>;
    source: string;
    sources: string[];
    generatedAt: string;
}
/**
 * Load the MCPU-generated config from disk and convert eligible entries to
 * gateway backend configs.
 */
export declare function loadFleetBackendsFromMcpuConfig(fleetConfig: ToolHiveFleetConfig, logger: Logger): Promise<FleetIngestResult>;
//# sourceMappingURL=fleet-backend-ingestion.d.ts.map