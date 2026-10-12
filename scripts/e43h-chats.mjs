import { chromium } from "playwright-core";
import fs from "fs";
const BASE = process.env.BASE;
const fx = JSON.parse(fs.readFileSync("/tmp/e43h-fixtures.json", "utf8"));
const b = await chromium.launch();
for (const user of ["std", "adminOn", "adminOff"]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
  await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + "/chats", { waitUntil: "load" });
  await p.waitForTimeout(1200);
  const arts = await p.$$eval("main article", (a) => a.map((x) => x.innerText.replace(/\n+/g, " / ")));
  console.log(`--- /chats as ${user}`);
  arts.filter((t) => t.includes("NSFW") || t.includes("NOIMG")).forEach((t) => console.log("  ", t));
  const links = await p.$$eval("main article a", (a) => a.map((x) => x.getAttribute("href") + " :: " + x.getAttribute("title")));
  links.filter((t) => t.includes("NSFW") || t.includes("NOIMG")).forEach((t) => console.log("   link", t));
  await p.screenshot({ path: `/tmp/e43h-chats-${user}.png` });
  await ctx.close();
}
await b.close();
