import fs from "fs";
import { chromium } from "playwright-core";
import { fx } from "./e44-lib.mjs";
const [base, label, outRoot = "/tmp/e44-shots"] = process.argv.slice(2);
const b = await chromium.launch();
const pages = process.env.CLS_PAGES ? JSON.parse(process.env.CLS_PAGES) : [["home", "/", null], ["new", "/tab/new", null], ["ranking", "/tab/ranking", null], ["search", "/search?q=%EC%83%88%EB%B2%BD", null], ["creator", `/creator/${fx.users.creatorA}`, null], ["points", "/points", "safe"], ["studio", "/studio", "creatorA"], ["chats", "/chats", "safe"], ["settings", "/settings", "safe"]];
const out = {};
for (const [name, path, user] of pages) {
  for (const width of (process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : [390, 1440])) {
    const ctx = await b.newContext({ viewport: { width, height: width < 576 ? 844 : 900 }, isMobile: width < 576, hasTouch: width < 576, deviceScaleFactor: 1, locale: "ko-KR" });
    if (user) await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: base }]);
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__cls = 0; window.__shifts = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), src: (e.sources || []).slice(0, 2).map((s) => (s.node?.nodeName || "") + "." + String(s.node?.className || "").slice(0, 30)) }); } }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => ({ cls: +window.__cls.toFixed(4), shifts: window.__shifts.slice(0, 4) }));
    out[`${name}-${width}`] = r;
    console.log(name, width, r.cls, JSON.stringify(r.shifts.slice(0, 2)));
    await ctx.close();
  }
}
fs.writeFileSync(`${outRoot}/${label}/cls.json`, JSON.stringify(out, null, 1));
await b.close();
