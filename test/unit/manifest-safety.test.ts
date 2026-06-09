import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createLogger } from "../../src/logger.js";
import {
  ManifestRegistry,
  isGatedClass,
  decideGate,
  WRITE_VERB_REGEX,
} from "../../src/manifest.js";
import type { SafetyClass, SafetyClassification } from "../../src/manifest.js";

const silentLogger = createLogger("silent");

// ─── isGatedClass ──────────────────────────────────────────────────────────────

describe("isGatedClass", () => {
  it("READ is NOT gated", () => {
    expect(isGatedClass("READ")).toBe(false);
  });

  it("every non-READ class IS gated", () => {
    const gated: SafetyClass[] = [
      "WRITE",
      "SIDE_EFFECT",
      "HUMAN_OUTBOUND",
      "PRODUCTION",
      "VAULT_VALUE",
    ];
    for (const c of gated) {
      expect(isGatedClass(c)).toBe(true);
    }
  });
});

// ─── WRITE_VERB_REGEX ──────────────────────────────────────────────────────────

describe("WRITE_VERB_REGEX — verb-set coverage", () => {
  it("matches _send at end of name", () => {
    expect(WRITE_VERB_REGEX.test("teams_send")).toBe(true);
  });
  it("matches _send_ in the middle", () => {
    expect(WRITE_VERB_REGEX.test("teams_send_message")).toBe(true);
  });
  it("matches _delete_", () => {
    expect(WRITE_VERB_REGEX.test("calendar_delete_event")).toBe(true);
  });
  it("does NOT match when verb is a substring (no word boundary)", () => {
    // 'sendgrid' should not match 'send' as a segment
    expect(WRITE_VERB_REGEX.test("sendgrid_get_stats")).toBe(false);
  });
  it("does NOT match a plain read name", () => {
    expect(WRITE_VERB_REGEX.test("teams_get_chat_messages")).toBe(false);
    expect(WRITE_VERB_REGEX.test("list_incidents")).toBe(false);
  });
  it("matches create at start of name", () => {
    expect(WRITE_VERB_REGEX.test("create_incident")).toBe(true);
  });
});

// ─── decideGate ───────────────────────────────────────────────────────────────

describe("decideGate — pure gate decision", () => {
  const readSafety: SafetyClassification = {
    safetyClass: "READ",
    tags: [],
    confirmationMapsToDownstream: false,
    source: "manifest",
  };
  const writeSafety: SafetyClassification = {
    safetyClass: "WRITE",
    tags: [],
    confirmationMapsToDownstream: false,
    source: "manifest",
  };
  const humanOutboundSafety: SafetyClassification = {
    safetyClass: "HUMAN_OUTBOUND",
    tags: [],
    confirmationMapsToDownstream: false,
    source: "manifest",
  };

  it("READ never gates regardless of confirmed or enforce mode", () => {
    expect(decideGate(readSafety, false, "advisory").action).toBe("proceed");
    expect(decideGate(readSafety, false, "blocking").action).toBe("proceed");
    expect(decideGate(readSafety, true, "advisory").action).toBe("proceed");
  });

  it("WRITE + confirmed:true always proceeds regardless of enforce mode", () => {
    expect(decideGate(writeSafety, true, "advisory").action).toBe("proceed");
    expect(decideGate(writeSafety, true, "blocking").action).toBe("proceed");
  });

  it("WRITE + confirmed:false + advisory → warn (advisory proceeds)", () => {
    const decision = decideGate(writeSafety, false, "advisory");
    expect(decision.action).toBe("warn");
    if (decision.action === "warn") {
      expect(decision.safetyClass).toBe("WRITE");
    }
  });

  it("WRITE + confirmed:false + blocking → block", () => {
    const decision = decideGate(writeSafety, false, "blocking");
    expect(decision.action).toBe("block");
    if (decision.action === "block") {
      expect(decision.safetyClass).toBe("WRITE");
    }
  });

  it("HUMAN_OUTBOUND + confirmed:false + blocking → block", () => {
    const decision = decideGate(humanOutboundSafety, false, "blocking");
    expect(decision.action).toBe("block");
  });

  it("undefined safety → proceed (unclassified tool is not blocked)", () => {
    expect(decideGate(undefined, false, "advisory").action).toBe("proceed");
    expect(decideGate(undefined, false, "blocking").action).toBe("proceed");
  });
});

