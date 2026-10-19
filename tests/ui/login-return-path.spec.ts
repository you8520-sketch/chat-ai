import { expect, test, type Page } from "@playwright/test";

const DEMO_EMAIL = "demo@playai.local";
const DEMO_PASSWORD = "demo1234";

async function expectLoginGate(page: Page, fromPath: string, redirectTarget: string) {
  await page.goto(fromPath);
  await expect(page).toHaveURL(`/login?redirect=${redirectTarget}`);
}

async function passwordLogin(page: Page, email: string, password: string) {
  await page.getByPlaceholder("이메일").fill(email);
  await page.getByPlaceholder("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}

test.describe("login return path", () => {
  test.beforeEach(async ({ page }) => {
    await page.request.post("/api/auth/demo-login");
    await page.context().clearCookies();
  });
  test("logged-out /points returns to /points after password login", async ({ page }) => {
    await expectLoginGate(page, "/points", "/points");
    await passwordLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/points$/);
    await expect(page.getByText("보유 포인트")).toBeVisible();
  });

  test("logged-out /settings returns to /settings after password login", async ({ page }) => {
    await expectLoginGate(page, "/settings", "/settings");
    await passwordLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: "내 정보 · 설정" })).toBeVisible();
  });

  test("wrong password keeps redirect query for retry", async ({ page }) => {
    await page.goto("/points");
    await expect(page).toHaveURL("/login?redirect=/points");
    await passwordLogin(page, DEMO_EMAIL, "wrong-password");
    await expect(page.getByText("이메일 또는 비밀번호가 올바르지 않습니다.")).toBeVisible();
    await expect(page).toHaveURL("/login?redirect=/points");
    await page.getByPlaceholder("비밀번호").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/points$/);
  });

  test("logged-out /chats still returns to /chats", async ({ page }) => {
    await expectLoginGate(page, "/chats", "/chats");
    await passwordLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/chats$/);
  });

  test("external and bypass redirect targets fall back to home", async ({ page }) => {
    await page.goto("/login?redirect=https://evil.example/phish");
    await passwordLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/login?redirect=//evil.example/phish");
    await passwordLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/login?redirect=/\\evil.example/phish");
    await passwordLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
  });

  test("Google start link preserves sanitized redirect without leaving the app", async ({ page }) => {
    await page.goto("/login?redirect=/settings");
    const googleHref = await page.getByRole("link", { name: "Google로 계속하기" }).getAttribute("href");
    expect(googleHref).toContain("redirect=%2Fsettings");
    expect(googleHref).toMatch(/^\/api\/auth\/google\?/);
  });

  test("evidence: login gate and return at 390 and 1280", async ({ page }, testInfo) => {
    for (const viewport of [
      { width: 390, height: 844, tag: "390" },
      { width: 1280, height: 800, tag: "1280" },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/points");
      await page.screenshot({
        path: testInfo.outputPath(`after-points-login-gate-${viewport.tag}.png`),
        fullPage: true,
      });
      await passwordLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
      await expect(page).toHaveURL(/\/points$/);
      await page.screenshot({
        path: testInfo.outputPath(`after-points-landed-${viewport.tag}.png`),
        fullPage: true,
      });
      await page.context().clearCookies();
      await page.request.post("/api/auth/demo-login");
      await page.context().clearCookies();
      await page.goto("/settings");
      await page.screenshot({
        path: testInfo.outputPath(`after-settings-login-gate-${viewport.tag}.png`),
        fullPage: true,
      });
      await passwordLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
      await expect(page).toHaveURL(/\/settings$/);
      await page.screenshot({
        path: testInfo.outputPath(`after-settings-landed-${viewport.tag}.png`),
        fullPage: true,
      });
      await page.context().clearCookies();
      await page.request.post("/api/auth/demo-login");
      await page.context().clearCookies();
    }
  });
});
