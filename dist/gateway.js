import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema, isInitializeRequest, } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { ToolRegistry } from "./tool-registry.js";
import { BackendInstance } from "./backend.js";
import { watch } from "chokidar";
import { loadConfig } from "./config.js";
import { buildToolHiveFleetInventory } from "./fleet-inventory.js";
import { buildFleetMcpuConfig } from "./fleet-mcpu-config.js";
import { loadFleetBackendsFromMcpuConfig } from "./fleet-backend-ingestion.js";
import { getMuxTools, isMuxToolName, MUX_TOOL_NAMES, extractCallToolArgs } from "./mux-tools.js";
const DEFAULT_MUX_RESPONSE_CHAR_LIMIT = 60_000;
const MAX_MUX_RESPONSE_CHAR_LIMIT = 200_000;
const DEFAULT_MUX_LIST_LIMIT = 25;
const MAX_MUX_LIST_LIMIT = 100;
const STREAMABLE_SESSION_IDLE_TTL_MS = 60 * 60 * 1000;
export class Gateway {
    config;
    configPath;
    logger;
    app = express();
    toolRegistry;
    backends = new Map();
    sseTransports = new Map();
    streamableTransports = new Map();
    sessions = new Map();
    streamableSessionLastSeen = new Map();
    healthTimer;
    httpServer;
    configWatcher;
    configReloadInFlight;
    fleetIngestInFlight;
    constructor(config, configPath, logger) {
        this.config = config;
        this.configPath = configPath;
        this.logger = logger;
        this.toolRegistry = new ToolRegistry(logger, config.gateway.tool_prefix);
        this.setupHttpRoutes();
    }
    createSessionServer() {
        const server = new McpServer({ name: this.config.gateway.name, version: "1.0.0" }, { capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} } });
        this.setupMcpHandlers(server);
        return server;
    }
    setupMcpHandlers(mcpServer) {
        const lowLevel = mcpServer.server;
        lowLevel.setRequestHandler(ListToolsRequestSchema, async () => {
            return { tools: this.getExposedTools() };
        });
        lowLevel.setRequestHandler(CallToolRequestSchema, async (request) => {
            const toolName = request.params.name;
            const args = request.params.arguments ?? {};
            if (isMuxToolName(toolName))
                return this.handleMuxTool(toolName, args);
            return this.callBackendTool(toolName, args);
        });
        // Resource handlers
        lowLevel.setRequestHandler(ListResourcesRequestSchema, async () => {
            const allResources = [];
            for (const [name, backend] of this.backends) {
                if (backend.status !== "connected")
                    continue;
                try {
                    const resources = await backend.listResources();
                    const ns = this.config.backends[name]?.namespace ?? name;
                    const prefix = this.config.gateway.tool_prefix ? `${this.config.gateway.tool_prefix}${ns}` : ns;
                    for (const r of resources) {
                        allResources.push({ ...r, name: `${prefix}_${r.name}` });
                    }
                }
                catch {
                    // skip backends that don't support resources
                }
            }
            return { resources: allResources };
        });
        lowLevel.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const uri = request.params.uri;
            // Try each backend until one handles the URI
            for (const [, backend] of this.backends) {
                if (backend.status !== "connected")
                    continue;
                try {
                    const result = await backend.readResource(uri);
                    return result;
                }
                catch {
                    // try next
                }
            }
            return { contents: [{ uri, text: `Resource not found: ${uri}` }] };
        });
        // Prompt handlers
        lowLevel.setRequestHandler(ListPromptsRequestSchema, async () => {
            const allPrompts = [];
            for (const [name, backend] of this.backends) {
                if (backend.status !== "connected")
                    continue;
                try {
                    const prompts = await backend.listPrompts();
                    const ns = this.config.backends[name]?.namespace ?? name;
                    const prefix = this.config.gateway.tool_prefix ? `${this.config.gateway.tool_prefix}${ns}` : ns;
                    for (const p of prompts) {
                        allPrompts.push({ ...p, name: `${prefix}_${p.name}` });
                    }
                }
                catch {
                    // skip backends that don't support prompts
                }
            }
            return { prompts: allPrompts };
        });
        lowLevel.setRequestHandler(GetPromptRequestSchema, async (request) => {
            const promptName = request.params.name;
            // Find the backend by namespace prefix
            for (const [name, backend] of this.backends) {
                if (backend.status !== "connected")
                    continue;
                const ns = this.config.backends[name]?.namespace ?? name;
                const prefix = this.config.gateway.tool_prefix ? `${this.config.gateway.tool_prefix}${ns}` : ns;
                if (promptName.startsWith(`${prefix}_`)) {
                    const originalName = promptName.slice(prefix.length + 1);
                    try {
                        const result = await backend.getPrompt(originalName, request.params.arguments);
                        return result;
                    }
                    catch (err) {
                        return {
                            messages: [
                                {
                                    role: "assistant",
                                    content: {
                                        type: "text",
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
                        role: "assistant",
                        content: {
                            type: "text",
                            text: `Unknown prompt: ${promptName}`,
                        },
                    },
                ],
            };
        });
    }
    setupHttpRoutes() {
        // Apply JSON parsing only to admin routes (not /messages — SSE transport reads raw body)
        this.app.use("/admin", express.json());
        this.app.use("/admin", this.requireAdminAccess.bind(this));
        this.app.use("/mcp", express.json({ limit: "10mb" }));
        // Streamable HTTP endpoint for MCP clients that support type=http (Claude Code, Copilot CLI)
        this.app.all("/mcp", async (req, res) => {
            const sessionId = this.headerValue(req.headers["mcp-session-id"]);
            let transport;
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
                }
                else if (req.method === "POST" && isInitializeRequest(req.body)) {
                    let initializedSessionId;
                    transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (newSessionId) => {
                            initializedSessionId = newSessionId;
                            this.streamableTransports.set(newSessionId, transport);
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
                }
                else {
                    res.status(400).json({
                        jsonrpc: "2.0",
                        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
                        id: null,
                    });
                    return;
                }
                await transport.handleRequest(req, res, req.body);
            }
            catch (err) {
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
        this.app.get("/sse", async (req, res) => {
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
        this.app.post("/messages", async (req, res) => {
            const sessionId = req.query.sessionId;
            const transport = this.sseTransports.get(sessionId);
            if (!transport) {
                res.status(404).json({ error: "Session not found" });
                return;
            }
            await transport.handlePostMessage(req, res);
        });
        // Admin API
        this.app.get("/admin/backends", (_req, res) => {
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
        this.app.post("/admin/reload/:name", async (req, res) => {
            const backendName = req.params.name;
            const backend = this.backends.get(backendName);
            if (!backend) {
                res.status(404).json({ error: `Backend "${backendName}" not found` });
                return;
            }
            try {
                await backend.restart();
                this.toolRegistry.registerBackend(backendName, backend.config.namespace, backend.tools);
                this.notifyToolsChanged();
                res.json({
                    status: "ok",
                    message: `Backend "${backendName}" reloaded`,
                    toolCount: backend.tools.length,
                });
            }
            catch (err) {
                res.status(500).json({
                    error: `Failed to reload backend "${backendName}": ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        });
        this.app.post("/admin/enable/:name", async (req, res) => {
            const backendName = req.params.name;
            const backend = this.backends.get(backendName);
            if (!backend) {
                res.status(404).json({ error: `Backend "${backendName}" not found` });
                return;
            }
            backend.config.enabled = true;
            try {
                await backend.restart();
                this.toolRegistry.registerBackend(backendName, backend.config.namespace, backend.tools);
                this.notifyToolsChanged();
                res.json({ status: "ok", message: `Backend "${backendName}" enabled` });
            }
            catch (err) {
                res.status(500).json({
                    error: `Failed to enable backend "${backendName}"`,
                });
            }
        });
        this.app.post("/admin/disable/:name", async (req, res) => {
            const backendName = req.params.name;
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
        });
        this.app.get("/admin/status", (_req, res) => {
            const toolStats = this.toolRegistry.getStats();
            const totalTools = this.toolRegistry.getAllTools().length;
            const connectedBackends = Array.from(this.backends.values()).filter((b) => b.status === "connected").length;
            res.json({
                gateway: this.config.gateway.name,
                totalBackends: this.backends.size,
                connectedBackends,
                totalTools,
                toolsByBackend: toolStats,
                activeSessions: this.sseTransports.size + this.streamableTransports.size,
            });
        });
        this.app.get("/admin/fleet/inventory", async (req, res) => {
            if (!this.config.fleet.enabled) {
                res.status(404).json({ error: "Fleet inventory is disabled" });
                return;
            }
            try {
                const probe = req.query.probe === "true" || req.query.probe === "1";
                const inventory = await this.buildFleetInventory(probe);
                res.json(inventory);
            }
            catch (err) {
                res.status(500).json({
                    error: `Failed to build fleet inventory: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        });
        this.app.get("/admin/fleet/mcpu-config", async (req, res) => {
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
            }
            catch (err) {
                res.status(500).json({
                    error: `Failed to build MCPU config report: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        });
        this.app.get("/admin/fleet/summary", async (_req, res) => {
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
            }
            catch (err) {
                res.status(500).json({
                    error: `Failed to build fleet summary: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        });
        this.app.get("/admin/fleet/backends", (_req, res) => {
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
        this.app.post("/admin/fleet/reload", async (_req, res) => {
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
            }
            catch (err) {
                res.status(500).json({
                    error: `Fleet reload failed: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        });
        this.app.post("/admin/reload-config", async (_req, res) => {
            try {
                await this.reloadConfig();
                res.json({ status: "ok", message: "Configuration reloaded" });
            }
            catch (err) {
                res.status(500).json({
                    error: `Failed to reload config: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        });
    }
    headerValue(value) {
        return Array.isArray(value) ? value[0] : value;
    }
    getExposedTools() {
        const mode = this.config.gateway.tool_exposure;
        if (mode === "mux")
            return getMuxTools();
        if (mode === "both")
            return [...getMuxTools(), ...this.toolRegistry.getAllTools()];
        return this.toolRegistry.getAllTools();
    }
    jsonToolResult(value, maxChars = DEFAULT_MUX_RESPONSE_CHAR_LIMIT) {
        const text = JSON.stringify(value, null, 2);
        const safeText = this.compactJsonText(text, maxChars);
        return {
            content: [
                {
                    type: "text",
                    text: safeText,
                },
            ],
        };
    }
    async handleMuxTool(toolName, args) {
        switch (toolName) {
            case MUX_TOOL_NAMES.searchTools:
                return this.jsonToolResult(this.searchRegisteredTools(args));
            case MUX_TOOL_NAMES.callTool: {
                const { target, targetArgs } = extractCallToolArgs(args);
                if (!target) {
                    return {
                        content: [{ type: "text", text: "gateway_call_tool requires a string 'tool' argument." }],
                        isError: true,
                    };
                }
                return this.callBackendTool(target, targetArgs, this.getCharLimit(args, "maxOutputChars"));
            }
            case MUX_TOOL_NAMES.backendStatus:
                return this.jsonToolResult(this.getBackendStatus(args));
            case MUX_TOOL_NAMES.fleetInventory: {
                if (!this.config.fleet.enabled) {
                    return {
                        content: [{ type: "text", text: "Fleet inventory is disabled." }],
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
                return this.jsonToolResult(compact);
            }
            case MUX_TOOL_NAMES.mcpuConfig: {
                if (!this.config.fleet.enabled) {
                    return {
                        content: [{ type: "text", text: "Fleet inventory is disabled." }],
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
                return this.jsonToolResult(payload);
            }
        }
    }
    buildFleetInventory(probe) {
        return buildToolHiveFleetInventory({
            ...this.config.fleet.toolhive,
            endpoint_probe: probe || this.config.fleet.toolhive.endpoint_probe,
        });
    }
    getListLimit(args) {
        const raw = args.limit;
        if (typeof raw !== "number" || !Number.isFinite(raw))
            return DEFAULT_MUX_LIST_LIMIT;
        return Math.max(1, Math.min(Math.floor(raw), MAX_MUX_LIST_LIMIT));
    }
    getCharLimit(args, key) {
        const raw = args[key];
        if (typeof raw !== "number" || !Number.isFinite(raw))
            return DEFAULT_MUX_RESPONSE_CHAR_LIMIT;
        return Math.max(1_000, Math.min(Math.floor(raw), MAX_MUX_RESPONSE_CHAR_LIMIT));
    }
    truncateText(value, maxChars) {
        if (value === undefined || value.length <= maxChars)
            return value;
        return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars by mcp-gateway]`;
    }
    compactJsonText(text, maxChars) {
        if (text.length <= maxChars)
            return text;
        return JSON.stringify({
            gatewayTruncated: true,
            originalChars: text.length,
            maxChars,
            preview: text.slice(0, maxChars),
            note: "Response exceeded the MCP gateway safe payload cap. Narrow the request or use the loopback admin API outside model context for full raw data.",
        }, null, 2);
    }
    compactFleetEntry(entry) {
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
    searchRegisteredTools(args) {
        const query = typeof args.query === "string" ? args.query : "";
        const backendFilter = typeof args.backend === "string" ? args.backend : "";
        const limit = this.getListLimit(args);
        const matches = this.toolRegistry.getAllEntries()
            .filter((entry) => {
            const backendConfig = this.backends.get(entry.backendName)?.config;
            if (backendFilter &&
                !this.matchesSearch([
                    entry.backendName,
                    backendConfig?.namespace ?? "",
                    backendConfig && "description" in backendConfig ? backendConfig.description ?? "" : "",
                ].join(" "), backendFilter)) {
                return false;
            }
            const haystack = [
                entry.namespacedName,
                entry.originalName,
                entry.backendName,
                backendConfig?.namespace ?? "",
                backendConfig && "description" in backendConfig ? backendConfig.description ?? "" : "",
                entry.tool.description ?? "",
            ].join(" ");
            return this.matchesSearch(haystack, query);
        })
            .slice(0, limit)
            .map((entry) => ({
            name: entry.namespacedName,
            backend: entry.backendName,
            originalName: entry.originalName,
            description: this.truncateText(entry.tool.description, 300),
            backendDescription: (() => {
                const backendConfig = this.backends.get(entry.backendName)?.config;
                return backendConfig && "description" in backendConfig
                    ? this.truncateText(backendConfig.description, 300)
                    : undefined;
            })(),
        }));
        return {
            totalRegisteredTools: this.toolRegistry.getAllTools().length,
            returned: matches.length,
            matches,
        };
    }
    getBackendStatus(args) {
        const backendFilter = typeof args.backend === "string" ? args.backend : "";
        const limit = this.getListLimit(args);
        const includeErrors = args.includeErrors === true;
        const includeDescriptions = args.includeDescriptions === true;
        const toolStats = this.toolRegistry.getStats();
        const backends = Array.from(this.backends.entries())
            .filter(([name, backend]) => !backendFilter ||
            this.matchesSearch([
                name,
                backend.config.namespace,
                backend.config.transport,
                "description" in backend.config ? backend.config.description ?? "" : "",
            ].join(" "), backendFilter))
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
        return {
            totalBackends: this.backends.size,
            returnedBackends: backends.length,
            omittedBackends: Math.max(0, this.backends.size - backends.length),
            totalRegisteredTools: this.toolRegistry.getAllTools().length,
            backends,
        };
    }
    async callBackendTool(toolName, args, maxOutputChars = DEFAULT_MUX_RESPONSE_CHAR_LIMIT) {
        const entry = this.toolRegistry.resolve(toolName);
        if (!entry) {
            return {
                content: [
                    {
                        type: "text",
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
                        type: "text",
                        text: `Backend "${entry.backendName}" is not connected (status: ${backend?.status ?? "unknown"}).`,
                    },
                ],
                isError: true,
            };
        }
        try {
            const result = await backend.callTool(entry.originalName, args);
            return this.compactBackendToolResult(result, maxOutputChars);
        }
        catch (err) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error calling ${entry.originalName} on backend "${entry.backendName}": ${err instanceof Error ? err.message : String(err)}`,
                    },
                ],
                isError: true,
            };
        }
    }
    compactBackendToolResult(result, maxOutputChars) {
        const record = result && typeof result === "object" ? result : {};
        const content = Array.isArray(record.content) ? record.content : [];
        let remaining = maxOutputChars;
        let truncated = false;
        const compactContent = content.map((item) => {
            if (!item || typeof item !== "object")
                return item;
            const entry = item;
            if (entry.type === "text" && typeof entry.text === "string") {
                if (remaining <= 0) {
                    truncated = true;
                    return { ...entry, text: "[mcp-gateway truncated additional text content]" };
                }
                if (entry.text.length > remaining) {
                    truncated = true;
                    const text = `${entry.text.slice(0, remaining)}\n...[truncated ${entry.text.length - remaining} chars by mcp-gateway]`;
                    remaining = 0;
                    return { ...entry, text };
                }
                remaining -= entry.text.length;
                return entry;
            }
            const serialized = JSON.stringify(entry);
            if (serialized.length > Math.max(1_000, remaining)) {
                truncated = true;
                remaining = 0;
                return {
                    type: "text",
                    text: `[mcp-gateway dropped oversized non-text content item: ${serialized.length} serialized chars]`,
                };
            }
            remaining -= serialized.length;
            return entry;
        });
        if (truncated) {
            compactContent.unshift({
                type: "text",
                text: `mcp-gateway compacted the backend response to stay under ${maxOutputChars} chars. Narrow the request or call a more specific backend tool for full detail.`,
            });
        }
        return {
            content: compactContent,
            ...(record.isError === true ? { isError: true } : {}),
        };
    }
    touchStreamableSession(sessionId) {
        this.streamableSessionLastSeen.set(sessionId, Date.now());
    }
    dropStreamableSession(sessionId) {
        this.streamableTransports.delete(sessionId);
        this.streamableSessionLastSeen.delete(sessionId);
        this.sessions.delete(sessionId);
    }
    async reapIdleStreamableSessions(now = Date.now()) {
        for (const [sessionId, lastSeen] of this.streamableSessionLastSeen) {
            if (now - lastSeen < STREAMABLE_SESSION_IDLE_TTL_MS)
                continue;
            const transport = this.streamableTransports.get(sessionId);
            const sessionServer = this.sessions.get(sessionId);
            this.logger.info(`Reaping idle streamable MCP session ${sessionId}`);
            this.dropStreamableSession(sessionId);
            try {
                await sessionServer?.close();
            }
            catch {
                // ignore cleanup failures
            }
            try {
                await transport?.close();
            }
            catch {
                // ignore cleanup failures
            }
        }
    }
    notifyToolsChanged() {
        // Notify all connected SSE clients that tool list changed
        for (const [sessionId, sessionServer] of this.sessions) {
            try {
                sessionServer.server
                    .notification({
                    method: "notifications/tools/list_changed",
                })
                    .catch(() => { });
            }
            catch {
                // ignore notification errors
            }
        }
    }
    async connectBackend(name, config) {
        const backend = new BackendInstance(name, config, this.logger, () => {
            // On reconnect, re-register tools
            this.toolRegistry.registerBackend(name, config.namespace, backend.tools);
            this.notifyToolsChanged();
        });
        this.backends.set(name, backend);
        try {
            await this.withTimeout(backend.connect(), config.connect_timeout_ms, `Backend "${name}" connection timed out after ${config.connect_timeout_ms}ms`);
            if (backend.status === "connected") {
                this.toolRegistry.registerBackend(name, config.namespace, backend.tools);
            }
        }
        catch (err) {
            await backend.disconnect();
            this.logger.warn(`Backend "${name}" startup did not complete: ${err instanceof Error ? err.message : String(err)}`);
            this.logger.warn(`Backend "${name}" failed to start — will retry per restart policy`);
        }
    }
    async withTimeout(promise, timeoutMs, message) {
        let timer;
        const timeout = new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        });
        try {
            return await Promise.race([promise, timeout]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    isFleetIngestedConfig(config) {
        return "source" in config && typeof config.source === "string" && config.source.startsWith("fleet-mcpu");
    }
    getBackendUrl(config) {
        if (config.transport === "http" || config.transport === "sse") {
            return config.url;
        }
        return undefined;
    }
    normalizeSearchText(value) {
        return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
    }
    matchesSearch(haystack, query) {
        if (!query)
            return true;
        const normalizedQuery = this.normalizeSearchText(query);
        if (!normalizedQuery)
            return true;
        const normalizedHaystack = this.normalizeSearchText(haystack);
        return normalizedQuery
            .split(" ")
            .every((term) => normalizedHaystack.includes(term));
    }
    backendConfigChanged(current, next) {
        return JSON.stringify(current) !== JSON.stringify(next);
    }
    requireAdminAccess(req, res, next) {
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
            error: "Admin API is restricted to loopback clients unless MCP_GATEWAY_ADMIN_TOKEN is set",
        });
    }
    isLoopbackAddress(address) {
        return (address === "::1" ||
            address === "127.0.0.1" ||
            address === "::ffff:127.0.0.1" ||
            address.startsWith("127."));
    }
    async reloadConfig() {
        if (this.configReloadInFlight) {
            this.logger.warn("Config reload already in progress; waiting for existing reload");
            return this.configReloadInFlight;
        }
        this.configReloadInFlight = this.reloadConfigUnlocked().finally(() => {
            this.configReloadInFlight = undefined;
        });
        return this.configReloadInFlight;
    }
    async reloadConfigUnlocked() {
        this.logger.info("Reloading configuration...");
        const newConfig = await loadConfig(this.configPath);
        const fleetAutoIngest = newConfig.fleet.enabled && newConfig.fleet.toolhive.auto_ingest;
        // Find backends to add, remove, or update
        const currentNames = new Set(this.backends.keys());
        const newNames = new Set(Object.keys(newConfig.backends));
        // Remove backends no longer in config
        for (const name of currentNames) {
            const backend = this.backends.get(name);
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
            if (this.isFleetIngestedConfig(existing.config) ||
                this.backendConfigChanged(existing.config, newConfig.backends[name])) {
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
    async ingestFleetBackends() {
        if (this.fleetIngestInFlight) {
            this.logger.warn("Fleet ingestion already in progress; waiting for existing ingestion");
            return this.fleetIngestInFlight;
        }
        this.fleetIngestInFlight = this.ingestFleetBackendsUnlocked().finally(() => {
            this.fleetIngestInFlight = undefined;
        });
        return this.fleetIngestInFlight;
    }
    async ingestFleetBackendsUnlocked() {
        const result = await loadFleetBackendsFromMcpuConfig(this.config.fleet.toolhive, this.logger);
        const connectEntries = [];
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
        const retainedMissing = Array.from(this.backends.entries()).filter(([name, backend]) => this.isFleetIngestedConfig(backend.config) && !(name in result.backends));
        if (retainedMissing.length > 0) {
            this.logger.warn(`Fleet ingestion: retaining ${retainedMissing.length} existing fleet backend(s) missing from generated MCPU config`);
        }
        if (connectEntries.length === 0) {
            this.logger.info(`Fleet ingestion: no backend changes (${unchanged} unchanged)`);
            return result;
        }
        this.logger.info(`Fleet ingestion: connecting ${connectEntries.length} backend(s) (${updated} refreshed, ${unchanged} unchanged)`);
        await Promise.allSettled(connectEntries.map(([name, config]) => this.connectBackend(name, config)));
        const connected = connectEntries.filter(([name]) => {
            const b = this.backends.get(name);
            return b && b.status === "connected";
        }).length;
        this.logger.info(`Fleet ingestion: ${connected}/${connectEntries.length} changed backend(s) connected`);
        this.notifyToolsChanged();
        return result;
    }
    async start() {
        this.logger.info(`Starting MCP Gateway "${this.config.gateway.name}" on ${this.config.gateway.host}:${this.config.gateway.port}`);
        // Connect all statically-configured backends
        const entries = Object.entries(this.config.backends);
        this.logger.info(`Connecting ${entries.length} static backend(s)...`);
        await Promise.allSettled(entries.map(([name, config]) => this.connectBackend(name, config)));
        // Auto-ingest fleet backends (ToolHive / MCPU)
        if (this.config.fleet.enabled && this.config.fleet.toolhive.auto_ingest) {
            await this.ingestFleetBackends();
        }
        const connected = Array.from(this.backends.values()).filter((b) => b.status === "connected").length;
        this.logger.info(`${connected}/${this.backends.size} backends connected, ${this.toolRegistry.getAllTools().length} tools available`);
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
            }
            catch (err) {
                this.logger.error(`Config reload failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        });
        // Start HTTP server
        return new Promise((resolve) => {
            this.httpServer = this.app.listen(this.config.gateway.port, this.config.gateway.host, () => {
                this.logger.info(`MCP Gateway listening on http://${this.config.gateway.host}:${this.config.gateway.port}`);
                this.logger.info(`  Streamable HTTP endpoint: /mcp`);
                this.logger.info(`  SSE endpoint:             /sse`);
                this.logger.info(`  Admin API:    /admin/status`);
                resolve();
            });
        });
    }
    async stop() {
        this.logger.info("Shutting down gateway...");
        if (this.healthTimer)
            clearInterval(this.healthTimer);
        await this.configWatcher?.close();
        this.configWatcher = undefined;
        for (const backend of this.backends.values()) {
            await backend.disconnect();
        }
        for (const [sessionId, sessionServer] of this.sessions) {
            try {
                await sessionServer.close();
            }
            catch {
                // ignore
            }
        }
        for (const transport of this.sseTransports.values()) {
            try {
                await transport.close();
            }
            catch {
                // ignore
            }
        }
        for (const transport of this.streamableTransports.values()) {
            try {
                await transport.close();
            }
            catch {
                // ignore
            }
        }
        this.streamableSessionLastSeen.clear();
        if (this.httpServer) {
            await new Promise((resolve, reject) => {
                this.httpServer?.close((err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            this.httpServer = undefined;
        }
    }
    startHealthMonitor() {
        const interval = 30_000; // 30 seconds
        this.healthTimer = setInterval(async () => {
            await this.reapIdleStreamableSessions();
            for (const [name, backend] of this.backends) {
                if (backend.status === "disconnected" || backend.status === "error") {
                    this.logger.info(`Health check: backend "${name}" is ${backend.status}, attempting reconnect...`);
                    try {
                        await backend.restart();
                        if (backend.status === "connected") {
                            const backendConfig = this.config.backends[name];
                            this.toolRegistry.registerBackend(name, backend.config.namespace, backend.tools);
                            this.notifyToolsChanged();
                            this.logger.info(`Health check: backend "${name}" reconnected — ${backend.tools.length} tools`);
                        }
                    }
                    catch {
                        this.logger.warn(`Health check: backend "${name}" reconnect failed`);
                    }
                }
            }
        }, interval);
    }
}
//# sourceMappingURL=gateway.js.map