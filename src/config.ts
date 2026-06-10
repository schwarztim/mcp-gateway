import { z } from "zod";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import Vault from "node-vault";

const SseBackendSchema = z.object({
  transport: z.literal("sse"),
  url: z.string().url(),
  namespace: z.string(),
  enabled: z.boolean().default(true),
  reconnect_interval: z.number().default(5),
  max_restarts: z.number().default(5),
  connect_timeout_ms: z.number().int().positive().default(15_000),
  restart_policy: z
    .enum(["always", "on-failure", "never"])
    .default("on-failure"),
  headers: z.record(z.string()).default({}),
  health_check_interval: z.number().default(30),
  source: z.string().optional(),
  description: z.string().optional(),
});

/** Streamable HTTP transport used by ToolHive-managed MCP servers */
const HttpBackendSchema = z.object({
  transport: z.literal("http"),
  url: z.string().url(),
  namespace: z.string(),
  enabled: z.boolean().default(true),
  reconnect_interval: z.number().default(5),
  max_restarts: z.number().default(5),
  connect_timeout_ms: z.number().int().positive().default(15_000),
  restart_policy: z
    .enum(["always", "on-failure", "never"])
    .default("on-failure"),
  headers: z.record(z.string()).default({}),
  health_check_interval: z.number().default(30),
  /** Informational: source of this backend entry (e.g. "fleet-mcpu") */
  source: z.string().optional(),
  /** Informational: original description from the fleet catalog */
  description: z.string().optional(),
});

const BackendSchema = z.discriminatedUnion("transport", [
  SseBackendSchema,
  HttpBackendSchema,
]);

const GatewayConfigSchema = z.object({
  port: z.number().default(3100),
  host: z.string().default("0.0.0.0"),
  name: z.string().default("mcp-gateway"),
  log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  tool_prefix: z.string().default(""),
  tool_exposure: z.enum(["namespaced", "mux", "both"]).default("namespaced"),
  /** Stateless Streamable HTTP prevents stale in-memory session IDs after gateway restarts */
  streamable_http_stateless: z.boolean().default(true),
  /** JSON responses keep facade calls request/response and avoid long-lived per-call SSE streams */
  streamable_http_json_response: z.boolean().default(true),
});

const ToolHiveFleetConfigSchema = z.object({
  app_support_dir: z.string().optional(),
  mcpu_generated_config: z.string().optional(),
  /** Also ingest static MCPU config entries that are not in generated ToolHive config */
  ingest_static_mcpu_config: z.boolean().default(true),
  /** Static MCPU config path; defaults to ~/.config/mcpu/config.json */
  mcpu_static_config: z.string().optional(),
  /** Additional flat or mcpServers-style MCPU config files to merge after generated/static configs */
  additional_mcpu_configs: z.array(z.string()).default([]),
  docker_ps: z.boolean().default(true),
  endpoint_probe: z.boolean().default(false),
  probe_timeout_ms: z.number().int().positive().default(750),
  /** Auto-ingest fleet entries as gateway backends at startup */
  auto_ingest: z.boolean().default(true),
  /** Prefix for auto-ingested backend namespaces (default: "") */
  ingest_namespace_prefix: z.string().default(""),
  /** Only ingest entries matching these names (empty = all) */
  ingest_only: z.array(z.string()).default([]),
  /** Skip ingesting entries matching these names */
  ingest_skip: z.array(z.string()).default([]),
});

const FleetConfigSchema = z.object({
  enabled: z.boolean().default(true),
  toolhive: ToolHiveFleetConfigSchema.default({}),
});

const SafetyConfigSchema = z.object({
  enforce: z.enum(["advisory", "blocking"]).default("blocking"),
  manifest_dir: z.string().optional(),
  decision_log: z
    .object({
      enabled: z.boolean().default(false),
      path: z.string().default("~/.mcp-gateway/decisions.jsonl"),
    })
    .default({}),
});

const CompressionConfigSchema = z.object({
  /** Master switch — defaults OFF so behavior is byte-identical to pre-Phase-4. */
  enabled: z.boolean().default(false),
  /** Only compress text payloads at least this large (chars); smaller text passes through unchanged. */
  min_chars: z.number().int().positive().default(20_000),
  /**
   * advisory — measure savings and log them, but return the ORIGINAL text unchanged.
   * active   — apply compression and return the compacted text with a marker.
   */
  mode: z.enum(["advisory", "active"]).default("active"),
});

const ConfigFileSchema = z.object({
  gateway: GatewayConfigSchema.default({}),
  fleet: FleetConfigSchema.default({}),
  backends: z.record(BackendSchema).default({}),
  safety: SafetyConfigSchema.default({}),
  compression: CompressionConfigSchema.default({}),
});

