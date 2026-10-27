import path from "node:path";

import { defineConfig } from "@playwright/test";

// The E2E run starts its own backend (port 8100, throwaway database) and
// frontend (port 3100), so it never touches your local data.
const DATA_DIR = path.resolve(__dirname, "e2e/.artifacts", `data-${Date.now()}`);
const BACKEND = "http://127.0.0.1:8100";
const FRONTEND = "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: FRONTEND,
    // Uses the locally installed Google Chrome by default; set PLAYWRIGHT_CHANNEL=""
    // after `npx playwright install chromium` to use the bundled browser instead.
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  outputDir: "e2e/.artifacts/results",
  webServer: [
    {
      command: "../backend/.venv/bin/uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 8100",
      url: `${BACKEND}/api/health`,
      env: { DATA_DIR, AI_PROVIDER: "demo", CORS_ORIGINS: FRONTEND },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npx next dev --port 3100",
      url: FRONTEND,
      env: { NEXT_PUBLIC_API_BASE_URL: BACKEND },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
