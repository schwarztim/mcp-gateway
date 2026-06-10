/**
 * Wire-level invariant suite: boots the REAL gateway against REAL in-process
 * MCP backends and proves the Phase-0 invariants by name.
 *
 * Tests of CURRENT behavior (boot, roundtrips) run always.
 * Tests of post-integration behavior (safety gate deny shape, stdio
 * quarantine, UNCLASSIFIED warn+proceed) are authored now but gated behind
 * GW_E2E_FULL — they go green at Wave-2 integration.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bootGateway,
  fakeBackend,
  mcpClient,
  callTool,
  type FakeBackend,
  type BootedGateway,
} from "./harness.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const FULL = !!process.env.GW_E2E_FULL;

const META_TOOLS = [
  "gateway_search_tools",
  "gateway_describe_tool",
  "gateway_call_tool",
  "gateway_fetch_artifact",
  "gateway_backend_status",
  "gateway_fleet_inventory",
  "gateway_mcpu_config",
  "gateway_reconnect_backend",
];

/** Track resources and close them all (reverse order) in finally. */
function cleanupStack() {
  const fns: Array<() => Promise<void>> = [];
  return {
    track<T extends { close?: () => Promise<void>; stop?: () => Promise<void> }>(r: T): T {
      fns.push(async () => {
        if (typeof r.stop === "function") await r.stop();
        else if (typeof r.close === "function") await r.close();
      });
      return r;
    },
    async closeAll() {
      for (const fn of fns.reverse()) {
        try {
          await fn();
        } catch {
          /* best-effort teardown */
        }
      }
    },
  };
}

async function bootWithFake(opts: {
  ns?: string;
  toolExposure?: "mux" | "both";
  enforce?: "advisory" | "blocking";
  rawBackends?: Record<string, object>;
}): Promise<{
  fake: FakeBackend;
  gw: BootedGateway;
  client: Client;
  stack: ReturnType<typeof cleanupStack>;
}> {
  const stack = cleanupStack();
  const ns = opts.ns ?? "fakebe";
  const fake = stack.track(await fakeBackend(ns));
  const gw = stack.track(
    await bootGateway({
      backends: { [ns]: { url: fake.url } },
      toolExposure: opts.toolExposure ?? "both",
      enforce: opts.enforce,
      rawBackends: opts.rawBackends,
    })
  );
  const client = stack.track(await mcpClient(gw.url));
  return { fake, gw, client, stack };
}

