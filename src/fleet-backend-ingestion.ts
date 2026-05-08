/**
 * Fleet Backend Ingestion
 *
 * Reads fleet entries from ~/.config/mcpu/config.generated.json and/or ToolHive
 * inventory, then converts "running" streamable-http / sse entries into callable
 * gateway HttpBackendConfig objects that can be connected at startup.
 *
 * This is read-only; it never modifies ToolHive state or Docker containers.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HttpBackendConfig, SseBackendConfig, ToolHiveFleetConfig } from "./config.js";
import type { Logger } from "./logger.js";

export type FleetBackendConfig = HttpBackendConfig | SseBackendConfig;

export interface FleetIngestResult {
  backends: Record<string, FleetBackendConfig>;
  skipped: Array<{ name: string; reason: string }>;
  source: string;
  generatedAt: string;
}

/** Shape of a single MCPU config.generated.json entry */
interface McpuEntry {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
}

/**
 * Sanitise a backend name for use as a namespace / backend key.
 * Replaces non-alphanumeric runs with underscores and lowercases.
 */
function sanitiseName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

function makeUniqueNamespace(
  baseNamespace: string,
  backendName: string,
  usedNamespaces: Map<string, string>,
  logger: Logger
): string {
  const fallbackNamespace = baseNamespace || "backend";
  let namespace = fallbackNamespace;
  let suffix = 2;

  while (usedNamespaces.has(namespace)) {
    namespace = `${fallbackNamespace}_${suffix}`;
    suffix++;
  }

  const priorBackend = usedNamespaces.get(fallbackNamespace);
  if (priorBackend && namespace !== fallbackNamespace) {
    logger.warn(
      `Fleet ingestion: namespace collision for "${backendName}" and "${priorBackend}"; using namespace "${namespace}"`
    );
  }

  usedNamespaces.set(namespace, backendName);
  return namespace;
}

/**
 * Load the MCPU-generated config from disk and convert eligible entries to
 * gateway backend configs.
 */
export async function loadFleetBackendsFromMcpuConfig(
  fleetConfig: ToolHiveFleetConfig,
  logger: Logger
): Promise<FleetIngestResult> {
  const configPath =
    fleetConfig.mcpu_generated_config ??
    join(homedir(), ".config", "mcpu", "config.generated.json");

  const result: FleetIngestResult = {
    backends: {},
    skipped: [],
    source: configPath,
    generatedAt: new Date().toISOString(),
  };

  // Read the MCPU generated config.
  let rawConfig: Record<string, McpuEntry>;
  try {
    const content = await readFile(configPath, "utf-8");
    rawConfig = JSON.parse(content) as Record<string, McpuEntry>;
  } catch (err) {
    logger.warn(
      `Fleet ingestion: could not read MCPU config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`
    );
    return result;
  }

  const ingestOnly = new Set(fleetConfig.ingest_only ?? []);
  const ingestSkip = new Set(fleetConfig.ingest_skip ?? []);
  const namespacePrefix = fleetConfig.ingest_namespace_prefix ?? "";
  const usedNamespaces = new Map<string, string>();

  for (const [name, entry] of Object.entries(rawConfig)) {
    // Filters.
    if (ingestOnly.size > 0 && !ingestOnly.has(name)) {
      result.skipped.push({ name, reason: "not in ingest_only list" });
      continue;
    }
    if (ingestSkip.has(name)) {
      result.skipped.push({ name, reason: "in ingest_skip list" });
      continue;
    }

    // Only ingest HTTP-based entries.
    const type = entry.type ?? "";
    if (type !== "streamable-http" && type !== "http" && type !== "sse") {
      result.skipped.push({
        name,
        reason: `type="${type}" is not http/streamable-http/sse; only HTTP transports are auto-ingested`,
      });
      continue;
    }

    if (!entry.url) {
      result.skipped.push({ name, reason: "no URL provided" });
      continue;
    }

    // Validate URL.
    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      result.skipped.push({ name, reason: `invalid URL: ${entry.url}` });
      continue;
    }

    const namespace = makeUniqueNamespace(
      `${namespacePrefix}${sanitiseName(name)}`,
      name,
      usedNamespaces,
      logger
    );

    if (type === "sse") {
      const config: SseBackendConfig = {
        transport: "sse",
        url: url.toString(),
        namespace,
        enabled: true,
        reconnect_interval: 5,
        max_restarts: 5,
        restart_policy: "on-failure",
        headers: {},
        health_check_interval: 30,
        source: "fleet-mcpu",
        description: entry.description,
      };
      result.backends[name] = config;
      logger.debug(`Fleet ingestion: will connect "${name}" as SSE backend at ${url}`);
    } else {
      // streamable-http or http
      const config: HttpBackendConfig = {
        transport: "http",
        url: url.toString(),
        namespace,
        enabled: true,
        reconnect_interval: 5,
        max_restarts: 5,
        restart_policy: "on-failure",
        headers: {},
        health_check_interval: 30,
        source: "fleet-mcpu",
        description: entry.description,
      };
      result.backends[name] = config;
      logger.debug(`Fleet ingestion: will connect "${name}" as HTTP backend at ${url}`);
    }
  }

  logger.info(
    `Fleet ingestion: ${Object.keys(result.backends).length} backends loaded from ${configPath} (${result.skipped.length} skipped)`
  );
  return result;
}
