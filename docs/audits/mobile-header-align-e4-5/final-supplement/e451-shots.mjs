import { launch, openPage } from "./e44-lib.mjs";
const [base, label] = process.argv.slice(2);
const browser = await launch();
for (const w of [360, 390]) {
  const { ctx, page } = await openPage(browser, base, { path: "/tab/ranking", user: "safe", width: w, wait: 600, reduced: "reduce" });
  await page.evaluate(() => {
    const p = document.querySelector('header.site-header [aria-label^="보유 포인트"] span'); p.textContent = "123,456,789P";
    const b = document.querySelector('header.site-header button[aria-label^="알림"] span'); if (b) b.textContent = "99+";
  });
  await page.screenshot({ path: `/opt/cursor/artifacts/e451/${label}-header-${w}-payments-on-123456789P.png`, clip: { x: 0, y: 0, width: w, height: 104 } });
  if (w === 360) {
    await page.evaluate(() => document.activeElement?.blur());
    for (let i = 0; i < 16; i++) { await page.keyboard.press("Tab"); await page.waitForTimeout(100); const t = await page.evaluate(() => document.activeElement.textContent.trim()); if (t === "북마크/팔로잉") break; }
    await page.waitForTimeout(250);
    await page.screenshot({ path: `/opt/cursor/artifacts/e451/${label}-focus-last-tab-360.png`, clip: { x: 0, y: 0, width: 360, height: 104 } });
  }
  await ctx.close();
}
await browser.close();
