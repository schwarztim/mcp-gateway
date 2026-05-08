import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type {
  BackendConfig,
  StdioBackendConfig,
  SseBackendConfig,
  HttpBackendConfig,
} from "./config.js";
import type { Logger } from "./logger.js";

export type BackendStatus =
  | "starting"
  | "connected"
  | "disconnected"
  | "error"
  | "disabled";

export interface BackendInfo {
  name: string;
  config: BackendConfig;
  status: BackendStatus;
  tools: Tool[];
  error?: string;
  restartCount: number;
  lastConnected?: Date;
}

export class BackendInstance {
  readonly name: string;
  readonly config: BackendConfig;
  private client: Client | null = null;
  private transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport | null = null;
  private _status: BackendStatus = "disconnected";
  private _tools: Tool[] = [];
  private _error?: string;
  private _restartCount = 0;
  private _lastConnected?: Date;
  private logger: Logger;
  private onToolsChanged?: () => void;

  constructor(
    name: string,
    config: BackendConfig,
    logger: Logger,
    onToolsChanged?: () => void
  ) {
    this.name = name;
    this.config = config;
    this.logger = logger;
    this.onToolsChanged = onToolsChanged;
  }

  get status(): BackendStatus {
    return this._status;
  }
  get tools(): Tool[] {
    return this._tools;
  }
  get error(): string | undefined {
    return this._error;
  }
  get restartCount(): number {
    return this._restartCount;
  }
  get lastConnected(): Date | undefined {
    return this._lastConnected;
  }

  getInfo(): BackendInfo {
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

  async connect(): Promise<void> {
    if (!this.config.enabled) {
      this._status = "disabled";
      return;
    }

    this._status = "starting";
    this._error = undefined;

    try {
      this.client = new Client(
        { name: `mcp-gateway/${this.name}`, version: "1.0.0" },
        { capabilities: {} }
      );

      if (this.config.transport === "stdio") {
        await this.connectStdio(this.config);
      } else if (this.config.transport === "http") {
        await this.connectHttp(this.config);
      } else {
        await this.connectSse(this.config);
      }

      // Fetch tools
      const toolsResult = await this.client.listTools();
      this._tools = toolsResult.tools;
      this._status = "connected";
      this._lastConnected = new Date();
      this.logger.info(
        `Backend "${this.name}" connected — ${this._tools.length} tools available`
      );
    } catch (err) {
      this._status = "error";
      this._error = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Backend "${this.name}" failed to connect: ${this._error}`
      );
      throw err;
    }
  }

  private async connectStdio(config: StdioBackendConfig): Promise<void> {
    const mergedEnv = { ...process.env, ...config.env };
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: mergedEnv as Record<string, string>,
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

    await this.client!.connect(this.transport);
  }

  private async connectSse(config: SseBackendConfig): Promise<void> {
    const url = new URL(config.url);
    const headers: Record<string, string> = { ...config.headers };
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

    await this.client!.connect(this.transport);
  }

  private async connectHttp(config: HttpBackendConfig): Promise<void> {
    const url = new URL(config.url);
    const headers: Record<string, string> = { ...config.headers };
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

    await this.client!.connect(this.transport);
  }

  private handleDisconnect(): void {
    const policy =
      this.config.transport === "stdio"
        ? this.config.restart_policy
        : this.config.transport === "http"
          ? this.config.restart_policy
          : this.config.restart_policy;
    const maxRestarts =
      this.config.transport === "stdio"
        ? this.config.max_restarts
        : this.config.transport === "http"
          ? this.config.max_restarts
          : this.config.max_restarts;

    if (
      policy === "never" ||
      (policy === "on-failure" && this._restartCount >= maxRestarts)
    ) {
      this.logger.warn(
        `Backend "${this.name}" will not be restarted (policy: ${policy}, restarts: ${this._restartCount}/${maxRestarts})`
      );
      return;
    }

    this._restartCount++;
    const delay =
      this.config.transport === "sse"
        ? this.config.reconnect_interval
        : this.config.transport === "http"
          ? this.config.reconnect_interval
          : 2;
    this.logger.info(
      `Backend "${this.name}" reconnecting in ${delay}s (attempt ${this._restartCount})`
    );

    setTimeout(async () => {
      try {
        await this.connect();
        this.onToolsChanged?.();
      } catch {
        // Error already logged in connect()
      }
    }, delay * 1000);
  }

  /** Call a tool on this backend */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.client || this._status !== "connected") {
      throw new Error(`Backend "${this.name}" is not connected`);
    }
    return this.client.callTool({ name: toolName, arguments: args });
  }

  /** List resources from this backend */
  async listResources() {
    if (!this.client || this._status !== "connected") return [];
    try {
      const result = await this.client.listResources();
      return result.resources;
    } catch {
      return [];
    }
  }

  /** Read a resource from this backend */
  async readResource(uri: string) {
    if (!this.client || this._status !== "connected") {
      throw new Error(`Backend "${this.name}" is not connected`);
    }
    return this.client.readResource({ uri });
  }

  /** List prompts from this backend */
  async listPrompts() {
    if (!this.client || this._status !== "connected") return [];
    try {
      const result = await this.client.listPrompts();
      return result.prompts;
    } catch {
      return [];
    }
  }

  /** Get a prompt from this backend */
  async getPrompt(name: string, args?: Record<string, string>) {
    if (!this.client || this._status !== "connected") {
      throw new Error(`Backend "${this.name}" is not connected`);
    }
    return this.client.getPrompt({ name, arguments: args });
  }

  async disconnect(): Promise<void> {
    this._status = "disconnected";
    try {
      await this.transport?.close();
    } catch {
      // ignore close errors
    }
    this.client = null;
    this.transport = null;
    this._tools = [];
  }

  async restart(): Promise<void> {
    this.logger.info(`Restarting backend "${this.name}"...`);
    await this.disconnect();
    this._restartCount = 0;
    await this.connect();
  }
}
