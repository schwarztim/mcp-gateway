import pino from "pino";
export function createLogger(level = "info") {
    return pino({
        level,
        transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
    });
}
//# sourceMappingURL=logger.js.map