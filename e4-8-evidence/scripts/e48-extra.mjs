import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
const [base, label] = process.argv.slice(2);
const out = `/tmp/e48-shots/${label}`;
fs.mkdirSync(out, { recursive: true });
const POPUP_OFF = `(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { if (String(k).startsWith("home-popup-notice:")) { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); } return g.call(this, k); }; })();`;
const WATCH = `(() => { const w = (window.__w = { veil: 0, anyCover: 0, rv: 0, cr: 0, tr: 0 }); const vw = () => innerWidth, vh = () => innerHeight; const tick = () => { if (document.querySelector(".menu-veil")) w.veil++; if (document.querySelector(".rv-veil")) w.rv++; if (document.querySelector(".cr-veil")) w.cr++; if (document.querySelector(".tr-veil")) w.tr++; for (const el of document.querySelectorAll("body > *")) { const cs = getComputedStyle(el); if (cs.position !== "fixed" || parseFloat(cs.opacity) < 0.05 || cs.display === "none") continue; const r = el.getBoundingClientRect(); if (r.width >= vw() * 0.9 && r.height >= vh() * 0.9) w.anyCover++; } requestAnimationFrame(tick); }; requestAnimationFrame(tick); })();`;
const browser = await launch();
const res = {};
const open = (path, user, width, height, extra = {}) => openPage(browser, base, { path, user, width, height, wait: 600, until: "domcontentloaded", reduced: "no-preference", init: POPUP_OFF + WATCH, ...extra });
const watch = (page) => page.evaluate(() => ({ ...window.__w, path: location.pathname + location.search }));
const reset = (page) => page.evaluate(() => { window.__w.veil = window.__w.anyCover = window.__w.rv = window.__w.cr = window.__w.tr = 0; });

