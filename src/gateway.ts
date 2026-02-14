import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import type { Request, Response } from "express";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import { ToolRegistry } from "./tool-registry.js";
import { BackendInstance } from "./backend.js";
import { watch } from "chokidar";
import { loadConfig } from "./config.js";

export class Gateway {
  private config: Config;
  private configPath: string;
  private logger: Logger;
  private app = express();
  private toolRegistry: ToolRegistry;
  private backends = new Map<string, BackendInstance>();
  private transports = new Map<string, SSEServerTransport>();
  private server: McpServer;

  private healthTimer?: ReturnType<typeof setInterval>;

  constructor(config: Config, configPath: string, logger: Logger) {
    this.config = config;
    this.configPath = configPath;
    this.logger = logger;
    this.toolRegistry = new ToolRegistry(logger);

    this.server = new McpServer(
      { name: config.gateway.name, version: "1.0.0" },
      { capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} } }
    );

    this.setupMcpHandlers();
    this.setupHttpRoutes();
  }

  private setupMcpHandlers(): void {
    // We override the tool list handler on the underlying Server
    const lowLevel = this.server.server;

    lowLevel.setRequestHandler(
      ListToolsRequestSchema,
      async (): Promise<{ tools: any[] }> => {
        return { tools: this.toolRegistry.getAllTools() };
      }
    );

    lowLevel.setRequestHandler(
      CallToolRequestSchema,
      async (request: any): Promise<{ content: any[]; isError?: boolean }> => {
        const toolName: string = request.params.name;
        const args: Record<string, unknown> = request.params.arguments ?? {};

        const entry = this.toolRegistry.resolve(toolName);
        if (!entry) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Unknown tool: ${toolName}. Use tools/list to see available tools.`,
              },
            ],
            isError: true,
          };
        }

        const backend = this.backends.get(entry.backendName);
        if (!backend || backend.status !== "connected") {
          return {
            content: [
              {
                type: "text" as const,
                text: `Backend "${entry.backendName}" is not connected (status: ${backend?.status ?? "unknown"}).`,
              },
            ],
            isError: true,
          };
        }

        try {
          const result = await backend.callTool(entry.originalName, args);
          return result as { content: any[]; isError?: boolean };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error calling ${entry.originalName} on backend "${entry.backendName}": ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // Resource handlers
    lowLevel.setRequestHandler(
      ListResourcesRequestSchema,
      async (): Promise<{ resources: any[] }> => {
        const allResources: any[] = [];
        for (const [name, backend] of this.backends) {
          if (backend.status !== "connected") continue;
          try {
            const resources = await backend.listResources();
            const ns = this.config.backends[name]?.namespace ?? name;
            for (const r of resources) {
              allResources.push({ ...r, name: `${ns}_${r.name}` });
            }
          } catch {
            // skip backends that don't support resources
          }
        }
        return { resources: allResources };
      }
    );

    lowLevel.setRequestHandler(
      ReadResourceRequestSchema,
      async (request: any): Promise<{ contents: any[] }> => {
        const uri: string = request.params.uri;
        // Try each backend until one handles the URI
        for (const [, backend] of this.backends) {
          if (backend.status !== "connected") continue;
          try {
            const result = await backend.readResource(uri);
            return result as { contents: any[] };
          } catch {
            // try next
          }
        }
        return { contents: [{ uri, text: `Resource not found: ${uri}` }] };
      }
    );

    // Prompt handlers
    lowLevel.setRequestHandler(
      ListPromptsRequestSchema,
      async (): Promise<{ prompts: any[] }> => {
        const allPrompts: any[] = [];
        for (const [name, backend] of this.backends) {
          if (backend.status !== "connected") continue;
          try {
            const prompts = await backend.listPrompts();
            const ns = this.config.backends[name]?.namespace ?? name;
            for (const p of prompts) {
              allPrompts.push({ ...p, name: `${ns}_${p.name}` });
            }
          } catch {
            // skip backends that don't support prompts
          }
        }
        return { prompts: allPrompts };
      }
    );

    lowLevel.setRequestHandler(
      GetPromptRequestSchema,
      async (request: any): Promise<{ messages: any[] }> => {
        const promptName: string = request.params.name;
        // Find the backend by namespace prefix
        for (const [name, backend] of this.backends) {
          if (backend.status !== "connected") continue;
          const ns = this.config.backends[name]?.namespace ?? name;
          if (promptName.startsWith(`${ns}_`)) {
            const originalName = promptName.slice(ns.length + 1);
            try {
              const result = await backend.getPrompt(
                originalName,
                request.params.arguments
              );
              return result as { messages: any[] };
            } catch (err) {
              return {
                messages: [
                  {
                    role: "assistant" as const,
                    content: {
                      type: "text" as const,
                      text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                    },
                  },
                ],
              };
            }
          }
        }
        return {
          messages: [
            {
              role: "assistant" as const,
              content: {
                type: "text" as const,
                text: `Unknown prompt: ${promptName}`,
              },
            },
          ],
        };
      }
    );
  }

  private setupHttpRoutes(): void {
    this.app.use(express.json());

    // SSE endpoint for MCP clients
    this.app.get("/sse", async (req: Request, res: Response) => {
      this.logger.info(`New SSE connection from ${req.ip}`);
      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;
      this.transports.set(sessionId, transport);

      transport.onclose = () => {
        this.transports.delete(sessionId);
        this.logger.debug(`SSE session ${sessionId} closed`);
      };

      await this.server.server.connect(transport);
    });

    // Message endpoint for MCP clients
    this.app.post("/messages", async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      const transport = this.transports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      await transport.handlePostMessage(req, res);
    });

    // Admin API
    this.app.get("/admin/backends", (_req: Request, res: Response) => {
      const backends = Array.from(this.backends.values()).map((b) => ({
        name: b.name,
        namespace: b.config.namespace,
        transport: b.config.transport,
        status: b.status,
        toolCount: b.tools.length,
        error: b.error,
        restartCount: b.restartCount,
        lastConnected: b.lastConnected,
        enabled: b.config.enabled,
      }));
      res.json({ backends });
    });

    this.app.post(
      "/admin/reload/:name",
      async (req: Request, res: Response) => {
        const backendName = req.params.name as string;
        const backend = this.backends.get(backendName);
        if (!backend) {
          res.status(404).json({ error: `Backend "${backendName}" not found` });
          return;
        }

        try {
          await backend.restart();
          this.toolRegistry.registerBackend(
            backendName,
            backend.config.namespace,
            backend.tools
          );
          this.notifyToolsChanged();
          res.json({
            status: "ok",
            message: `Backend "${backendName}" reloaded`,
            toolCount: backend.tools.length,
          });
        } catch (err) {
          res.status(500).json({
            error: `Failed to reload backend "${backendName}": ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    );

    this.app.post(
      "/admin/enable/:name",
      async (req: Request, res: Response) => {
        const backendName = req.params.name as string;
        const backend = this.backends.get(backendName);
        if (!backend) {
          res.status(404).json({ error: `Backend "${backendName}" not found` });
          return;
        }

        (backend.config as any).enabled = true;
        try {
          await backend.restart();
          this.toolRegistry.registerBackend(
            backendName,
            backend.config.namespace,
            backend.tools
          );
          this.notifyToolsChanged();
          res.json({ status: "ok", message: `Backend "${backendName}" enabled` });
        } catch (err) {
          res.status(500).json({
            error: `Failed to enable backend "${backendName}"`,
          });
        }
      }
    );

    this.app.post(
      "/admin/disable/:name",
      async (req: Request, res: Response) => {
        const backendName = req.params.name as string;
        const backend = this.backends.get(backendName);
        if (!backend) {
          res.status(404).json({ error: `Backend "${backendName}" not found` });
          return;
        }

        await backend.disconnect();
        (backend.config as any).enabled = false;
        this.toolRegistry.unregisterBackend(backendName);
        this.notifyToolsChanged();
        res.json({ status: "ok", message: `Backend "${backendName}" disabled` });
      }
    );

    this.app.get("/admin/status", (_req: Request, res: Response) => {
      const toolStats = this.toolRegistry.getStats();
      const totalTools = this.toolRegistry.getAllTools().length;
      const connectedBackends = Array.from(this.backends.values()).filter(
        (b) => b.status === "connected"
      ).length;

      res.json({
        gateway: this.config.gateway.name,
        totalBackends: this.backends.size,
        connectedBackends,
        totalTools,
        toolsByBackend: toolStats,
        activeSessions: this.transports.size,
      });
    });

    this.app.post("/admin/reload-config", async (_req: Request, res: Response) => {
      try {
        await this.reloadConfig();
        res.json({ status: "ok", message: "Configuration reloaded" });
      } catch (err) {
        res.status(500).json({
          error: `Failed to reload config: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  }

  private notifyToolsChanged(): void {
    // Notify all connected SSE clients that tool list changed
    for (const transport of this.transports.values()) {
      try {
        this.server.server
          .notification({
            method: "notifications/tools/list_changed",
          })
          .catch(() => {});
      } catch {
        // ignore notification errors
      }
    }
  }

  private async connectBackend(
    name: string,
    config: import("./config.js").BackendConfig
  ): Promise<void> {
    const backend = new BackendInstance(name, config, this.logger, () => {
      // On reconnect, re-register tools
      this.toolRegistry.registerBackend(name, config.namespace, backend.tools);
      this.notifyToolsChanged();
    });

    this.backends.set(name, backend);

    try {
      await backend.connect();
      if (backend.status === "connected") {
        this.toolRegistry.registerBackend(
          name,
          config.namespace,
          backend.tools
        );
      }
    } catch {
      this.logger.warn(
        `Backend "${name}" failed to start — will retry per restart policy`
      );
    }
  }

  async reloadConfig(): Promise<void> {
    this.logger.info("Reloading configuration...");
    const newConfig = loadConfig(this.configPath);

    // Find backends to add, remove, or update
    const currentNames = new Set(this.backends.keys());
    const newNames = new Set(Object.keys(newConfig.backends));

    // Remove backends no longer in config
    for (const name of currentNames) {
      if (!newNames.has(name)) {
        this.logger.info(`Removing backend "${name}"`);
        const backend = this.backends.get(name)!;
        await backend.disconnect();
        this.toolRegistry.unregisterBackend(name);
        this.backends.delete(name);
      }
    }

    // Add new backends
    for (const name of newNames) {
      if (!currentNames.has(name)) {
        this.logger.info(`Adding new backend "${name}"`);
        await this.connectBackend(name, newConfig.backends[name]);
      }
    }

    this.config = newConfig;
    this.notifyToolsChanged();
    this.logger.info("Configuration reloaded successfully");
  }

  async start(): Promise<void> {
    this.logger.info(
      `Starting MCP Gateway "${this.config.gateway.name}" on ${this.config.gateway.host}:${this.config.gateway.port}`
    );

    // Connect all enabled backends
    const entries = Object.entries(this.config.backends);
    this.logger.info(`Connecting ${entries.length} backend(s)...`);

    await Promise.allSettled(
      entries.map(([name, config]) => this.connectBackend(name, config))
    );

    const connected = Array.from(this.backends.values()).filter(
      (b) => b.status === "connected"
    ).length;
    this.logger.info(
      `${connected}/${entries.length} backends connected, ${this.toolRegistry.getAllTools().length} tools available`
    );

    // Start health monitoring
    this.startHealthMonitor();

    // Watch config file for changes
    const watcher = watch(this.configPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500 },
    });
    watcher.on("change", async () => {
      this.logger.info("Config file changed, reloading...");
      try {
        await this.reloadConfig();
      } catch (err) {
        this.logger.error(
          `Config reload failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });

    // Start HTTP server
    return new Promise((resolve) => {
      this.app.listen(this.config.gateway.port, this.config.gateway.host, () => {
        this.logger.info(
          `MCP Gateway listening on http://${this.config.gateway.host}:${this.config.gateway.port}`
        );
        this.logger.info(`  SSE endpoint: /sse`);
        this.logger.info(`  Admin API:    /admin/status`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.logger.info("Shutting down gateway...");
    if (this.healthTimer) clearInterval(this.healthTimer);
    for (const backend of this.backends.values()) {
      await backend.disconnect();
    }
    for (const transport of this.transports.values()) {
      try {
        await transport.close();
      } catch {
        // ignore
      }
    }
  }

  private startHealthMonitor(): void {
    const interval = 30_000; // 30 seconds
    this.healthTimer = setInterval(async () => {
      for (const [name, backend] of this.backends) {
        if (backend.status === "disconnected" || backend.status === "error") {
          this.logger.info(
            `Health check: backend "${name}" is ${backend.status}, attempting reconnect...`
          );
          try {
            await backend.restart();
            if ((backend.status as string) === "connected") {
              const backendConfig = this.config.backends[name];
              this.toolRegistry.registerBackend(
                name,
                backendConfig.namespace,
                backend.tools
              );
              this.notifyToolsChanged();
              this.logger.info(
                `Health check: backend "${name}" reconnected — ${backend.tools.length} tools`
              );
            }
          } catch {
            this.logger.warn(
              `Health check: backend "${name}" reconnect failed`
            );
          }
        }
      }
    }, interval);
  }
}
