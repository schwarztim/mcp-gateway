import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { Gateway } from "./gateway.js";

const configPath = resolve(process.env.MCP_GATEWAY_CONFIG ?? "config.yaml");

// Fleet-control-plane resilience: a single stray error (a backend transport
// hiccup, a downstream restart, a library 'error' event) must NOT crash the
// gateway and take all backends down with it. Log to stderr directly — NOT via
// the pino logger, so a fault in logging itself can never recurse — and keep
// running. Installed before anything else so it also covers startup.
process.on("uncaughtException", (err) => {
  try {
    process.stderr.write(
      `[gateway] uncaughtException (continuing): ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
  } catch {
    /* stderr write failed — nothing safe left to do */
  }
});
process.on("unhandledRejection", (reason) => {
  try {
    process.stderr.write(`[gateway] unhandledRejection (continuing): ${String(reason)}\n`);
  } catch {
    /* ignore */
  }
});

async function main() {
  const config = await loadConfig(configPath);
  const logger = createLogger(config.gateway.log_level);

  logger.info(`Loading config from ${configPath}`);

  const gateway = new Gateway(config, configPath, logger);

  // Graceful shutdown
  const shutdown = async () => {
    await gateway.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await gateway.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
