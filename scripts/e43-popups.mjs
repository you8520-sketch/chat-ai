import { chromium } from "playwright-core";
import fs from "fs";
const BASE = process.env.BASE, TAG = process.env.TAG ?? "before";
const OUT = process.env.OUT ?? `/opt/cursor/artifacts/e43/${TAG}`;
fs.mkdirSync(OUT, { recursive: true });
const fx = JSON.parse(fs.readFileSync("/tmp/e43-fixtures.json", "utf8"));
const b = await chromium.launch();
const res = {};
const rectOf = async (loc) => { if (!(await loc.count())) return null; const r = await loc.first().boundingBox(); return r ? { l: Math.round(r.x), r: Math.round(r.x + r.width), t: Math.round(r.y), b: Math.round(r.y + r.height) } : null; };
for (const user of ["heavy", "std"]) for (const vw of [360, 390, 640, 768, 1440]) {
  const ctx = await b.newContext({ viewport: { width: vw, height: 800 }, locale: "ko-KR" });
  await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "load" }); await p.waitForTimeout(1500);
  const ok = p.getByRole("button", { name: "확인" }); if (await ok.count()) await ok.first().click().catch(() => {});
  const r = { vw };
  await p.locator('button[aria-haspopup="dialog"]').first().click(); await p.waitForTimeout(700);
  r.notifPanel = await rectOf(p.locator('div.fixed.z-\\[60\\]'));
  await p.screenshot({ path: `${OUT}/popup-notif-${user}-${vw}.png` });
  await p.keyboard.press("Escape"); await p.mouse.click(5, 790); await p.waitForTimeout(300);
  const chip = p.locator('a[href^="/points#"]').first();
  await chip.hover(); await p.waitForTimeout(400);
  r.pointsTip = await rectOf(p.locator('[role="tooltip"]'));
  await p.screenshot({ path: `${OUT}/popup-points-${user}-${vw}.png`, clip: { x: 0, y: 0, width: vw, height: 200 } });
  await p.mouse.move(5, 500);
  const prof = p.locator('button[aria-label="프로필 메뉴"]');
  if (await prof.count() && await prof.isVisible()) { await prof.click(); await p.waitForTimeout(300); r.profileMenu = await rectOf(p.locator('[role="menu"]')); await p.screenshot({ path: `${OUT}/popup-profile-${user}-${vw}.png`, clip: { x: 0, y: 0, width: vw, height: 260 } }); }
  res[`${user}|${vw}`] = r; await ctx.close();
}
fs.writeFileSync(`${OUT}/popups.json`, JSON.stringify(res, null, 1));
for (const [k, v] of Object.entries(res)) console.log(k, JSON.stringify(v));
await b.close();
