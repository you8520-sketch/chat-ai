import { chromium } from "playwright-core";
import fs from "fs";
const BASE = process.argv[2];
const fx = JSON.parse(fs.readFileSync("/tmp/e43d-fixtures.json", "utf8"));
const browser = await chromium.launch();
const out = [];
for (const [w, user] of [[390, "std"], [390, "guest"], [1440, "std"], [768, "std"]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, locale: "ko-KR", hasTouch: w < 600, isMobile: w < 600 });
  if (user !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "load" });
  await p.waitForTimeout(1200);
  const dlg = p.getByRole("dialog");
  const shown = await dlg.count();
  const info = {};
  if (shown) {
    const b = await dlg.first().boundingBox();
    info.rect = b && [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
    info.centerX = b && Math.round(b.x + b.width / 2);
    info.centerY = b && Math.round(b.y + b.height / 2);
    info.inViewport = b && b.x >= 0 && b.y >= 0 && b.x + b.width <= w && b.y + b.height <= (w < 600 ? 844 : 900);
    await p.screenshot({ path: `/opt/cursor/artifacts/e43d/popup-${user}-${w}.png` });
    await p.getByRole("button", { name: "공지 닫기" }).click();
    await p.waitForTimeout(300);
    info.closedByX = (await p.getByRole("dialog").count()) === 0;
    await p.reload({ waitUntil: "load" }); await p.waitForTimeout(1000);
    info.reappearsAfterX = (await p.getByRole("dialog").count()) > 0;
    if (info.reappearsAfterX) {
      await p.getByLabel("오늘 하루 보지 않기").check(); await p.getByRole("button", { name: "확인", exact: true }).click(); await p.waitForTimeout(300);
      info.closedByToday = (await p.getByRole("dialog").count()) === 0;
      await p.reload({ waitUntil: "load" }); await p.waitForTimeout(1000);
      info.hiddenAfterToday = (await p.getByRole("dialog").count()) === 0;
    }
  }
  out.push({ w, user, shown: !!shown, ...info });
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
