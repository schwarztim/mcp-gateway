function endpointType(entry) {
    return entry.runConfig?.proxyMode === "sse" ? "sse" : "streamable-http";
}
function endpointPath(type) {
    return type === "sse" ? "/sse" : "/mcp";
}
function endpointUrl(entry, type) {
    const port = entry.runConfig?.port;
    if (!port || port <= 0)
        return undefined;
    const host = entry.runConfig?.host || "127.0.0.1";
    return `http://${host}:${port}${endpointPath(type)}`;
}
function descriptionFor(entry) {
    const run = entry.runConfig;
    const image = run?.image ? `image=${run.image}` : "image=unknown";
    const status = entry.statusFile?.status ? `toolhive=${entry.statusFile.status}` : "toolhive=unknown";
    const docker = entry.docker?.state ? `docker=${entry.docker.state}` : "docker=unknown";
    const reasons = entry.reasons.length > 0 ? ` reasons=${entry.reasons.join("; ")}` : "";
    return `ToolHive backend preserved by mcp-gateway fleet catalog (${image}, ${status}, ${docker}, health=${entry.health}).${reasons}`;
}
export function buildFleetMcpuConfig(inventory) {
    const config = {};
    const entries = [];
    let degradedIncluded = 0;
    let safeAutomaticRepairHints = 0;
    for (const entry of inventory.entries) {
        const type = endpointType(entry);
        const url = endpointUrl(entry, type);
        const included = Boolean(entry.runConfig && url);
        safeAutomaticRepairHints += entry.repairHints.filter((hint) => hint.safeAutomatic).length;
        if (included && url) {
            if (entry.health === "degraded")
                degradedIncluded++;
            config[entry.name] = {
                type,
                url,
                description: descriptionFor(entry),
            };
        }
        entries.push({
            name: entry.name,
            included,
            health: entry.health,
            url,
            type: included ? type : undefined,
            reasons: entry.reasons,
            repairHints: entry.repairHints,
        });
    }
    const included = Object.keys(config).length;
    return {
        generatedAt: new Date().toISOString(),
        mode: "read-only",
        config,
        summary: {
            totalCatalogEntries: inventory.entries.length,
            included,
            omitted: inventory.entries.length - included,
            degradedIncluded,
            safeAutomaticRepairHints,
        },
        entries,
    };
}
//# sourceMappingURL=fleet-mcpu-config.js.map