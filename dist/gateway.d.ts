import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
export declare class Gateway {
    private config;
    private configPath;
    private logger;
    private app;
    private toolRegistry;
    private backends;
    private sseTransports;
    private streamableTransports;
    private sessions;
    private healthTimer?;
    private httpServer?;
    private configWatcher?;
    private configReloadInFlight?;
    private fleetIngestInFlight?;
    constructor(config: Config, configPath: string, logger: Logger);
    private createSessionServer;
    private setupMcpHandlers;
    private setupHttpRoutes;
    private headerValue;
    private getExposedTools;
    private jsonToolResult;
    private handleMuxTool;
    private buildFleetInventory;
    private searchRegisteredTools;
    private getBackendStatus;
    private callBackendTool;
    private notifyToolsChanged;
    private connectBackend;
    private isFleetIngestedConfig;
    private getBackendUrl;
    private backendConfigChanged;
    private requireAdminAccess;
    private isLoopbackAddress;
    reloadConfig(): Promise<void>;
    private reloadConfigUnlocked;
    /**
     * Ingest fleet backends from MCPU generated config.
     * Skips any backend already registered (static config takes precedence).
     * Returns the raw ingest result for admin/logging use.
     */
    private ingestFleetBackends;
    private ingestFleetBackendsUnlocked;
    start(): Promise<void>;
    stop(): Promise<void>;
    private startHealthMonitor;
}
//# sourceMappingURL=gateway.d.ts.map