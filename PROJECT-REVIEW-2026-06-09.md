# MCP Gateway — Project Review & Gap Analysis

**Date:** 2026-06-09 · **Reviewer:** Claude Opus 4.8 (multi-agent fan-out: architecture, fleet/safety, tests, ops) · **Repo:** `~/Projects/mcp-gateway` @ `master` (96d06f6)

---

## Working Thesis

This is a **well-architected, component-tested MCP proxy** whose two most important invariants — *"never stdio"* and *"gate write-class tool calls"* — are enforced only by **operator discipline and YAML comments, not by code**, and are **not proven by any end-to-end test**. The pure-logic layers (compression, ranking, classification, stale-session detection) are genuinely solid and well unit-tested. The wire layer (transport, sessions, call-time enforcement, fleet ingestion) is **entirely unverified by automation**, and `master` currently ships a live stdio backend that reproduces the exact fleet-outage failure mode documented in the operator's own rules.

The bottleneck is not features. It is **structural enforcement and integration proof of the core invariants.**

---

## 1. What This Project Is

A TypeScript MCP (Model Context Protocol) **gateway/proxy** that aggregates many backend MCP servers behind a single SSE/HTTP endpoint, so one AI client sees one connection instead of 18+.

**Stack:** Node 22 · Express 4 · `@modelcontextprotocol/sdk` 1.x · Zod · Pino · `node-vault` · YAML · chokidar. Test runner: Vitest (124 tests). Build: `tsc`.

**Surface area:** 13 source modules (~`src/`), 7 unit-test files, 7 backend capability manifests (`manifests/*.json`), a contract-audit script, a resilience harness, Dockerfile + compose.

### Core capabilities (as built)

| Capability | Where | State |
|---|---|---|
| Aggregate N backends behind one endpoint | `gateway.ts`, `backend.ts` | Working |
| Per-connection `McpServer` isolation (multi-client) | `gateway.ts:233` | Present (untested) |
| Transports: streamable-http (stateless default + stateful), legacy SSE, **stdio** | `backend.ts`, `config.ts` | All wired — **stdio should not be** |
| Tool namespacing (`<ns>_<tool>`) + 3 exposure modes (`mux`/`namespaced`/`both`) | `tool-registry.ts` | Working |
| 8 `gateway_*` meta-tools (search, describe, call, fetch_artifact, status, fleet_inventory, mcpu_config, reconnect) | `mux-tools.ts` | Working |
| Manifest safety overlay (READ/WRITE/SIDE_EFFECT/HUMAN_OUTBOUND/PRODUCTION/VAULT_VALUE) + call-time gate | `manifest.ts`, `gateway.ts:802` | **Partially enforced** |
| Stale-session detection (-32001 / message-gated -32000) + dedup reconnect | `gateway.ts:1448` | Working, well-tested |
| Token-set tool search/ranking | `gateway.ts:1176` | Working, tested |
| Reversible output compression (prune → columnar → minify) + artifact store | `gateway.ts:1000` | Working (off by default), **lossy edge cases** |
| Fleet ingestion from ToolHive / MCPU config | `fleet-*.ts` | Working — **ingests stdio** |
| Vault secret references (`vault:path#key`, `${ENV}`) | `config.ts` | Clean, no leaks |
| Hot config reload (chokidar) + health monitor | `gateway.ts:1735`, `:1990` | Present (untested, has bugs) |

### Tool-call data flow

```
Client ──HTTP──▶ /mcp (stateless: fresh McpServer per request)
                   │
                   ├─ gateway_* name? ─▶ handleMuxTool()
                   │                      └─ gateway_call_tool ─▶ decideGate(safety, confirmed, enforce)
                   │                                               ├ block  → return confirmationRequired (NO backend call)
                   │                                               ├ warn   → log, fall through
                   │                                               └ proceed→ callBackendTool()
                   │
                   └─ namespaced backend tool? ─▶ callBackendTool()  ◀── ⚠ NO SAFETY GATE HERE
                                                    └─ ToolRegistry.resolve → BackendInstance.callTool
                                                       └─ on stale(-3200x): ensureReconnected() + retry once
                                                          └─ compactBackendToolResult (cap + optional compress)
```

