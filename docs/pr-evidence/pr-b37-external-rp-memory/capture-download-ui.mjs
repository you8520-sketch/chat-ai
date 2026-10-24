// Real chat-room screenshots for the download control. TEST messages only.
//
// B37_SHOT_KIND=head  (default) — this branch. The button must be visible. Does not edit the DOM.
// B37_SHOT_KIND=base — a build that does not contain the control (run against that server).
//   The button must be absent. This script does not delete nodes to fake a before shot.
//
// Earlier captures that removed [data-testid=chat-transcript-download] from the head DOM
// were simulated comparisons, not base-build screenshots. Do not present them as before.
import { chromium } from "playwright";
import fs from "node:fs";

const seed = JSON.parse(fs.readFileSync(process.env.B37_SEED ?? "/tmp/b37/seed.json", "utf8"));
const base = process.env.B37_BASE ?? "http://localhost:3000";
const out = process.env.B37_SHOTS ?? "/opt/cursor/artifacts/screenshots";
const kind = process.env.B37_SHOT_KIND === "base" ? "base" : "head";
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
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    acceptDownloads: true,
  });
  await context.addCookies([{ name: "session", value: seed.cookieA, url: base }]);
  const page = await context.newPage();
  await page.goto(`${base}/chat/${seed.characterId}?chat=${seed.chatId}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.getByPlaceholder("메시지 입력").first().waitFor({ state: "visible", timeout: 120000 });
  if (vp.mobile) {
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "채팅 메뉴" }).first().click();
    await page.waitForTimeout(400);
  }
  const button = page.locator('[data-testid="chat-transcript-download"]:visible');
  const count = await button.count();
  if (kind === "head" && count < 1) throw new Error(`head build has no download button at ${vp.name}`);
  if (kind === "base" && count !== 0) throw new Error(`base build still shows a download button at ${vp.name}`);
  const file = `${out}/b37-${kind}-build-${vp.name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  results.push({ kind, viewport: vp.name, buttonCount: count, file, bytes: fs.statSync(file).size });
  if (kind === "head" && vp.name === "desktop-1280") {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20000 }),
      button.first().click(),
    ]);
    const saved = `${out}/../b37-downloaded-${vp.name}.txt`;
    await download.saveAs(saved);
    results.push({
      viewport: vp.name,
      downloadedFilename: download.suggestedFilename(),
      bytes: fs.statSync(saved).size,
    });
  }
  await context.close();
}
await browser.close();
fs.writeFileSync(`${out}/../b37-ui-capture-${kind}.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 1));
