// Captures BEFORE/AFTER screenshots of the chat room download control with TEST-ONLY messages.
// BEFORE = same page with the new button removed from the DOM.
import { chromium } from "playwright";
import fs from "node:fs";

const seed = JSON.parse(fs.readFileSync(process.env.B37_SEED ?? "/tmp/b37/seed.json", "utf8"));
const base = process.env.B37_BASE ?? "http://localhost:3000";
const out = process.env.B37_SHOTS ?? "/opt/cursor/artifacts/screenshots";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome",
  args: ["--no-sandbox"],
});
const viewports = [
  { name: "desktop-1280", width: 1280, height: 800, mobile: false },
  { name: "mobile-390", width: 390, height: 844, mobile: true },
  { name: "mobile-320", width: 320, height: 640, mobile: true },
];
const results = [];
for (const vp of viewports) {
  for (const phase of ["before", "after"]) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      acceptDownloads: true,
    });
    await context.addCookies([
      { name: "session", value: seed.cookieA, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(`${base}/chat/${seed.characterId}?chat=${seed.chatId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    if (vp.mobile) {
      await page.waitForTimeout(6000);
      await page.getByRole("button", { name: "채팅 메뉴" }).first().click();
      await page.waitForTimeout(300);
    }
    const button = page.locator('[data-testid="chat-transcript-download"]:visible');
    await button.first().waitFor({ state: "visible", timeout: 120000 });
    const box = await button.first().boundingBox();
    const viewport = page.viewportSize();
    const fits = box && box.x >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
    if (phase === "before") {
      await page.evaluate(() => document.querySelectorAll('[data-testid="chat-transcript-download"]').forEach((n) => n.remove()));
    }
    await page.screenshot({ path: `${out}/b37-download-${vp.name}-${phase}.png` });
    results.push({ viewport: vp.name, phase, buttonBox: box, fitsInViewport: fits });

    if (phase === "after") {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 20000 }),
        button.first().click(),
      ]);
      const saved = `${out}/../b37-downloaded-${vp.name}.txt`;
      await download.saveAs(saved);
      results.push({ viewport: vp.name, downloadedFilename: download.suggestedFilename(), bytes: fs.statSync(saved).size });
      if (vp.name === "desktop-1280") {
        await context.route("**/api/chat/export**", (r) =>
          r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "서버 오류로 대화를 내려받지 못했습니다." }) })
        );
        await button.first().click();
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${out}/b37-download-desktop-1280-error-toast.png` });
      }
    }
    await context.close();
  }
}
await browser.close();
fs.writeFileSync(`${out}/../b37-ui-capture-results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 1));