---

## 2. What Is Proven vs. Claimed

**Build:** clean (`tsc`, 0 errors). **Tests:** 124/124 pass in 1.67s.

| Claim | Status | Evidence |
|---|---|---|
| Compression is reversible | **Proven (unit)** + caveat | `compression.test.ts` (34 tests); but `pruneEmpty` is lossy for meaningful `null`/`""`/`[]` |
| Tool ranking works | **Proven (unit)** | `search-tools-ranking.test.ts` (20) |
| Safety classification is correct | **Proven (unit, isolated)** | `manifest-safety.test.ts` (25) — tests `decideGate()`/`classify()` alone |
| Stale-session detect + reconnect | **Proven (unit, fake backend)** | `gateway-stale-session.test.ts` (10) — fake backend via private-map injection |
| Manifest contract audit | **Proven** | `audit-contracts.test.ts` (7) against real manifests + bad fixtures |
| **Safety gate fires at call time** | **Implemented but UNPROVEN** | `handleMuxTool` gate wiring (`gateway.ts:802`) has zero test coverage |
| **A tool call round-trips over HTTP** | **UNPROVEN** | No e2e test starts the gateway + a backend; `test-client.mjs` is manual, not in CI |
| **Multi-client session isolation** | **UNPROVEN** | per-session `McpServer` map never exercised concurrently |
| **stdio is rejected** | **FALSE** | stdio is fully wired and connects; no rejection anywhere |
| **Config hot-reload / health monitor** | **UNPROVEN + buggy** | no tests; logic bugs found (see §3) |

**Overclaim risk:** The green 124-test suite covers *pure logic via private-map injection and a `TestableGateway` subclass that never calls `start()`*. The entire transport/session/enforcement wire is dark. A regression in how `handleMuxTool` reads `confirmed` or resolves `safety` would ship green.

---

## 3. The Real Bottleneck

> **Structural enforcement and end-to-end proof of two invariants — transport safety ("never stdio") and call-time safety gating — neither of which is wired closed nor tested.**

Everything else (resilience bugs, hygiene, Docker hardening) is downstream of this. The project has the *design* of a safety-first gateway but enforces its safety behaviorally. This maps one-to-one to the operator's own **Structural Determinism Mandate**: a rule enforced only by discipline regresses silently.

---

## 4. Issues Found (Consolidated, Cross-Verified)

### 🔴 Critical

**C1 — `master` ships a live stdio backend (reproduces the documented fleet outage).**
`config.fleet.yaml` @ master: `copilot-studio` → `transport: stdio, enabled: true`, with a foreign hardcoded path `/home/user/Scripts/...`. A clean clone + `npm run start:fleet` attempts the stdio connect that deadlocks the gateway. The fix (`enabled: false`) exists **only in the uncommitted working tree** and on the unmerged branch `fix/never-stdio-copilot-studio`.
*Verified:* `git show master:config.fleet.yaml` line 42 = `enabled: true`; working tree line 58 = `enabled: false`.
→ **Fix:** merge `fix/never-stdio-copilot-studio` to master now; remove the hardcoded path.

**C2 — "Never stdio" is not enforced anywhere in code.** *(3 of 4 agents independently confirmed)*
- `config.ts:6` — `StdioBackendSchema` is a fully valid union member; `loadConfig()` parses stdio with no warning.
- `backend.ts:101` — `connectStdio()` runs with no block, no advisory.
- `fleet-backend-ingestion.ts:115,190` — any MCPU config entry with a `command:` field is *inferred as stdio and connected*. `~/.config/mcpu/config.json` commonly has such entries.
→ **Fix:** reject `transport: "stdio"` (enabled) at `loadConfig()` AND skip stdio entries in fleet ingestion with a loud `logger.error`. Make it a startup-fatal for enabled stdio. This is the single highest-leverage structural change in the whole repo.

