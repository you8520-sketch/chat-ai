import { launch, openChat, scrollBottom } from "./e43e-lib.mjs";
const [, , BASE, TAG] = process.argv;
const b = await launch();
for (const w of [390, 1440]) {
  const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "c3200" });
  await scrollBottom(page);
  await page.evaluate(() => { const a=[...document.querySelectorAll('article[id^="msg-"]')].pop(); const r=a.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top + Math.min(r.height*0.35,900) - 80); });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `/opt/cursor/artifacts/e43e/hue/${TAG}-hue18-${w}.png` });
  await ctx.close();
}
await b.close();
