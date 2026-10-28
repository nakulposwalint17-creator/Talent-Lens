import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "e2e/**", ".next/**", ".next-e2e/**"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["lib/**", "features/auth/**", "features/shortlist/filters.ts", "features/job-setup/schema.ts",
        "components/layout/auth.tsx"],
      exclude: ["**/*.test.*"],
      reporter: ["text", "text-summary"],
      thresholds: { lines: 85, branches: 80 },
    },
  },
});
