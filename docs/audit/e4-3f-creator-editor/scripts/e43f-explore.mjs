import { launch, openCreate, measure, draftSnapshot } from "./e43f-lib.mjs";
const BASE = process.env.BASE; const OUT = process.env.OUT;
const b = await launch();
for (const w of [390, 1440]) {
  const { ctx, page } = await openCreate(b, BASE, { width: w });
  await page.screenshot({ path: `${OUT}/new-empty-${w}-full.png`, fullPage: true });
  const m = await measure(page);
  console.log(w, JSON.stringify({ docH: m.docH, hOverflow: m.hOverflow, saveBar: m.saveBar, nav: m.mobileNav, barOverlapsNav: m.barOverlapsNav, small: m.smallTargetCount, panelHeights: m.panelHeights }));
  const btn = await page.evaluate(() => { const b = document.querySelector('[data-testid="studio-save-bar"] button[type=submit], [data-testid="studio-save-bar"] button'); return [...document.querySelectorAll('[data-testid="studio-save-bar"] button')].map(x => [x.textContent.trim(), x.disabled]); });
  console.log(JSON.stringify(btn));
  await ctx.close();
}
await b.close();
