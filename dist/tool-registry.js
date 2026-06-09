export class ToolRegistry {
    tools = new Map();
    logger;
    globalPrefix;
    classify;
    constructor(logger, globalPrefix = "", classify) {
        this.logger = logger;
        this.globalPrefix = globalPrefix;
        this.classify = classify;
    }
    /** Register all tools from a backend, namespacing them */
    registerBackend(backendName, namespace, tools) {
        // Remove any existing tools for this backend first
        this.unregisterBackend(backendName);
        const prefix = this.globalPrefix ? `${this.globalPrefix}${namespace}` : namespace;
        for (const tool of tools) {
            const namespacedName = `${prefix}_${tool.name}`;
            const entry = {
                namespacedName,
                originalName: tool.name,
                backendName,
                tool: { ...tool, name: namespacedName },
            };
            if (this.classify) {
                entry.safety = this.classify(backendName, tool.name, namespacedName);
            }
            this.tools.set(namespacedName, entry);
        }
        this.logger.info(`Registered ${tools.length} tools from backend "${backendName}" (namespace: ${prefix})`);
    }
    /** Remove all tools for a backend */
    unregisterBackend(backendName) {
        const toRemove = [];
        for (const [name, entry] of this.tools) {
            if (entry.backendName === backendName)
                toRemove.push(name);
        }
        for (const name of toRemove)
            this.tools.delete(name);
        if (toRemove.length > 0) {
            this.logger.debug(`Unregistered ${toRemove.length} tools from backend "${backendName}"`);
        }
    }
    /** Get all registered tools (for tools/list) */
    getAllTools() {
        return Array.from(this.tools.values()).map((e) => e.tool);
    }
    /** Get all registered tool entries, including backend routing metadata */
    getAllEntries() {
        return Array.from(this.tools.values());
    }
    /** Look up a tool by its namespaced name */
    resolve(namespacedName) {
        return this.tools.get(namespacedName);
    }
    /** Get count of tools per backend */
    getStats() {
        const stats = {};
        for (const entry of this.tools.values()) {
            stats[entry.backendName] = (stats[entry.backendName] || 0) + 1;
        }
        return stats;
    }
}
//# sourceMappingURL=tool-registry.js.map