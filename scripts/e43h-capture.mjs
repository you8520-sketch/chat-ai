import { chromium } from "playwright-core";
import fs from "fs";
const [,, BASE, TAG, user] = process.argv;
const fx = JSON.parse(fs.readFileSync("/tmp/e43h-fixtures.json", "utf8"));
fs.mkdirSync("/tmp/e43h-img", { recursive: true });
const b = await chromium.launch();
const res = {};
for (const w of [360, 390, 768, 1440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: w < 700 ? 800 : 900 }, locale: "ko-KR", hasTouch: w < 600, isMobile: w < 600 });
  await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + "/chats", { waitUntil: "load" }); await p.waitForTimeout(1500);
  const ok = p.getByRole("button", { name: "확인", exact: true }); if (await ok.count()) await ok.first().click().catch(() => {});
  res[w] = { overflowX: await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) };
  await p.screenshot({ path: `/tmp/e43h-img/${TAG}-${user}-chats-${w}.png` });
  const adult = p.locator(".chats-page-grid article", { hasText: "성인" }).first();
  await adult.locator("button", { hasText: "대화 선택" }).click();
  await p.waitForSelector('[role="dialog"]'); await p.waitForTimeout(500);
  await p.screenshot({ path: `/tmp/e43h-img/${TAG}-${user}-modal-${w}.png` });
  res[w].modalOverflowX = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  await ctx.close();
}
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 760 }, locale: "ko-KR" });
  await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + "/settings", { waitUntil: "load" }); await p.waitForTimeout(1500);
  await p.screenshot({ path: `/tmp/e43h-img/${TAG}-${user}-sidebar.png`, clip: { x: 0, y: 90, width: 300, height: 430 } });
  await ctx.close();
}
await b.close();
console.log(TAG, user, JSON.stringify(res));
