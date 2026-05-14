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
    private streamableSessionLastSeen;
    private artifacts;
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
    private handleStatelessStreamableRequest;
    private isFacadeMode;
    private getExposedTools;
    private jsonToolResult;
    private handleMuxTool;
    private buildFleetInventory;
    private getListLimit;
    private getCharLimit;
    private truncateText;
    private compactJsonText;
    private storeArtifact;
    private fetchArtifact;
    private compactFleetEntry;
    private searchRegisteredTools;
    private describeRegisteredTool;
    private getBackendStatus;
    private callBackendTool;
    private compactBackendToolResult;
    private touchStreamableSession;
    private dropStreamableSession;
    private reapIdleStreamableSessions;
    private notifyToolsChanged;
    private connectBackend;
    private withTimeout;
    private isFleetIngestedConfig;
    private getBackendUrl;
    private normalizeSearchText;
    private matchesSearch;
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