// 1. logged-out menus
{
  const { page, ctx } = await open("/", null, 1440, 900);
  const seq = [];
  for (const [name, dest] of [["신작", "/tab/new"], ["랭킹", "/tab/ranking"], ["검색", "/search"], ["TRPG", "/trpg"], ["홈", "/"]]) {
    await reset(page);
    await page.locator(`nav[aria-label="주요 메뉴"] >> a:has-text("${name}") >> visible=true`).first().click();
    await page.waitForTimeout(1500);
    const w = await watch(page);
    seq.push({ name, dest, path: w.path, veil: w.veil, anyCover: w.anyCover, ok: w.path === dest });
  }
  await reset(page);
  await page.locator('a[href^="/login"]:visible').first().click();
  await page.waitForTimeout(1500);
  seq.push({ name: "login", ...(await watch(page)) });
  res.loggedOut = seq;
  await ctx.close();
}
// 2. same-menu re-click + rapid sequence + back/forward + keyboard + modifier
{
  const { page, ctx } = await open("/search", "creatorA", 1440, 900);
  await reset(page);
  await page.locator('nav[aria-label="주요 메뉴"] >> a:has-text("검색") >> visible=true').first().click();
  await page.waitForTimeout(1200);
  res.reclick = { ...(await watch(page)), expected: "/search" };
  // rapid
  await reset(page);
  const names = ["홈", "신작", "랭킹", "검색"];
  for (const n of names) { await page.locator(`nav[aria-label="주요 메뉴"] >> a:has-text("${n}") >> visible=true`).first().click({ delay: 0 }); await page.waitForTimeout(60); }
  await page.waitForTimeout(2200);
  const act = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="주요 메뉴"] [aria-current="page"]')].map((a) => a.textContent.trim()));
  res.rapid = { ...(await watch(page)), expected: "/search", active: act };
  // back / forward
  await reset(page);
  await page.goBack(); await page.waitForTimeout(900);
  const b1 = (await watch(page)).path;
  await page.goBack(); await page.waitForTimeout(900);
  const b2 = (await watch(page)).path;
  await page.goForward(); await page.waitForTimeout(900);
  const f1 = (await watch(page)).path;
  res.history = { back1: b1, back2: b2, fwd1: f1, ...(await watch(page)) };
  // keyboard Enter
  await reset(page);
  const lk = page.locator('nav[aria-label="주요 메뉴"] >> a:has-text("랭킹") >> visible=true').first();
  await lk.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
  res.enter = { ...(await watch(page)), expected: "/tab/ranking" };
  // ctrl-click new tab
  await reset(page);
  const popupP = ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await page.locator('nav[aria-label="주요 메뉴"] >> a:has-text("신작") >> visible=true').first().click({ modifiers: ["Control"] });
  const np = await popupP;
  await page.waitForTimeout(800);
  res.ctrlClick = { newTab: !!np, newTabUrl: np ? np.url() : null, origin: await watch(page), expectedOrigin: "/tab/ranking" };
  await ctx.close();
}
// 3. slow RSC: delay route fetches (RSC) by 3s
{
  const { page, ctx } = await open("/tab/new", "creatorA", 390, 844);
  await page.route((u) => u.pathname === "/search" && u.search.includes("_rsc"), async (route) => { await new Promise((r) => setTimeout(r, 3000)); await route.continue(); });
  await reset(page);
  const t0 = Date.now();
  await page.locator('nav[aria-label="주요 메뉴"] >> a:has-text("검색") >> visible=true').first().click();
  const samples = [];
  for (const at of [300, 1000, 2000]) { await page.waitForTimeout(at - (Date.now() - t0)); samples.push({ at, ...(await watch(page)) }); }
  await page.screenshot({ path: `${out}/slow-rsc-t2000.png` });
  await page.waitForTimeout(2500);
  res.slowRsc = { during: samples, final: await watch(page) };
  await ctx.close();
}
// 4. mobile strip horizontal scroll + bottom nav active
{
  const { page, ctx } = await open("/tab/new", "creatorA", 390, 844);
  const before = await page.evaluate(() => document.querySelector('nav[aria-label="주요 메뉴"]').scrollLeft);
  await reset(page);
  await page.locator('nav[aria-label="주요 메뉴"] >> a:has-text("북마크/팔로잉") >> visible=true').first().click();
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => { const nav = document.querySelector('nav[aria-label="주요 메뉴"]'); const a = nav.querySelector('[aria-current="page"]'); const nr = nav.getBoundingClientRect(); const ar = a.getBoundingClientRect(); return { scrollLeft: nav.scrollLeft, activeText: a.textContent.trim(), fullyVisible: ar.left >= nr.left - 1 && ar.right <= nr.right + 1 }; });
  res.strip = { before, ...r, ...(await watch(page)) };
  await reset(page);
  await page.locator('nav[aria-label="모바일 메뉴"] a[href="/chats"]').click();
  await page.waitForTimeout(1500);
  res.bottomNav = { active: await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="모바일 메뉴"] [aria-current="page"]')].map((a) => a.textContent.trim())), ...(await watch(page)) };
  await ctx.close();
}
// 5. moments: menu click shots (390 and 1440), TRPG lobby
for (const [w, h, shotName, from, sel, expect] of [
  [390, 844, "m390-ranking", "/", 'nav[aria-label="주요 메뉴"] >> a:has-text("랭킹") >> visible=true', "/tab/ranking"],
  [1440, 900, "m1440-new", "/", 'nav[aria-label="주요 메뉴"] >> a:has-text("신작") >> visible=true', "/tab/new"],
  [390, 844, "m390-trpg-lobby", "/", 'nav[aria-label="주요 메뉴"] >> a:has-text("TRPG") >> visible=true', "/trpg"],
  [1440, 900, "m1440-trpg-lobby", "/", 'nav[aria-label="주요 메뉴"] >> a:has-text("TRPG") >> visible=true', "/trpg"],
]) {
  const { page, ctx } = await open(from, "creatorA", w, h);
  await page.locator(sel).first().click();
  let t = 0;
  for (const at of [60, 180, 420, 800]) { await page.waitForTimeout(at - t); t = at; await page.screenshot({ path: `${out}/${shotName}-t${at}.png` }); }
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${shotName}-settled.png` });
  res[shotName] = await watch(page);
  await ctx.close();
}
fs.writeFileSync(`${out}/extra.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
await browser.close();
