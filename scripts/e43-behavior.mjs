import { chromium } from "playwright-core";
import fs from "fs";

const BASE = process.env.BASE;
const TAG = process.env.TAG ?? "base";
const OUT = process.env.OUT ?? `/opt/cursor/artifacts/e43/${TAG}`;
fs.mkdirSync(OUT, { recursive: true });
const fx = JSON.parse(fs.readFileSync("/tmp/e43-fixtures.json", "utf8"));
const b = await chromium.launch();
const res = {};
const newCtx = async (user, vw, extra = {}) => {
  const ctx = await b.newContext({ viewport: { width: vw, height: 820 }, locale: "ko-KR", hasTouch: vw < 600, isMobile: vw < 600, ...extra });
  if (user !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  return ctx;
};
const settle = async (p) => {
  await p.waitForTimeout(900);
  const ok = p.getByRole("button", { name: "확인" });
  if (await ok.count()) await ok.first().click().catch(() => {});
};

// 1. width sweep around breakpoints: exactly one tab row, no clipped/overlapping header row items
{
  const ctx = await newCtx("heavy", 1200);
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "load" });
  await settle(p);
  const sweep = [];
  for (let w = 540; w <= 1120; w += 20) {
    await p.setViewportSize({ width: w, height: 820 });
    await p.waitForTimeout(120);
    sweep.push({ w, ...(await p.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; };
      const navs = [...document.querySelectorAll('nav[aria-label="주요 메뉴"]')].filter(vis);
      const tabs = navs.flatMap((n) => [...n.querySelectorAll("a")].filter(vis));
      const row1 = [...document.querySelectorAll(".site-header a, .site-header button")].filter((el) => vis(el) && !el.closest('nav[aria-label="주요 메뉴"]')).map((el) => el.getBoundingClientRect());
      const vw = document.documentElement.clientWidth;
      let overlap = 0;
      for (let i = 0; i < row1.length; i++) for (let j = i + 1; j < row1.length; j++) { const a = row1[i], c = row1[j]; if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) overlap++; }
      const tabsClipped = tabs.filter((t) => { const n = t.closest("nav"); const nr = n.getBoundingClientRect(); const r = t.getBoundingClientRect(); return r.right > nr.right + 1 || r.left < nr.left - 1; }).length;
      const rail = document.querySelector("aside.app-left-rail");
      const railR = rail && vis(rail) ? rail.getBoundingClientRect() : null;
      const header = document.querySelector(".site-header").getBoundingClientRect();
      return { navRows: navs.length, tabCount: tabs.length, tabsClipped, overlap, row1MaxRight: Math.round(Math.max(...row1.map((r) => r.right))), vw, overflowX: document.documentElement.scrollWidth > vw + 1, headerH: Math.round(header.height), railTop: railR ? Math.round(railR.top) : null };
    })) });
  }
  res.sweep = sweep;
  await ctx.close();
}

// 2. real click navigation + aria-current + transition marker
{
  const out = {};
  for (const [name, vw, linkName, expect] of [["header-1440", 1440, "신작", "/tab/new"], ["strip-768", 768, "랭킹", "/tab/ranking"], ["strip-600", 600, "TRPG", "/trpg"], ["bottom-390", 390, "대화", "/chats"], ["bottom-360", 360, "제작", "/studio"]]) {
    const ctx = await newCtx("std", vw);
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(BASE + "/", { waitUntil: "load" });
    await settle(p);
    const nav = name.startsWith("bottom") ? p.locator("nav.mobile-bottom-nav") : p.locator('nav[aria-label="주요 메뉴"]:visible');
    const link = nav.getByRole("link", { name: linkName, exact: true }).first();
    let sawVeil = false;
    const watch = p.waitForFunction(() => !!document.querySelector(".menu-veil[data-state], .menu-veil[data-active], .menu-veil"), null, { timeout: 4000 }).then(() => { sawVeil = true; }).catch(() => {});
    await link.click();
    await p.waitForURL((u) => new URL(u).pathname === expect, { timeout: 15000 }).catch(() => {});
    await watch;
    await p.waitForTimeout(1800);
    const cur = await p.evaluate(() => [...document.querySelectorAll('[aria-current="page"]')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.textContent.trim()));
    out[name] = { landed: new URL(p.url()).pathname, expect, ariaCurrent: cur, sawVeil, pageErrors: errors.length };
    await ctx.close();
  }
  res.clicks = out;
}

// 3. safety filter toggle (admin may disable; std cannot)
{
  const out = {};
  for (const user of ["admin", "std"]) {
    const ctx = await newCtx(user, 390);
    const p = await ctx.newPage();
    await p.goto(BASE + "/", { waitUntil: "load" });
    await settle(p);
    const btn = p.getByRole("button", { name: "세이프티 필터" });
    const read = async () => ({ pressed: await btn.getAttribute("aria-pressed"), text: (await btn.innerText()).replace(/\s+/g, " ").trim(), disabled: await btn.isDisabled(), box: await btn.boundingBox() });
    const before = await read();
    let after = before, reloaded = before;
    if (!before.disabled) {
      const resp = p.waitForResponse((r) => r.url().includes("/api/settings") && r.request().method() === "PATCH");
      await btn.click();
      const r = await resp;
      await p.waitForTimeout(800);
      after = { ...(await read()), status: r.status() };
      await p.reload({ waitUntil: "load" });
      await settle(p);
      reloaded = await read();
      const resp2 = p.waitForResponse((r) => r.url().includes("/api/settings") && r.request().method() === "PATCH");
      await btn.click(); await resp2; await p.waitForTimeout(600);
    }
    out[user] = { before, after, reloaded };
    await ctx.close();
  }
  res.safety = out;
}

