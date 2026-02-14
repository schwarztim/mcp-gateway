import { z } from "zod";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const StdioBackendSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).default({}),
  namespace: z.string(),
  enabled: z.boolean().default(true),
  restart_policy: z
    .enum(["always", "on-failure", "never"])
    .default("on-failure"),
  max_restarts: z.number().default(5),
  health_check_interval: z.number().default(30),
});

const SseBackendSchema = z.object({
  transport: z.literal("sse"),
  url: z.string().url(),
  namespace: z.string(),
  enabled: z.boolean().default(true),
  reconnect_interval: z.number().default(5),
  headers: z.record(z.string()).default({}),
  health_check_interval: z.number().default(30),
});

const BackendSchema = z.discriminatedUnion("transport", [
  StdioBackendSchema,
  SseBackendSchema,
]);

const GatewayConfigSchema = z.object({
  port: z.number().default(3100),
  host: z.string().default("0.0.0.0"),
  name: z.string().default("mcp-gateway"),
  log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const ConfigFileSchema = z.object({
  gateway: GatewayConfigSchema.default({}),
  backends: z.record(BackendSchema).default({}),
});

export type StdioBackendConfig = z.infer<typeof StdioBackendSchema>;
export type SseBackendConfig = z.infer<typeof SseBackendSchema>;
export type BackendConfig = z.infer<typeof BackendSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
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

export function loadConfig(filePath: string): Config {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(raw);
  const resolved = resolveEnvInObject(parsed);
  return ConfigFileSchema.parse(resolved);
}
