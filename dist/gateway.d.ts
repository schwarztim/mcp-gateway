import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
export declare class Gateway {
    private config;
    private configPath;
    private logger;
    private app;
    private toolRegistry;
    private backends;
    private transports;
    private server;
    constructor(config: Config, configPath: string, logger: Logger);
    private setupMcpHandlers;
    private setupHttpRoutes;
    private notifyToolsChanged;
    private connectBackend;
    reloadConfig(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
}
//# sourceMappingURL=gateway.d.ts.map