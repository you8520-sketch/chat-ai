import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
const [base, label, pathArg] = process.argv.slice(2);
const path = pathArg || "/create";
const init = fs.readFileSync("/workspace/scripts/e47-vv.js", "utf8");
const POPUP_OFF = fs.readFileSync("/workspace/scripts/e48-menu.mjs", "utf8").match(/const POPUP_OFF = `([^`]*)`/)[1];
fs.mkdirSync(`/tmp/e49/${label}`, { recursive: true });
const b = await launch();
const out = [];
const VPS = process.env.VPS ? JSON.parse(process.env.VPS) : [[667, 375], [740, 360], [844, 390], [932, 430], [576, 768], [768, 1024], [1024, 768], [375, 667], [390, 844]];
for (const [w, h] of VPS) {
  for (const kb of process.env.KBS ? JSON.parse(process.env.KBS) : [0]) {
    const { page, ctx } = await openPage(b, base, { path, user: "creatorA", width: w, height: h, wait: 900, until: "domcontentloaded", init: init + POPUP_OFF });
    await page.evaluate((k) => window.__setKeyboard(k), kb);
    await page.waitForTimeout(250);
    for (const sy of [0, 700]) {
      await page.evaluate((y) => window.scrollTo(0, y), sy);
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const px = (v) => Math.round(v * 10) / 10;
        const rr = (el) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return { t: px(b.top), b: px(b.bottom), h: px(b.height), pos: cs.position };
        };
        const nav = document.querySelector(".mobile-bottom-nav");
        const navOn = nav && getComputedStyle(nav).display !== "none";
        const hdr = rr(document.querySelector(".site-header"));
        const tabs = rr(document.querySelector('[role="tablist"]'));
        const bar = rr(document.querySelector('[data-testid="studio-save-bar"]'));
        const navR = navOn ? rr(nav) : null;
        const vh = innerHeight;
        const vv = window.visualViewport.height;
        const topCover = Math.max(hdr && hdr.pos !== "static" && hdr.pos !== "relative" ? hdr.b : 0, tabs && tabs.t <= (hdr?.b ?? 0) + 1 ? tabs.b : 0);
        const botCover = Math.min(bar ? bar.t : vv, navR ? navR.t : vv, vv);
        return { vh, vv, hdr, tabs, bar, nav: navR && navR.h, editable: px(botCover - topCover), scrollY: Math.round(scrollY), sp: [getComputedStyle(document.documentElement).scrollPaddingTop, getComputedStyle(document.documentElement).scrollPaddingBottom] };
      });
      out.push({ vp: `${w}x${h}`, kb, sy, ...r });
      console.log(`${w}x${h} kb=${kb} sy=${sy}`, JSON.stringify({ hdr: r.hdr && [r.hdr.pos, r.hdr.h, r.hdr.t], tabs: r.tabs && [r.tabs.pos, r.tabs.h, r.tabs.t], bar: r.bar && [r.bar.h, r.bar.t], nav: r.nav, editable: r.editable, pct: Math.round((r.editable / (r.vv)) * 100) }));
      if (sy === 700) await page.screenshot({ path: `/tmp/e49/${label}/land-${w}x${h}-kb${kb}.png` });
    }
    await ctx.close();
  }
}
fs.writeFileSync(`/tmp/e49/${label}/land.json`, JSON.stringify(out, null, 1));
await b.close();
