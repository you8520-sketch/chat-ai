import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openExplicitFreshChat } from "./helpers/openExplicitChat";

test.use({
  launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {},
});

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "docs/evidence/deepseek-retire-user-select"
);

function openFixtureDb() {
  const dataDir = process.env.PLAYWRIGHT_DATA_DIR;
  if (!dataDir) throw new Error("PLAYWRIGHT_DATA_DIR must be resolved by playwright.config.ts");
  const db = new Database(path.resolve(dataDir, "app.db"));
  db.pragma("busy_timeout = 5000");
  return db;
}

function setDemoSelectedAi(selectedAi: string) {
  const db = openFixtureDb();
  try {
    db.prepare("UPDATE users SET selected_ai=? WHERE email=?").run(
      selectedAi,
      "demo@playai.local"
    );
  } finally {
    db.close();
  }
}

async function demoLogin(page: Page) {
  const response = await page.request.post("/api/auth/demo-login");
  expect(response.ok()).toBeTruthy();
}

async function openPickerChat(page: Page): Promise<number> {
  await page.goto("/health", { waitUntil: "domcontentloaded" });
  await demoLogin(page);
  return openExplicitFreshChat(page, 2);
}

async function captureDock(page: Page, filename: string) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const dock = page.locator("select").first();
  await expect(dock).toBeVisible();
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, filename),
    fullPage: false,
  });
}

test.describe("Main RP model picker after DeepSeek retirement", () => {
  test("unselected user sees four options and cannot send", async ({ page }) => {
    await openPickerChat(page);
    setDemoSelectedAi("");
    await page.reload({ waitUntil: "domcontentloaded" });

    const select = page.locator("select").first();
    await expect(select).toHaveValue("");
    const estimates = page.waitForResponse(
      (res) => res.url().includes("/api/chat/next-turn-estimates") && res.ok(),
      { timeout: 15_000 }
    ).catch(() => null);
    await select.focus();
    await estimates;
    await expect
      .poll(async () => (await select.locator("option").allTextContents()).some((label) => label.includes("약")))
      .toBeTruthy();
    const labels = await select.locator("option").allTextContents();
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "actual-picker-options.txt"),
      labels.map((label) => label.trim()).join("\n") + "\n"
    );
    expect(labels.some((label) => label.includes("채팅에 사용할 AI 모델을 선택해 주세요."))).toBeTruthy();
    expect(labels.some((label) => label.includes("DeepSeek"))).toBeFalsy();
    expect(labels.some((label) => label.includes("Gemini 3.8 Flash"))).toBeTruthy();
    expect(labels.some((label) => label.includes("GPT-6.1 Sol"))).toBeTruthy();
    expect(labels.some((label) => label.includes("Claude Opus 5.5"))).toBeTruthy();
    expect(labels.some((label) => label.includes("Gemini 4 Argon"))).toBeTruthy();
    await expect(page.getByRole("button", { name: "전송" })).toHaveAttribute(
      "data-chat-send-state",
      "need-model"
    );
    await expect(page.getByRole("button", { name: /자동진행/ })).toBeDisabled();
    await captureDock(page, "actual-unselected-desktop.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await captureDock(page, "actual-unselected-mobile.png");
  });

  test("stored DeepSeek asks for a new choice and does not auto-remap", async ({ page }) => {
    await openPickerChat(page);
    setDemoSelectedAi("deepseek-v4.1-flash");
    await page.reload({ waitUntil: "domcontentloaded" });

    const select = page.locator("select").first();
    await expect(select).toHaveValue("");
    const stored = openFixtureDb();
    try {
      const row = stored
        .prepare("SELECT selected_ai FROM users WHERE email=?")
        .get("demo@playai.local") as { selected_ai: string };
      expect(row.selected_ai).toBe("deepseek-v4.1-flash");
    } finally {
      stored.close();
    }
    await expect(page.getByRole("button", { name: "전송" })).toHaveAttribute(
      "data-chat-send-state",
      "need-model"
    );
    await captureDock(page, "actual-deepseek-reselect-desktop.png");
  });

  test("explicit Gemini selection persists after reload", async ({ page }) => {
    await openPickerChat(page);
    const select = page.locator("select").first();
    const save = page.waitForResponse(
      (res) =>
        res.url().includes("/api/user/selected-ai") &&
        res.request().method() === "PATCH" &&
        res.ok()
    );
    await select.selectOption("gemini-3.8-flash");
    await save;
    await expect(select).toHaveValue("gemini-3.8-flash");
    await expect(page.getByRole("button", { name: "전송" })).toHaveAttribute(
      "data-chat-send-state",
      "empty"
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("select").first()).toHaveValue("gemini-3.8-flash");
    await expect(page.getByRole("button", { name: "전송" })).toHaveAttribute(
      "data-chat-send-state",
      "empty"
    );
    await captureDock(page, "actual-gemini-selected-desktop.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await captureDock(page, "actual-gemini-selected-mobile.png");
  });
});
