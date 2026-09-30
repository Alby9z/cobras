import { defineConfig } from "vitest/config";
import path from "node:path";

/** Tests d'intégration : PostgreSQL réel (DATABASE_URL_TEST), Stripe / stockage / e-mail / file remplacés par des doubles. */
export default defineConfig({
  test: {
    include: ["tests/integration/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "tests/stubs/empty.ts") } },
});
