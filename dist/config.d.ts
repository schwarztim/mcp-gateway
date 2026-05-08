import { z } from "zod";
declare const StdioBackendSchema: z.ZodObject<{
    transport: z.ZodLiteral<"stdio">;
    command: z.ZodString;
    args: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    cwd: z.ZodOptional<z.ZodString>;
    env: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    namespace: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
    restart_policy: z.ZodDefault<z.ZodEnum<["always", "on-failure", "never"]>>;
    max_restarts: z.ZodDefault<z.ZodNumber>;
    health_check_interval: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    transport: "stdio";
    command: string;
    args: string[];
    env: Record<string, string>;
    namespace: string;
    enabled: boolean;
    restart_policy: "never" | "always" | "on-failure";
    max_restarts: number;
    health_check_interval: number;
    cwd?: string | undefined;
}, {
    transport: "stdio";
    command: string;
    namespace: string;
    args?: string[] | undefined;
    cwd?: string | undefined;
    env?: Record<string, string> | undefined;
    enabled?: boolean | undefined;
    restart_policy?: "never" | "always" | "on-failure" | undefined;
    max_restarts?: number | undefined;
    health_check_interval?: number | undefined;
}>;
declare const SseBackendSchema: z.ZodObject<{
    transport: z.ZodLiteral<"sse">;
    url: z.ZodString;
    namespace: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
    reconnect_interval: z.ZodDefault<z.ZodNumber>;
    max_restarts: z.ZodDefault<z.ZodNumber>;
    restart_policy: z.ZodDefault<z.ZodEnum<["always", "on-failure", "never"]>>;
    headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    health_check_interval: z.ZodDefault<z.ZodNumber>;
    source: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    transport: "sse";
    namespace: string;
    enabled: boolean;
    restart_policy: "never" | "always" | "on-failure";
    max_restarts: number;
    health_check_interval: number;
    url: string;
    reconnect_interval: number;
    headers: Record<string, string>;
    source?: string | undefined;
    description?: string | undefined;
}, {
    transport: "sse";
    namespace: string;
    url: string;
    enabled?: boolean | undefined;
    restart_policy?: "never" | "always" | "on-failure" | undefined;
    max_restarts?: number | undefined;
    health_check_interval?: number | undefined;
    reconnect_interval?: number | undefined;
    headers?: Record<string, string> | undefined;
    source?: string | undefined;
    description?: string | undefined;
}>;
/** Streamable HTTP transport used by ToolHive-managed MCP servers */
declare const HttpBackendSchema: z.ZodObject<{
    transport: z.ZodLiteral<"http">;
    url: z.ZodString;
    namespace: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
    reconnect_interval: z.ZodDefault<z.ZodNumber>;
    max_restarts: z.ZodDefault<z.ZodNumber>;
    restart_policy: z.ZodDefault<z.ZodEnum<["always", "on-failure", "never"]>>;
    headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    health_check_interval: z.ZodDefault<z.ZodNumber>;
    /** Informational: source of this backend entry (e.g. "fleet-mcpu") */
    source: z.ZodOptional<z.ZodString>;
    /** Informational: original description from the fleet catalog */
    description: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    transport: "http";
    namespace: string;
    enabled: boolean;
    restart_policy: "never" | "always" | "on-failure";
    max_restarts: number;
    health_check_interval: number;
    url: string;
    reconnect_interval: number;
    headers: Record<string, string>;
    source?: string | undefined;
    description?: string | undefined;
}, {
    transport: "http";
    namespace: string;
    url: string;
    enabled?: boolean | undefined;
    restart_policy?: "never" | "always" | "on-failure" | undefined;
    max_restarts?: number | undefined;
    health_check_interval?: number | undefined;
    reconnect_interval?: number | undefined;
    headers?: Record<string, string> | undefined;
    source?: string | undefined;
    description?: string | undefined;
}>;
declare const BackendSchema: z.ZodDiscriminatedUnion<"transport", [z.ZodObject<{
    transport: z.ZodLiteral<"stdio">;
    command: z.ZodString;
    args: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    cwd: z.ZodOptional<z.ZodString>;
    env: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    namespace: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
    restart_policy: z.ZodDefault<z.ZodEnum<["always", "on-failure", "never"]>>;
    max_restarts: z.ZodDefault<z.ZodNumber>;
    health_check_interval: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    transport: "stdio";
    command: string;
    args: string[];
    env: Record<string, string>;
    namespace: string;
    enabled: boolean;
    restart_policy: "never" | "always" | "on-failure";
    max_restarts: number;
    health_check_interval: number;
    cwd?: string | undefined;
}, {
    transport: "stdio";
    command: string;
    namespace: string;
    args?: string[] | undefined;
    cwd?: string | undefined;
    env?: Record<string, string> | undefined;
    enabled?: boolean | undefined;
    restart_policy?: "never" | "always" | "on-failure" | undefined;
    max_restarts?: number | undefined;
    health_check_interval?: number | undefined;
}>, z.ZodObject<{
    transport: z.ZodLiteral<"sse">;
    url: z.ZodString;
    namespace: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
    reconnect_interval: z.ZodDefault<z.ZodNumber>;
    max_restarts: z.ZodDefault<z.ZodNumber>;
    restart_policy: z.ZodDefault<z.ZodEnum<["always", "on-failure", "never"]>>;
    headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    health_check_interval: z.ZodDefault<z.ZodNumber>;
    source: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    transport: "sse";
    namespace: string;
    enabled: boolean;
    restart_policy: "never" | "always" | "on-failure";
    max_restarts: number;
    health_check_interval: number;
    url: string;
    reconnect_interval: number;
    headers: Record<string, string>;
    source?: string | undefined;
    description?: string | undefined;
}, {
    transport: "sse";
    namespace: string;
    url: string;
    enabled?: boolean | undefined;
    restart_policy?: "never" | "always" | "on-failure" | undefined;
    max_restarts?: number | undefined;
    health_check_interval?: number | undefined;
    reconnect_interval?: number | undefined;
    headers?: Record<string, string> | undefined;
    source?: string | undefined;
    description?: string | undefined;
}>, z.ZodObject<{
    transport: z.ZodLiteral<"http">;
    url: z.ZodString;
    namespace: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
    reconnect_interval: z.ZodDefault<z.ZodNumber>;
    max_restarts: z.ZodDefault<z.ZodNumber>;
    restart_policy: z.ZodDefault<z.ZodEnum<["always", "on-failure", "never"]>>;
    headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    health_check_interval: z.ZodDefault<z.ZodNumber>;
    /** Informational: source of this backend entry (e.g. "fleet-mcpu") */
    source: z.ZodOptional<z.ZodString>;
    /** Informational: original description from the fleet catalog */
    description: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    transport: "http";
    namespace: string;
    enabled: boolean;
    restart_policy: "never" | "always" | "on-failure";
    max_restarts: number;
    health_check_interval: number;
    url: string;
    reconnect_interval: number;
    headers: Record<string, string>;
    source?: string | undefined;
    description?: string | undefined;
}, {
    transport: "http";
    namespace: string;
    url: string;
    enabled?: boolean | undefined;
    restart_policy?: "never" | "always" | "on-failure" | undefined;
    max_restarts?: number | undefined;
    health_check_interval?: number | undefined;
    reconnect_interval?: number | undefined;
    headers?: Record<string, string> | undefined;
    source?: string | undefined;
    description?: string | undefined;
}>]>;
declare const GatewayConfigSchema: z.ZodObject<{
    port: z.ZodDefault<z.ZodNumber>;
    host: z.ZodDefault<z.ZodString>;
    name: z.ZodDefault<z.ZodString>;
    log_level: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
    tool_prefix: z.ZodDefault<z.ZodString>;
    tool_exposure: z.ZodDefault<z.ZodEnum<["namespaced", "mux", "both"]>>;
}, "strip", z.ZodTypeAny, {
    port: number;
    host: string;
    name: string;
    log_level: "debug" | "info" | "warn" | "error";
    tool_prefix: string;
    tool_exposure: "namespaced" | "mux" | "both";
}, {
    port?: number | undefined;
    host?: string | undefined;
    name?: string | undefined;
    log_level?: "debug" | "info" | "warn" | "error" | undefined;
    tool_prefix?: string | undefined;
    tool_exposure?: "namespaced" | "mux" | "both" | undefined;
}>;
declare const ToolHiveFleetConfigSchema: z.ZodObject<{
    app_support_dir: z.ZodOptional<z.ZodString>;
    mcpu_generated_config: z.ZodOptional<z.ZodString>;
    docker_ps: z.ZodDefault<z.ZodBoolean>;
    endpoint_probe: z.ZodDefault<z.ZodBoolean>;
    probe_timeout_ms: z.ZodDefault<z.ZodNumber>;
    /** Auto-ingest fleet entries as gateway backends at startup */
    auto_ingest: z.ZodDefault<z.ZodBoolean>;
    /** Prefix for auto-ingested backend namespaces (default: "") */
    ingest_namespace_prefix: z.ZodDefault<z.ZodString>;
    /** Only ingest entries matching these names (empty = all) */
    ingest_only: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** Skip ingesting entries matching these names */
    ingest_skip: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    docker_ps: boolean;
    endpoint_probe: boolean;
    probe_timeout_ms: number;
    auto_ingest: boolean;
    ingest_namespace_prefix: string;
    ingest_only: string[];
    ingest_skip: string[];
    app_support_dir?: string | undefined;
    mcpu_generated_config?: string | undefined;
}, {
    app_support_dir?: string | undefined;
    mcpu_generated_config?: string | undefined;
    docker_ps?: boolean | undefined;
    endpoint_probe?: boolean | undefined;
    probe_timeout_ms?: number | undefined;
    auto_ingest?: boolean | undefined;
    ingest_namespace_prefix?: string | undefined;
    ingest_only?: string[] | undefined;
    ingest_skip?: string[] | undefined;
}>;
declare const FleetConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    toolhive: z.ZodDefault<z.ZodObject<{
        app_support_dir: z.ZodOptional<z.ZodString>;
        mcpu_generated_config: z.ZodOptional<z.ZodString>;
        docker_ps: z.ZodDefault<z.ZodBoolean>;
        endpoint_probe: z.ZodDefault<z.ZodBoolean>;
        probe_timeout_ms: z.ZodDefault<z.ZodNumber>;
        /** Auto-ingest fleet entries as gateway backends at startup */
        auto_ingest: z.ZodDefault<z.ZodBoolean>;
        /** Prefix for auto-ingested backend namespaces (default: "") */
        ingest_namespace_prefix: z.ZodDefault<z.ZodString>;
        /** Only ingest entries matching these names (empty = all) */
        ingest_only: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** Skip ingesting entries matching these names */
        ingest_skip: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        docker_ps: boolean;
        endpoint_probe: boolean;
        probe_timeout_ms: number;
        auto_ingest: boolean;
        ingest_namespace_prefix: string;
        ingest_only: string[];
        ingest_skip: string[];
        app_support_dir?: string | undefined;
        mcpu_generated_config?: string | undefined;
    }, {
        app_support_dir?: string | undefined;
        mcpu_generated_config?: string | undefined;
        docker_ps?: boolean | undefined;
        endpoint_probe?: boolean | undefined;
        probe_timeout_ms?: number | undefined;
        auto_ingest?: boolean | undefined;
        ingest_namespace_prefix?: string | undefined;
        ingest_only?: string[] | undefined;
        ingest_skip?: string[] | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    toolhive: {
        docker_ps: boolean;
        endpoint_probe: boolean;
        probe_timeout_ms: number;
        auto_ingest: boolean;
        ingest_namespace_prefix: string;
        ingest_only: string[];
        ingest_skip: string[];
        app_support_dir?: string | undefined;
        mcpu_generated_config?: string | undefined;
    };
}, {
    enabled?: boolean | undefined;
    toolhive?: {
        app_support_dir?: string | undefined;
        mcpu_generated_config?: string | undefined;
        docker_ps?: boolean | undefined;
        endpoint_probe?: boolean | undefined;
        probe_timeout_ms?: number | undefined;
        auto_ingest?: boolean | undefined;
        ingest_namespace_prefix?: string | undefined;
        ingest_only?: string[] | undefined;
        ingest_skip?: string[] | undefined;
    } | undefined;
}>;
declare const ConfigFileSchema: z.ZodObject<{
    gateway: z.ZodDefault<z.ZodObject<{
        port: z.ZodDefault<z.ZodNumber>;
        host: z.ZodDefault<z.ZodString>;
        name: z.ZodDefault<z.ZodString>;
        log_level: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
        tool_prefix: z.ZodDefault<z.ZodString>;
        tool_exposure: z.ZodDefault<z.ZodEnum<["namespaced", "mux", "both"]>>;
    }, "strip", z.ZodTypeAny, {
        port: number;
        host: string;
        name: string;
        log_level: "debug" | "info" | "warn" | "error";
        tool_prefix: string;
        tool_exposure: "namespaced" | "mux" | "both";
    }, {
        port?: number | undefined;
        host?: string | undefined;
        name?: string | undefined;
        log_level?: "debug" | "info" | "warn" | "error" | undefined;
        tool_prefix?: string | undefined;
        tool_exposure?: "namespaced" | "mux" | "both" | undefined;
    }>>;
    fleet: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        toolhive: z.ZodDefault<z.ZodObject<{
            app_support_dir: z.ZodOptional<z.ZodString>;
            mcpu_generated_config: z.ZodOptional<z.ZodString>;
            docker_ps: z.ZodDefault<z.ZodBoolean>;
            endpoint_probe: z.ZodDefault<z.ZodBoolean>;
            probe_timeout_ms: z.ZodDefault<z.ZodNumber>;
            /** Auto-ingest fleet entries as gateway backends at startup */
            auto_ingest: z.ZodDefault<z.ZodBoolean>;
            /** Prefix for auto-ingested backend namespaces (default: "") */
            ingest_namespace_prefix: z.ZodDefault<z.ZodString>;
            /** Only ingest entries matching these names (empty = all) */
            ingest_only: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            /** Skip ingesting entries matching these names */
            ingest_skip: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            docker_ps: boolean;
            endpoint_probe: boolean;
            probe_timeout_ms: number;
            auto_ingest: boolean;
            ingest_namespace_prefix: string;
            ingest_only: string[];
            ingest_skip: string[];
            app_support_dir?: string | undefined;
            mcpu_generated_config?: string | undefined;
        }, {
            app_support_dir?: string | undefined;
            mcpu_generated_config?: string | undefined;
            docker_ps?: boolean | undefined;
            endpoint_probe?: boolean | undefined;
            probe_timeout_ms?: number | undefined;
            auto_ingest?: boolean | undefined;
            ingest_namespace_prefix?: string | undefined;
            ingest_only?: string[] | undefined;
            ingest_skip?: string[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        toolhive: {
            docker_ps: boolean;
            endpoint_probe: boolean;
            probe_timeout_ms: number;
            auto_ingest: boolean;
            ingest_namespace_prefix: string;
            ingest_only: string[];
            ingest_skip: string[];
            app_support_dir?: string | undefined;
            mcpu_generated_config?: string | undefined;
        };
    }, {
        enabled?: boolean | undefined;
        toolhive?: {
            app_support_dir?: string | undefined;
            mcpu_generated_config?: string | undefined;
            docker_ps?: boolean | undefined;
            endpoint_probe?: boolean | undefined;
            probe_timeout_ms?: number | undefined;
            auto_ingest?: boolean | undefined;
            ingest_namespace_prefix?: string | undefined;
            ingest_only?: string[] | undefined;
            ingest_skip?: string[] | undefined;
        } | undefined;
    }>>;
    backends: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<"transport", [z.ZodObject<{
        transport: z.ZodLiteral<"stdio">;
        command: z.ZodString;
        args: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        cwd: z.ZodOptional<z.ZodString>;
        env: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        namespace: z.ZodString;
        enabled: z.ZodDefault<z.ZodBoolean>;
        restart_policy: z.ZodDefault<z.ZodEnum<["always", "on-failure", "never"]>>;
        max_restarts: z.ZodDefault<z.ZodNumber>;
        health_check_interval: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        transport: "stdio";
        command: string;
        args: string[];
        env: Record<string, string>;
        namespace: string;
        enabled: boolean;
        restart_policy: "never" | "always" | "on-failure";
        max_restarts: number;
        health_check_interval: number;
        cwd?: string | undefined;
    }, {
        transport: "stdio";
        command: string;
        namespace: string;
        args?: string[] | undefined;
        cwd?: string | undefined;
        env?: Record<string, string> | undefined;
        enabled?: boolean | undefined;
        restart_policy?: "never" | "always" | "on-failure" | undefined;
        max_restarts?: number | undefined;
        health_check_interval?: number | undefined;
    }>, z.ZodObject<{
        transport: z.ZodLiteral<"sse">;
        url: z.ZodString;
        namespace: z.ZodString;
        enabled: z.ZodDefault<z.ZodBoolean>;
        reconnect_interval: z.ZodDefault<z.ZodNumber>;
        max_restarts: z.ZodDefault<z.ZodNumber>;
        restart_policy: z.ZodDefault<z.ZodEnum<["always", "on-failure", "never"]>>;
        headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        health_check_interval: z.ZodDefault<z.ZodNumber>;
        source: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        transport: "sse";
        namespace: string;
        enabled: boolean;
        restart_policy: "never" | "always" | "on-failure";
        max_restarts: number;
        health_check_interval: number;
        url: string;
        reconnect_interval: number;
        headers: Record<string, string>;
        source?: string | undefined;
        description?: string | undefined;
    }, {
        transport: "sse";
        namespace: string;
        url: string;
        enabled?: boolean | undefined;
        restart_policy?: "never" | "always" | "on-failure" | undefined;
        max_restarts?: number | undefined;
        health_check_interval?: number | undefined;
        reconnect_interval?: number | undefined;
        headers?: Record<string, string> | undefined;
        source?: string | undefined;
        description?: string | undefined;
    }>, z.ZodObject<{
        transport: z.ZodLiteral<"http">;
        url: z.ZodString;
        namespace: z.ZodString;
        enabled: z.ZodDefault<z.ZodBoolean>;
        reconnect_interval: z.ZodDefault<z.ZodNumber>;
        max_restarts: z.ZodDefault<z.ZodNumber>;
        restart_policy: z.ZodDefault<z.ZodEnum<["always", "on-failure", "never"]>>;
        headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        health_check_interval: z.ZodDefault<z.ZodNumber>;
        /** Informational: source of this backend entry (e.g. "fleet-mcpu") */
        source: z.ZodOptional<z.ZodString>;
        /** Informational: original description from the fleet catalog */
        description: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        transport: "http";
        namespace: string;
        enabled: boolean;
        restart_policy: "never" | "always" | "on-failure";
        max_restarts: number;
        health_check_interval: number;
        url: string;
        reconnect_interval: number;
        headers: Record<string, string>;
        source?: string | undefined;
        description?: string | undefined;
    }, {
        transport: "http";
        namespace: string;
        url: string;
        enabled?: boolean | undefined;
        restart_policy?: "never" | "always" | "on-failure" | undefined;
        max_restarts?: number | undefined;
        health_check_interval?: number | undefined;
        reconnect_interval?: number | undefined;
        headers?: Record<string, string> | undefined;
        source?: string | undefined;
        description?: string | undefined;
    }>]>>>;
}, "strip", z.ZodTypeAny, {
    gateway: {
        port: number;
        host: string;
        name: string;
        log_level: "debug" | "info" | "warn" | "error";
        tool_prefix: string;
        tool_exposure: "namespaced" | "mux" | "both";
    };
    fleet: {
        enabled: boolean;
        toolhive: {
            docker_ps: boolean;
            endpoint_probe: boolean;
            probe_timeout_ms: number;
            auto_ingest: boolean;
            ingest_namespace_prefix: string;
            ingest_only: string[];
            ingest_skip: string[];
            app_support_dir?: string | undefined;
            mcpu_generated_config?: string | undefined;
        };
    };
    backends: Record<string, {
        transport: "stdio";
        command: string;
        args: string[];
        env: Record<string, string>;
        namespace: string;
        enabled: boolean;
        restart_policy: "never" | "always" | "on-failure";
        max_restarts: number;
        health_check_interval: number;
        cwd?: string | undefined;
    } | {
        transport: "sse";
        namespace: string;
        enabled: boolean;
        restart_policy: "never" | "always" | "on-failure";
        max_restarts: number;
        health_check_interval: number;
        url: string;
        reconnect_interval: number;
        headers: Record<string, string>;
        source?: string | undefined;
        description?: string | undefined;
    } | {
        transport: "http";
        namespace: string;
        enabled: boolean;
        restart_policy: "never" | "always" | "on-failure";
        max_restarts: number;
        health_check_interval: number;
        url: string;
        reconnect_interval: number;
        headers: Record<string, string>;
        source?: string | undefined;
        description?: string | undefined;
    }>;
}, {
    gateway?: {
        port?: number | undefined;
        host?: string | undefined;
        name?: string | undefined;
        log_level?: "debug" | "info" | "warn" | "error" | undefined;
        tool_prefix?: string | undefined;
        tool_exposure?: "namespaced" | "mux" | "both" | undefined;
    } | undefined;
    fleet?: {
        enabled?: boolean | undefined;
        toolhive?: {
            app_support_dir?: string | undefined;
            mcpu_generated_config?: string | undefined;
            docker_ps?: boolean | undefined;
            endpoint_probe?: boolean | undefined;
            probe_timeout_ms?: number | undefined;
            auto_ingest?: boolean | undefined;
            ingest_namespace_prefix?: string | undefined;
            ingest_only?: string[] | undefined;
            ingest_skip?: string[] | undefined;
        } | undefined;
    } | undefined;
    backends?: Record<string, {
        transport: "stdio";
        command: string;
        namespace: string;
        args?: string[] | undefined;
        cwd?: string | undefined;
        env?: Record<string, string> | undefined;
        enabled?: boolean | undefined;
        restart_policy?: "never" | "always" | "on-failure" | undefined;
        max_restarts?: number | undefined;
        health_check_interval?: number | undefined;
    } | {
        transport: "sse";
        namespace: string;
        url: string;
        enabled?: boolean | undefined;
        restart_policy?: "never" | "always" | "on-failure" | undefined;
        max_restarts?: number | undefined;
        health_check_interval?: number | undefined;
        reconnect_interval?: number | undefined;
        headers?: Record<string, string> | undefined;
        source?: string | undefined;
        description?: string | undefined;
    } | {
        transport: "http";
        namespace: string;
        url: string;
        enabled?: boolean | undefined;
        restart_policy?: "never" | "always" | "on-failure" | undefined;
        max_restarts?: number | undefined;
        health_check_interval?: number | undefined;
        reconnect_interval?: number | undefined;
        headers?: Record<string, string> | undefined;
        source?: string | undefined;
        description?: string | undefined;
    }> | undefined;
}>;
export type StdioBackendConfig = z.infer<typeof StdioBackendSchema>;
export type SseBackendConfig = z.infer<typeof SseBackendSchema>;
export type HttpBackendConfig = z.infer<typeof HttpBackendSchema>;
export type BackendConfig = z.infer<typeof BackendSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type ToolHiveFleetConfig = z.infer<typeof ToolHiveFleetConfigSchema>;
export type FleetConfig = z.infer<typeof FleetConfigSchema>;
export type Config = z.infer<typeof ConfigFileSchema>;
export declare function loadConfig(filePath: string): Promise<Config>;
export {};
//# sourceMappingURL=config.d.ts.map