**C3 — Safety gate is bypassed for direct (non-mux) tool calls.**
When `tool_exposure` is `"namespaced"` or `"both"`, backend tools appear in `tools/list` and clients call them directly → `callBackendTool()` (`gateway.ts:254`), which has **zero gate logic**. HUMAN_OUTBOUND / PRODUCTION / VAULT_VALUE / WRITE all execute with no confirmation. The safety contract only holds when `tool_exposure: "mux"`.
→ **Fix:** enforce `decideGate()` inside `callBackendTool()` too, OR make config validation reject non-`mux` exposure when any gated backend is manifested.

**C4 — `node_modules/` (4,855 files) and `dist/` (48 files) are committed to git.**
`.gitignore` is 14 bytes; node_modules was force-added before it took effect. Working tree is **perpetually dirty** after any `npm install` (platform binaries differ per machine). Repo is bloated by hundreds of MB.
→ **Fix:** `git rm -r --cached node_modules dist && echo -e "dist/\n*.js.map" >> .gitignore`, commit.

### 🟠 High

**H1 — Default safety mode is `advisory`** (`config.ts:110`). Out of the box, write-class tools execute without confirmation; the gate only logs. A safety gateway that defaults to not-enforcing is a footgun. → Default to `"blocking"`, or startup-warn loudly when advisory + gated backends present.

**H2 — `write_guard` manifest field is decorative.** Parsed and surfaced but **read by no code in the call path** (e.g. `az-teams.json` `write_guard: "router_confirmation_maps_to_downstream"` does nothing). Implies protection that doesn't exist. → Enforce it, or remove it from the schema.

**H3 — Call-time gate enforcement is untested.** The one path that makes this a "safety" gateway (`handleMuxTool` → `decideGate` → block) has no test. → Add an integration test: WRITE tool + `confirmed:false` + blocking ⇒ `confirmationRequired`, no backend call.

**H4 — Health monitor ignores `restart_policy: "never"` and defeats `max_restarts`.** `gateway.ts:2000` calls `backend.restart()` for any down backend with no policy check; `backend.ts:322` `restart()` resets `_restartCount = 0`, so the cap is effectively infinite. A `"never"` backend is restarted every 30s. → Skip `never`; check the count before restarting; route through `ensureReconnected()`.

**H5 — Stale-retry surfaces the wrong error.** `gateway.ts:1416` — when the post-reconnect retry fails, the caller gets the *original* "session not found", not the real `retryErr`. → `const surfaced = retryErr ?? err`.

**H6 — No authentication on `/mcp` and `/sse`.** Any local process that can reach the port can call any backend tool (Teams send, ServiceNow writes, Vault reads). Admin API has loopback-only fallback; the MCP endpoints have nothing. `gateway_reconnect_backend` is also unauthenticated/unbounded (DoS via reconnect flooding). → Add a bearer-token check on MCP endpoints; cooldown on reconnect.

**H7 — No end-to-end / round-trip test exists.** The entire wire layer is dark. → One integration test that boots the gateway, connects an in-process http stub backend, and round-trips `gateway_call_tool` would retire most of the "unproven" column.

### 🟡 Medium

- **M1 — Health monitor + stale-retry can concurrently restart the same backend** → double `connectionGeneration` bump leaves it stuck in `error` (`gateway.ts:2000` vs `:1412`). Route both through `ensureReconnected()`.
- **M2 — `pruneEmpty` is lossy for semantically meaningful empties** (`{"assignee": null}` → `{}`). Compression can subtly corrupt ITSM/Vault/calendar payloads (`gateway.ts:109`). Limit to `undefined`, or gate per-backend.
- **M3 — Truncation artifact stores compressed/pruned text, not the original** (`gateway.ts:1516`); the lossless original is in a *different* artifact ID the model isn't told to use.
- **M4 — Manifest registry silently ignores backend-name mismatches** (fleet `ingest_namespace_prefix` can rename a backend so its manifest never matches → gated tools silently fall back to verb-pattern READ/WRITE). Warn at load time.
- **M5 — Schema default `host: "0.0.0.0"`** (`config.ts:71`) binds all interfaces if `host` is omitted; configs set `127.0.0.1` but the default is unsafe. → Default `127.0.0.1`.
- **M6 — Docker runs as root, no `HEALTHCHECK`, config baked into image.** Add a non-root `USER`, a `HEALTHCHECK` on `/admin/status`, and document `MCP_GATEWAY_CONFIG` for fleet mode.
- **M7 — No rate limiting** on any endpoint; each stateless `/mcp` call builds+tears down a full `McpServer`.
- **M8 — Artifact store: 100-entry cap, no TTL**; high-throughput sessions evict artifacts the model was told to fetch, with no warning at issue time.
- **M9 — Contract auditor only flags empty `write_guard`, not missing**; combined with H2 (no enforcement), the audit gives false assurance.
- **M10 — 9 open Dependabot PRs** superseded by local override commit `96d06f6` (npm audit = 0 vulns). Close/dismiss them; they obscure real signal.

