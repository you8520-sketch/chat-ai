import { chromium } from "playwright-core";
import fs from "fs";
const BASE = process.env.BASE, TAG = process.env.TAG;
const OUT = `/tmp/e43-cap/${TAG}`;
fs.mkdirSync(OUT, { recursive: true });
const fx = JSON.parse(fs.readFileSync("/tmp/e43-fixtures.json", "utf8"));
const b = await chromium.launch();
const settle = async (p) => { await p.waitForTimeout(1100); const ok = p.getByRole("button", { name: "확인" }); if (await ok.count()) await ok.first().click().catch(() => {}); await p.waitForTimeout(250); };
const ctxFor = async (user, vw) => {
  const ctx = await b.newContext({ viewport: { width: vw, height: vw < 700 ? 800 : 900 }, locale: "ko-KR", hasTouch: vw < 600, isMobile: vw < 600, deviceScaleFactor: 1 });
  if (user !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  return ctx;
};
// header + shell at each width for each fixture on home
for (const user of ["guest", "std", "heavy", "admin", "huge"]) for (const vw of [360, 390, 576, 768, 1024, 1440]) {
  const ctx = await ctxFor(user, vw); const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "load" }); await settle(p);
  await p.screenshot({ path: `${OUT}/home-${user}-${vw}.png` });
  await ctx.close();
}
// routes
const routes = [["new", "/tab/new"], ["search", "/search"], ["chats", "/chats"], ["chatroom", `/chat/${fx.charIds[0]}?chat=${fx.chatIds.heavy[0]}`], ["studio", "/studio"], ["settings", "/settings"], ["trpg", "/trpg"], ["trpgroom", "/trpg/4"]];
for (const vw of [390, 768, 1440]) for (const [name, path] of routes) {
  const ctx = await ctxFor("heavy", vw); const p = await ctx.newPage();
  let url = path;
  if (name === "trpgroom") {
    await p.goto(BASE + "/trpg", { waitUntil: "load" }); await settle(p);
    url = await p.evaluate(() => [...document.querySelectorAll("a[href^='/trpg/']")].map((a) => a.getAttribute("href")).find((h) => /^\/trpg\/\d+/.test(h ?? "")) ?? "/trpg");
  }
  await p.goto(BASE + url, { waitUntil: "load" }); await settle(p);
  await p.screenshot({ path: `${OUT}/route-${name}-${vw}.png` });
  await ctx.close();
}
// popups
for (const vw of [360, 390, 1440]) {
  const ctx = await ctxFor("heavy", vw); const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "load" }); await settle(p);
  await p.locator('a[href^="/points#"]').first().hover(); await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/popup-points-${vw}.png` });
  await p.mouse.move(5, 500); await p.waitForTimeout(200);
  await p.locator('button[aria-haspopup="dialog"]').first().click(); await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/popup-notif-${vw}.png` });
  await ctx.close();
}
for (const vw of [640, 1440]) {
  const ctx = await ctxFor("heavy", vw); const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "load" }); await settle(p);
  await p.locator('button[aria-label="프로필 메뉴"]').click(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/popup-profile-${vw}.png` });
  await ctx.close();
}
// active state hover/active on route pages (sidebar & header active)
for (const vw of [1440, 768, 390]) {
  const ctx = await ctxFor("std", vw); const p = await ctx.newPage();
  await p.goto(BASE + "/studio", { waitUntil: "load" }); await settle(p);
  await p.screenshot({ path: `${OUT}/active-studio-${vw}.png` });
  await ctx.close();
}
await b.close();
console.log("captured", TAG);