export type SseBackendConfig = z.infer<typeof SseBackendSchema>;
export type HttpBackendConfig = z.infer<typeof HttpBackendSchema>;
export type BackendConfig = z.infer<typeof BackendSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type ToolHiveFleetConfig = z.infer<typeof ToolHiveFleetConfigSchema>;
export type FleetConfig = z.infer<typeof FleetConfigSchema>;
export type SafetyConfig = z.infer<typeof SafetyConfigSchema>;
export type CompressionConfig = z.infer<typeof CompressionConfigSchema>;
export type Config = z.infer<typeof ConfigFileSchema>;

/** Resolve ${VAR} references in a string from process.env */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    const envVal = process.env[varName];
    if (envVal === undefined) {
      throw new Error(`Environment variable ${varName} is not set`);
    }
    return envVal;
  });
}

/** Recursively resolve env vars in an object */
function resolveEnvInObject(obj: unknown): unknown {
  if (typeof obj === "string") return resolveEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(resolveEnvInObject);
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = resolveEnvInObject(v);
    }
    return result;
  }
  return obj;
}

/** Vault secret cache to avoid redundant fetches */
const vaultCache = new Map<string, Record<string, string>>();

/**
 * Resolve vault:path#key references.
 * Syntax: vault:secret/mcp/akamai#client_secret
 * Or shorthand: vault:mcp/akamai#client_secret (auto-prefixes secret/)
 */
async function resolveVaultRef(ref: string): Promise<string> {
  const match = ref.match(/^vault:(.+)#(.+)$/);
  if (!match) throw new Error(`Invalid vault reference: ${ref}`);

  let [, path, key] = match;

  // Shorthand: vault:mcp/x#y → secret/data/mcp/x
  if (!path.startsWith("secret/")) {
    path = `secret/data/${path}`;
  } else if (!path.includes("/data/")) {
    // vault:secret/mcp/x#y → secret/data/mcp/x
    path = path.replace("secret/", "secret/data/");
  }

  if (!vaultCache.has(path)) {
    const vaultAddr = process.env.VAULT_ADDR || "http://127.0.0.1:8200";
    const vaultToken = process.env.VAULT_TOKEN;
    if (!vaultToken) throw new Error("VAULT_TOKEN environment variable is required for vault: references");

    const client = Vault({ endpoint: vaultAddr, token: vaultToken });
    const result = await client.read(path);
    vaultCache.set(path, result.data?.data || result.data || {});
  }

  const data = vaultCache.get(path)!;
  if (!(key in data)) {
    throw new Error(`Vault secret at ${path} does not contain key "${key}". Available: ${Object.keys(data).join(", ")}`);
  }
  return data[key];
}

/** Recursively resolve vault: refs in an object */
async function resolveVaultInObject(obj: unknown): Promise<unknown> {
  if (typeof obj === "string" && obj.startsWith("vault:")) {
    return resolveVaultRef(obj);
  }
  if (Array.isArray(obj)) {
    return Promise.all(obj.map(resolveVaultInObject));
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = await resolveVaultInObject(v);
    }
    return result;
  }
  return obj;
}

/**
 * Pre-parse quarantine filter: stdio is not representable in the config schema.
 * Any backend entry declaring `transport: stdio` (or having a `command` with no
 * `url`) is stripped BEFORE schema validation so the gateway boots on with the
 * entry removed — fail-closed for the entry, fail-open for the gateway.
 */
function quarantineStdioBackends(resolved: unknown): unknown {
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    return resolved;
  }
  const root = resolved as Record<string, unknown>;
  const backends = root.backends;
  if (!backends || typeof backends !== "object" || Array.isArray(backends)) {
    return resolved;
  }
  const backendsRecord = backends as Record<string, unknown>;
  for (const [name, entry] of Object.entries(backendsRecord)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const isStdio =
      e.transport === "stdio" ||
      (e.command !== undefined && e.url === undefined);
    if (isStdio) {
      delete backendsRecord[name];
      // loadConfig has no logger — index.ts creates the logger after loadConfig.
      console.error(
        `[config] quarantined backend "${name}": reason=stdio-unsupported remedy="re-front behind streamable-http"`
      );
    }
  }
  return resolved;
}

export async function loadConfig(filePath: string): Promise<Config> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = parseYaml(raw);

  // First resolve env vars, then resolve vault references
  const envResolved = resolveEnvInObject(parsed);
  const vaultResolved = await resolveVaultInObject(envResolved);

  // Quarantine stdio entries before schema parse — stdio is unrepresentable.
  const quarantined = quarantineStdioBackends(vaultResolved);

  vaultCache.clear(); // free memory after load
  return ConfigFileSchema.parse(quarantined);
}
