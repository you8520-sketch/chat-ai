import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PROD_TEST_PORT = process.env.PLAYWRIGHT_PROD_PORT ?? "3001";
const PROD_TEST_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PROD_TEST_PORT}`;
const PLAYWRIGHT_DATA_DIR =
  process.env.PLAYWRIGHT_DATA_DIR ?? path.join(os.tmpdir(), `habby-playwright-${process.pid}`);

if (!process.env.PLAYWRIGHT_SKIP_WEB_SERVER) {
  fs.rmSync(PLAYWRIGHT_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(PLAYWRIGHT_DATA_DIR, { recursive: true });
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
          `bash -c "export SESSION_SECRET=dev-test-session-secret-32chars-minimum ` +
          `PLAYWRIGHT_PROD_SERVER=1 DATA_DIR=${PLAYWRIGHT_DATA_DIR} ` +
          `TRPG_SCROLL_FOLLOW_LAB_ENABLED=1 PORT=${PROD_TEST_PORT} && ` +
          `npm run build && NODE_ENV=production npm run start"`,
        url: PROD_TEST_BASE_URL,
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
