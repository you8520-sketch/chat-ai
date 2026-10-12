import { chromium } from "playwright-core";
import fs from "fs";
const [, , BASE, TAG, ...specs] = process.argv;
const fx = JSON.parse(fs.readFileSync("/tmp/e43c-fixtures.json", "utf8"));
const OUT = process.env.OUT ?? "/tmp/e43c-out";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
// spec: name:width:height:user:mode  mode = fold | full
for (const s of specs) {
  const [name, w, h, user, mode] = s.split(":");
  const W = +w, H = +h;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: "ko-KR", hasTouch: W < 600, isMobile: W < 600, deviceScaleFactor: W < 600 ? 2 : 1 });
  if (user !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "load" });
  await p.waitForTimeout(1000);
  const ok = p.getByRole("button", { name: "확인", exact: true });
  if (await ok.count()) await ok.first().click().catch(() => {});
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/${TAG}-${name}.png`, fullPage: mode === "full" });
  console.log("shot", name);
  await ctx.close();
}
await browser.close();