// ─── ManifestRegistry — helpers ───────────────────────────────────────────────

function makeTempManifestDir(): string {
  const dir = join(tmpdir(), `mcp-gw-test-manifests-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeManifest(dir: string, filename: string, content: object): void {
  writeFileSync(join(dir, filename), JSON.stringify(content));
}

function cleanDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// ─── ManifestRegistry — missing directory ─────────────────────────────────────

describe("ManifestRegistry — missing manifest directory", () => {
  it("tolerates a missing dir and classifies everything by name-pattern", () => {
    const reg = new ManifestRegistry(silentLogger, "/nonexistent/path/that/never/exists");

    // Name-pattern fallback: send → WRITE
    const sendResult = reg.classify("any-backend", "send_notification", "any_send_notification");
    expect(sendResult.safetyClass).toBe("WRITE");
    expect(sendResult.source).toBe("name-pattern");

    // Name-pattern fallback: get → READ
    const getResult = reg.classify("any-backend", "get_status", "any_get_status");
    expect(getResult.safetyClass).toBe("READ");
    expect(getResult.source).toBe("name-pattern");
  });
});

// ─── ManifestRegistry — manifest hit (READ) ───────────────────────────────────

describe("ManifestRegistry — manifest hit: READ classification", () => {
  let dir: string;
  let reg: ManifestRegistry;

  beforeEach(() => {
    dir = makeTempManifestDir();
    writeManifest(dir, "az-teams.json", {
      manifest: "isaac-router-manifest/v1",
      backend: "az-teams",
      capabilities: [
        {
          tool: "teams_get_chat_messages",
          safety_class: "READ",
          locality: "remote",
          tags: ["teams", "chat", "read"],
        },
      ],
    });
    reg = new ManifestRegistry(silentLogger, dir);
  });

  it("returns manifest READ for a classified tool", () => {
    const result = reg.classify(
      "az-teams",
      "teams_get_chat_messages",
      "az_teams_teams_get_chat_messages"
    );
    expect(result.safetyClass).toBe("READ");
    expect(result.source).toBe("manifest");
    expect(result.tags).toContain("teams");
    expect(result.confirmationMapsToDownstream).toBe(false);
  });

  it("falls back to name-pattern for a tool not in the manifest", () => {
    // 'delete_something' would be WRITE by name-pattern but is not in the manifest
    const result = reg.classify("az-teams", "delete_something", "az_teams_delete_something");
    expect(result.safetyClass).toBe("WRITE");
    expect(result.source).toBe("name-pattern");
  });
});

// ─── ManifestRegistry — manifest hit (HUMAN_OUTBOUND) ────────────────────────

describe("ManifestRegistry — manifest hit: HUMAN_OUTBOUND classification", () => {
  let dir: string;
  let reg: ManifestRegistry;

  beforeEach(() => {
    dir = makeTempManifestDir();
    writeManifest(dir, "az-teams.json", {
      manifest: "isaac-router-manifest/v1",
      backend: "az-teams",
      capabilities: [
        {
          tool: "teams_send_message",
          safety_class: "HUMAN_OUTBOUND",
          locality: "remote",
          tags: ["teams", "chat", "send", "outbound"],
          write_guard: "router_confirmation_maps_to_downstream",
          confirmation_maps_to_downstream: false,
        },
      ],
    });
    reg = new ManifestRegistry(silentLogger, dir);
  });

  it("returns HUMAN_OUTBOUND from manifest with correct metadata", () => {
    const result = reg.classify(
      "az-teams",
      "teams_send_message",
      "az_teams_teams_send_message"
    );
    expect(result.safetyClass).toBe("HUMAN_OUTBOUND");
    expect(result.source).toBe("manifest");
    expect(result.tags).toContain("outbound");
    expect(result.writeGuard).toBe("router_confirmation_maps_to_downstream");
    expect(result.confirmationMapsToDownstream).toBe(false);
    expect(result.locality).toBe("remote");
  });
});

// ─── ManifestRegistry — name-pattern fallback ────────────────────────────────

describe("ManifestRegistry — name-pattern fallback (no manifest for backend)", () => {
  let dir: string;
  let reg: ManifestRegistry;

  beforeEach(() => {
    dir = makeTempManifestDir();
    // No manifest for "unknown-backend"
    reg = new ManifestRegistry(silentLogger, dir);
  });

  it("classifies _send_ tool as WRITE by name-pattern", () => {
    const result = reg.classify("unknown-backend", "teams_send_message", "ub_teams_send_message");
    expect(result.safetyClass).toBe("WRITE");
    expect(result.source).toBe("name-pattern");
    expect(result.confirmationMapsToDownstream).toBe(false);
  });

  it("classifies _get_ tool as READ by name-pattern", () => {
    const result = reg.classify("unknown-backend", "get_status", "ub_get_status");
    expect(result.safetyClass).toBe("READ");
    expect(result.source).toBe("name-pattern");
  });

  it("classifies _delete tool as WRITE by name-pattern", () => {
    const result = reg.classify("unknown-backend", "record_delete", "ub_record_delete");
    expect(result.safetyClass).toBe("WRITE");
    expect(result.source).toBe("name-pattern");
  });

  it("classifies list_ tool as READ by name-pattern", () => {
    const result = reg.classify("unknown-backend", "list_items", "ub_list_items");
    expect(result.safetyClass).toBe("READ");
    expect(result.source).toBe("name-pattern");
  });
});

// ─── ManifestRegistry — malformed manifest is skipped ────────────────────────

describe("ManifestRegistry — malformed manifest is skipped without crash", () => {
  it("loads other manifests and skips the malformed one", () => {
    const dir = makeTempManifestDir();
    try {
      // Write a good manifest
      writeManifest(dir, "good.json", {
        manifest: "isaac-router-manifest/v1",
        backend: "good-backend",
        capabilities: [
          { tool: "get_thing", safety_class: "READ", tags: [] },
        ],
      });
      // Write a broken manifest (wrong schema version)
      writeFileSync(join(dir, "bad.json"), JSON.stringify({ manifest: "wrong", backend: "bad" }));

      const reg = new ManifestRegistry(silentLogger, dir);

      // Good manifest is loaded
      const result = reg.classify("good-backend", "get_thing", "good_get_thing");
      expect(result.safetyClass).toBe("READ");
      expect(result.source).toBe("manifest");

      // Bad backend falls back to name-pattern (not a crash)
      const fallback = reg.classify("bad", "send_x", "bad_send_x");
      expect(fallback.source).toBe("name-pattern");
    } finally {
      cleanDir(dir);
    }
  });
});

// ─── ManifestRegistry — confirmationMapsToDownstream defaults false ───────────

describe("ManifestRegistry — confirmationMapsToDownstream defaults", () => {
  it("defaults confirmation_maps_to_downstream to false when absent", () => {
    const dir = makeTempManifestDir();
    try {
      writeManifest(dir, "test.json", {
        manifest: "isaac-router-manifest/v1",
        backend: "test-svc",
        capabilities: [
          // No confirmation_maps_to_downstream field
          { tool: "send_alert", safety_class: "HUMAN_OUTBOUND", tags: ["alert"] },
        ],
      });
      const reg = new ManifestRegistry(silentLogger, dir);
      const result = reg.classify("test-svc", "send_alert", "test_send_alert");
      expect(result.confirmationMapsToDownstream).toBe(false);
    } finally {
      cleanDir(dir);
    }
  });
});

// ─── ManifestRegistry — VAULT_VALUE classification ───────────────────────────

describe("ManifestRegistry — VAULT_VALUE classification", () => {
  it("returns VAULT_VALUE for secret reads", () => {
    const dir = makeTempManifestDir();
    try {
      writeManifest(dir, "vault.json", {
        manifest: "isaac-router-manifest/v1",
        backend: "azure-key-vault-mcp",
        capabilities: [
          { tool: "get_secret", safety_class: "VAULT_VALUE", tags: ["vault"] },
        ],
      });
      const reg = new ManifestRegistry(silentLogger, dir);
      const result = reg.classify("azure-key-vault-mcp", "get_secret", "vault_get_secret");
      expect(result.safetyClass).toBe("VAULT_VALUE");
      expect(isGatedClass("VAULT_VALUE")).toBe(true);
    } finally {
      cleanDir(dir);
    }
  });
});