describe("phase-0 invariants (wire-level, real gateway, real backends)", () => {
  it("boots-and-serves: gateway boots from temp config and serves meta + namespaced tools", async () => {
    const { client, stack } = await bootWithFake({ toolExposure: "both" });
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const meta of META_TOOLS) {
        expect(names, `missing meta-tool ${meta}`).toContain(meta);
      }
      // "both" mode also exposes namespaced backend tools directly.
      expect(names).toContain("fakebe_echo_message");
      expect(names).toContain("fakebe_fake_delete_item");
    } finally {
      await stack.closeAll();
    }
  });

  it("roundtrip-mux-path: gateway_call_tool dispatches to the backend with nested arguments", async () => {
    const { fake, client, stack } = await bootWithFake({});
    try {
      const result = await callTool(client, "gateway_call_tool", {
        tool: "fakebe_echo_message",
        arguments: { text: "hello-mux-roundtrip" },
      });
      expect(result.isError).toBe(false);
      expect(result.text).toContain("hello-mux-roundtrip");
      expect(fake.calls.echo_message).toBe(1);
    } finally {
      await stack.closeAll();
    }
  });

  it("roundtrip-direct-path: namespaced tool is callable directly by name", async () => {
    const { fake, client, stack } = await bootWithFake({ toolExposure: "both" });
    try {
      const result = await callTool(client, "fakebe_echo_message", {
        text: "hello-direct-roundtrip",
      });
      expect(result.isError).toBe(false);
      expect(result.text).toContain("hello-direct-roundtrip");
      expect(fake.calls.echo_message).toBe(1);
    } finally {
      await stack.closeAll();
    }
  });

  it.skipIf(!FULL)(
    "write-without-confirmed-blocks-mux-path: blocking mode denies unconfirmed WRITE via gateway_call_tool, backend never invoked",
    async () => {
      const { fake, client, stack } = await bootWithFake({ enforce: "blocking" });
      try {
        const denied = await callTool(client, "gateway_call_tool", {
          tool: "fakebe_fake_delete_item",
          arguments: { id: "42" },
        });
        expect(denied.json).toBeDefined();
        expect(denied.json.confirmationRequired).toBe(true);
        expect(denied.json.tool).toBe("fakebe_fake_delete_item");
        expect(denied.json.safetyClass).toBe("WRITE");
        expect(denied.json.source).toBeDefined();
        expect(denied.json.reason).toBeDefined();
        expect(denied.json.redactedArguments).toEqual({ id: "<string>" });
        // Recipe field removed post-integration: deny payload has NO `next` key.
        expect(denied.json).not.toHaveProperty("next");
        // The deny happened at the gateway: backend recorded ZERO invocations.
        expect(fake.calls.fake_delete_item).toBe(0);

        // With confirmed:true the call proceeds to the backend.
        const allowed = await callTool(client, "gateway_call_tool", {
          tool: "fakebe_fake_delete_item",
          arguments: { id: "42" },
          confirmed: true,
        });
        expect(allowed.isError).toBe(false);
        expect(allowed.text).toContain("deleted 42");
        expect(fake.calls.fake_delete_item).toBe(1);
      } finally {
        await stack.closeAll();
      }
    }
  );

  it.skipIf(!FULL)(
    "write-without-confirmed-blocks-direct-path: blocking mode denies unconfirmed WRITE on direct namespaced calls with remedy",
    async () => {
      const { fake, client, stack } = await bootWithFake({
        enforce: "blocking",
        toolExposure: "both",
      });
      try {
        const denied = await callTool(client, "fakebe_fake_delete_item", { id: "9" });
        expect(denied.json).toBeDefined();
        expect(denied.json.confirmationRequired).toBe(true);
        expect(denied.json.safetyClass).toBe("WRITE");
        // Direct-path deny carries a remedy pointing at the confirmable mux path.
        expect(String(denied.json.remedy)).toContain("gateway_call_tool");
        expect(fake.calls.fake_delete_item).toBe(0);
      } finally {
        await stack.closeAll();
      }
    }
  );

  it.skipIf(!FULL)(
    "stdio-config-quarantined-at-boot: stdio backends entry is stripped pre-parse, gateway boots, http backend unaffected",
    async () => {
      const { fake, gw, client, stack } = await bootWithFake({
        rawBackends: {
          deadbeef: {
            transport: "stdio",
            command: "node",
            args: [],
            namespace: "deadbeef",
            enabled: true,
          },
        },
      });
      try {
        // Gateway booted (start resolved) — stdio entry must be absent from admin view.
        const res = await fetch(`${gw.adminUrl}/admin/backends`);
        expect(res.ok).toBe(true);
        const body: any = await res.json();
        const names = (body.backends ?? []).map((b: any) => b.name);
        expect(names).not.toContain("deadbeef");
        const namespaces = (body.backends ?? []).map((b: any) => b.namespace);
        expect(namespaces).not.toContain("deadbeef");

        // The http fake still serves a full roundtrip.
        const result = await callTool(client, "gateway_call_tool", {
          tool: "fakebe_echo_message",
          arguments: { text: "alive-after-quarantine" },
        });
        expect(result.text).toContain("alive-after-quarantine");
        expect(fake.calls.echo_message).toBe(1);
      } finally {
        await stack.closeAll();
      }
    }
  );

  it.skipIf(!FULL)(
    "stdio-mcpu-ingestion-quarantined: fleet-ingested command-style MCPU entry lands in quarantined[] with reason stdio-unsupported",
    async () => {
      const stack = cleanupStack();
      const dir = await mkdtemp(join(tmpdir(), "gw-e2e-mcpu-"));
      try {
        const fake = stack.track(await fakeBackend("goodhttp"));
        const mcpuPath = join(dir, "mcpu.json");
        await writeFile(
          mcpuPath,
          JSON.stringify({
            deadcmd: { command: "node", args: [] },
            goodhttp: { type: "http", url: fake.url },
          }),
          "utf-8"
        );
        const gw = stack.track(
          await bootGateway({
            backends: {},
            fleet: {
              enabled: true,
              toolhive: {
                auto_ingest: true,
                ingest_static_mcpu_config: false,
                docker_ps: false,
                mcpu_generated_config: mcpuPath,
              },
            },
          })
        );
        const client = stack.track(await mcpClient(gw.url));

        const status = await callTool(client, "gateway_backend_status", {});
        expect(status.json).toBeDefined();
        const quarantined: any[] = status.json.quarantined ?? [];
        const dead = quarantined.find((q) => q.name === "deadcmd");
        expect(dead, "deadcmd must appear in quarantined[]").toBeDefined();
        expect(dead.reason).toBe("stdio-unsupported");

        // goodhttp connected and serves a roundtrip.
        const result = await callTool(client, "gateway_call_tool", {
          tool: "goodhttp_echo_message",
          arguments: { text: "fleet-roundtrip" },
        });
        expect(result.text).toContain("fleet-roundtrip");
        expect(fake.calls.echo_message).toBe(1);
      } finally {
        await stack.closeAll();
        await rm(dir, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(!FULL)(
    "unclassified-tool-warns-and-proceeds: verb-less unmanifested tool proceeds without confirmed even in blocking mode",
    async () => {
      const { fake, client, stack } = await bootWithFake({ enforce: "blocking" });
      try {
        const result = await callTool(client, "gateway_call_tool", {
          tool: "fakebe_echo_message",
          arguments: { text: "unclassified-proceeds" },
        });
        expect(result.isError).toBe(false);
        expect(result.text).toContain("unclassified-proceeds");
        expect(fake.calls.echo_message).toBe(1);
      } finally {
        await stack.closeAll();
      }
    }
  );
});
