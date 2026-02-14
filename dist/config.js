import { z } from "zod";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import Vault from "node-vault";
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
/** Resolve ${VAR} references in a string from process.env */
function resolveEnvVars(value) {
    return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
        const envVal = process.env[varName];
        if (envVal === undefined) {
            throw new Error(`Environment variable ${varName} is not set`);
        }
        return envVal;
    });
}
/** Recursively resolve env vars in an object */
function resolveEnvInObject(obj) {
    if (typeof obj === "string")
        return resolveEnvVars(obj);
    if (Array.isArray(obj))
        return obj.map(resolveEnvInObject);
    if (obj && typeof obj === "object") {
        const result = {};
        for (const [k, v] of Object.entries(obj)) {
            result[k] = resolveEnvInObject(v);
        }
        return result;
    }
    return obj;
}
/** Vault secret cache to avoid redundant fetches */
const vaultCache = new Map();
/**
 * Resolve vault:path#key references.
 * Syntax: vault:secret/mcp/akamai#client_secret
 * Or shorthand: vault:mcp/akamai#client_secret (auto-prefixes secret/)
 */
async function resolveVaultRef(ref) {
    const match = ref.match(/^vault:(.+)#(.+)$/);
    if (!match)
        throw new Error(`Invalid vault reference: ${ref}`);
    let [, path, key] = match;
    // Shorthand: vault:mcp/x#y → secret/data/mcp/x
    if (!path.startsWith("secret/")) {
        path = `secret/data/${path}`;
    }
    else if (!path.includes("/data/")) {
        // vault:secret/mcp/x#y → secret/data/mcp/x
        path = path.replace("secret/", "secret/data/");
    }
    if (!vaultCache.has(path)) {
        const vaultAddr = process.env.VAULT_ADDR || "http://127.0.0.1:8200";
        const vaultToken = process.env.VAULT_TOKEN;
        if (!vaultToken)
            throw new Error("VAULT_TOKEN environment variable is required for vault: references");
        const client = Vault({ endpoint: vaultAddr, token: vaultToken });
        const result = await client.read(path);
        vaultCache.set(path, result.data?.data || result.data || {});
    }
    const data = vaultCache.get(path);
    if (!(key in data)) {
        throw new Error(`Vault secret at ${path} does not contain key "${key}". Available: ${Object.keys(data).join(", ")}`);
    }
    return data[key];
}
/** Recursively resolve vault: refs in an object */
async function resolveVaultInObject(obj) {
    if (typeof obj === "string" && obj.startsWith("vault:")) {
        return resolveVaultRef(obj);
    }
    if (Array.isArray(obj)) {
        return Promise.all(obj.map(resolveVaultInObject));
    }
    if (obj && typeof obj === "object") {
        const result = {};
        for (const [k, v] of Object.entries(obj)) {
            result[k] = await resolveVaultInObject(v);
        }
        return result;
    }
    return obj;
}
export async function loadConfig(filePath) {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = parseYaml(raw);
    // First resolve env vars, then resolve vault references
    const envResolved = resolveEnvInObject(parsed);
    const vaultResolved = await resolveVaultInObject(envResolved);
    vaultCache.clear(); // free memory after load
    return ConfigFileSchema.parse(vaultResolved);
}
//# sourceMappingURL=config.js.map