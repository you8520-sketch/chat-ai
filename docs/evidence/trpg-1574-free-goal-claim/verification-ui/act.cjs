const { chromium } = require("/workspace/node_modules/playwright");
const { installChunkGuard } = require("/tmp/ui/guard.cjs");
const fs = require("fs");
const seedFile = process.argv[3] || "/tmp/ui/seed.txt";
const seed = JSON.parse(fs.readFileSync(seedFile, "utf8").replace(/^SEED_RESULT /, ""));
const dev = process.argv[2];
const cfgs = {
  pc: { viewport: { width: 1280, height: 900 } },
  mobile: { viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
async function open(browser, token, id) {
  const ctx = await browser.newContext({ ...cfgs[dev], baseURL: "http://localhost:3000" });
  await ctx.addCookies([{ name: "session", value: token, url: "http://localhost:3000" }]);
  const page = await ctx.newPage();
  await installChunkGuard(page);
  await page.goto(`/trpg/${id}`, { waitUntil: "domcontentloaded" });
  await page.locator("textarea").first().waitFor({ timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(9000);
  return { ctx, page };
}

async function press(page, name) {
  const btn = page.getByRole("button", { name });
  if (dev === "mobile") await page.getByText("목표 해결 확인", { exact: true }).locator("xpath=ancestor::section[1]").first().evaluate((el, off) => { el.scrollIntoView({ block: "start" }); window.scrollBy(0, -off); }, 170);
  else await btn.scrollIntoViewIfNeeded();
  let posted = false;
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("goal-claim")) posted = true; });
  for (let i = 0; i < 6 && !posted; i++) {
    await btn.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
}
async function frame(page, name) {
  const sec = page.getByText("목표 해결 확인", { exact: true }).locator("xpath=ancestor::section[1]");
  if (dev === "pc") await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  else if (await sec.count()) await sec.first().evaluate((el, off) => { el.scrollIntoView({ block: "start" }); window.scrollBy(0, -off); }, 170);
  else await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight - 1100));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `/tmp/ui/shots/act-${name}-${dev}.png` });
}
(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", args: ["--no-sandbox"] });
  const cardGone = (page) => page.getByText("목표 해결 확인", { exact: true }).waitFor({ state: "detached", timeout: 15000 });
  // stale proposal: host clears it
  let { ctx, page } = await open(browser, seed.hostToken, seed.staleCampaignId);
  await press(page, "제안 정리");
  await cardGone(page);
  await frame(page, "stale-host-after-clear");
  console.log(dev, "stale: host card gone after 제안 정리");
  await ctx.close();
  ({ ctx, page } = await open(browser, seed.guestToken, seed.staleCampaignId));
  console.log(dev, "stale: guest card count", await page.getByText("목표 해결 확인", { exact: true }).count());
  await frame(page, "stale-guest-after-clear");
  await ctx.close();
  // valid proposal: host confirms
  ({ ctx, page } = await open(browser, seed.hostToken, seed.validCampaignId));
  await press(page, "해결 확인");
  await cardGone(page);
  await frame(page, "valid-host-after-confirm");
  console.log(dev, "valid: host card gone after 해결 확인");
  await ctx.close();
  ({ ctx, page } = await open(browser, seed.guestToken, seed.validCampaignId));
  console.log(dev, "valid: guest card count", await page.getByText("목표 해결 확인", { exact: true }).count());
  await frame(page, "valid-guest-after-confirm");
  await ctx.close();
  await browser.close();
})();
