import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
// usage: e49-shots.mjs <base> <label>
const [base, label] = process.argv.slice(2);
const out = `/tmp/e49/${label}/shots`;
fs.mkdirSync(out, { recursive: true });
const init = fs.readFileSync("/workspace/scripts/e47-vv.js", "utf8");
const POPUP_OFF = fs.readFileSync("/workspace/scripts/e48-menu.mjs", "utf8").match(/const POPUP_OFF = `([^`]*)`/)[1];
const b = await launch();
const LINES = (n) => Array.from({ length: n }, (_, i) => `${i + 1}번째 줄 입력 중입니다 캐럿 확인`).join("\n");
const res = {};

async function keyboard(page, kb) {
  await page.evaluate((k) => {
    window.__setKeyboard(k);
    document.getElementById("__kb")?.remove();
    if (k > 0) {
      const d = document.createElement("div");
      d.id = "__kb";
      d.textContent = `KEYBOARD (simulated ${k}px)`;
      d.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${k}px;z-index:99999;pointer-events:none;background:repeating-linear-gradient(45deg,#3b3b46,#3b3b46 10px,#33333d 10px,#33333d 20px);color:#fff;font:700 14px sans-serif;display:flex;align-items:center;justify-content:center;opacity:.96`;
      document.body.appendChild(d);
    }
  }, kb);
  await page.waitForTimeout(300);
}

async function open(w, h, path = "/create") {
  const { page, ctx } = await openPage(b, base, { path, user: "creatorA", width: w, height: h, wait: 900, until: "domcontentloaded", init: init + POPUP_OFF });
  return { page, ctx };
}

async function typeScene(name, w, h, kb) {
  const { page, ctx } = await open(w, h);
  const ta = page.locator("#studio-character-form textarea:visible").nth(1);
  await ta.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForTimeout(200);
  await ta.click();
  await keyboard(page, kb);
  await page.keyboard.type(LINES(9));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  res[name] = await page.evaluate(() => ({ sy: Math.round(scrollY), vv: visualViewport.height, hdr: Math.round(document.querySelector(".site-header").getBoundingClientRect().bottom) }));
  await ctx.close();
}

async function tabScene(name, w, h, kb, reverse) {
  const { page, ctx } = await open(w, h);
  await keyboard(page, kb);
  const tas = page.locator("#studio-character-form textarea:visible");
  if (!reverse) {
    await tas.first().evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("#studio-character-form input:visible").first().focus();
    for (let i = 0; i < 4; i++) { await page.keyboard.press("Tab"); await page.waitForTimeout(80); }
  } else {
    await tas.nth(2).focus();
    await page.waitForTimeout(150);
    await page.keyboard.press("Shift+Tab");
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png` });
  res[name] = await page.evaluate(() => ({ active: document.activeElement.tagName + ":" + (document.activeElement.id || "").slice(-12), sy: Math.round(scrollY) }));
  await ctx.close();
}

async function plain(name, w, h, kb, path, prep) {
  const { page, ctx } = await open(w, h, path);
  if (prep) await prep(page);
  await keyboard(page, kb);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png` });
  await ctx.close();
}

// P1: short landscape + keyboard while typing
await typeScene("land-667x375-kb190-typing", 667, 375, 190);
await typeScene("land-740x360-kb180-typing", 740, 360, 180);
await typeScene("land-844x390-kb200-typing", 844, 390, 200);
// unchanged: landscape without keyboard, portrait with keyboard
await typeScene("land-667x375-kb0-typing", 667, 375, 0);
await typeScene("port-375x667-kb300-typing", 375, 667, 300);
await typeScene("port-390x844-kb330-typing", 390, 844, 330);
// Tab / Shift+Tab at 375x667
await tabScene("tab-375x667-kb300", 375, 667, 300, false);
await tabScene("shifttab-375x667-kb300", 375, 667, 300, true);
// normal portrait editing, tabs, required jump
await plain("port-390x844-normal", 390, 844, 0, "/create", async (p) => { await p.evaluate(() => window.scrollTo(0, 600)); });
await plain("land-844x390-tabs-sticky", 844, 390, 0, "/create", async (p) => { await p.evaluate(() => window.scrollTo(0, 700)); });
await plain("port-375x667-jump", 375, 667, 0, "/create", async (p) => { await p.getByTestId("studio-save-bar").getByRole("button", { name: /채우러 가기/ }).click(); await p.waitForTimeout(1000); });
{
  const { page, ctx } = await open(667, 375);
  await keyboard(page, 190);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  const jump = page.getByTestId("studio-save-bar").getByRole("button", { name: /채우러 가기/ });
  await jump.scrollIntoViewIfNeeded();
  await jump.click({ force: true });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/land-667x375-kb190-jump.png` });
  await ctx.close();
}
// adjacent editors sharing StudioSaveBar
for (const [n, path] of [["world", "/world/create"], ["lorebook", "/lorebook/create"], ["trpg-scenario", "/trpg/scenarios/new"]]) {
  await plain(`adj-${n}-667x375-kb190`, 667, 375, 190, path, async (p) => {
    const f = p.locator("main input:visible, main textarea:visible").first();
    await f.click().catch(() => {});
  });
}
fs.writeFileSync(`${out}/shots.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await b.close();
