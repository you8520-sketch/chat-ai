import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
const [base, label, outRoot = "/tmp/e45-shots", pathArg = "/tab/ranking"] = process.argv.slice(2);
const dir = `${outRoot}/${label}`;
fs.mkdirSync(dir, { recursive: true });
const STATES = [
  ["guest", null, false],
  ["user", "safe", false],
  ["user-long", "safe", true],
];
const b = await launch();
const out = {};
for (const [name, user, long] of STATES) {
  for (const width of [360, 390, 575, 576]) {
    const { ctx, page } = await openPage(b, base, { path: pathArg, user, width, wait: 700 });
    if (long) {
      await page.evaluate(() => {
        const points = document.querySelector('header.site-header [aria-label^="보유 포인트"] span');
        if (points) points.textContent = "123,456,789P";
        const badge = document.querySelector('header.site-header button[aria-label^="알림"] span');
        if (badge) badge.textContent = "99+";
      });
    }
    const info = await page.evaluate(() => {
      const h = document.querySelector("header.site-header").getBoundingClientRect();
      const items = [...document.querySelector("header.site-header").children[0].querySelectorAll("a,button")].filter((e) => e.getBoundingClientRect().width > 0 && !e.closest("nav")).map((e) => ({ l: e.getAttribute("aria-label") || e.textContent.trim(), r: Math.round(e.getBoundingClientRect().right), left: Math.round(e.getBoundingClientRect().left), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }));
      const shop = !!document.querySelector('header.site-header a[aria-label="포인트 충전"]');
      return { h: Math.round(h.height), items, shop, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    out[`${name}-${width}`] = info;
    await page.screenshot({ path: `${dir}/hdr-${name}-${width}.png`, clip: { x: 0, y: 0, width, height: 130 } });
    await ctx.close();
  }
}
fs.writeFileSync(`${dir}/states.json`, JSON.stringify(out, null, 1));
console.log("done", label);
await b.close();
