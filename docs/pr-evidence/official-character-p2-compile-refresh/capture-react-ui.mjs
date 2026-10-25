import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright";

const BASE = process.env.P2_UI_BASE ?? "http://localhost:3000";
const dirs = ["/opt/cursor/artifacts", path.join(process.cwd(), "docs/pr-evidence/official-character-p2-compile-refresh/ui")];

async function login(context) {
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { email: "p2-ui-admin@test.local", password: "p2-ui-demo-pass" },
  });
  if (!res.ok()) throw new Error(`login ${res.status()}`);
}

async function save(page, name) {
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, name), fullPage: true });
  }
}

async function openAdmin(page) {
  await page.goto(`${BASE}/admin/official-characters`, { waitUntil: "load" });
  await page.waitForSelector("text=볼프강", { timeout: 45000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await login(desktop);
  const dPage = await desktop.newPage();
  await openAdmin(dPage);
  await dPage.locator("text=저장 원고 유지").first().scrollIntoViewIfNeeded();
  await save(dPage, "p2-react-desktop-01-buttons.png");
  await dPage.locator("article").filter({ hasText: "볼프강" }).getByRole("button", { name: "컴파일 미리보기" }).click();
  await dPage.waitForSelector("text=컴파일 미리보기 · #51", { timeout: 15000 });
  await dPage.locator("summary", { hasText: "공개 설정" }).click();
  await save(dPage, "p2-react-desktop-02-compile-preview.png");
  await desktop.close();

  const mobile = await browser.newContext({ ...devices["iPhone 13"] });
  await login(mobile);
  const mPage = await mobile.newPage();
  await mPage.goto(`${BASE}/admin/official-characters`, { waitUntil: "load" });
  await mPage.waitForSelector("text=#51", { timeout: 45000 });
  await mPage.locator("article").filter({ hasText: "#51" }).scrollIntoViewIfNeeded();
  await save(mPage, "p2-react-mobile-01-buttons.png");
  await mPage.locator("article").filter({ hasText: "#51" }).getByRole("button", { name: "컴파일 미리보기" }).click();
  await mPage.waitForSelector("text=컴파일 미리보기 · #51", { timeout: 15000 });
  await save(mPage, "p2-react-mobile-02-compile-preview.png");
  await mobile.close();

  await browser.close();
  console.log("react ui screenshots saved");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
