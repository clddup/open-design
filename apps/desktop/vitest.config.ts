import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { desktopSourceAliases } from "./build/source-paths.ts";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: desktopSourceAliases },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/renderer/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // Happy DOM interaction suites are CPU-heavy and retain a strict 5s
    // per-test timeout. Run one file worker so macOS and Windows CI do not
    // turn scheduler contention into cascading interaction-test failures.
    maxWorkers: 1,
  },
});
