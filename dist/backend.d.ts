import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { BackendConfig } from "./config.js";
import type { Logger } from "./logger.js";
export type BackendStatus = "starting" | "connected" | "disconnected" | "error" | "disabled";
export interface BackendInfo {
    name: string;
    config: BackendConfig;
    status: BackendStatus;
    tools: Tool[];
    error?: string;
    restartCount: number;
    lastConnected?: Date;
}
export declare class BackendInstance {
    readonly name: string;
    readonly config: BackendConfig;
    private client;
    private transport;
    private _status;
    private _tools;
    private _error?;
    private _restartCount;
    private _lastConnected?;
    private logger;
    private onToolsChanged?;
    constructor(name: string, config: BackendConfig, logger: Logger, onToolsChanged?: () => void);
    get status(): BackendStatus;
    get tools(): Tool[];
    get error(): string | undefined;
    get restartCount(): number;
    get lastConnected(): Date | undefined;
    getInfo(): BackendInfo;
    connect(): Promise<void>;
    private connectStdio;
    private connectSse;
    private connectHttp;
    private handleDisconnect;
    /** Call a tool on this backend */
    callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
    /** List resources from this backend */
    listResources(): Promise<{
        uri: string;
        name: string;
        description?: string | undefined;
        mimeType?: string | undefined;
        annotations?: {
            audience?: ("user" | "assistant")[] | undefined;
            priority?: number | undefined;
            lastModified?: string | undefined;
        } | undefined;
        _meta?: {
            [x: string]: unknown;
        } | undefined;
        icons?: {
            src: string;
            mimeType?: string | undefined;
            sizes?: string[] | undefined;
            theme?: "light" | "dark" | undefined;
        }[] | undefined;
        title?: string | undefined;
    }[]>;
    /** Read a resource from this backend */
    readResource(uri: string): Promise<{
        [x: string]: unknown;
        contents: ({
            uri: string;
            text: string;
            mimeType?: string | undefined;
            _meta?: Record<string, unknown> | undefined;
        } | {
            uri: string;
            blob: string;
            mimeType?: string | undefined;
            _meta?: Record<string, unknown> | undefined;
        })[];
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
    }>;
    /** List prompts from this backend */
    listPrompts(): Promise<{
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
        _meta?: {
            [x: string]: unknown;
        } | undefined;
        icons?: {
            src: string;
            mimeType?: string | undefined;
            sizes?: string[] | undefined;
            theme?: "light" | "dark" | undefined;
        }[] | undefined;
        title?: string | undefined;
    }[]>;
    /** Get a prompt from this backend */
    getPrompt(name: string, args?: Record<string, string>): Promise<{
        [x: string]: unknown;
        messages: {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
                annotations?: {
                    audience?: ("user" | "assistant")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                } | undefined;
                _meta?: Record<string, unknown> | undefined;
            } | {
                type: "image";
                data: string;
                mimeType: string;
                annotations?: {
                    audience?: ("user" | "assistant")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                } | undefined;
                _meta?: Record<string, unknown> | undefined;
            } | {
                type: "audio";
                data: string;
                mimeType: string;
                annotations?: {
                    audience?: ("user" | "assistant")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                } | undefined;
                _meta?: Record<string, unknown> | undefined;
            } | {
                type: "resource";
                resource: {
                    uri: string;
                    text: string;
                    mimeType?: string | undefined;
                    _meta?: Record<string, unknown> | undefined;
                } | {
                    uri: string;
                    blob: string;
                    mimeType?: string | undefined;
                    _meta?: Record<string, unknown> | undefined;
                };
                annotations?: {
                    audience?: ("user" | "assistant")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                } | undefined;
                _meta?: Record<string, unknown> | undefined;
            } | {
                uri: string;
                name: string;
                type: "resource_link";
                description?: string | undefined;
                mimeType?: string | undefined;
                annotations?: {
                    audience?: ("user" | "assistant")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                } | undefined;
                _meta?: {
                    [x: string]: unknown;
                } | undefined;
                icons?: {
                    src: string;
                    mimeType?: string | undefined;
                    sizes?: string[] | undefined;
                    theme?: "light" | "dark" | undefined;
                }[] | undefined;
                title?: string | undefined;
            };
        }[];
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
        description?: string | undefined;
    }>;
    disconnect(): Promise<void>;
    restart(): Promise<void>;
}
//# sourceMappingURL=backend.d.ts.map