import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a real Supabase project (see tests/integration
 * and AI.md). They need the app's env plus RUN_INTEGRATION=1 and E2E_BUSINESS_ID.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/integration/**/*.int.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The suites share one E2E business (plan, settings), so they must not run concurrently.
    fileParallelism: false,
  },
});
