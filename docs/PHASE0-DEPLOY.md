# Phase-0 Deploy Note

Operator notes for deploying the Phase-0 invariants (transport constitution + safety gate hardening) to the live gateway.

## What changed

- **stdio is gone from the config schema.** Only `http` (streamable-http) and `sse` are representable backend transports. `transport: stdio` entries are stripped at load with a console error (reason `stdio-unsupported`, remedy: re-front behind streamable-http) and the gateway boots on without them. Fleet ingestion quarantines `command:`-style MCPU entries into a `quarantined[]` list surfaced by `gateway_backend_status` instead of connecting them.
- **Safety gate is blocking by default and fires on every path.** `safety.enforce` now defaults to `"blocking"` (was advisory) and gates both `gateway_call_tool` and direct namespaced tool calls. A blocking deny returns `{ confirmationRequired: true, tool, safetyClass, source, reason, redactedArguments }`; direct-path denials add `remedy: "invoke via gateway_call_tool with confirmed:true"`.
- **Graduated classification.** Manifested tools use their manifest class. Unmanifested tools with a write-class verb in the name (verb list extended: purge, execute, run, trigger, invoke, revoke, approve, merge, deploy, restart, kill, terminate, publish, assign, transition, resolve, close, escalate) are WRITE and gated. Unmanifested verb-less tools are UNCLASSIFIED: calls proceed with a warning plus telemetry, and boot logs a per-backend unclassified-tools report.
- **Decision log (seed).** New config block `safety.decision_log: { enabled: false, path: "~/.mcp-gateway/decisions.jsonl" }`. When enabled, one JSONL line per dispatch decision `{ ts, path, tool, backend, safetyClass, source, decision, enforce }`. Fail-open on write errors; the durable recorder comes in a later phase.

## Deploy steps

1. Merge `phase0-invariants` → `master`.
2. `npm run build`
3. Restart the live `:3100` gateway process. The running binary picks up nothing until restart.

## Behavior changes on restart

- Write-class calls without `confirmed: true` now return `confirmationRequired` instead of executing. qbot/Karen callers must pass `confirmed: true` for intended writes.
- The disabled `copilot-studio` stdio entry is stripped at config load and logged instead of parsed.
- The UNCLASSIFIED boot report appears in the logs. Use it to draft manifests for the ~11 backends that lack them — completing manifest coverage is the path to flipping UNCLASSIFIED from warn to block in a later phase.

## Rollback

Restart the gateway process on `master` (pre-merge state). No data migration is involved.

## Superseded work

Branch `fix/never-stdio-copilot-studio` is superseded by the Phase-0 transport constitution and can be deleted.
