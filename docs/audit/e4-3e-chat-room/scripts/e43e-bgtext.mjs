import { launch, openChat } from "./e43e-lib.mjs";
const [, , BASE, TAG] = process.argv;
const b = await launch();
for (const op of [0.22, 0.5, 0.8, 1]) {
  const { page, ctx } = await openChat(b, BASE, { width: 390, scenario: "c3200", prefs: { portraitBackgroundOpacity: op } });
  await page.evaluate(() => { const a=[...document.querySelectorAll('article[id^="msg-"]')].pop(); window.scrollTo(0, window.scrollY + a.getBoundingClientRect().top + 400); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/opt/cursor/artifacts/e43e/${TAG}/bg-text-390-${op}.png` });
  await ctx.close();
}
await b.close();
