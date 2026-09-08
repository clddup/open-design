import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    maxWorkers: process.env.CI ? undefined : 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
