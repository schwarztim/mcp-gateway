import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
export class BackendInstance {
    name;
    config;
    client = null;
    transport = null;
    _status = "disconnected";
    _tools = [];
    _error;
    _restartCount = 0;
    _lastConnected;
    logger;
    onToolsChanged;
    connectionGeneration = 0;
    constructor(name, config, logger, onToolsChanged) {
        this.name = name;
        this.config = config;
        this.logger = logger;
        this.onToolsChanged = onToolsChanged;
    }
    get status() {
        return this._status;
    }
    get tools() {
        return this._tools;
    }
    get error() {
        return this._error;
    }
    get restartCount() {
        return this._restartCount;
    }
    get lastConnected() {
        return this._lastConnected;
    }
    getInfo() {
        return {
            name: this.name,
            config: this.config,
            status: this._status,
            tools: this._tools,
            error: this._error,
            restartCount: this._restartCount,
            lastConnected: this._lastConnected,
        };
    }
    async connect() {
        if (!this.config.enabled) {
            this._status = "disabled";
            return;
        }
        const generation = ++this.connectionGeneration;
        this._status = "starting";
        this._error = undefined;
        try {
            this.client = new Client({ name: `mcp-gateway/${this.name}`, version: "1.0.0" }, { capabilities: {} });
            if (this.config.transport === "stdio") {
                await this.connectStdio(this.config);
            }
            else if (this.config.transport === "http") {
                await this.connectHttp(this.config);
            }
            else {
                await this.connectSse(this.config);
            }
            if (generation !== this.connectionGeneration || !this.client || this._status !== "starting") {
                throw new Error(`Connection was cancelled for backend "${this.name}"`);
            }
            // Fetch tools
            const toolsResult = await this.client.listTools();
            if (generation !== this.connectionGeneration || !this.client || this._status !== "starting") {
                throw new Error(`Connection was cancelled for backend "${this.name}"`);
            }
            this._tools = toolsResult.tools;
            this._status = "connected";
            this._lastConnected = new Date();
            this.logger.info(`Backend "${this.name}" connected — ${this._tools.length} tools available`);
        }
        catch (err) {
            if (generation === this.connectionGeneration) {
                this._status = "error";
                this._error = err instanceof Error ? err.message : String(err);
                this.logger.error(`Backend "${this.name}" failed to connect: ${this._error}`);
            }
            throw err;
        }
    }
    async connectStdio(config) {
        const mergedEnv = { ...process.env, ...config.env };
        this.transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            cwd: config.cwd,
            env: mergedEnv,
        });
        // Handle process exit for auto-restart
        this.transport.onclose = () => {
            if (this._status === "connected") {
                this.logger.warn(`Backend "${this.name}" stdio process exited`);
                this._status = "disconnected";
                this.handleDisconnect();
            }
        };
        this.transport.onerror = (err) => {
            this.logger.error(`Backend "${this.name}" stdio error: ${err.message}`);
            this._error = err.message;
        };
        await this.client.connect(this.transport);
    }
    async connectSse(config) {
        const url = new URL(config.url);
        const headers = { ...config.headers };
        this.transport = new SSEClientTransport(url, {
            requestInit: {
                headers,
            },
        });
        this.transport.onclose = () => {
            if (this._status === "connected") {
                this.logger.warn(`Backend "${this.name}" SSE connection closed`);
                this._status = "disconnected";
                this.handleDisconnect();
            }
        };
        this.transport.onerror = (err) => {
            this.logger.error(`Backend "${this.name}" SSE error: ${err.message}`);
            this._error = err.message;
        };
        await this.client.connect(this.transport);
    }
    async connectHttp(config) {
        const url = new URL(config.url);
        const headers = { ...config.headers };
        this.transport = new StreamableHTTPClientTransport(url, {
            requestInit: {
                headers,
            },
        });
        this.transport.onclose = () => {
            if (this._status === "connected") {
                this.logger.warn(`Backend "${this.name}" HTTP connection closed`);
                this._status = "disconnected";
                this.handleDisconnect();
            }
        };
        this.transport.onerror = (err) => {
            this.logger.error(`Backend "${this.name}" HTTP error: ${err.message}`);
            this._error = err.message;
        };
        await this.client.connect(this.transport);
    }
    handleDisconnect() {
        const policy = this.config.transport === "stdio"
            ? this.config.restart_policy
            : this.config.transport === "http"
                ? this.config.restart_policy
                : this.config.restart_policy;
        const maxRestarts = this.config.transport === "stdio"
            ? this.config.max_restarts
            : this.config.transport === "http"
                ? this.config.max_restarts
                : this.config.max_restarts;
        if (policy === "never" ||
            (policy === "on-failure" && this._restartCount >= maxRestarts)) {
            this.logger.warn(`Backend "${this.name}" will not be restarted (policy: ${policy}, restarts: ${this._restartCount}/${maxRestarts})`);
            return;
        }
        this._restartCount++;
        const delay = this.config.transport === "sse"
            ? this.config.reconnect_interval
            : this.config.transport === "http"
                ? this.config.reconnect_interval
                : 2;
        this.logger.info(`Backend "${this.name}" reconnecting in ${delay}s (attempt ${this._restartCount})`);
        setTimeout(async () => {
            try {
                await this.connect();
                this.onToolsChanged?.();
            }
            catch {
                // Error already logged in connect()
            }
        }, delay * 1000);
    }
    /** Call a tool on this backend */
    async callTool(toolName, args) {
        if (!this.client || this._status !== "connected") {
            throw new Error(`Backend "${this.name}" is not connected`);
        }
        return this.client.callTool({ name: toolName, arguments: args });
    }
    /** List resources from this backend */
    async listResources() {
        if (!this.client || this._status !== "connected")
            return [];
        try {
            const result = await this.client.listResources();
            return result.resources;
        }
        catch {
            return [];
        }
    }
    /** Read a resource from this backend */
    async readResource(uri) {
        if (!this.client || this._status !== "connected") {
            throw new Error(`Backend "${this.name}" is not connected`);
        }
        return this.client.readResource({ uri });
    }
    /** List prompts from this backend */
    async listPrompts() {
        if (!this.client || this._status !== "connected")
            return [];
        try {
            const result = await this.client.listPrompts();
            return result.prompts;
        }
        catch {
            return [];
        }
    }
    /** Get a prompt from this backend */
    async getPrompt(name, args) {
        if (!this.client || this._status !== "connected") {
            throw new Error(`Backend "${this.name}" is not connected`);
        }
        return this.client.getPrompt({ name, arguments: args });
    }
    async disconnect() {
        this.connectionGeneration++;
        this._status = "disconnected";
        try {
            await this.transport?.close();
        }
        catch {
            // ignore close errors
        }
        this.client = null;
        this.transport = null;
        this._tools = [];
    }
    async restart() {
        this.logger.info(`Restarting backend "${this.name}"...`);
        await this.disconnect();
        this._restartCount = 0;
        await this.connect();
    }
}
//# sourceMappingURL=backend.js.map