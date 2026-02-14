import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "./logger.js";
export interface ToolEntry {
    /** The namespaced tool name exposed to clients */
    namespacedName: string;
    /** The original tool name on the backend */
    originalName: string;
    /** The backend this tool belongs to */
    backendName: string;
    /** Full tool definition with namespaced name */
    tool: Tool;
}
export declare class ToolRegistry {
    private tools;
    private logger;
    constructor(logger: Logger);
    /** Register all tools from a backend, namespacing them */
    registerBackend(backendName: string, namespace: string, tools: Tool[]): void;
    /** Remove all tools for a backend */
    unregisterBackend(backendName: string): void;
    /** Get all registered tools (for tools/list) */
    getAllTools(): Tool[];
    /** Look up a tool by its namespaced name */
    resolve(namespacedName: string): ToolEntry | undefined;
    /** Get count of tools per backend */
    getStats(): Record<string, number>;
}
//# sourceMappingURL=tool-registry.d.ts.map