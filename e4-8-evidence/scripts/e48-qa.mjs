import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
const [base, label] = process.argv.slice(2);
const out = `/tmp/e48-shots/${label}/qa`;
fs.mkdirSync(out, { recursive: true });
const POPUP_OFF = fs.readFileSync("/workspace/scripts/e48-menu.mjs", "utf8").match(/const POPUP_OFF = `([^`]*)`/)[1];
const browser = await launch();
const res = { journeys: {}, sweep: [], focus: [] };

const hov = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const here = (page) => page.evaluate(() => location.pathname + location.search);

async function clickNav(page, name) {
  const loc = page.locator(`nav[aria-label="주요 메뉴"] >> a:has-text("${name}") >> visible=true`).first();
  if (await loc.count()) { await loc.click(); return true; }
  const bottom = page.locator(`nav a:has-text("${name}") >> visible=true`).first();
  if (await bottom.count()) { await bottom.click(); return true; }
  return false;
}

async function journey(name, user, width, height, steps) {
  const { page, ctx } = await openPage(browser, base, { path: "/", user, width, height, wait: 700, until: "domcontentloaded", reduced: "no-preference", init: POPUP_OFF });
  const log = [];
  for (const [desc, fn, expectRe] of steps) {
    let err = null;
    try { await fn(page); } catch (e) { err = String(e).split("\n")[0].slice(0, 120); }
    await page.waitForTimeout(1100);
    const p = await here(page);
    log.push({ step: desc, path: p, ok: !err && expectRe.test(p), overflow: await hov(page), err });
  }
  const back = [];
  for (let i = 0; i < 2; i++) { await page.goBack(); await page.waitForTimeout(700); back.push(await here(page)); }
  await page.goForward(); await page.waitForTimeout(700);
  const fwd = await here(page);
  await page.reload(); await page.waitForTimeout(900);
  res.journeys[`${name}-${width}`] = { log, back, fwd, afterReload: await here(page), reloadOverflow: await hov(page), veilEver: await page.evaluate(() => document.querySelectorAll(".menu-veil").length) };
  await ctx.close();
}

const nav = (n) => (p) => clickNav(p, n);
for (const w of [390, 1440]) {
  const h = w === 390 ? 844 : 900;
  await journey("public", null, w, h, [
    ["신작", nav("신작"), /^\/tab\/new/],
    ["랭킹", nav("랭킹"), /^\/tab\/ranking/],
    ["검색", nav("검색"), /^\/search/],
    ["홈", nav("홈"), /^\/$/],
  ]);
  await journey("public-viewer", "safe", w, h, [
    ["신작", nav("신작"), /^\/tab\/new/],
    ["랭킹", nav("랭킹"), /^\/tab\/ranking/],
    ["검색", nav("검색"), /^\/search/],
    ["작품 상세", async (p) => { await p.goto(base + "/tab/new", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(500); await p.locator('[data-character-card] a[href^="/character/"] >> visible=true').first().click(); }, /^\/character\//],
    ["크리에이터 프로필", async (p) => { await p.locator('a[href^="/creator/"] >> visible=true').first().click(); }, /^\/creator\//],
    ["홈", nav("홈"), /^\/$/],
  ]);
  await journey("loggedin", "safe", w, h, [
    ["대화", nav("대화"), /^\/chats/],
    ["설정", w === 390 ? nav("설정") : async (p) => { await p.goto(base + "/settings", { waitUntil: "domcontentloaded" }); }, /^\/settings/],
    ["페르소나", async (p) => { await p.goto(base + "/persona", { waitUntil: "domcontentloaded" }); }, /^\/persona/],
    ["제작", nav("제작"), /^\/studio/],
  ]);
  await journey("creator", "creatorA", w, h, [
    ["제작", nav("제작"), /^\/studio/],
    ["캐릭터 제작", async (p) => { await p.goto(base + "/create", { waitUntil: "domcontentloaded" }); }, /^\/create/],
    ["스튜디오", async (p) => { await p.goto(base + "/studio", { waitUntil: "domcontentloaded" }); }, /^\/studio/],
    ["대시보드", async (p) => { await p.locator('a[href="/creator"] >> visible=true').first().click(); }, /^\/creator/],
    ["내 공개 프로필", async (p) => { await p.locator('a[href^="/creator/5"], a[href^="/c/"] >> visible=true').first().click(); }, /^\/(creator\/5|c\/)/],
  ]);
  await journey("points", "safe", w, h, [
    ["포인트", async (p) => { const l = p.locator('a[href="/points"] >> visible=true').first(); if (await l.count()) await l.click(); else await p.goto(base + "/points", { waitUntil: "domcontentloaded" }); }, /^\/points/],
    ["홈으로", nav("홈"), /^\/$/],
  ]);
}

if (process.env.ONLY === "journeys") { fs.writeFileSync(`${out}/journeys.json`, JSON.stringify(res.journeys, null, 1)); console.log(JSON.stringify(Object.fromEntries(Object.entries(res.journeys).map(([k, v]) => [k, v.log.map((l) => (l.ok && !l.overflow ? "ok" : `FAIL(${l.step}:${l.path}:${l.err || ""})`)).join(",") + ` | back=${v.back} fwd=${v.fwd} reload=${v.afterReload} veil=${v.veilEver}`])), null, 1)); await browser.close(); process.exit(0); }
const VPS = [[320, 568], [360, 740], [375, 667], [390, 844], [576, 900], [768, 1024], [1024, 800], [1440, 900], [667, 375]];
const PAGES = [
  ["/", null], ["/tab/new", null], ["/tab/ranking", null], ["/search", null], ["/trpg", "safe"], ["/tab/following", "safe"],
  ["/chats", "safe"], ["/persona", "safe"], ["/settings", "safe"], ["/studio", "creatorA"], ["/creator", "creatorA"], ["/points", "safe"], ["/create", "creatorA"], ["/lorebook/create", "creatorA"],
];
for (const [w, h] of VPS) {
  const row = { vp: `${w}x${h}`, overflow: [], noBottomNav: [] };
  for (const [path, user] of PAGES) {
    const { page, ctx } = await openPage(browser, base, { path, user, width: w, height: h, wait: 500, until: "domcontentloaded", reduced: "reduce", init: POPUP_OFF });
    if (await hov(page)) row.overflow.push(path);
    if (w < 1024 && h >= 500) {
      const bn = await page.evaluate(() => { const n = [...document.querySelectorAll("nav")].find((x) => getComputedStyle(x).position === "fixed" && x.getBoundingClientRect().bottom > innerHeight - 4 && x.getBoundingClientRect().height > 40); return Boolean(n); });
      if (!bn && !["/create", "/lorebook/create"].includes(path)) row.noBottomNav.push(path);
    }
    if (path === "/search" || path === "/studio" || path === "/") await page.screenshot({ path: `${out}/${w}x${h}-${path.replace(/\W+/g, "_") || "home"}.png` });
    await ctx.close();
  }
  res.sweep.push(row);
}

// keyboard focus must not hide behind fixed chrome (header / bottom nav / save bar)
for (const [w, h] of [[320, 568], [375, 667], [390, 844]]) {
  for (const [path, user] of [["/", null], ["/search", null], ["/settings", "safe"], ["/persona", "safe"], ["/studio", "creatorA"], ["/create", "creatorA"]]) {
    const { page, ctx } = await openPage(browser, base, { path, user, width: w, height: h, wait: 600, until: "domcontentloaded", reduced: "reduce", init: POPUP_OFF });
    let hidden = 0, checked = 0; const samples = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const r = await page.evaluate(() => {
        const el = document.activeElement; if (!el || el === document.body) return null;
        const b = el.getBoundingClientRect(); if (!b.width || !b.height) return null;
        const cx = Math.min(Math.max(b.left + b.width / 2, 1), innerWidth - 1);
        const cy = Math.min(Math.max(b.top + Math.min(b.height / 2, 8), 1), innerHeight - 1);
        if (b.bottom < 0 || b.top > innerHeight) return { off: true };
        const top = document.elementFromPoint(cx, cy);
        const covered = top && top !== el && !el.contains(top) && !top.contains(el);
        return { covered, tag: el.tagName, text: (el.getAttribute("aria-label") || el.textContent || el.name || "").trim().slice(0, 20), top: b.top | 0, h: b.height | 0 };
      });
      if (!r || r.off) continue;
      checked++;
      if (r.covered) { hidden++; if (samples.length < 3) samples.push(r); }
    }
    res.focus.push({ vp: `${w}x${h}`, path, checked, hidden, samples });
    await ctx.close();
  }
}
fs.writeFileSync(`${out}/qa.json`, JSON.stringify(res, null, 1));
await browser.close();
console.log(JSON.stringify({ j: Object.fromEntries(Object.entries(res.journeys).map(([k, v]) => [k, v.log.map((l) => (l.ok && !l.overflow ? "ok" : `FAIL(${l.step}:${l.path}:${l.err || ""})`)).join(",") + ` | back=${v.back} fwd=${v.fwd} reload=${v.afterReload} veil=${v.veilEver}`])), sweep: res.sweep, focus: res.focus.filter((f) => f.hidden) }, null, 1));
