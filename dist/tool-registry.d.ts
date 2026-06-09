import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "./logger.js";
import type { SafetyClassification } from "./manifest.js";
export interface ToolEntry {
    /** The namespaced tool name exposed to clients */
    namespacedName: string;
    /** The original tool name on the backend */
    originalName: string;
    /** The backend this tool belongs to */
    backendName: string;
    /** Full tool definition with namespaced name */
    tool: Tool;
    /** Safety classification (set when a classifier is provided to the registry) */
    safety?: SafetyClassification;
}
export declare class ToolRegistry {
    private tools;
    private logger;
    private globalPrefix;
    private classify?;
    constructor(logger: Logger, globalPrefix?: string, classify?: (backendName: string, originalName: string, namespacedName: string) => SafetyClassification);
    /** Register all tools from a backend, namespacing them */
    registerBackend(backendName: string, namespace: string, tools: Tool[]): void;
    /** Remove all tools for a backend */
    unregisterBackend(backendName: string): void;
    /** Get all registered tools (for tools/list) */
    getAllTools(): Tool[];
    /** Get all registered tool entries, including backend routing metadata */
    getAllEntries(): ToolEntry[];
    /** Look up a tool by its namespaced name */
    resolve(namespacedName: string): ToolEntry | undefined;
    /** Get count of tools per backend */
    getStats(): Record<string, number>;
}
//# sourceMappingURL=tool-registry.d.ts.map