// 4. keyboard focus order and visible focus ring
{
  const out = {};
  for (const [name, user, vw] of [["pc1280", "heavy", 1280], ["tablet768", "heavy", 768], ["mobile390", "std", 390], ["guest390", "guest", 390]]) {
    const ctx = await newCtx(user, vw);
    const p = await ctx.newPage();
    await p.goto(BASE + "/", { waitUntil: "load" });
    await settle(p);
    await p.mouse.click(2, 2);
    const seq = [];
    for (let i = 0; i < 16; i++) {
      await p.keyboard.press("Tab");
      seq.push(await p.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const region = el.closest(".site-header") ? "header" : el.closest("nav.mobile-bottom-nav") ? "bottom" : el.closest("aside") ? "rail" : "main";
        return { region, label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 14), ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 || /rgb/.test(cs.boxShadow), inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
      }));
    }
    out[name] = seq;
    await ctx.close();
  }
  res.keyboard = out;
}

// 5. collapsible sidebar in chat room, header/bottom nav hidden, geometry consistent
{
  const out = {};
  for (const vw of [390, 700, 1440]) {
    const ctx = await newCtx("std", vw);
    const p = await ctx.newPage();
    await p.goto(BASE + `/chat/${fx.charIds[0]}?chat=${fx.chatIds.std[0]}`, { waitUntil: "load" });
    await settle(p);
    await p.waitForTimeout(800);
    const snap = () => p.evaluate(() => {
      const vis = (el) => el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== "none";
      const rail = document.querySelector("aside.chat-room-left-rail");
      const spacer = document.querySelector(".chat-room-left-rail-spacer");
      return { headerVisible: vis(document.querySelector(".site-header")), bottomNav: vis(document.querySelector("nav.mobile-bottom-nav")), railW: rail && vis(rail) ? Math.round(rail.getBoundingClientRect().width) : null, spacerW: spacer && vis(spacer) ? Math.round(spacer.getBoundingClientRect().width) : null, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, url: location.pathname + location.search };
    });
    const first = await snap();
    let toggled = null;
    const tog = p.getByRole("button", { name: /메뉴 (접기|펼치기)/ });
    if (vw >= 576 && (await tog.count())) {
      await tog.first().click(); await p.waitForTimeout(400);
      const s2 = await snap();
      await tog.first().click(); await p.waitForTimeout(400);
      const s3 = await snap();
      toggled = { afterFirst: s2, afterSecond: s3 };
    }
    out[vw] = { first, toggled };
    if (vw === 1440 || vw === 390) await p.screenshot({ path: `${OUT}/chatroom-${vw}.png` });
    await ctx.close();
  }
  res.chatRoom = out;
}

// 6. TRPG scene (campaign page) chrome
{
  const out = {};
  const ctx0 = await newCtx("std", 1440);
  const p0 = await ctx0.newPage();
  await p0.goto(BASE + "/trpg", { waitUntil: "load" });
  await settle(p0);
  const href = await p0.evaluate(() => [...document.querySelectorAll("a[href^='/trpg/']")].map((a) => a.getAttribute("href")).find((h) => /^\/trpg\/\d+/.test(h ?? "")) ?? null);
  await ctx0.close();
  out.href = href;
  if (href) {
    for (const vw of [390, 768, 1440]) {
      const ctx = await newCtx("std", vw);
      const p = await ctx.newPage();
      await p.goto(BASE + href, { waitUntil: "load" });
      await settle(p);
      await p.waitForTimeout(800);
      out[vw] = await p.evaluate(() => {
        const vis = (el) => el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== "none";
        return { url: location.pathname, headerVisible: vis(document.querySelector(".site-header")), bottomNav: vis(document.querySelector("nav.mobile-bottom-nav")), rail: vis(document.querySelector("aside.app-left-rail")), overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
      });
      await p.screenshot({ path: `${OUT}/trpg-room-${vw}.png` });
      await ctx.close();
    }
  }
  res.trpg = out;
}

// 7. notification panel focus + keyboard dismissal
{
  const ctx = await newCtx("heavy", 390);
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "load" });
  await settle(p);
  const bell = p.locator('button[aria-haspopup="dialog"]').first();
  await bell.click();
  await p.waitForTimeout(600);
  const open = await p.locator("div.fixed.z-\\[60\\]").count();
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  const closedByEsc = (await p.locator("div.fixed.z-\\[60\\]").count()) === 0;
  const focusOnBell = await p.evaluate(() => document.activeElement?.getAttribute("aria-haspopup") === "dialog");
  res.notification = { open, closedByEsc, focusOnBell };
  await ctx.close();
}

// 8. reduced motion keeps navigation functional
{
  const ctx = await newCtx("std", 1280, { reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "load" });
  await settle(p);
  await p.locator('nav[aria-label="주요 메뉴"]:visible').getByRole("link", { name: "검색", exact: true }).click();
  await p.waitForURL((u) => new URL(u).pathname === "/search", { timeout: 15000 }).catch(() => {});
  res.reducedMotion = { landed: new URL(p.url()).pathname };
  await ctx.close();
}

fs.writeFileSync(`${OUT}/behavior.json`, JSON.stringify(res, null, 1));
console.log("behavior done", TAG);
await b.close();
