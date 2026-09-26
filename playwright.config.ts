import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PROD_TEST_PORT = process.env.PLAYWRIGHT_PROD_PORT ?? "3001";
const PROD_TEST_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PROD_TEST_PORT}`;
const PLAYWRIGHT_DATA_DIR =
  process.env.PLAYWRIGHT_DATA_DIR ?? path.join(os.tmpdir(), `habby-playwright-${process.pid}`);
const PLAYWRIGHT_DATA_DIR_RESET_OWNED = "PLAYWRIGHT_DATA_DIR_RESET_OWNED";

// The production web server and the Playwright worker must use one resolved
// data directory when an E2E fixture seeds canonical persisted history.
process.env.PLAYWRIGHT_DATA_DIR = PLAYWRIGHT_DATA_DIR;

if (!process.env.PLAYWRIGHT_SKIP_WEB_SERVER && process.env[PLAYWRIGHT_DATA_DIR_RESET_OWNED] !== "1") {
  fs.rmSync(PLAYWRIGHT_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(PLAYWRIGHT_DATA_DIR, { recursive: true });
  // Playwright can evaluate this config again after the web server has
  // bootstrapped. Child processes inherit this marker, so that evaluation
  // preserves the already-created canonical application database.
  process.env[PLAYWRIGHT_DATA_DIR_RESET_OWNED] = "1";
}

export default defineConfig({
  testDir: "./tests/ui",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: PROD_TEST_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEB_SERVER
    ? undefined
    : {
        command:
          "npm run prod",
        env: {
          SESSION_SECRET: "dev-test-session-secret-32chars-minimum",
          PLAYWRIGHT_PROD_SERVER: "1",
          DATA_DIR: PLAYWRIGHT_DATA_DIR,
          TRPG_SCROLL_FOLLOW_LAB_ENABLED: "1",
          PORT: PROD_TEST_PORT,
          NODE_ENV: "production",
          // Browser regression servers must never inherit developer/Cursor
          // provider credentials. Fresh-chat creation schedules greeting
          // Suggested Replies in the background, so a real key here would make
          // a supposedly provider-free UI test spend real GPT-6 Luna calls.
          REGULAR_TEST_REAL_PROVIDER_CALLS: "0",
          REAL_PROVIDER_SCHEMA_PROBE: "0",
          REAL_TRPG_GM_PROVIDER_PROBE: "0",
          CHEAPER_INFERENCE_API_KEY: "",
          CHEAPER_INFERENCE_BENCHMARK_API_KEY: "",
          OPENROUTER_API_KEY: "",
          OPENAI_API_KEY: "",
        },
        url: PROD_TEST_BASE_URL,
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
