import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server as HttpServer } from "node:http";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { BackendConfig, Config } from "./config.js";
import type { Logger } from "./logger.js";
import { ToolRegistry } from "./tool-registry.js";
import { ManifestRegistry, decideGate } from "./manifest.js";
import { BackendInstance } from "./backend.js";
import { watch, type FSWatcher } from "chokidar";
import { loadConfig } from "./config.js";
import { buildToolHiveFleetInventory, type FleetEntry } from "./fleet-inventory.js";
import { buildFleetMcpuConfig } from "./fleet-mcpu-config.js";
import { loadFleetBackendsFromMcpuConfig, type FleetIngestResult } from "./fleet-backend-ingestion.js";
import { getMuxTools, isMuxToolName, MUX_TOOL_NAMES, type MuxToolName, extractCallToolArgs } from "./mux-tools.js";

// ── Phase 4: Content-aware compression helpers (zero-dependency, native TS) ────
//
// Exported so unit tests can exercise the pure transform without a full Gateway
// instance. The Gateway.compressToolText() private method is the integration
// point; it calls these helpers and wraps them with the artifact store.

/**
 * cols/v1 columnar envelope format.
 *
 * A homogeneous object-array is encoded as:
 *   { "__gw_compact__": "cols/v1", "keys": [k0,k1,...], "rows": [[v0,v1,...], ...] }
 *
 * This eliminates repeated key strings — the dominant redundancy in large
 * arrays of chat messages, Jira issues, calendar events, etc. where N objects
 * share the same M keys. For N=200 objects with M=10 keys, key strings appear
 * once instead of 200 times.
 *
 * Round-trip guarantee: decodeColumnar(encodeColumnar(arr)) deep-equals arr.
 */
export interface ColumnarEnvelope {
  __gw_compact__: "cols/v1";
  keys: string[];
  rows: unknown[][];
}

/** Minimum array length to attempt columnar encoding (not worth it below this). */
const COLUMNAR_MIN_ROWS = 8;

/**
 * Return true if every element of arr is a non-null plain object and all
 * objects share exactly the same set of own-enumerable keys.
 */
export function isHomogeneousObjectArray(arr: unknown[]): arr is Record<string, unknown>[] {
  if (arr.length < COLUMNAR_MIN_ROWS) return false;
  const first = arr[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return false;
  const keys = Object.keys(first as object).sort();
  if (keys.length === 0) return false;
  const keySet = keys.join("\0");
  for (let i = 1; i < arr.length; i++) {
    const el = arr[i];
    if (!el || typeof el !== "object" || Array.isArray(el)) return false;
    if (Object.keys(el as object).sort().join("\0") !== keySet) return false;
  }
  return true;
}

/**
 * Encode a homogeneous object-array into a cols/v1 envelope.
 * Caller MUST verify isHomogeneousObjectArray before calling.
 */
export function encodeColumnar(arr: Record<string, unknown>[]): ColumnarEnvelope {
  const keys = Object.keys(arr[0]).sort();
  const rows = arr.map((obj) => keys.map((k) => obj[k]));
  return { __gw_compact__: "cols/v1", keys, rows };
}

/**
 * Decode a cols/v1 envelope back to a plain object-array.
 * Used in tests to verify lossless round-trip.
 */
export function decodeColumnar(env: ColumnarEnvelope): Record<string, unknown>[] {
  return env.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < env.keys.length; i++) {
      obj[env.keys[i]] = row[i];
    }
    return obj;
  });
}

/**
 * Recursively prune null / undefined / empty-string / empty-array /
 * empty-object fields from a value.  These are low-information tokens that
 * inflate serialised size without adding meaning.
 *
 * Arrays of primitives are pruned only of null/undefined elements.
 * Objects lose keys whose pruned value is null/undefined/""/{}/[].
 */
export function pruneEmpty(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return undefined;

  if (Array.isArray(value)) {
    const pruned = value
      .map(pruneEmpty)
      .filter((v) => v !== undefined);
    return pruned.length === 0 ? undefined : pruned;
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const pv = pruneEmpty(v);
      if (pv !== undefined) result[k] = pv;
    }
    return Object.keys(result).length === 0 ? undefined : result;
  }

  return value;
}

/**
 * Recursively apply columnar encoding to any homogeneous object-array found
 * in the value tree.  Leaves non-homogeneous arrays and scalars unchanged.
 */
export function applyColumnarEncoding(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (isHomogeneousObjectArray(value)) {
      return encodeColumnar(value as Record<string, unknown>[]);
    }
    return value.map(applyColumnarEncoding);
  }
  if (value && typeof value === "object" && !(value as Record<string, unknown>).__gw_compact__) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = applyColumnarEncoding(v);
    }
    return result;
  }
  return value;
}

/**
 * Apply the full compression pipeline to a JSON-parseable text string:
 *   1. Prune null/empty fields
 *   2. Columnar-encode homogeneous object-arrays
 *   3. Minify (JSON.stringify without indentation)
 *
 * Returns the compressed string, or the original if the pipeline produces no
 * meaningful reduction (savedPct ≤ 0).
 *
 * Throws if `text` is not valid JSON — callers must guard.
 */
export function applyJsonCompression(text: string): { compressed: string; savedPct: number } {
  const parsed = JSON.parse(text) as unknown;
  const pruned = pruneEmpty(parsed) ?? parsed; // if pruneEmpty returns undefined (e.g. empty root), keep original
  const columnar = applyColumnarEncoding(pruned);
  const compressed = JSON.stringify(columnar);
  const savedPct = Math.round(100 * (1 - compressed.length / text.length));
  if (savedPct <= 0) {
    return { compressed: text, savedPct: 0 };
  }
  return { compressed, savedPct };
}

// ── End Phase 4 compression helpers ────────────────────────────────────────────

const DEFAULT_MUX_RESPONSE_CHAR_LIMIT = 6_000;
const STATUS_RESPONSE_CHAR_LIMIT = 4_000;
const DESCRIBE_RESPONSE_CHAR_LIMIT = 12_000;
const MAX_MUX_RESPONSE_CHAR_LIMIT = 2_000_000;
const DEFAULT_MUX_LIST_LIMIT = 10;
const MAX_MUX_LIST_LIMIT = 50;
const MAX_ARTIFACTS = 100;
const MAX_ARTIFACT_CHARS = 2_000_000;
const STREAMABLE_SESSION_IDLE_TTL_MS = 60 * 60 * 1000;

interface GatewayArtifact {
  id: string;
  kind: string;
  text: string;
  originalChars: number;
  storedAt: string;
}

export class Gateway {
  private config: Config;
  private configPath: string;
  private logger: Logger;
  private app = express();
  private manifests: ManifestRegistry;
  private toolRegistry: ToolRegistry;
  private backends = new Map<string, BackendInstance>();
  private sseTransports = new Map<string, SSEServerTransport>();
  private streamableTransports = new Map<string, StreamableHTTPServerTransport>();
  private sessions = new Map<string, McpServer>();
  private streamableSessionLastSeen = new Map<string, number>();
  private artifacts = new Map<string, GatewayArtifact>();
  // Deduplicates concurrent reconnects of the same backend so N parallel
  // stale-session errors trigger one reconnect, not N. Keyed by backend name;
  // entry is the in-flight reconnect promise, deleted in its finally block.
  private reconnectInflight = new Map<string, Promise<number>>();

