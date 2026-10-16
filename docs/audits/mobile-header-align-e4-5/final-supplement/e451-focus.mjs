import { launch, openPage } from "./e44-lib.mjs";
const [base, label] = process.argv.slice(2);
const browser = await launch();
for (const w of [360, 390, 575]) {
  for (const dir of ["Tab", "Shift+Tab"]) {
    const { ctx, page } = await openPage(browser, base, { path: "/tab/ranking", user: "safe", width: w, wait: 500 });
    const out = [];
    const info = () => page.evaluate(() => {
      const el = document.activeElement;
      const nav = el.closest('nav[aria-label="주요 메뉴"]');
      if (!nav) return null;
      const r = el.getBoundingClientRect(), n = nav.getBoundingClientRect();
      return { t: el.textContent.trim(), l: Math.round(r.left), r: Math.round(r.right), navL: Math.round(n.left), navR: Math.round(n.right), sl: Math.round(nav.scrollLeft), full: r.left >= n.left - 1 && r.right <= n.right + 1 };
    });
    if (dir === "Tab") { await page.evaluate(() => document.activeElement?.blur()); for (let i = 0; i < 16; i++) { await page.keyboard.press("Tab"); await page.waitForTimeout(120); const x = await info(); if (x) out.push(x); } }
    else { await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="주요 메뉴"]')].find(n => n.getBoundingClientRect().width).querySelector('a[href="/tab/following"]').focus()); for (let i = 0; i < 6; i++) { const x = await info(); if (x) out.push(x); await page.keyboard.press("Shift+Tab"); await page.waitForTimeout(120); } }
    console.log(`${label} w=${w} ${dir}`); for (const x of out) console.log(`   ${x.t.padEnd(8)} link ${x.l}-${x.r} nav ${x.navL}-${x.navR} scrollLeft=${x.sl} ${x.full ? "FULL" : "CLIPPED"}`);
    await ctx.close();
  }
}
await browser.close();