### 🟢 Low

- L1 — Vestigial `esbuild`/`vite`/`uuid` overrides in `package.json` (not in dep tree).
- L2 — `manifest.ts` uses sync `readdirSync`/`readFileSync` in the constructor (blocks event loop at startup).
- L3 — `pino-pretty` is a prod dependency; should be dev-only / `NODE_ENV`-gated.
- L4 — Backend-filter search uses substring matching while query scoring uses token-set; `backend=X query=Y` can return zero matches inconsistently (`gateway.ts:1684` vs `:1194`).
- L5 — `mux-tools.ts:29` documents a silent arg-shape footgun (flat args → empty `targetArgs` → backend 404) with no runtime warning.
- L6 — `EventEmitter` leak warning in tests (Gateway constructor side effects accumulate; no `stop()` in teardown).
- L7 — `config.fleet.yaml` and 3 intentional READMEs (`README.md` / `.github.md` / `.stash.md`) are fine but the README config example shows a `mcpu_generated_config` key not set in the real config.
- L8 — `docker-compose.yml` keeps deprecated `version: "3.9"`.

---

## 5. Highest-Leverage Next Steps (ranked)

1. **Merge the stdio fix to master + make stdio structurally fatal** (C1+C2). One config merge + ~15 lines of validation in `config.ts` and `fleet-backend-ingestion.ts`. Closes the documented outage class permanently.
2. **Close the safety-gate holes** (C3 + H1 + H2): enforce the gate on the direct call path, default to blocking, and either enforce or delete `write_guard`. Turns the safety model from "designed" to "enforced."
3. **De-bloat git** (C4): one `git rm --cached`. Stops the perpetually-dirty tree and restores meaningful diffs.
4. **Add the first integration test** (H3 + H7): boot gateway + in-process http stub backend; prove (a) a tool call round-trips, (b) a WRITE without `confirmed` blocks in blocking mode, (c) a stdio config is *rejected*. Retires most of the "unproven" column in one file.
5. **Fix the resilience bugs** (H4, H5, M1): policy-aware health monitor, correct error surfacing, single reconnect path.
6. **Harden the edges** (H6, M2/M3, M5/M6): MCP-endpoint auth, lossless-safe compression default, safe bind default, non-root + healthcheck Docker.

---

## 6. What NOT To Do Yet

- Don't add new backends, tools, or compression algorithms — the bottleneck is enforcement/proof, not breadth.
- Don't build observability dashboards before there's an integration test producing real round-trip events.
- Don't refactor the (already-good) compression/ranking/classification logic.
- Don't rewrite history to purge node_modules until after a clean `git rm --cached` baseline commit is agreed — coordinate with the 5 local + Stash/GitHub branches in flight.

---

## 7. Branch / Ops State (context)

5 local branches (`master`, `ai223-stash-sync`, `feature/CSA-690-mcp-gateway-governance`, `fix/never-stdio-copilot-studio`, `stash-publish`); 9 open GitHub Dependabot PRs; Stash mirror with `CSA-987` / `AI-223` branches. `npm audit`: **0 vulnerabilities**. No plaintext secrets committed (`vault-data/` empty; configs use `vault:`/`${ENV}` refs). The `fix/never-stdio-copilot-studio` branch is the most urgent un-merged work.

---

*Generated by a 4-agent parallel review. Every finding above is cited to `file:line` in the agent transcripts; the three headline items (stdio not enforced, safety-gate holes, committed node_modules) were independently confirmed by multiple agents and re-verified directly against `master`.*
