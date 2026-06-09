import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
/**
 * cols/v1 columnar envelope format.
 *
 * A homogeneous object-array is encoded as:
 *   { "__gw_compact__": "cols/v1", "keys": [k0,k1,...], "rows": [[v0,v1,...], ...] }
 *
 * This eliminates repeated key strings — the dominant redundancy in large
 * arrays of chat messages, Jira issues, calendar events, etc. where N objects
 * share the same M keys. For N=200 objects with M=10 keys, key strings appear
 * once instead of 200 times.
 *
 * Round-trip guarantee: decodeColumnar(encodeColumnar(arr)) deep-equals arr.
 */
export interface ColumnarEnvelope {
    __gw_compact__: "cols/v1";
    keys: string[];
    rows: unknown[][];
}
/**
 * Return true if every element of arr is a non-null plain object and all
 * objects share exactly the same set of own-enumerable keys.
 */
export declare function isHomogeneousObjectArray(arr: unknown[]): arr is Record<string, unknown>[];
/**
 * Encode a homogeneous object-array into a cols/v1 envelope.
 * Caller MUST verify isHomogeneousObjectArray before calling.
 */
export declare function encodeColumnar(arr: Record<string, unknown>[]): ColumnarEnvelope;
/**
 * Decode a cols/v1 envelope back to a plain object-array.
 * Used in tests to verify lossless round-trip.
 */
export declare function decodeColumnar(env: ColumnarEnvelope): Record<string, unknown>[];
/**
 * Recursively prune null / undefined / empty-string / empty-array /
 * empty-object fields from a value.  These are low-information tokens that
 * inflate serialised size without adding meaning.
 *
 * Arrays of primitives are pruned only of null/undefined elements.
 * Objects lose keys whose pruned value is null/undefined/""/{}/[].
 */
export declare function pruneEmpty(value: unknown): unknown;
/**
 * Recursively apply columnar encoding to any homogeneous object-array found
 * in the value tree.  Leaves non-homogeneous arrays and scalars unchanged.
 */
export declare function applyColumnarEncoding(value: unknown): unknown;
/**
 * Apply the full compression pipeline to a JSON-parseable text string:
 *   1. Prune null/empty fields
 *   2. Columnar-encode homogeneous object-arrays
 *   3. Minify (JSON.stringify without indentation)
 *
 * Returns the compressed string, or the original if the pipeline produces no
 * meaningful reduction (savedPct ≤ 0).
 *
 * Throws if `text` is not valid JSON — callers must guard.
 */
export declare function applyJsonCompression(text: string): {
    compressed: string;
    savedPct: number;
};
export declare class Gateway {
    private config;
    private configPath;
    private logger;
    private app;
    private manifests;
    private toolRegistry;
    private backends;
    private sseTransports;
    private streamableTransports;
    private sessions;
    private streamableSessionLastSeen;
    private artifacts;
    private reconnectInflight;
    private healthTimer?;
    private httpServer?;
    private configWatcher?;
    private configReloadInFlight?;
    private fleetIngestInFlight?;
    constructor(config: Config, configPath: string, logger: Logger);
    private createSessionServer;
    private setupMcpHandlers;
    private setupHttpRoutes;
    private headerValue;
    private handleStatelessStreamableRequest;
    private isFacadeMode;
    private getExposedTools;
    private jsonToolResult;
    private handleMuxTool;
    private buildFleetInventory;
    private getListLimit;
    private getCharLimit;
    private truncateText;
    /**
     * Phase 4: Content-aware compression of tool-output text.
     *
     * Gate: disabled by default (compression.enabled defaults to false).
     * When disabled the method is a pure pass-through — zero behavior change.
     *
     * When active, applies applyJsonCompression() (prune→columnar→minify),
     * stores the FULL UNCOMPRESSED ORIGINAL in the artifact store for lossless
     * retrieval via gateway_fetch_artifact, and returns the compressed text with
     * a self-describing marker object.
     *
     * In mode:"advisory" the original text is returned unchanged — only the
     * savings are logged.  The artifact is still stored so the model can opt in
     * to retrieval.
     *
     * @param text  The raw text content from a backend tool response.
     * @param kind  Artifact kind label (e.g. "backend-tool-compressed").
     * @returns     { text, marker? } — marker is present when compression engaged.
     */
    private compressToolText;
    private compactJsonText;
    private storeArtifact;
    private fetchArtifact;
    private compactFleetEntry;
    /** Tokenize a string for token-set ranking: lowercase, split on non-alphanumeric, dedupe. */
    private tokenize;
    private searchRegisteredTools;
    private describeRegisteredTool;
    private getBackendStatus;
    private callBackendTool;
    private isStaleSessionError;
    private ensureReconnected;
    private reconnectBackend;
    private compactBackendToolResult;
    private touchStreamableSession;
    private dropStreamableSession;
    private reapIdleStreamableSessions;
    private notifyToolsChanged;
    private connectBackend;
    private withTimeout;
    private isFleetIngestedConfig;
    private getBackendUrl;
    private normalizeSearchText;
    private matchesSearch;
    private backendConfigChanged;
    private requireAdminAccess;
    private isLoopbackAddress;
    reloadConfig(): Promise<void>;
    private reloadConfigUnlocked;
    /**
     * Ingest fleet backends from MCPU generated config.
     * Skips any backend already registered (static config takes precedence).
     * Returns the raw ingest result for admin/logging use.
     */
    private ingestFleetBackends;
    private ingestFleetBackendsUnlocked;
    start(): Promise<void>;
    stop(): Promise<void>;
    private startHealthMonitor;
}
//# sourceMappingURL=gateway.d.ts.map