  private healthTimer?: ReturnType<typeof setInterval>;
  private httpServer?: HttpServer;
  private configWatcher?: FSWatcher;
  private configReloadInFlight?: Promise<void>;
  private fleetIngestInFlight?: Promise<FleetIngestResult>;

  constructor(config: Config, configPath: string, logger: Logger) {
    this.config = config;
    this.configPath = configPath;
    this.logger = logger;
    this.manifests = new ManifestRegistry(logger, config.safety?.manifest_dir);
    this.toolRegistry = new ToolRegistry(
      logger,
      config.gateway.tool_prefix,
      this.manifests.classify.bind(this.manifests)
    );

    this.setupHttpRoutes();
  }

  private createSessionServer(): McpServer {
    const server = new McpServer(
      { name: this.config.gateway.name, version: "1.0.0" },
      { capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} } }
    );
    this.setupMcpHandlers(server);
    return server;
  }

  private setupMcpHandlers(mcpServer: McpServer): void {
    const lowLevel = mcpServer.server;

    lowLevel.setRequestHandler(
      ListToolsRequestSchema,
      async (): Promise<{ tools: any[] }> => {
        return { tools: this.getExposedTools() };
      }
    );

    lowLevel.setRequestHandler(
      CallToolRequestSchema,
      async (request: any): Promise<{ content: any[]; isError?: boolean }> => {
        const toolName: string = request.params.name;
        const args: Record<string, unknown> = request.params.arguments ?? {};

        if (isMuxToolName(toolName)) return this.handleMuxTool(toolName, args);
        return this.callBackendTool(toolName, args);
      }
    );

    // Resource handlers
    lowLevel.setRequestHandler(
      ListResourcesRequestSchema,
      async (): Promise<{ resources: any[] }> => {
        if (this.isFacadeMode()) return { resources: [] };

        const allResources: any[] = [];
        for (const [name, backend] of this.backends) {
          if (backend.status !== "connected") continue;
          try {
            const resources = await backend.listResources();
            const ns = this.config.backends[name]?.namespace ?? name;
            const prefix = this.config.gateway.tool_prefix ? `${this.config.gateway.tool_prefix}${ns}` : ns;
            for (const r of resources) {
              allResources.push({ ...r, name: `${prefix}_${r.name}` });
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
        if (this.isFacadeMode()) {
          return { contents: [{ uri, text: "Resource passthrough is disabled in mcp-gateway mux facade mode." }] };
        }

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
        if (this.isFacadeMode()) return { prompts: [] };

        const allPrompts: any[] = [];
        for (const [name, backend] of this.backends) {
          if (backend.status !== "connected") continue;
          try {
            const prompts = await backend.listPrompts();
            const ns = this.config.backends[name]?.namespace ?? name;
            const prefix = this.config.gateway.tool_prefix ? `${this.config.gateway.tool_prefix}${ns}` : ns;
            for (const p of prompts) {
              allPrompts.push({ ...p, name: `${prefix}_${p.name}` });
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
        if (this.isFacadeMode()) {
          return {
            messages: [
              {
                role: "assistant" as const,
                content: {
                  type: "text" as const,
                  text: "Prompt passthrough is disabled in mcp-gateway mux facade mode.",
                },
              },
            ],
          };
        }

        // Find the backend by namespace prefix
        for (const [name, backend] of this.backends) {
          if (backend.status !== "connected") continue;
          const ns = this.config.backends[name]?.namespace ?? name;
          const prefix = this.config.gateway.tool_prefix ? `${this.config.gateway.tool_prefix}${ns}` : ns;
          if (promptName.startsWith(`${prefix}_`)) {
            const originalName = promptName.slice(prefix.length + 1);
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
    // Apply JSON parsing only to admin routes (not /messages — SSE transport reads raw body)
    this.app.use("/admin", express.json());
    this.app.use("/admin", this.requireAdminAccess.bind(this));
    this.app.use("/mcp", express.json({ limit: "10mb" }));

    // Streamable HTTP endpoint for MCP clients that support type=http (Claude Code, Copilot CLI)
    this.app.all("/mcp", async (req: Request, res: Response) => {
      if (this.config.gateway.streamable_http_stateless) {
        await this.handleStatelessStreamableRequest(req, res);
        return;
      }

      const sessionId = this.headerValue(req.headers["mcp-session-id"]);
      let transport: StreamableHTTPServerTransport | undefined;

      try {
        if (sessionId) {
          transport = this.streamableTransports.get(sessionId);
          if (!transport) {
            res.status(404).json({
              jsonrpc: "2.0",
              error: { code: -32001, message: "Session not found" },
              id: null,
            });
            return;
          }
          this.touchStreamableSession(sessionId);
        } else if (req.method === "POST" && isInitializeRequest(req.body)) {
          let initializedSessionId: string | undefined;
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              initializedSessionId = newSessionId;
              this.streamableTransports.set(newSessionId, transport!);
              this.touchStreamableSession(newSessionId);
            },
          });

          const sessionServer = this.createSessionServer();
          transport.onclose = () => {
            const sid = initializedSessionId ?? transport?.sessionId;
            if (sid) {
              this.dropStreamableSession(sid);
            }
          };

          await sessionServer.server.connect(transport);
          await transport.handleRequest(req, res, req.body);

          const sid = initializedSessionId ?? transport.sessionId;
          if (sid) {
            this.sessions.set(sid, sessionServer);
            this.touchStreamableSession(sid);
          }
          return;
        } else {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: No valid session ID provided" },
            id: null,
          });
          return;
        }

        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        this.logger.error(`Streamable HTTP request failed: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });

    // SSE endpoint for MCP clients
    this.app.get("/sse", async (req: Request, res: Response) => {
      this.logger.info(`New SSE connection from ${req.ip}`);
      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;
      this.sseTransports.set(sessionId, transport);

      const sessionServer = this.createSessionServer();
      this.sessions.set(sessionId, sessionServer);

      transport.onclose = () => {
        this.sseTransports.delete(sessionId);
        this.sessions.delete(sessionId);
        this.logger.debug(`SSE session ${sessionId} closed`);
      };

      await sessionServer.server.connect(transport);
    });

    // Message endpoint for MCP clients
    this.app.post("/messages", async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      const transport = this.sseTransports.get(sessionId);
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
          const toolCount = await this.ensureReconnected(backendName);
          res.json({
            status: "ok",
            message: `Backend "${backendName}" reloaded`,
            toolCount,
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

        backend.config.enabled = true;
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
        backend.config.enabled = false;
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
        activeSessions: this.sseTransports.size + this.streamableTransports.size,
      });
    });

    this.app.get("/admin/fleet/inventory", async (req: Request, res: Response) => {
      if (!this.config.fleet.enabled) {
        res.status(404).json({ error: "Fleet inventory is disabled" });
        return;
      }

      try {
        const probe = req.query.probe === "true" || req.query.probe === "1";
        const inventory = await this.buildFleetInventory(probe);
        res.json(inventory);
      } catch (err) {
        res.status(500).json({
          error: `Failed to build fleet inventory: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    this.app.get("/admin/fleet/mcpu-config", async (req: Request, res: Response) => {
      if (!this.config.fleet.enabled) {
        res.status(404).json({ error: "Fleet inventory is disabled" });
        return;
      }

      try {
        const probe = req.query.probe === "true" || req.query.probe === "1";
        const configOnly = req.query.configOnly === "true" || req.query.configOnly === "1";
        const inventory = await this.buildFleetInventory(probe);
        const report = buildFleetMcpuConfig(inventory);
        res.json(configOnly ? report.config : report);
      } catch (err) {
        res.status(500).json({
          error: `Failed to build MCPU config report: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    this.app.get("/admin/fleet/summary", async (_req: Request, res: Response) => {
      if (!this.config.fleet.enabled) {
        res.status(404).json({ error: "Fleet inventory is disabled" });
        return;
      }

      try {
        const inventory = await this.buildFleetInventory(false);
        res.json({
          generatedAt: inventory.generatedAt,
          paths: inventory.paths,
          probeEnabled: inventory.probeEnabled,
          dockerPsEnabled: inventory.dockerPsEnabled,
          summary: inventory.summary,
          errors: inventory.errors,
        });
      } catch (err) {
        res.status(500).json({
          error: `Failed to build fleet summary: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    this.app.get("/admin/fleet/backends", (_req: Request, res: Response) => {
      const fleetBackends = Array.from(this.backends.entries())
        .filter(([, b]) => this.isFleetIngestedConfig(b.config))
        .map(([name, b]) => ({
          name,
          namespace: b.config.namespace,
          url: this.getBackendUrl(b.config),
          status: b.status,
          toolCount: b.tools.length,
          error: b.error,
          restartCount: b.restartCount,
          lastConnected: b.lastConnected,
        }));

      res.json({
        fleetBackendCount: fleetBackends.length,
        totalBackends: this.backends.size,
        backends: fleetBackends,
      });
    });

    this.app.post("/admin/fleet/reload", async (_req: Request, res: Response) => {
      if (!this.config.fleet.enabled || !this.config.fleet.toolhive.auto_ingest) {
        res.status(404).json({ error: "Fleet auto-ingestion is disabled" });
        return;
      }

      try {
        const result = await this.ingestFleetBackends();
        res.json({
          status: "ok",
          ingestResult: {
            source: result.source,
            generatedAt: result.generatedAt,
            loaded: Object.keys(result.backends).length,
            skipped: result.skipped.length,
            skippedDetails: result.skipped,
          },
          totalBackends: this.backends.size,
        });
      } catch (err) {
        res.status(500).json({
          error: `Fleet reload failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
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

  private headerValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private async handleStatelessStreamableRequest(
    req: Request,
    res: Response
  ): Promise<void> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: this.config.gateway.streamable_http_json_response,
    });
    const sessionServer = this.createSessionServer();

    try {
      await sessionServer.server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.logger.error(
        `Stateless Streamable HTTP request failed: ${err instanceof Error ? err.message : String(err)}`
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    } finally {
      try {
        await sessionServer.close();
      } catch (err) {
        this.logger.debug(`Stateless session cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        await transport.close();
      } catch (err) {
        this.logger.debug(`Stateless transport cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private isFacadeMode(): boolean {
    return this.config.gateway.tool_exposure === "mux";
  }

  private getExposedTools(): Tool[] {
    const mode = this.config.gateway.tool_exposure;
    if (mode === "mux") return getMuxTools();
    if (mode === "both") return [...getMuxTools(), ...this.toolRegistry.getAllTools()];
    return this.toolRegistry.getAllTools();
  }

  private jsonToolResult(value: unknown, maxChars = DEFAULT_MUX_RESPONSE_CHAR_LIMIT): { content: any[] } {
    const text = JSON.stringify(value, null, 2);
    const safeText = this.compactJsonText(text, maxChars);
    return {
      content: [
        {
          type: "text" as const,
          text: safeText,
        },
      ],
    };
  }

  private async handleMuxTool(
    toolName: MuxToolName,
    args: Record<string, unknown>
  ): Promise<{ content: any[]; isError?: boolean }> {
    switch (toolName) {
      case MUX_TOOL_NAMES.searchTools:
        return this.jsonToolResult(this.searchRegisteredTools(args));
      case MUX_TOOL_NAMES.describeTool:
        return this.jsonToolResult(
          this.describeRegisteredTool(args),
          DESCRIBE_RESPONSE_CHAR_LIMIT
        );
      case MUX_TOOL_NAMES.callTool: {
        const { target, targetArgs } = extractCallToolArgs(args);
        if (!target) {
          return {
            content: [{ type: "text" as const, text: "gateway_call_tool requires a string 'tool' argument." }],
            isError: true,
          };
        }

        // ── Safety confirmation gate ──────────────────────────────────────────
        const entry = this.toolRegistry.resolve(target);
        const confirmed = args.confirmed === true;
        const safety = entry?.safety;
        const decision = decideGate(safety, confirmed, this.config.safety.enforce);

        if (decision.action === "warn") {
          this.logger.warn({
            event: "safety.would_block",
            tool: target,
            safetyClass: decision.safetyClass,
            source: decision.source,
            msg: "advisory: unconfirmed write-class tool call — would block in blocking mode",
          });
          // Advisory mode: fall through and dispatch as normal (zero behavior change).
        } else if (decision.action === "block") {
          // Redact argument values: keep keys, replace values with type tags.
          const redacted: Record<string, string> = {};
          for (const [k, v] of Object.entries(targetArgs)) {
            if (v === null) redacted[k] = "<null>";
            else if (Array.isArray(v)) redacted[k] = "<array>";
            else redacted[k] = `<${typeof v}>`;
          }
          return this.jsonToolResult({
            confirmationRequired: true,
            tool: target,
            safetyClass: decision.safetyClass,
            reason: `This tool is classified ${decision.safetyClass} and requires confirmed:true to authorize the call.`,
            redactedArguments: redacted,
            next: {
              tool: "gateway_call_tool",
              arguments: {
                tool: target,
                confirmed: true,
                arguments: "<your original args>",
              },
            },
          });
        }

        // confirmationMapsToDownstream: only when caller confirmed AND the manifest
        // says the downstream tool also expects a confirmation flag.
        const dispatchArgs = { ...targetArgs };
        if (confirmed && safety?.confirmationMapsToDownstream === true) {
          dispatchArgs.confirmed = true;
        }

        return this.callBackendTool(target, dispatchArgs, this.getCharLimit(args, "maxOutputChars"));
      }
      case MUX_TOOL_NAMES.fetchArtifact:
        return this.jsonToolResult(this.fetchArtifact(args), DEFAULT_MUX_RESPONSE_CHAR_LIMIT);
      case MUX_TOOL_NAMES.backendStatus:
        return this.jsonToolResult(this.getBackendStatus(args), STATUS_RESPONSE_CHAR_LIMIT);
      case MUX_TOOL_NAMES.fleetInventory: {
        if (!this.config.fleet.enabled) {
          return {
            content: [{ type: "text" as const, text: "Fleet inventory is disabled." }],
            isError: true,
          };
        }
        const probe = args.probe === true;
        const inventory = await this.buildFleetInventory(probe);
        const includeEntries = args.includeEntries === true || args.summaryOnly === false;
        const limit = this.getListLimit(args);
        const compact = {
          generatedAt: inventory.generatedAt,
          paths: inventory.paths,
          probeEnabled: inventory.probeEnabled,
          dockerPsEnabled: inventory.dockerPsEnabled,
          summary: inventory.summary,
          errors: inventory.errors,
          ...(includeEntries
            ? {
                entries: inventory.entries.slice(0, limit).map((entry) => this.compactFleetEntry(entry)),
                returnedEntries: Math.min(inventory.entries.length, limit),
                omittedEntries: Math.max(0, inventory.entries.length - limit),
                note: "MCP output is capped to avoid context bloat. Use the loopback admin API /admin/fleet/inventory for full raw inventory when needed outside model context.",
              }
            : {}),
        };
        return this.jsonToolResult(compact, DEFAULT_MUX_RESPONSE_CHAR_LIMIT);
      }
      case MUX_TOOL_NAMES.reconnectBackend: {
        const backendName = typeof args.backend === "string" ? args.backend : "";
        if (!backendName) {
          return {
            content: [{ type: "text" as const, text: "gateway_reconnect_backend requires a string 'backend' argument." }],
            isError: true,
          };
        }
        if (!this.backends.has(backendName)) {
          return {
            content: [{ type: "text" as const, text: `Backend "${backendName}" not found. Use gateway_backend_status to list connected backends.` }],
            isError: true,
          };
        }
        try {
          const toolCount = await this.ensureReconnected(backendName);
          return this.jsonToolResult({
            backend: backendName,
            status: "reconnected",
            toolCount,
          }, DEFAULT_MUX_RESPONSE_CHAR_LIMIT);
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Failed to reconnect backend "${backendName}": ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      }
      case MUX_TOOL_NAMES.mcpuConfig: {
        if (!this.config.fleet.enabled) {
          return {
            content: [{ type: "text" as const, text: "Fleet inventory is disabled." }],
            isError: true,
          };
        }
        const inventory = await this.buildFleetInventory(args.probe === true);
        const report = buildFleetMcpuConfig(inventory);
        const limit = this.getListLimit(args);
        const configEntries = Object.entries(report.config);
        const payload = {
          mode: report.mode,
          generatedAt: report.generatedAt,
          summary: report.summary,
          returnedConfigEntries: args.configOnly === true ? Math.min(configEntries.length, limit) : 0,
          omittedConfigEntries: args.configOnly === true ? Math.max(0, configEntries.length - limit) : configEntries.length,
          ...(args.configOnly === true
            ? {
                config: Object.fromEntries(configEntries.slice(0, limit)),
              }
            : {}),
          ...(args.includeEntries === true
            ? {
                entries: report.entries.slice(0, limit),
                returnedEntries: Math.min(report.entries.length, limit),
                omittedEntries: Math.max(0, report.entries.length - limit),
              }
            : {}),
          note: "MCP output is capped to avoid loading the full ToolHive/MCPU fleet into model context. Use the loopback admin API /admin/fleet/mcpu-config?configOnly=1 for full machine-consumable config outside model context.",
        };
        return this.jsonToolResult(payload, DEFAULT_MUX_RESPONSE_CHAR_LIMIT);
      }
    }
  }

  private buildFleetInventory(probe: boolean) {
    return buildToolHiveFleetInventory({
      ...this.config.fleet.toolhive,
      endpoint_probe: probe || this.config.fleet.toolhive.endpoint_probe,
    });
  }

  private getListLimit(args: Record<string, unknown>): number {
    const raw = args.limit;
    if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_MUX_LIST_LIMIT;
    return Math.max(1, Math.min(Math.floor(raw), MAX_MUX_LIST_LIMIT));
  }

  private getCharLimit(args: Record<string, unknown>, key: string): number {
    const raw = args[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_MUX_RESPONSE_CHAR_LIMIT;
    return Math.max(1_000, Math.min(Math.floor(raw), MAX_MUX_RESPONSE_CHAR_LIMIT));
  }

  private truncateText(value: string | undefined, maxChars: number): string | undefined {
    if (value === undefined || value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars by mcp-gateway]`;
  }

  /**
   * Phase 4: Content-aware compression of tool-output text.
   *
   * Gate: disabled by default (compression.enabled defaults to false).
   * When disabled the method is a pure pass-through — zero behavior change.
   *
   * When active, applies applyJsonCompression() (prune→columnar→minify),
   * stores the FULL UNCOMPRESSED ORIGINAL in the artifact store for lossless
   * retrieval via gateway_fetch_artifact, and returns the compressed text with
   * a self-describing marker object.
   *
   * In mode:"advisory" the original text is returned unchanged — only the
   * savings are logged.  The artifact is still stored so the model can opt in
   * to retrieval.
   *
   * @param text  The raw text content from a backend tool response.
   * @param kind  Artifact kind label (e.g. "backend-tool-compressed").
   * @returns     { text, marker? } — marker is present when compression engaged.
   */
  private compressToolText(
    text: string,
    kind: string
  ): { text: string; marker?: Record<string, unknown> } {
    // Defensive: older configs (e.g. test fixtures) may not have the compression
    // block.  Treat missing as { enabled: false }.
    const cfg = this.config.compression ?? { enabled: false, min_chars: 20_000, mode: "active" as const };

    // Gate 1: feature disabled (default) — pure pass-through.
    if (!cfg.enabled) return { text };

    // Gate 2: text below min_chars threshold — not worth compressing.
    if (text.length < cfg.min_chars) return { text };

    // Gate 3: must be valid JSON — non-JSON text passes through unchanged.
    let result: { compressed: string; savedPct: number };
    try {
      result = applyJsonCompression(text);
    } catch {
      return { text };
    }

    const { compressed, savedPct } = result;

    // Gate 4: no meaningful reduction — return original.
    if (savedPct <= 0) return { text };

    // Store the FULL UNCOMPRESSED ORIGINAL for lossless retrieval.
    const artifactId = this.storeArtifact(kind, text);

    const marker: Record<string, unknown> = {
      compressed: true,
      format: "gw-compress/v1 (prune+cols/v1+minify)",
      originalChars: text.length,
      compressedChars: compressed.length,
      savedPct,
      artifactId,
      note: "Full uncompressed original retrievable via gateway_fetch_artifact.",
    };

    if (cfg.mode === "advisory") {
      this.logger.info({
        event: "compression.advisory",
        kind,
        originalChars: text.length,
        compressedChars: compressed.length,
        savedPct,
        artifactId,
        msg: `compression advisory: would save ${savedPct}% (${text.length - compressed.length} chars)`,
      });
      // Advisory: return original text (do not alter output yet).
      return { text, marker };
    }

    // Active mode: return the compressed text with the marker.
    return { text: compressed, marker };
  }

  private compactJsonText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const artifactId = this.storeArtifact("json-response", text);
    return JSON.stringify(
      {
        gatewayTruncated: true,
        originalChars: text.length,
        maxChars,
        preview: text.slice(0, maxChars),
        artifactId,
        next: {
          tool: MUX_TOOL_NAMES.fetchArtifact,
          artifactId,
          offset: maxChars,
          maxChars: DEFAULT_MUX_RESPONSE_CHAR_LIMIT,
        },
        note: "Response exceeded the MCP gateway safe payload cap. Narrow the request or use the loopback admin API outside model context for full raw data.",
      },
      null,
      2
    );
  }

  private storeArtifact(kind: string, value: string): string {
    const id = `gw_artifact_${randomUUID()}`;
    const text = value.length > MAX_ARTIFACT_CHARS
      ? `${value.slice(0, MAX_ARTIFACT_CHARS)}\n...[artifact truncated ${value.length - MAX_ARTIFACT_CHARS} chars at storage boundary]`
      : value;
    this.artifacts.set(id, {
      id,
      kind,
      text,
      originalChars: value.length,
      storedAt: new Date().toISOString(),
    });

    while (this.artifacts.size > MAX_ARTIFACTS) {
      const oldest = this.artifacts.keys().next().value as string | undefined;
      if (!oldest) break;
      this.artifacts.delete(oldest);
    }

    return id;
  }

  private fetchArtifact(args: Record<string, unknown>): unknown {
    const artifactId = typeof args.artifactId === "string" ? args.artifactId : "";
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return {
        error: "artifact_not_found",
        artifactId,
        note: "Artifacts are in-memory and may disappear after gateway restart or artifact cache eviction.",
      };
    }

    const rawOffset = args.offset;
    const offset = typeof rawOffset === "number" && Number.isFinite(rawOffset)
      ? Math.max(0, Math.floor(rawOffset))
      : 0;
    const maxChars = this.getCharLimit(args, "maxChars");
    const text = artifact.text.slice(offset, offset + maxChars);
    const nextOffset = offset + text.length;
    return {
      artifactId,
      kind: artifact.kind,
      storedAt: artifact.storedAt,
      originalChars: artifact.originalChars,
      storedChars: artifact.text.length,
      offset,
      returnedChars: text.length,
      text,
      hasMore: nextOffset < artifact.text.length,
      next: nextOffset < artifact.text.length
        ? { tool: MUX_TOOL_NAMES.fetchArtifact, artifactId, offset: nextOffset, maxChars }
        : undefined,
    };
  }

  private compactFleetEntry(entry: FleetEntry): unknown {
    return {
      name: entry.name,
      health: entry.health,
      reasons: entry.reasons.slice(0, 5),
      mcpuExposed: entry.mcpu.exposed,
      endpoint: {
        checked: entry.endpoint.checked,
        tcpOpen: entry.endpoint.tcpOpen,
        error: this.truncateText(entry.endpoint.error, 240),
      },
      runConfig: entry.runConfig
        ? {
            image: entry.runConfig.image,
            host: entry.runConfig.host,
            port: entry.runConfig.port,
            proxyMode: entry.runConfig.proxyMode,
            envKeyCount: entry.runConfig.envKeys.length,
            secretRefCount: entry.runConfig.secretRefs.length,
          }
        : undefined,
      docker: entry.docker
        ? {
            name: entry.docker.name,
            image: entry.docker.image,
            state: entry.docker.state,
            status: this.truncateText(entry.docker.status, 160),
          }
        : undefined,
      safeAutomaticRepairHints: entry.repairHints.filter((hint) => hint.safeAutomatic).length,
    };
  }

  /** Tokenize a string for token-set ranking: lowercase, split on non-alphanumeric, dedupe. */
  private tokenize(s: string): string[] {
    const tokens = s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
    return [...new Set(tokens)];
  }

  private searchRegisteredTools(args: Record<string, unknown>): unknown {
    const query = typeof args.query === "string" ? args.query : "";
    const backendFilter = typeof args.backend === "string" ? args.backend : "";
    const limit = this.getListLimit(args);
    const totalRegisteredTools = this.toolRegistry.getAllTools().length;

    // Query-required guard — keep exactly as before.
    if (!query.trim() && !backendFilter.trim()) {
      return {
        totalRegisteredTools,
        returned: 0,
        matches: [],
        queryRequired: true,
        note: "gateway_search_tools requires a query or backend filter in facade mode; it will not dump the full backend tool inventory into model context.",
      };
    }

    // Phase 1: backendFilter pre-filter (unchanged behaviour, still uses matchesSearch).
    const backendFiltered = this.toolRegistry.getAllEntries().filter((entry) => {
      if (!backendFilter) return true;
      const backendConfig = this.backends.get(entry.backendName)?.config;
      return this.matchesSearch(
        [
          entry.backendName,
          backendConfig?.namespace ?? "",
          backendConfig && "description" in backendConfig ? backendConfig.description ?? "" : "",
        ].join(" "),
        backendFilter
      );
    });

    // Phase 2: token-set ranking.
    const queryTokens = this.tokenize(query);
    const queryHasTokens = queryTokens.length > 0;

    const EXACT_MATCH_BONUS = 100_000;

    const scored = backendFiltered.flatMap((entry) => {
      const backendConfig = this.backends.get(entry.backendName)?.config;
      const haystackTokens = new Set(
        this.tokenize(
          [
            entry.namespacedName,
            entry.originalName,
            entry.backendName,
            backendConfig?.namespace ?? "",
            backendConfig && "description" in backendConfig ? backendConfig.description ?? "" : "",
            entry.tool.description ?? "",
            ...(entry.safety?.tags ?? []),
          ].join(" ")
        )
      );

      // Token-set intersection score.
      let score = 0;
      for (const t of queryTokens) {
        if (haystackTokens.has(t)) score++;
      }

      // Exact-match pin: force to top regardless of score.
      if (entry.namespacedName.toLowerCase() === query.trim().toLowerCase()) {
        score += EXACT_MATCH_BONUS;
      }

      // When there are query tokens, drop entries with zero score.
      if (queryHasTokens && score === 0) return [];
      return [{ entry, score }];
    });

    // Sort: score desc, then namespacedName asc (deterministic tie-break).
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.namespacedName.localeCompare(b.entry.namespacedName);
    });

    const ranked = scored.slice(0, limit);
    const matches = ranked.map(({ entry, score }) => ({
      name: entry.namespacedName,
      backend: entry.backendName,
      originalName: entry.originalName,
      description: this.truncateText(entry.tool.description, 180),
      safetyClass: entry.safety?.safetyClass ?? null,
      tags: entry.safety?.tags ?? [],
      score,
      describeWith: {
        tool: MUX_TOOL_NAMES.describeTool,
        arguments: { tool: entry.namespacedName },
      },
    }));

    return {
      totalRegisteredTools,
      returned: matches.length,
      omittedByLimit: Math.max(0, scored.length - matches.length),
      matches,
    };
  }

  private describeRegisteredTool(args: Record<string, unknown>): unknown {
    const toolName = typeof args.tool === "string" ? args.tool : "";
    const entry = this.toolRegistry.resolve(toolName);
    if (!entry) {
      return {
        error: "unknown_tool",
        tool: toolName,
        note: `Use ${MUX_TOOL_NAMES.searchTools} with a specific query to find a namespaced backend tool.`,
      };
    }

    const backendConfig = this.backends.get(entry.backendName)?.config;
    return {
      name: entry.namespacedName,
      backend: entry.backendName,
      namespace: backendConfig?.namespace,
      transport: backendConfig?.transport,
      originalName: entry.originalName,
      description: entry.tool.description,
      inputSchema: entry.tool.inputSchema,
      callWith: {
        tool: MUX_TOOL_NAMES.callTool,
        arguments: {
          tool: entry.namespacedName,
          arguments: {},
        },
      },
      note: "This is a lazy, single-tool description. Backend-wide schema dumps are intentionally not exposed in facade mode.",
    };
  }

  private getBackendStatus(args: Record<string, unknown>): unknown {
    const backendFilter = typeof args.backend === "string" ? args.backend : "";
    const limit = this.getListLimit(args);
    const includeBackends = args.includeBackends === true || Boolean(backendFilter.trim());
    const includeErrors = args.includeErrors === true;
    const includeDescriptions = args.includeDescriptions === true;
    const toolStats = this.toolRegistry.getStats();
    const allBackends = Array.from(this.backends.entries());
    const statusCounts = allBackends.reduce<Record<string, number>>((acc, [, backend]) => {
      acc[backend.status] = (acc[backend.status] ?? 0) + 1;
      return acc;
    }, {});
    const matchedBackends = allBackends
      .filter(([name, backend]) =>
        !backendFilter ||
        this.matchesSearch(
          [
            name,
            backend.config.namespace,
            backend.config.transport,
            "description" in backend.config ? backend.config.description ?? "" : "",
          ].join(" "),
          backendFilter
        )
      );
    const compactBackends = matchedBackends
      .slice(0, limit)
      .map(([name, backend]) => ({
        name,
        namespace: backend.config.namespace,
        transport: backend.config.transport,
        status: backend.status,
        toolCount: toolStats[name] ?? 0,
        ...(includeErrors ? { error: this.truncateText(backend.error, 500) } : {}),
        restartCount: backend.restartCount,
        lastConnected: backend.lastConnected?.toISOString(),
        ...(includeDescriptions && "description" in backend.config
          ? { description: this.truncateText(backend.config.description, 300) }
          : {}),
      }));
    const degradedBackends = allBackends
      .filter(([, backend]) => backend.status !== "connected")
      .slice(0, limit)
      .map(([name, backend]) => ({
        name,
        status: backend.status,
        transport: backend.config.transport,
        toolCount: toolStats[name] ?? 0,
        restartCount: backend.restartCount,
        ...(includeErrors ? { error: this.truncateText(backend.error, 300) } : {}),
      }));

    return {
      totalBackends: this.backends.size,
      connectedBackends: statusCounts.connected ?? 0,
      statusCounts,
      totalRegisteredTools: this.toolRegistry.getAllTools().length,
      returnedBackends: includeBackends ? compactBackends.length : 0,
      omittedBackends: includeBackends ? Math.max(0, matchedBackends.length - compactBackends.length) : matchedBackends.length,
      degradedBackends,
      backends: includeBackends ? compactBackends : undefined,
      note: includeBackends
        ? "Backend list is capped. Omit includeBackends for summary-only status."
        : "Summary-only facade response. Set backend=<name> or includeBackends=true for a capped backend list.",
    };
  }

  private async callBackendTool(
    toolName: string,
    args: Record<string, unknown>,
    maxOutputChars = DEFAULT_MUX_RESPONSE_CHAR_LIMIT
  ): Promise<{ content: any[]; isError?: boolean }> {
    const entry = this.toolRegistry.resolve(toolName);
    if (!entry) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown tool: ${toolName}. Use tools/list or ${MUX_TOOL_NAMES.searchTools} to see available tools.`,
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
      return this.compactBackendToolResult(result, maxOutputChars);
    } catch (err) {
      if (this.isStaleSessionError(err)) {
        this.logger.warn(
          `Backend "${entry.backendName}" returned stale-session error on ${entry.originalName}, auto-reconnecting and retrying once...`
        );
        try {
          await this.ensureReconnected(entry.backendName);
          const result = await backend.callTool(entry.originalName, args);
          return this.compactBackendToolResult(result, maxOutputChars);
        } catch (retryErr) {
          this.logger.error(
            `Backend "${entry.backendName}" retry after auto-reconnect failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`
          );
          // Fall through to surface the original error (per spec: retry is best-effort).
        }
      }
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

  // Detect transport-layer stale-session errors that a reconnect can heal.
  // Two shapes surface after a streamable-http backend is bounced and the
  // gateway's cached mcp-session-id is invalidated:
  //   1. JSON-RPC -32001 "Session not found" (transport-level code) — fast-path.
  //   2. JSON-RPC -32000 "Bad Request: No valid session ID provided" — the
  //      backend rejects the next forwarded call with a generic server-error
  //      code but a stale-session message.
  // The matcher is MESSAGE-GATED for the -32000 case: -32000 is the generic
  // "server error" code, so matching it alone would misclassify unrelated
  // application failures as stale sessions. We only treat it as stale when the
  // message names a missing/invalid session. The textual regex covers both the
  // "session not found" and "no valid session" variants and is robust to where
  // the SDK puts the text — McpError stringifies as
  // "MCP error <code>: <message>", so err.message carries the original text.
  private isStaleSessionError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const code = (err as { code?: unknown }).code;
    // Fast-path: transport-level "Session not found" code.
    if (code === -32001) return true;
    const message = (err as { message?: unknown }).message;
    // Message-gated: covers -32000 "No valid session ID" and the textual
    // "Session not found" variant regardless of code, but never matches a bare
    // -32000 whose message is unrelated (e.g. "internal error").
    if (typeof message === "string" && /(session not found|no valid session)/i.test(message)) return true;
    return false;
  }

  // Dedup wrapper around reconnectBackend: if a reconnect for this backend is
  // already in flight, await it instead of starting a new one. Prevents
  // thundering-herd reconnects when N concurrent calls all hit -32001 from the
  // same dead session. Returns the registered tool count after reconnect.
  private async ensureReconnected(backendName: string): Promise<number> {
    const existing = this.reconnectInflight.get(backendName);
    if (existing) return existing;
    const inflight = (async () => {
      try {
        return await this.reconnectBackend(backendName);
      } finally {
        this.reconnectInflight.delete(backendName);
      }
    })();
    this.reconnectInflight.set(backendName, inflight);
    return inflight;
  }

  // Restart one backend (drop transport session, reinitialize), re-register
  // its tools, and notify clients. Throws if the backend is unknown or the
  // restart fails — callers handle surfacing.
  private async reconnectBackend(backendName: string): Promise<number> {
    const backend = this.backends.get(backendName);
    if (!backend) {
      throw new Error(`Backend "${backendName}" not found`);
    }
    await backend.restart();
    this.toolRegistry.registerBackend(
      backendName,
      backend.config.namespace,
      backend.tools
    );
    this.notifyToolsChanged();
    return backend.tools.length;
  }

  private compactBackendToolResult(result: unknown, maxOutputChars: number): { content: any[]; isError?: boolean } {
    const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
    const content = Array.isArray(record.content) ? record.content : [];
    let remaining = maxOutputChars;
    let truncated = false;
    // Collect compression markers to prepend once, even if multiple text items compressed.
    const compressionMarkers: Record<string, unknown>[] = [];

    const compactContent = content.map((item) => {
      if (!item || typeof item !== "object") return item;
      const entry = item as Record<string, unknown>;
      if (entry.type === "text" && typeof entry.text === "string") {
        if (remaining <= 0) {
          truncated = true;
          return { ...entry, text: "[mcp-gateway truncated additional text content]" };
        }

        // Phase 4: attempt compression BEFORE applying the char-cap.
        // compressToolText is a pure pass-through when compression.enabled=false.
        const { text: maybeCompressed, marker } = this.compressToolText(
          entry.text,
          "backend-tool-compressed"
        );
        const workingText = maybeCompressed;
        if (marker) compressionMarkers.push(marker);

        if (workingText.length > remaining) {
          truncated = true;
          // Store the working text (compressed if active, original if advisory/disabled).
          const artifactId = this.storeArtifact("backend-tool-text", workingText);
          const text = `${workingText.slice(0, remaining)}\n...[truncated ${workingText.length - remaining} chars by mcp-gateway; artifactId=${artifactId}; fetch next page with ${MUX_TOOL_NAMES.fetchArtifact}]`;
          remaining = 0;
          return { ...entry, text };
        }
        remaining -= workingText.length;
        return { ...entry, text: workingText };
      }

      const serialized = JSON.stringify(entry);
      if (serialized.length > Math.max(1_000, remaining)) {
        truncated = true;
        const artifactId = this.storeArtifact("backend-tool-json", serialized);
        remaining = 0;
        return {
          type: "text" as const,
          text: `[mcp-gateway stored oversized non-text content item as ${artifactId}: ${serialized.length} serialized chars; fetch a page with ${MUX_TOOL_NAMES.fetchArtifact}]`,
        };
      }
      remaining -= serialized.length;
      return entry;
    });

    if (truncated) {
      compactContent.unshift({
        type: "text" as const,
        text: `mcp-gateway compacted the backend response to stay under ${maxOutputChars} chars. Narrow the request, use ${MUX_TOOL_NAMES.describeTool} before calling schema-heavy tools, or fetch a referenced artifact page explicitly.`,
      });
    }

    // Phase 4: prepend compression marker(s) so the model sees compaction metadata.
    // Only present when compression.enabled=true and active mode engaged at least once.
    for (const marker of compressionMarkers) {
      compactContent.unshift({
        type: "text" as const,
        text: JSON.stringify(marker),
      });
    }

    return {
      content: compactContent,
      ...(record.isError === true ? { isError: true } : {}),
    };
  }

  private touchStreamableSession(sessionId: string): void {
    this.streamableSessionLastSeen.set(sessionId, Date.now());
  }

  private dropStreamableSession(sessionId: string): void {
    this.streamableTransports.delete(sessionId);
    this.streamableSessionLastSeen.delete(sessionId);
    this.sessions.delete(sessionId);
  }

  private async reapIdleStreamableSessions(now = Date.now()): Promise<void> {
    for (const [sessionId, lastSeen] of this.streamableSessionLastSeen) {
      if (now - lastSeen < STREAMABLE_SESSION_IDLE_TTL_MS) continue;
      const transport = this.streamableTransports.get(sessionId);
      const sessionServer = this.sessions.get(sessionId);
      this.logger.info(`Reaping idle streamable MCP session ${sessionId}`);
      this.dropStreamableSession(sessionId);
      try {
        await sessionServer?.close();
      } catch {
        // ignore cleanup failures
      }
      try {
        await transport?.close();
      } catch {
        // ignore cleanup failures
      }
    }
  }

  private notifyToolsChanged(): void {
    // Notify all connected SSE clients that tool list changed
    for (const [sessionId, sessionServer] of this.sessions) {
      try {
        sessionServer.server
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
    config: BackendConfig
  ): Promise<void> {
    const backend = new BackendInstance(name, config, this.logger, () => {
      // On reconnect, re-register tools
      this.toolRegistry.registerBackend(name, config.namespace, backend.tools);
      this.notifyToolsChanged();
    });

    this.backends.set(name, backend);

    try {
      await this.withTimeout(
        backend.connect(),
        config.connect_timeout_ms,
        `Backend "${name}" connection timed out after ${config.connect_timeout_ms}ms`
      );
      if (backend.status === "connected") {
        this.toolRegistry.registerBackend(
          name,
          config.namespace,
          backend.tools
        );
      }
    } catch (err) {
      await backend.disconnect();
      this.logger.warn(
        `Backend "${name}" startup did not complete: ${err instanceof Error ? err.message : String(err)}`
      );
      this.logger.warn(
        `Backend "${name}" failed to start — will retry per restart policy`
      );
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private isFleetIngestedConfig(config: BackendConfig): boolean {
    return "source" in config && typeof config.source === "string" && config.source.startsWith("fleet-mcpu");
  }

  private getBackendUrl(config: BackendConfig): string | undefined {
    if (config.transport === "http" || config.transport === "sse") {
      return config.url;
    }
    return undefined;
  }

  private normalizeSearchText(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  }

  private matchesSearch(haystack: string, query: string): boolean {
    if (!query) return true;
    const normalizedQuery = this.normalizeSearchText(query);
    if (!normalizedQuery) return true;
    const normalizedHaystack = this.normalizeSearchText(haystack);
    return normalizedQuery
      .split(" ")
      .every((term) => normalizedHaystack.includes(term));
  }

  private backendConfigChanged(current: BackendConfig, next: BackendConfig): boolean {
    return JSON.stringify(current) !== JSON.stringify(next);
  }

  private requireAdminAccess(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const configuredToken = process.env.MCP_GATEWAY_ADMIN_TOKEN;
    if (configuredToken) {
      const expected = `Bearer ${configuredToken}`;
      if (req.header("authorization") === expected) {
        next();
        return;
      }
      res.status(401).json({ error: "Admin API authorization required" });
      return;
    }

    const remoteAddress = req.socket.remoteAddress ?? req.ip ?? "";
    if (this.isLoopbackAddress(remoteAddress)) {
      next();
      return;
    }

    res.status(403).json({
      error:
        "Admin API is restricted to loopback clients unless MCP_GATEWAY_ADMIN_TOKEN is set",
    });
  }

  private isLoopbackAddress(address: string): boolean {
    return (
      address === "::1" ||
      address === "127.0.0.1" ||
      address === "::ffff:127.0.0.1" ||
      address.startsWith("127.")
    );
  }

  async reloadConfig(): Promise<void> {
    if (this.configReloadInFlight) {
      this.logger.warn("Config reload already in progress; waiting for existing reload");
      return this.configReloadInFlight;
    }

    this.configReloadInFlight = this.reloadConfigUnlocked().finally(() => {
      this.configReloadInFlight = undefined;
    });
    return this.configReloadInFlight;
  }

  private async reloadConfigUnlocked(): Promise<void> {
    this.logger.info("Reloading configuration...");
    const newConfig = await loadConfig(this.configPath);
    const fleetAutoIngest =
      newConfig.fleet.enabled && newConfig.fleet.toolhive.auto_ingest;

    // Find backends to add, remove, or update
    const currentNames = new Set(this.backends.keys());
    const newNames = new Set(Object.keys(newConfig.backends));

    // Remove backends no longer in config
    for (const name of currentNames) {
      const backend = this.backends.get(name)!;
      const isFleetBackend = this.isFleetIngestedConfig(backend.config);
      if (!newNames.has(name) && (!isFleetBackend || !fleetAutoIngest)) {
        this.logger.info(`Removing backend "${name}"`);
        await backend.disconnect();
        this.toolRegistry.unregisterBackend(name);
        this.backends.delete(name);
      }
    }

    // Add or replace static backends
    for (const name of newNames) {
      const existing = this.backends.get(name);
      if (!existing) {
        this.logger.info(`Adding new backend "${name}"`);
        await this.connectBackend(name, newConfig.backends[name]);
        continue;
      }

      if (
        this.isFleetIngestedConfig(existing.config) ||
        this.backendConfigChanged(existing.config, newConfig.backends[name])
      ) {
        this.logger.info(`Replacing backend "${name}" from reloaded config`);
        await existing.disconnect();
        this.toolRegistry.unregisterBackend(name);
        this.backends.delete(name);
        await this.connectBackend(name, newConfig.backends[name]);
      }
    }

    this.config = newConfig;
    if (fleetAutoIngest) {
      await this.ingestFleetBackends();
    }
    this.notifyToolsChanged();
    this.logger.info("Configuration reloaded successfully");
  }

  /**
   * Ingest fleet backends from MCPU generated config.
   * Skips any backend already registered (static config takes precedence).
   * Returns the raw ingest result for admin/logging use.
   */
  private async ingestFleetBackends(): Promise<FleetIngestResult> {
    if (this.fleetIngestInFlight) {
      this.logger.warn("Fleet ingestion already in progress; waiting for existing ingestion");
      return this.fleetIngestInFlight;
    }

    this.fleetIngestInFlight = this.ingestFleetBackendsUnlocked().finally(() => {
      this.fleetIngestInFlight = undefined;
    });
    return this.fleetIngestInFlight;
  }

  private async ingestFleetBackendsUnlocked(): Promise<FleetIngestResult> {
    const result = await loadFleetBackendsFromMcpuConfig(
      this.config.fleet.toolhive,
      this.logger
    );

    const connectEntries: Array<[string, BackendConfig]> = [];
    let unchanged = 0;
    let updated = 0;

    for (const [name, config] of Object.entries(result.backends)) {
      const existing = this.backends.get(name);
      if (!existing) {
        connectEntries.push([name, config]);
        continue;
      }

      if (!this.isFleetIngestedConfig(existing.config)) {
        result.skipped.push({
          name,
          reason: "static backend with same name takes precedence",
        });
        continue;
      }

      if (!this.backendConfigChanged(existing.config, config)) {
        unchanged++;
        continue;
      }

      this.logger.info(`Fleet ingestion: refreshing backend "${name}"`);
      await existing.disconnect();
      this.toolRegistry.unregisterBackend(name);
      this.backends.delete(name);
      updated++;
      connectEntries.push([name, config]);
    }

    const retainedMissing = Array.from(this.backends.entries()).filter(
      ([name, backend]) =>
        this.isFleetIngestedConfig(backend.config) && !(name in result.backends)
    );

    if (retainedMissing.length > 0) {
      this.logger.warn(
        `Fleet ingestion: retaining ${retainedMissing.length} existing fleet backend(s) missing from generated MCPU config`
      );
    }

    if (connectEntries.length === 0) {
      this.logger.info(
        `Fleet ingestion: no backend changes (${unchanged} unchanged)`
      );
      return result;
    }

    this.logger.info(
      `Fleet ingestion: connecting ${connectEntries.length} backend(s) (${updated} refreshed, ${unchanged} unchanged)`
    );
    await Promise.allSettled(
      connectEntries.map(([name, config]) => this.connectBackend(name, config))
    );

    const connected = connectEntries.filter(([name]) => {
      const b = this.backends.get(name);
      return b && b.status === "connected";
    }).length;

    this.logger.info(
      `Fleet ingestion: ${connected}/${connectEntries.length} changed backend(s) connected`
    );

    this.notifyToolsChanged();
    return result;
  }

  async start(): Promise<void> {
    this.logger.info(
      `Starting MCP Gateway "${this.config.gateway.name}" on ${this.config.gateway.host}:${this.config.gateway.port}`
    );

    // Connect all statically-configured backends
    const entries = Object.entries(this.config.backends);
    this.logger.info(`Connecting ${entries.length} static backend(s)...`);

    await Promise.allSettled(
      entries.map(([name, config]) => this.connectBackend(name, config))
    );

    // Auto-ingest fleet backends (ToolHive / MCPU)
    if (this.config.fleet.enabled && this.config.fleet.toolhive.auto_ingest) {
      await this.ingestFleetBackends();
    }

    const connected = Array.from(this.backends.values()).filter(
      (b) => b.status === "connected"
    ).length;
    this.logger.info(
      `${connected}/${this.backends.size} backends connected, ${this.toolRegistry.getAllTools().length} tools available`
    );

    // Start health monitoring
    this.startHealthMonitor();

    // Watch config file for changes
    this.configWatcher = watch(this.configPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500 },
    });
    this.configWatcher.on("change", async () => {
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
      this.httpServer = this.app.listen(this.config.gateway.port, this.config.gateway.host, () => {
        this.logger.info(
          `MCP Gateway listening on http://${this.config.gateway.host}:${this.config.gateway.port}`
        );
        this.logger.info(`  Streamable HTTP endpoint: /mcp`);
        this.logger.info(`  SSE endpoint:             /sse`);
        this.logger.info(`  Admin API:    /admin/status`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.logger.info("Shutting down gateway...");
    if (this.healthTimer) clearInterval(this.healthTimer);
    await this.configWatcher?.close();
    this.configWatcher = undefined;
    for (const backend of this.backends.values()) {
      await backend.disconnect();
    }
    for (const [sessionId, sessionServer] of this.sessions) {
      try {
        await sessionServer.close();
      } catch {
        // ignore
      }
    }
    for (const transport of this.sseTransports.values()) {
      try {
        await transport.close();
      } catch {
        // ignore
      }
    }
    for (const transport of this.streamableTransports.values()) {
      try {
        await transport.close();
      } catch {
        // ignore
      }
    }
    this.streamableSessionLastSeen.clear();
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer?.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.httpServer = undefined;
    }
  }

  private startHealthMonitor(): void {
    const interval = 30_000; // 30 seconds
    this.healthTimer = setInterval(async () => {
      await this.reapIdleStreamableSessions();
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
                backend.config.namespace,
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
