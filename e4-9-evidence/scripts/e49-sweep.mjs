import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
// usage: e49-sweep.mjs <base> <label>
const [base, label] = process.argv.slice(2);
fs.mkdirSync(`/tmp/e49/${label}`, { recursive: true });
const init = fs.readFileSync("/workspace/scripts/e47-vv.js", "utf8");
const CLS = `(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); })();`;
const POPUP_OFF = fs.readFileSync("/workspace/scripts/e48-menu.mjs", "utf8").match(/const POPUP_OFF = `([^`]*)`/)[1];
const b = await launch();
const VPS = [[320, 568], [360, 740], [375, 667], [390, 844], [576, 768], [667, 375], [740, 360], [844, 390], [932, 430], [768, 1024], [1024, 768], [1440, 900]];
const PAGES = ["/create", "/create?kind=simulation", "/create?edit=693", "/world/create", "/lorebook/create", "/trpg/scenarios/new"];
const rows = [];
for (const [w, h] of VPS) {
  for (const path of PAGES) {
    const kbOpen = Math.round(h * (w > h ? 0.5 : 0.4));
    const { page, ctx } = await openPage(b, base, { path, user: "creatorA", width: w, height: h, wait: 700, until: "domcontentloaded", init: init + POPUP_OFF + CLS });
    const row = { vp: `${w}x${h}`, path };
    const state = () =>
      page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const rect = (e) => { const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height) }; };
        const bar = q('[data-testid="studio-save-bar"]');
        const tabs = q('[role="tablist"][aria-label="캐릭터·시뮬레이션 제작 탭"]');
        const btns = bar ? [...bar.querySelectorAll("button")].map((x) => rect(x).h) : [];
        const tabBtns = tabs ? [...tabs.querySelectorAll('[role="tab"]')].map((x) => rect(x).h) : [];
        return {
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          barPos: bar && getComputedStyle(bar).position,
          tabsPos: tabs && getComputedStyle(tabs).position,
          barH: bar && rect(bar).h,
          minBtn: btns.length ? Math.min(...btns) : null,
          minTab: tabBtns.length ? Math.min(...tabBtns) : null,
          spb: getComputedStyle(document.documentElement).scrollPaddingBottom,
          spt: getComputedStyle(document.documentElement).scrollPaddingTop,
        };
      });
    row.closed = await state();
    const c0 = await page.evaluate(() => window.__cls);
    await page.evaluate((k) => window.__setKeyboard(k), kbOpen);
    await page.waitForTimeout(350);
    row.open = await state();
    await page.evaluate(() => window.__setKeyboard(0));
    await page.waitForTimeout(350);
    row.reclosed = await state();
    row.clsToggle = Math.round(((await page.evaluate(() => window.__cls)) - c0) * 1000) / 1000;
    row.kbOpen = kbOpen;
    rows.push(row);
    await ctx.close();
  }
}
fs.writeFileSync(`/tmp/e49/${label}/sweep.json`, JSON.stringify(rows, null, 1));
const bad = rows.filter((r) => r.closed.overflow || r.open.overflow || r.reclosed.overflow);
console.log(label, "rows", rows.length, "overflow rows", bad.length, bad.map((r) => r.vp + r.path).slice(0, 6));
const diff = rows.filter((r) => JSON.stringify(r.closed) !== JSON.stringify(r.reclosed));
console.log("closed!=reclosed", diff.length, diff.map((r) => r.vp + r.path).slice(0, 6));
const flips = rows.filter((r) => r.open.barPos !== r.closed.barPos);
console.log("bar position flips on keyboard open:", [...new Set(flips.map((r) => r.vp))].join(" "));
console.log("max clsToggle", Math.max(...rows.map((r) => r.clsToggle)), "min touch (bar/tab)", Math.min(...rows.map((r) => r.closed.minBtn ?? 99)), Math.min(...rows.map((r) => r.closed.minTab ?? 99)));
await b.close();
