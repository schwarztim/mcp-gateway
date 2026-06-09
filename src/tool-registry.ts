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

export class ToolRegistry {
  private tools = new Map<string, ToolEntry>();
  private logger: Logger;
  private globalPrefix: string;
  private classify?: (
    backendName: string,
    originalName: string,
    namespacedName: string
  ) => SafetyClassification;

  constructor(
    logger: Logger,
    globalPrefix = "",
    classify?: (
      backendName: string,
      originalName: string,
      namespacedName: string
    ) => SafetyClassification
  ) {
    this.logger = logger;
    this.globalPrefix = globalPrefix;
    this.classify = classify;
  }

  /** Register all tools from a backend, namespacing them */
  registerBackend(backendName: string, namespace: string, tools: Tool[]): void {
    // Remove any existing tools for this backend first
    this.unregisterBackend(backendName);

    const prefix = this.globalPrefix ? `${this.globalPrefix}${namespace}` : namespace;
    for (const tool of tools) {
      const namespacedName = `${prefix}_${tool.name}`;
      const entry: ToolEntry = {
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
    this.logger.info(
      `Registered ${tools.length} tools from backend "${backendName}" (namespace: ${prefix})`
    );
  }

  /** Remove all tools for a backend */
  unregisterBackend(backendName: string): void {
    const toRemove: string[] = [];
    for (const [name, entry] of this.tools) {
      if (entry.backendName === backendName) toRemove.push(name);
    }
    for (const name of toRemove) this.tools.delete(name);
    if (toRemove.length > 0) {
      this.logger.debug(
        `Unregistered ${toRemove.length} tools from backend "${backendName}"`
      );
    }
  }

  /** Get all registered tools (for tools/list) */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values()).map((e) => e.tool);
  }

  /** Get all registered tool entries, including backend routing metadata */
  getAllEntries(): ToolEntry[] {
    return Array.from(this.tools.values());
  }

  /** Look up a tool by its namespaced name */
  resolve(namespacedName: string): ToolEntry | undefined {
    return this.tools.get(namespacedName);
  }

  /** Get count of tools per backend */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const entry of this.tools.values()) {
      stats[entry.backendName] = (stats[entry.backendName] || 0) + 1;
    }
    return stats;
  }
}
