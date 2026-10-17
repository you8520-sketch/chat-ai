import fs from "fs";
import { launch, openPage } from "/workspace/scripts/e44-lib.mjs";
const init = fs.readFileSync("/workspace/scripts/e47-vv.js", "utf8");
const base = process.argv[2];
const b = await launch();
for (const path of ["/search", "/settings", "/studio", "/chats"]) {
  const { page, ctx } = await openPage(b, base, { path, user: "creatorA", width: 667, height: 375, wait: 700, until: "domcontentloaded", init });
  const read = () => page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return [cs.scrollPaddingTop, cs.scrollPaddingBottom, cs.getPropertyValue("--studio-save-bar-h") || "unset"]; });
  const closed = await read();
  await page.evaluate(() => window.__setKeyboard(190)); await page.waitForTimeout(250);
  console.log(path, "closed", closed, "kb190", await read());
  await ctx.close();
}
await b.close();
