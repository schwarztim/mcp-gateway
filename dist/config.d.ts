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
    headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    health_check_interval: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    transport: "sse";
    namespace: string;
    enabled: boolean;
    health_check_interval: number;
    url: string;
    reconnect_interval: number;
    headers: Record<string, string>;
}, {
    transport: "sse";
    namespace: string;
    url: string;
    enabled?: boolean | undefined;
    health_check_interval?: number | undefined;
    reconnect_interval?: number | undefined;
    headers?: Record<string, string> | undefined;
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
    headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    health_check_interval: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    transport: "sse";
    namespace: string;
    enabled: boolean;
    health_check_interval: number;
    url: string;
    reconnect_interval: number;
    headers: Record<string, string>;
}, {
    transport: "sse";
    namespace: string;
    url: string;
    enabled?: boolean | undefined;
    health_check_interval?: number | undefined;
    reconnect_interval?: number | undefined;
    headers?: Record<string, string> | undefined;
}>]>;
declare const GatewayConfigSchema: z.ZodObject<{
    port: z.ZodDefault<z.ZodNumber>;
    host: z.ZodDefault<z.ZodString>;
    name: z.ZodDefault<z.ZodString>;
    log_level: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
}, "strip", z.ZodTypeAny, {
    port: number;
    host: string;
    name: string;
    log_level: "debug" | "info" | "warn" | "error";
}, {
    port?: number | undefined;
    host?: string | undefined;
    name?: string | undefined;
    log_level?: "debug" | "info" | "warn" | "error" | undefined;
}>;
declare const ConfigFileSchema: z.ZodObject<{
    gateway: z.ZodDefault<z.ZodObject<{
        port: z.ZodDefault<z.ZodNumber>;
        host: z.ZodDefault<z.ZodString>;
        name: z.ZodDefault<z.ZodString>;
        log_level: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
    }, "strip", z.ZodTypeAny, {
        port: number;
        host: string;
        name: string;
        log_level: "debug" | "info" | "warn" | "error";
    }, {
        port?: number | undefined;
        host?: string | undefined;
        name?: string | undefined;
        log_level?: "debug" | "info" | "warn" | "error" | undefined;
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
        headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        health_check_interval: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        transport: "sse";
        namespace: string;
        enabled: boolean;
        health_check_interval: number;
        url: string;
        reconnect_interval: number;
        headers: Record<string, string>;
    }, {
        transport: "sse";
        namespace: string;
        url: string;
        enabled?: boolean | undefined;
        health_check_interval?: number | undefined;
        reconnect_interval?: number | undefined;
        headers?: Record<string, string> | undefined;
    }>]>>>;
}, "strip", z.ZodTypeAny, {
    gateway: {
        port: number;
        host: string;
        name: string;
        log_level: "debug" | "info" | "warn" | "error";
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
        health_check_interval: number;
        url: string;
        reconnect_interval: number;
        headers: Record<string, string>;
    }>;
}, {
    gateway?: {
        port?: number | undefined;
        host?: string | undefined;
        name?: string | undefined;
        log_level?: "debug" | "info" | "warn" | "error" | undefined;
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
        health_check_interval?: number | undefined;
        reconnect_interval?: number | undefined;
        headers?: Record<string, string> | undefined;
    }> | undefined;
}>;
export type StdioBackendConfig = z.infer<typeof StdioBackendSchema>;
export type SseBackendConfig = z.infer<typeof SseBackendSchema>;
export type BackendConfig = z.infer<typeof BackendSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type Config = z.infer<typeof ConfigFileSchema>;
export declare function loadConfig(filePath: string): Config;
export {};
//# sourceMappingURL=config.d.ts.map