const { chromium } = require("/workspace/node_modules/playwright");
const { installChunkGuard } = require("/tmp/ui/guard.cjs");
const fs = require("fs");
const seed = JSON.parse(fs.readFileSync("/tmp/ui/seed.txt", "utf8").replace(/^SEED_RESULT /, ""));
const phase = process.argv[2]; // before | after
const actions = process.argv[3] === "act";
const COOKIE = process.env.SESSION_COOKIE_NAME || "session";
const devices = {
  pc: { viewport: { width: 1280, height: 900 }, isMobile: false },
  mobile: { viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const scenarios = [
  { key: "host-valid", token: seed.hostToken, id: seed.validCampaignId },
  { key: "host-stale", token: seed.hostToken, id: seed.staleCampaignId },
  { key: "guest-valid", token: seed.guestToken, id: seed.validCampaignId },
  { key: "guest-stale", token: seed.guestToken, id: seed.staleCampaignId },
];
(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", args: ["--no-sandbox"] });
  for (const [dev, cfg] of Object.entries(devices)) {
    if (process.env.ONLY && process.env.ONLY !== dev) continue;
    for (const sc of scenarios) {
      const ctx = await browser.newContext({ ...cfg, baseURL: "http://localhost:3000" });
      await ctx.addCookies([{ name: COOKIE, value: sc.token, url: "http://localhost:3000" }]);
      const page = await ctx.newPage();
  await installChunkGuard(page);
      await page.goto(`/trpg/${sc.id}`, { waitUntil: "domcontentloaded" });
      await page.locator("body").waitFor();
      await page.waitForTimeout(4000);
      const section = page.getByText('목표 해결 확인', { exact: true }).locator('xpath=ancestor::section[1]');
      const count = await section.count();
      const buttons = count ? await section.locator("button").allInnerTexts() : [];
      console.log(JSON.stringify({ phase, dev, scenario: sc.key, cardCount: count, buttons, notice: count ? (await section.innerText()).replace(/\n/g, " | ") : null }));
      const tag = `${phase}-${sc.key}-${dev}`;
      if (dev === "pc") await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      else if (count) await section.first().evaluate((el, off) => { el.scrollIntoView({ block: "start" }); window.scrollBy(0, -off); }, Number(process.env.OFF) || 170);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `/tmp/ui/shots/${tag}.png`, fullPage: false });
      await ctx.close();
    }
  }
  await browser.close();
})();
