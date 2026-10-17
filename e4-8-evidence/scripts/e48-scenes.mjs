import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
const [base, label] = process.argv.slice(2);
const out = `/tmp/e48-shots/${label}`;
fs.mkdirSync(out, { recursive: true });
const POPUP_OFF = fs.readFileSync("/workspace/scripts/e48-menu.mjs", "utf8").match(/const POPUP_OFF = `([^`]*)`/)[1];
const WATCH = `(() => { const w = (window.__w = { rv: 0, cr: 0, tr: 0, menu: 0, minPath: null }); const tick = () => { if (document.querySelector(".rv-veil")) w.rv++; if (document.querySelector(".cr-veil")) w.cr++; if (document.querySelector(".tr-veil")) w.tr++; if (document.querySelector(".menu-veil")) w.menu++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); })();`;
const browser = await launch();
const res = {};
async function scene(name, path, user, w, h, sel, expectPrefix, shotAt = [250, 550]) {
  const { page, ctx } = await openPage(browser, base, { path, user, width: w, height: h, wait: 1200, until: "domcontentloaded", reduced: "no-preference", init: POPUP_OFF + WATCH });
  await page.waitForTimeout(800);
  const el = page.locator(`${sel} >> visible=true`).first();
  if (!(await el.count())) { res[name] = { err: "no element " + sel }; await ctx.close(); return; }
  await el.scrollIntoViewIfNeeded();
  await el.click({ timeout: 6000 });
  let t = 0;
  for (const at of shotAt) { await page.waitForTimeout(at - t); t = at; await page.screenshot({ path: `${out}/${name}-t${at}.png` }); }
  await page.waitForTimeout(2600 - t);
  res[name] = { ...(await page.evaluate(() => ({ ...window.__w, path: location.pathname + location.search, leftover: document.querySelectorAll(".rv-veil,.cr-veil,.tr-veil,.menu-veil").length }))), expectPrefix };
  await page.screenshot({ path: `${out}/${name}-settled.png` });
  await ctx.close();
}
await scene("card-detail-390", "/tab/new", "creatorA", 390, 844, '[data-character-card] a[href^="/character/"]', "/character/");
await scene("card-detail-1440", "/tab/new", "creatorA", 1440, 900, '[data-character-card] a[href^="/character/"]', "/character/");
await scene("chat-resume-390", "/chats", "safe", 390, 844, "a[data-chat-resume]", "/chat/");
await scene("chat-resume-1440", "/chats", "safe", 1440, 900, "a[data-chat-resume]", "/chat/");
await scene("trpg-resume-390", "/chats", "safe", 390, 844, "a[data-trpg-resume]", "/trpg/");
await scene("trpg-resume-1440", "/chats", "safe", 1440, 900, "a[data-trpg-resume]", "/trpg/");
fs.writeFileSync(`${out}/scenes.json`, JSON.stringify(res, null, 1));
for (const [k, v] of Object.entries(res)) console.log(label, k, JSON.stringify(v));
await browser.close();
