import { z } from "zod";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Logger } from "./logger.js";

// ─── Safety classification types ──────────────────────────────────────────────

export type SafetyClass =
  | "READ"
  | "WRITE"
  | "SIDE_EFFECT"
  | "HUMAN_OUTBOUND"
  | "PRODUCTION"
  | "VAULT_VALUE"
  | "UNCLASSIFIED";

export interface SafetyClassification {
  safetyClass: SafetyClass;
  tags: string[];
  writeGuard?: string;
  confirmationMapsToDownstream: boolean;
  locality?: string;
  source: "manifest" | "name-pattern" | "unclassified";
}

// ─── Manifest file format (isaac-router-manifest/v1) ─────────────────────────

export const ManifestCapabilitySchema = z.object({
  tool: z.string(),
  safety_class: z.enum([
    "READ",
    "WRITE",
    "SIDE_EFFECT",
    "HUMAN_OUTBOUND",
    "PRODUCTION",
    "VAULT_VALUE",
  ]),
  locality: z.string().optional(),
  tags: z.array(z.string()).default([]),
  write_guard: z.string().optional(),
  confirmation_maps_to_downstream: z.boolean().default(false),
});

export const ManifestFileSchema = z.object({
  manifest: z.literal("isaac-router-manifest/v1"),
  backend: z.string(),
  capabilities: z.array(ManifestCapabilitySchema),
});

type ManifestCapability = z.infer<typeof ManifestCapabilitySchema>;
type ManifestFile = z.infer<typeof ManifestFileSchema>;

// ─── Verb-set regex (fail-closed: unclassified write-like names → WRITE) ──────

/**
 * Write/destructive verb segments. A tool whose originalName or namespacedName
 * contains one of these verbs as a word segment (preceded by start-of-string or
 * `_`, and followed by `_` or end-of-string) defaults to WRITE when not
 * explicitly classified in a manifest.
 *
 * Exported so contract audits and tests can reuse the same regex.
 */
export const WRITE_VERB_REGEX =
  /(?:^|_)(?:create|update|delete|send|reply|upload|move|copy|archive|set|add|remove|patch|post|purge|execute|run|trigger|invoke|revoke|approve|merge|deploy|restart|kill|terminate|publish|assign|transition|resolve|close|escalate)(?:_|$)/i;

// ─── Gate decision helper ─────────────────────────────────────────────────────

export type GateDecision =
  | { action: "proceed" }
  | { action: "warn"; safetyClass: SafetyClass; source: "manifest" | "name-pattern" | "unclassified" }
  | { action: "block"; safetyClass: SafetyClass; source: "manifest" | "name-pattern" | "unclassified" };

/**
 * Pure function: given a safety classification, confirmed flag, and enforce
 * mode, decide what the gate should do. Extracted for unit testing.
 *
 * UNCLASSIFIED is telemetry-only: it warns (proceed + log) in BOTH advisory
 * and blocking modes and must never block — there is no confirmation contract
 * for a tool the gateway cannot classify, only visibility.
 */
export function decideGate(
  safety: SafetyClassification | undefined,
  confirmed: boolean,
  enforce: "advisory" | "blocking"
): GateDecision {
  if (!safety || !isGatedClass(safety.safetyClass)) {
    return { action: "proceed" };
  }
  if (safety.safetyClass === "UNCLASSIFIED") {
    return { action: "warn", safetyClass: "UNCLASSIFIED", source: safety.source };
  }
  if (confirmed) {
    return { action: "proceed" };
  }
  if (enforce === "advisory") {
    return { action: "warn", safetyClass: safety.safetyClass, source: safety.source };
  }
  return { action: "block", safetyClass: safety.safetyClass, source: safety.source };
}

// ─── Gated-class predicate ────────────────────────────────────────────────────

/** Returns true for every safety class that requires confirmation (i.e., not READ). */
export function isGatedClass(c: SafetyClass): boolean {
  return c !== "READ";
}

// ─── Manifest registry ────────────────────────────────────────────────────────

export class ManifestRegistry {
  private logger: Logger;
  /** Map from backend name → tool name → capability entry */
  private index = new Map<string, Map<string, ManifestCapability>>();

  constructor(logger: Logger, manifestDir?: string) {
    this.logger = logger;
    const dir = manifestDir
      ? resolve(manifestDir)
      : resolve(process.cwd(), "manifests");

    this.loadDir(dir);
  }

  private loadDir(dir: string): void {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Missing manifests dir is expected on first boot — log info, not warn.
      this.logger.info(`ManifestRegistry: manifests directory not found or unreadable (${dir}): ${msg}. All tools will fall back to name-pattern classification.`);
      return;
    }

    this.logger.info(`ManifestRegistry: loading ${files.length} manifest file(s) from ${dir}`);

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        const manifest: ManifestFile = ManifestFileSchema.parse(parsed);
        this.indexManifest(manifest);
        this.logger.info(`ManifestRegistry: loaded manifest for backend "${manifest.backend}" (${manifest.capabilities.length} capabilities)`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // One bad manifest must not break startup.
        this.logger.warn(`ManifestRegistry: skipping malformed manifest ${filePath}: ${msg}`);
      }
    }
  }

  private indexManifest(manifest: ManifestFile): void {
    let backendMap = this.index.get(manifest.backend);
    if (!backendMap) {
      backendMap = new Map<string, ManifestCapability>();
      this.index.set(manifest.backend, backendMap);
    }
    for (const cap of manifest.capabilities) {
      backendMap.set(cap.tool, cap);
    }
  }

  /**
   * Classify a tool by backend name + original tool name.
   *
   * Priority:
   *  1. Manifest entry (source: "manifest") — exact match on backendName + originalName.
   *  2. Graduated fallback for tools with no manifest entry:
   *     - If originalName or namespacedName contains a write verb → WRITE
   *       (source: "name-pattern", fail-closed).
   *     - Otherwise → UNCLASSIFIED (source: "unclassified") — proceeds with a
   *       warning and telemetry so missing manifest coverage is visible
   *       without blocking read-shaped tools.
   */
  classify(
    backendName: string,
    originalName: string,
    namespacedName: string
  ): SafetyClassification {
    const backendMap = this.index.get(backendName);
    if (backendMap) {
      const cap = backendMap.get(originalName);
      if (cap) {
        return {
          safetyClass: cap.safety_class as SafetyClass,
          tags: cap.tags,
          writeGuard: cap.write_guard,
          confirmationMapsToDownstream: cap.confirmation_maps_to_downstream,
          locality: cap.locality,
          source: "manifest",
        };
      }
    }

    // Name-pattern fallback (fail-closed: missing coverage → WRITE if verb matches)
    const isWrite =
      WRITE_VERB_REGEX.test(originalName) || WRITE_VERB_REGEX.test(namespacedName);

    if (isWrite) {
      return {
        safetyClass: "WRITE",
        tags: [],
        confirmationMapsToDownstream: false,
        source: "name-pattern",
      };
    }

    // Verb-less and unmanifested → UNCLASSIFIED (warn + telemetry, never block).
    return {
      safetyClass: "UNCLASSIFIED",
      tags: [],
      confirmationMapsToDownstream: false,
      source: "unclassified",
    };
  }
}
