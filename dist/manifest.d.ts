import { z } from "zod";
import type { Logger } from "./logger.js";
export type SafetyClass = "READ" | "WRITE" | "SIDE_EFFECT" | "HUMAN_OUTBOUND" | "PRODUCTION" | "VAULT_VALUE";
export interface SafetyClassification {
    safetyClass: SafetyClass;
    tags: string[];
    writeGuard?: string;
    confirmationMapsToDownstream: boolean;
    locality?: string;
    source: "manifest" | "name-pattern";
}
export declare const ManifestCapabilitySchema: z.ZodObject<{
    tool: z.ZodString;
    safety_class: z.ZodEnum<["READ", "WRITE", "SIDE_EFFECT", "HUMAN_OUTBOUND", "PRODUCTION", "VAULT_VALUE"]>;
    locality: z.ZodOptional<z.ZodString>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    write_guard: z.ZodOptional<z.ZodString>;
    confirmation_maps_to_downstream: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    tool: string;
    safety_class: "READ" | "WRITE" | "SIDE_EFFECT" | "HUMAN_OUTBOUND" | "PRODUCTION" | "VAULT_VALUE";
    tags: string[];
    confirmation_maps_to_downstream: boolean;
    locality?: string | undefined;
    write_guard?: string | undefined;
}, {
    tool: string;
    safety_class: "READ" | "WRITE" | "SIDE_EFFECT" | "HUMAN_OUTBOUND" | "PRODUCTION" | "VAULT_VALUE";
    locality?: string | undefined;
    tags?: string[] | undefined;
    write_guard?: string | undefined;
    confirmation_maps_to_downstream?: boolean | undefined;
}>;
export declare const ManifestFileSchema: z.ZodObject<{
    manifest: z.ZodLiteral<"isaac-router-manifest/v1">;
    backend: z.ZodString;
    capabilities: z.ZodArray<z.ZodObject<{
        tool: z.ZodString;
        safety_class: z.ZodEnum<["READ", "WRITE", "SIDE_EFFECT", "HUMAN_OUTBOUND", "PRODUCTION", "VAULT_VALUE"]>;
        locality: z.ZodOptional<z.ZodString>;
        tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        write_guard: z.ZodOptional<z.ZodString>;
        confirmation_maps_to_downstream: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        tool: string;
        safety_class: "READ" | "WRITE" | "SIDE_EFFECT" | "HUMAN_OUTBOUND" | "PRODUCTION" | "VAULT_VALUE";
        tags: string[];
        confirmation_maps_to_downstream: boolean;
        locality?: string | undefined;
        write_guard?: string | undefined;
    }, {
        tool: string;
        safety_class: "READ" | "WRITE" | "SIDE_EFFECT" | "HUMAN_OUTBOUND" | "PRODUCTION" | "VAULT_VALUE";
        locality?: string | undefined;
        tags?: string[] | undefined;
        write_guard?: string | undefined;
        confirmation_maps_to_downstream?: boolean | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    capabilities: {
        tool: string;
        safety_class: "READ" | "WRITE" | "SIDE_EFFECT" | "HUMAN_OUTBOUND" | "PRODUCTION" | "VAULT_VALUE";
        tags: string[];
        confirmation_maps_to_downstream: boolean;
        locality?: string | undefined;
        write_guard?: string | undefined;
    }[];
    backend: string;
    manifest: "isaac-router-manifest/v1";
}, {
    capabilities: {
        tool: string;
        safety_class: "READ" | "WRITE" | "SIDE_EFFECT" | "HUMAN_OUTBOUND" | "PRODUCTION" | "VAULT_VALUE";
        locality?: string | undefined;
        tags?: string[] | undefined;
        write_guard?: string | undefined;
        confirmation_maps_to_downstream?: boolean | undefined;
    }[];
    backend: string;
    manifest: "isaac-router-manifest/v1";
}>;
/**
 * Write/destructive verb segments. A tool whose originalName or namespacedName
 * contains one of these verbs as a word segment (preceded by start-of-string or
 * `_`, and followed by `_` or end-of-string) defaults to WRITE when not
 * explicitly classified in a manifest.
 *
 * Exported so contract audits and tests can reuse the same regex.
 */
export declare const WRITE_VERB_REGEX: RegExp;
export type GateDecision = {
    action: "proceed";
} | {
    action: "warn";
    safetyClass: SafetyClass;
    source: "manifest" | "name-pattern";
} | {
    action: "block";
    safetyClass: SafetyClass;
    source: "manifest" | "name-pattern";
};
/**
 * Pure function: given a safety classification, confirmed flag, and enforce
 * mode, decide what the gate should do. Extracted for unit testing.
 */
export declare function decideGate(safety: SafetyClassification | undefined, confirmed: boolean, enforce: "advisory" | "blocking"): GateDecision;
/** Returns true for every safety class that requires confirmation (i.e., not READ). */
export declare function isGatedClass(c: SafetyClass): boolean;
export declare class ManifestRegistry {
    private logger;
    /** Map from backend name → tool name → capability entry */
    private index;
    constructor(logger: Logger, manifestDir?: string);
    private loadDir;
    private indexManifest;
    /**
     * Classify a tool by backend name + original tool name.
     *
     * Priority:
     *  1. Manifest entry (source: "manifest") — exact match on backendName + originalName.
     *  2. Fail-closed name-pattern fallback (source: "name-pattern"):
     *     - If originalName or namespacedName contains a write verb → WRITE.
     *     - Otherwise → READ.
     */
    classify(backendName: string, originalName: string, namespacedName: string): SafetyClassification;
}
//# sourceMappingURL=manifest.d.ts.map