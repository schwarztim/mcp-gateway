import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Socket } from "node:net";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
function defaultToolHiveDir() {
    return join(homedir(), "Library", "Application Support", "toolhive");
}
function defaultMcpuGeneratedConfig() {
    return join(homedir(), ".config", "mcpu", "config.generated.json");
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value) {
    return typeof value === "string" ? value : undefined;
}
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function fileStem(path) {
    return basename(path).replace(/\.json$/i, "");
}
async function readJsonFiles(dir) {
    const out = new Map();
    let entries;
    try {
        entries = await readdir(dir);
    }
    catch {
        return out;
    }
    for (const entry of entries) {
        if (!entry.endsWith(".json"))
            continue;
        const path = join(dir, entry);
        try {
            out.set(fileStem(entry), {
                path,
                data: JSON.parse(await readFile(path, "utf8")),
            });
        }
        catch {
            out.set(fileStem(entry), { path, data: undefined });
        }
    }
    return out;
}
async function readMcpuExposure(path) {
    const out = new Map();
    try {
        const parsed = JSON.parse(await readFile(path, "utf8"));
        if (!isRecord(parsed))
            return out;
        for (const [name, value] of Object.entries(parsed)) {
            const entry = isRecord(value) ? value : {};
            out.set(name, {
                exposed: true,
                type: asString(entry.type),
                url: asString(entry.url),
            });
        }
    }
    catch {
        return out;
    }
    return out;
}
function parseLabels(raw) {
    const labels = {};
    if (!raw)
        return labels;
    for (const part of raw.split(",")) {
        const idx = part.indexOf("=");
        if (idx <= 0)
            continue;
        labels[part.slice(0, idx)] = part.slice(idx + 1);
    }
    return labels;
}
async function readDockerContainers(enabled) {
    const containers = new Map();
    const errors = [];
    if (!enabled)
        return { containers, errors };
    try {
        const { stdout } = await execFileAsync("docker", ["ps", "--all", "--format", "{{json .}}"], {
            timeout: 5_000,
            maxBuffer: 1024 * 1024 * 4,
        });
        for (const line of stdout.split("\n")) {
            if (!line.trim())
                continue;
            const raw = JSON.parse(line);
            const labels = parseLabels(raw.Labels);
            if (labels.toolhive !== "true" && !labels["toolhive-name"])
                continue;
            const name = labels["toolhive-name"] || raw.Names;
            if (!name || !raw.ID)
                continue;
            containers.set(name, {
                id: raw.ID,
                name,
                image: raw.Image,
                state: raw.State,
                status: raw.Status,
                labels,
                toolhiveName: labels["toolhive-name"],
                toolhivePort: labels["toolhive-port"],
                toolhiveTransport: labels["toolhive-transport"],
            });
        }
    }
    catch (err) {
        errors.push(`docker ps failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { containers, errors };
}
function normalizeRunConfig(path, raw) {
    if (!isRecord(raw))
        return undefined;
    const envVars = isRecord(raw.env_vars) ? raw.env_vars : {};
    const labels = isRecord(raw.container_labels) ? raw.container_labels : {};
    const secrets = Array.isArray(raw.secrets) ? raw.secrets.filter((item) => typeof item === "string") : [];
    return {
        path,
        image: asString(raw.image),
        containerName: asString(raw.container_name),
        baseName: asString(raw.base_name),
        transport: asString(raw.transport),
        proxyMode: asString(raw.proxy_mode),
        group: asString(raw.group),
        host: asString(raw.host),
        port: asNumber(raw.port),
        targetHost: asString(raw.target_host),
        envKeys: Object.keys(envVars).sort(),
        secretRefs: secrets.map((secret) => secret.split(",")[0]).sort(),
        labelPort: asString(labels["toolhive-port"]),
        labelTransport: asString(labels["toolhive-transport"]),
    };
}
function isProcessAlive(pid) {
    if (!pid || pid <= 0 || pid > 4_194_304)
        return undefined;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function normalizeStatus(path, raw) {
    if (!isRecord(raw))
        return undefined;
    const processId = asNumber(raw.process_id);
    return {
        path,
        status: asString(raw.status),
        statusContext: asString(raw.status_context),
        processId,
        proxyProcessAlive: isProcessAlive(processId),
        createdAt: asString(raw.created_at),
        updatedAt: asString(raw.updated_at),
    };
}
function endpointUrl(runConfig) {
    if (!runConfig?.port || runConfig.port <= 0)
        return undefined;
    const host = runConfig.host || "127.0.0.1";
    return `http://${host}:${runConfig.port}/mcp`;
}
async function probeTcp(urlString, timeoutMs) {
    let url;
    try {
        url = new URL(urlString);
    }
    catch (err) {
        return { checked: true, url: urlString, tcpOpen: false, error: err instanceof Error ? err.message : String(err) };
    }
    return new Promise((resolve) => {
        const socket = new Socket();
        let finished = false;
        const done = (probe) => {
            if (finished)
                return;
            finished = true;
            socket.destroy();
            resolve(probe);
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => done({ checked: true, url: urlString, tcpOpen: true }));
        socket.once("timeout", () => done({ checked: true, url: urlString, tcpOpen: false, error: "timeout" }));
        socket.once("error", (err) => done({ checked: true, url: urlString, tcpOpen: false, error: err.message }));
        socket.connect(Number(url.port || (url.protocol === "https:" ? 443 : 80)), url.hostname);
    });
}
function increment(record, key) {
    record[key] = (record[key] || 0) + 1;
}
function classifyEntry(name, runConfig, statusFile, docker, mcpu, endpoint, dockerPsEnabled) {
    const reasons = [];
    const repairHints = [];
    if (!runConfig)
        reasons.push("missing-runconfig");
    if (!statusFile)
        reasons.push("missing-status-file");
    const status = statusFile?.status?.toLowerCase();
    if (status && status !== "running") {
        reasons.push(`toolhive-status:${status}`);
        if (statusFile?.statusContext)
            reasons.push(statusFile.statusContext);
    }
    if (status === "running" && statusFile?.proxyProcessAlive === false) {
        reasons.push("proxy-process-missing");
    }
    if (dockerPsEnabled && !docker) {
        reasons.push("docker-container-missing");
    }
    else if (docker && docker.state !== "running") {
        reasons.push(`docker-state:${docker.state ?? "unknown"}`);
    }
    if (endpoint.checked && endpoint.tcpOpen === false) {
        reasons.push(`endpoint-unreachable:${endpoint.error ?? "tcp-closed"}`);
    }
    if (!mcpu.exposed) {
        reasons.push("not-exposed-in-mcpu-generated-config");
    }
    if (runConfig && docker?.state === "running" && statusFile?.proxyProcessAlive === false) {
        repairHints.push({
            code: "restart-toolhive-proxy",
            safeAutomatic: true,
            description: "Runconfig and container exist, but the recorded ToolHive proxy process is gone. Restarting the proxy is a safe automatic repair candidate.",
        });
    }
    if (runConfig && mcpu.exposed === false && status === "running") {
        repairHints.push({
            code: "refresh-mcpu-generated-config",
            safeAutomatic: true,
            description: "Backend evidence exists but generated MCPU config does not expose it. Regenerating config is a safe automatic repair candidate.",
        });
    }
    if (docker && docker.state && docker.state !== "running") {
        repairHints.push({
            code: "inspect-container-before-restart",
            safeAutomatic: false,
            description: "Container is not running. Restart may be valid, but requires policy and statefulness checks before automation.",
        });
    }
    if (reasons.length === 0)
        return { health: "available", reasons, repairHints };
    if (runConfig || docker || statusFile) {
        const onlyMcpuMissing = reasons.length === 1 && reasons[0] === "not-exposed-in-mcpu-generated-config";
        return { health: onlyMcpuMissing ? "available" : "degraded", reasons, repairHints };
    }
    return { health: "unknown", reasons, repairHints };
}
export async function buildToolHiveFleetInventory(config = {}) {
    const appSupportDir = config.app_support_dir || defaultToolHiveDir();
    const runconfigsDir = join(appSupportDir, "runconfigs");
    const statusesDir = join(appSupportDir, "statuses");
    const mcpuGeneratedConfig = config.mcpu_generated_config || defaultMcpuGeneratedConfig();
    const probeEnabled = config.endpoint_probe ?? false;
    const dockerPsEnabled = config.docker_ps ?? true;
    const probeTimeoutMs = config.probe_timeout_ms ?? 750;
    const [runconfigs, statuses, mcpuExposures, dockerResult] = await Promise.all([
        readJsonFiles(runconfigsDir),
        readJsonFiles(statusesDir),
        readMcpuExposure(mcpuGeneratedConfig),
        readDockerContainers(dockerPsEnabled),
    ]);
    const names = new Set([
        ...runconfigs.keys(),
        ...statuses.keys(),
        ...dockerResult.containers.keys(),
    ]);
    const entries = await Promise.all(Array.from(names).sort().map(async (name) => {
        const runConfigRaw = runconfigs.get(name);
        const statusRaw = statuses.get(name);
        const runConfig = runConfigRaw ? normalizeRunConfig(runConfigRaw.path, runConfigRaw.data) : undefined;
        const statusFile = statusRaw ? normalizeStatus(statusRaw.path, statusRaw.data) : undefined;
        const docker = dockerResult.containers.get(name);
        const mcpu = mcpuExposures.get(name) ?? { exposed: false };
        const url = endpointUrl(runConfig);
        const endpoint = probeEnabled && url
            ? await probeTcp(url, probeTimeoutMs)
            : { checked: false, url };
        const classification = classifyEntry(name, runConfig, statusFile, docker, mcpu, endpoint, dockerPsEnabled);
        return { name, ...classification, runConfig, statusFile, docker, mcpu, endpoint };
    }));
    const byHealth = { available: 0, degraded: 0, unavailable: 0, unknown: 0 };
    const toolhiveStatuses = {};
    const dockerStates = {};
    let exposedInMcpu = 0;
    let withRunConfig = 0;
    let withStatusFile = 0;
    let withDockerContainer = 0;
    let safeAutomaticRepairHints = 0;
    for (const entry of entries) {
        increment(byHealth, entry.health);
        if (entry.statusFile?.status)
            toolhiveStatuses[entry.statusFile.status] = (toolhiveStatuses[entry.statusFile.status] || 0) + 1;
        if (entry.docker?.state)
            dockerStates[entry.docker.state] = (dockerStates[entry.docker.state] || 0) + 1;
        if (entry.mcpu.exposed)
            exposedInMcpu++;
        if (entry.runConfig)
            withRunConfig++;
        if (entry.statusFile)
            withStatusFile++;
        if (entry.docker)
            withDockerContainer++;
        safeAutomaticRepairHints += entry.repairHints.filter((hint) => hint.safeAutomatic).length;
    }
    return {
        generatedAt: new Date().toISOString(),
        source: "toolhive",
        paths: { appSupportDir, runconfigsDir, statusesDir, mcpuGeneratedConfig },
        probeEnabled,
        dockerPsEnabled,
        summary: {
            total: entries.length,
            byHealth,
            toolhiveStatuses,
            dockerStates,
            exposedInMcpu,
            withRunConfig,
            withStatusFile,
            withDockerContainer,
            safeAutomaticRepairHints,
        },
        entries,
        errors: dockerResult.errors,
    };
}
//# sourceMappingURL=fleet-inventory.js.map