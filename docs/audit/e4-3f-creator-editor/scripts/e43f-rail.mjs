import { launch, openCreate, draftSnapshot } from "./e43f-lib.mjs";
const BASE = process.env.BASE, OUT = process.env.OUT;
const b = await launch();
const out = {};
for (const [w, h] of [[1024, 800], [1280, 720], [1440, 900]]) {
  const { ctx, page } = await openCreate(b, BASE, { width: w, height: h, draft: draftSnapshot() });
  for (const y of [0, 900]) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(400);
    out[`${w}x${h}@${y}`] = await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="creator-guide-rail"] > div');
      const bar = document.querySelector('[data-testid="studio-save-bar"]');
      if (!rail) return null;
      const r = rail.getBoundingClientRect(), bb = bar.getBoundingClientRect();
      return { railTop: Math.round(r.top), railBottom: Math.round(r.bottom), barTop: Math.round(bb.top), overlapsBar: r.bottom > bb.top + 1, scrollH: rail.scrollHeight, clientH: rail.clientHeight };
    });
    await page.screenshot({ path: `${OUT}/rail-${w}x${h}-y${y}-viewport.png` });
  }
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
await b.close();
