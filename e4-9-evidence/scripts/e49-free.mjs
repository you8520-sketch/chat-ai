import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
// usage: e49-free.mjs <beforeBase> <afterBase>
const [bb, ab] = process.argv.slice(2);
const init = fs.readFileSync("/workspace/scripts/e47-vv.js", "utf8");
const VPS = [[320, 568, 230], [360, 740, 290], [375, 667, 270], [390, 844, 330], [576, 768, 300], [667, 375, 190], [740, 360, 180], [844, 390, 200], [932, 430, 215], [768, 1024, 330], [1024, 768, 0], [1440, 900, 0]];
const b = await launch();
const rows = [];
for (const [w, h, kb] of VPS) {
  const row = { vp: `${w}x${h}`, kb };
  for (const [tag, base] of [["before", bb], ["after", ab]]) {
    const { page, ctx } = await openPage(b, base, { path: "/create", user: "creatorA", width: w, height: h, wait: 700, until: "domcontentloaded", init });
    const measure = async (k) => {
      await page.evaluate((x) => window.__setKeyboard(x), k);
      await page.evaluate(() => window.scrollTo(0, 700));
      await page.waitForTimeout(300);
      return page.evaluate(() => {
        const rect = (el) => el.getBoundingClientRect();
        const fs = (el) => !!el && ["fixed", "sticky"].includes(getComputedStyle(el).position);
        const hdr = document.querySelector(".site-header");
        const tabs = document.querySelector('[role="tablist"][aria-label="캐릭터·시뮬레이션 제작 탭"]');
        const bar = document.querySelector('[data-testid="studio-save-bar"]');
        const nav = document.querySelector(".mobile-bottom-nav");
        const navOn = nav && getComputedStyle(nav).display !== "none";
        const hb = fs(hdr) ? rect(hdr).bottom : 0;
        const stuck = fs(tabs) && rect(tabs).top <= hb + 1;
        const top = Math.max(hb, stuck ? rect(tabs).bottom : 0);
        const vv = window.visualViewport.height;
        let bottom = vv;
        if (fs(bar)) bottom = Math.min(bottom, rect(bar).top);
        if (navOn) bottom = Math.min(bottom, rect(nav).top);
        return { vv, free: Math.round(bottom - top), pct: Math.round(((bottom - top) / vv) * 100) };
      });
    };
    row[tag] = { closed: await measure(0) };
    if (kb) row[tag].open = await measure(kb);
    await ctx.close();
  }
  rows.push(row);
  const f = (x) => (x ? `${x.free}px (${x.pct}%)` : "-");
  console.log(row.vp.padEnd(9), "kb", String(kb).padEnd(3), "| BEFORE closed", f(row.before.closed).padEnd(12), "open", f(row.before.open).padEnd(12), "| AFTER closed", f(row.after.closed).padEnd(12), "open", f(row.after.open));
}
fs.writeFileSync("/tmp/e49/free.json", JSON.stringify(rows, null, 1));
await b.close();
