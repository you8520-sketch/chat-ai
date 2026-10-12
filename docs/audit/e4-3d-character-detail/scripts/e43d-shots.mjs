import { chromium } from "playwright-core";
import fs from "fs";
const [, , BASE, TAG] = process.argv;
const fx = JSON.parse(fs.readFileSync("/tmp/e43d-fixtures.json", "utf8"));
const WIDTHS = (process.env.WIDTHS || "390,768,1440").split(",").map(Number);
const CHARS = (process.env.CHARS || "rich,long,noimg").split(",");
const USER = process.env.USER_KEY || "std";
const dir = `/opt/cursor/artifacts/e43d/${TAG}`;
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
for (const w of WIDTHS) {
  for (const k of CHARS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, locale: "ko-KR", hasTouch: w < 600, isMobile: w < 600, reducedMotion: "reduce" });
    if (USER !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[USER], url: BASE }]);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/character/${fx.ids[k]}`, { waitUntil: "load" });
    await p.waitForTimeout(1500);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: `${dir}/${k}-${w}-fold.png` });
    await p.addStyleTag({ content: 'nav[aria-label="모바일 메뉴"]{display:none!important}' });
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.screenshot({ path: `${dir}/${k}-${w}-full.png`, fullPage: true });
    await ctx.close();
  }
}
await browser.close();
