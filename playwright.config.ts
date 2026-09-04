import { defineConfig, devices } from "@playwright/test";

const PROD_TEST_PORT = process.env.PLAYWRIGHT_PROD_PORT ?? "3001";
const PROD_TEST_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PROD_TEST_PORT}`;

export default defineConfig({
  testDir: "./tests/ui",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
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
          `bash -c "test -f .next/BUILD_ID || npm run build; ` +
          `NODE_ENV=production PLAYWRIGHT_PROD_SERVER=1 DATA_DIR=data SESSION_SECRET=dev-test-session-secret-32chars-minimum ` +
          `TRPG_SCROLL_FOLLOW_LAB_ENABLED=1 PORT=${PROD_TEST_PORT} npm run start"`,
        url: PROD_TEST_BASE_URL,
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
