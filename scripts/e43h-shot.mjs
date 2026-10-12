import { chromium } from "playwright-core";
import fs from "fs";
const BASE = process.env.BASE;
const fx = JSON.parse(fs.readFileSync("/tmp/e43h-fixtures.json", "utf8"));
const b = await chromium.launch();
for (const user of ["std", "adminOn", "adminOff"]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 700 }, locale: "ko-KR" });
  await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + "/settings", { waitUntil: "load" });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `/opt/cursor/artifacts/hidden-sidebar-${user}.png`, clip: { x: 0, y: 100, width: 260, height: 420 } });
  await ctx.close();
}
await b.close();
