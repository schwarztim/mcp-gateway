import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { Gateway } from "./gateway.js";
const configPath = resolve(process.env.MCP_GATEWAY_CONFIG ?? "config.yaml");
async function main() {
    const config = loadConfig(configPath);
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
//# sourceMappingURL=index.js.map