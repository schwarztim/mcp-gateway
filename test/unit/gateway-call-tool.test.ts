import { describe, it, expect } from "vitest";
import { getMuxTools, MUX_TOOL_NAMES, extractCallToolArgs } from "../../src/mux-tools.js";

// ─── Schema verification ───────────────────────────────────────────────────────

describe("gateway_call_tool schema", () => {
  const callToolDef = getMuxTools().find((t) => t.name === MUX_TOOL_NAMES.callTool)!;

  it("exposes an arguments property in the input schema", () => {
    expect(callToolDef.inputSchema.properties).toHaveProperty("arguments");
  });

  it("arguments schema accepts arbitrary JSON objects (additionalProperties: true)", () => {
    const argsProp = (callToolDef.inputSchema.properties as Record<string, any>).arguments;
    expect(argsProp.type).toBe("object");
    expect(argsProp.additionalProperties).toBe(true);
  });

  it("requires the tool field", () => {
    expect(callToolDef.inputSchema.required).toContain("tool");
  });

  it("does not require the arguments field — callers omit it for no-arg tools", () => {
    expect(callToolDef.inputSchema.required ?? []).not.toContain("arguments");
  });
});

// ─── Argument forwarding ───────────────────────────────────────────────────────

describe("extractCallToolArgs — argument forwarding to backend", () => {
  it("forwards nested arguments to the backend (primary success path)", () => {
    const { target, targetArgs } = extractCallToolArgs({
      tool: "atlassian_api_key_get_confluence_page",
      arguments: { pageId: "ABC-123", spaceKey: "ARCH" },
    });
    expect(target).toBe("atlassian_api_key_get_confluence_page");
    expect(targetArgs).toEqual({ pageId: "ABC-123", spaceKey: "ARCH" });
  });

  it(
    "REGRESSION: flat args silently produce empty targetArgs — the original Confluence 404 failure mode",
    () => {
      // Original failure mode: callers passed pageId at the top level instead of
      // nesting it under `arguments`. The gateway silently ignored flat top-level
      // properties, so the backend received {} and Confluence returned 404.
      //
      // Correct call:   { tool: "...", arguments: { pageId: "ABC-123" } }
      // Incorrect call: { tool: "...", pageId: "ABC-123" }   ← this test
      const { target, targetArgs } = extractCallToolArgs({
        tool: "atlassian_api_key_get_confluence_page",
        pageId: "ABC-123",
      });
      expect(target).toBe("atlassian_api_key_get_confluence_page");
      // Flat args produce an empty object — the documented failure mode that
      // caused Confluence 404s.
      expect(targetArgs).toEqual({});
    }
  );

  it("passes through deeply nested and mixed-type argument values", () => {
    const { targetArgs } = extractCallToolArgs({
      tool: "some_tool",
      arguments: {
        a: 1,
        b: "two",
        c: { nested: true },
        d: [1, 2, 3],
      },
    });
    expect(targetArgs).toEqual({ a: 1, b: "two", c: { nested: true }, d: [1, 2, 3] });
  });

  it("returns empty target string when tool is absent", () => {
    const { target, targetArgs } = extractCallToolArgs({
      arguments: { pageId: "x" },
    });
    expect(target).toBe("");
    expect(targetArgs).toEqual({ pageId: "x" });
  });

  it("returns empty target string when tool is not a string", () => {
    const { target } = extractCallToolArgs({ tool: 42 });
    expect(target).toBe("");
  });

  it("returns empty args when arguments is null", () => {
    const { target, targetArgs } = extractCallToolArgs({ tool: "x", arguments: null });
    expect(target).toBe("x");
    expect(targetArgs).toEqual({});
  });

  it("returns empty args when arguments is an array (wrong type)", () => {
    const { targetArgs } = extractCallToolArgs({ tool: "x", arguments: [{ pageId: "x" }] });
    expect(targetArgs).toEqual({});
  });

  it("returns empty args when arguments is a plain string", () => {
    const { targetArgs } = extractCallToolArgs({ tool: "x", arguments: "pageId=x" });
    expect(targetArgs).toEqual({});
  });

  it("returns empty args when arguments is a number", () => {
    const { targetArgs } = extractCallToolArgs({ tool: "x", arguments: 42 });
    expect(targetArgs).toEqual({});
  });

  it("handles empty arguments object (no-arg tool call)", () => {
    const { target, targetArgs } = extractCallToolArgs({ tool: "x", arguments: {} });
    expect(target).toBe("x");
    expect(targetArgs).toEqual({});
  });
});
