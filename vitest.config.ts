import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "e2e",
          include: ["test/e2e/**/*.test.ts"],
          environment: "node",
          // Each e2e test boots a real gateway + fake backends on free ports;
          // serial files keep port allocation and teardown sane.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
