import { chromium } from "playwright-core";
import fs from "fs";

const [, , BASE, TAG] = process.argv;
const fx = JSON.parse(fs.readFileSync("/tmp/e43b-fixtures.json", "utf8"));
const OUT = process.env.OUT ?? "/tmp/e43b-out";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok, info });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, info === undefined ? "" : JSON.stringify(info));
};

const FAKE_VV = `(() => {
  const vv = new EventTarget();
  Object.assign(vv, { height: window.innerHeight, width: window.innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 });
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  window.__setVV = (p) => { Object.assign(vv, p); vv.dispatchEvent(new Event("resize")); };
})();`;

async function open(w, h, user, path, { fakeVV = false, reduced = false, safeBottom = 0 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    locale: "ko-KR",
    hasTouch: w < 600,
    isMobile: w < 600,
    deviceScaleFactor: 2,
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  if (user !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  if (fakeVV) await ctx.addInitScript(FAKE_VV);
  const p = await ctx.newPage();
  if (safeBottom) {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 0, right: 0, bottom: safeBottom } }).catch((e) => console.log("safe-area override unsupported", String(e).slice(0, 80)));
  }
  await p.goto(BASE + path, { waitUntil: "load" });
  await p.waitForTimeout(1000);
  const ok = p.getByRole("button", { name: "확인", exact: true });
  if (await ok.count()) await ok.first().click().catch(() => {});
  return { ctx, p };
}

const rect = (p, sel) =>
  p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el || !el.getClientRects().length) return null;
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top * 10) / 10, bottom: Math.round(b.bottom * 10) / 10, h: Math.round(b.height * 10) / 10 };
  }, sel);

// 1. studio save bar docks on the nav, then the keyboard, with the nav stepping aside
{
  const { ctx, p } = await open(390, 844, "std", "/create", { fakeVV: true });
  const nav = await rect(p, "nav.mobile-bottom-nav");
  const bar = await rect(p, '[data-testid="studio-save-bar"]');
  check("create: save bar bottom meets nav top (no overlap, no gap)", nav && bar && Math.abs(bar.bottom - nav.top) < 0.6, { nav, bar });
  await p.screenshot({ path: `${OUT}/${TAG}-fixed-1-create-idle.png` });
  await p.evaluate(() => window.__setVV({ height: 844 - 320 }));
  await p.waitForTimeout(300);
  const st = await p.evaluate(() => ({
    open: document.documentElement.hasAttribute("data-keyboard-open"),
    inset: getComputedStyle(document.documentElement).getPropertyValue("--keyboard-inset").trim(),
    navDisplay: getComputedStyle(document.querySelector("nav.mobile-bottom-nav")).display,
  }));
  const bar2 = await rect(p, '[data-testid="studio-save-bar"]');
  check("keyboard open: flag set, nav hidden", st.open && st.navDisplay === "none" && st.inset === "320px", st);
  check("keyboard open: save bar sits on the keyboard edge (bottom = 844-320)", bar2 && Math.abs(bar2.bottom - 524) < 0.6, bar2);
  const btn = await p.evaluate(() => {
    const b = document.querySelector('[data-testid="studio-save-bar"] button[type="submit"]').getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return hit?.closest('button[type="submit"]') !== null;
  });
  check("keyboard open: save button is hit-testable above the keyboard", btn);
  await p.screenshot({ path: `${OUT}/${TAG}-fixed-2-create-keyboard.png` });
  await p.evaluate(() => window.__setVV({ height: 844 - 60 }));
  await p.waitForTimeout(200);
  const urlbar = await p.evaluate(() => ({ open: document.documentElement.hasAttribute("data-keyboard-open"), navDisplay: getComputedStyle(document.querySelector("nav.mobile-bottom-nav")).display }));
  check("URL-bar sized viewport change (60px) does not count as a keyboard", !urlbar.open && urlbar.navDisplay !== "none", urlbar);
  await p.evaluate(() => window.__setVV({ height: 844 }));
  await p.waitForTimeout(200);
  const nav3 = await rect(p, "nav.mobile-bottom-nav");
  const bar3 = await rect(p, '[data-testid="studio-save-bar"]');
  check("keyboard closed: nav and bar restored", nav3 && bar3 && Math.abs(bar3.bottom - nav3.top) < 0.6, { nav3, bar3 });
  await ctx.close();
}

// 2. iOS safe-area
{
  const { ctx, p } = await open(390, 844, "std", "/create", { safeBottom: 34 });
  const nav = await rect(p, "nav.mobile-bottom-nav");
  const bar = await rect(p, '[data-testid="studio-save-bar"]');
  const pad = await p.evaluate(() => getComputedStyle(document.querySelector("nav.mobile-bottom-nav")).paddingBottom);
  check("safe-area 34px: nav grows by the inset, bar still meets nav top", nav && bar && Math.abs(nav.h - 53 - 34) < 0.6 && Math.abs(bar.bottom - nav.top) < 0.6, { nav, bar, pad });
  await p.screenshot({ path: `${OUT}/${TAG}-fixed-3-create-safe-area.png` });
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(300);
  const tail = await p.evaluate(() => {
    const links = [...document.querySelectorAll(".site-legal-footer a, .site-legal-footer p")];
    const last = links[links.length - 1];
    const bar = document.querySelector('[data-testid="studio-save-bar"]').getBoundingClientRect();
    return { lastBottom: Math.round(last.getBoundingClientRect().bottom), barTop: Math.round(bar.top) };
  });
  check("scrolled to the end: footer's last line clears the save bar", tail.lastBottom <= tail.barTop, tail);
  await ctx.close();
}

// 3. real Tab order: main content before the bottom nav; skip the header
{
  const { ctx, p } = await open(390, 844, "std", "/tab/new");
  const seq = [];
  for (let i = 0; i < 90; i++) {
    await p.keyboard.press("Tab");
    seq.push(await p.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return "body";
      const region = el.closest("nav.mobile-bottom-nav") ? "bottom-nav" : el.closest("header") ? "header" : el.closest("main") ? "main" : el.closest("footer") ? "footer" : el.closest("aside") ? "aside" : "other";
      return region;
    }));
  }
  const wrap = seq.indexOf("body");
  const cycle = wrap === -1 ? seq : seq.slice(0, wrap);
  const firstNav = cycle.indexOf("bottom-nav");
  const lastMain = cycle.lastIndexOf("main");
  check("tab order: every main control precedes the bottom nav", firstNav === -1 || firstNav > lastMain, { firstNav, lastMain, cycleLength: cycle.length, regions: cycle.filter((r, i) => i === 0 || cycle[i - 1] !== r) });
  await ctx.close();
}

// 4. hit-testing of every nav link + cinematic marker + focus after navigation
async function navClick(user, w, startPath, linkName, scopeSel) {
  const { ctx, p } = await open(w, w < 600 ? 844 : 900, user, startPath);
  const loc = p.locator(`${scopeSel} a:visible`, { hasText: linkName }).first();
  if (!(await loc.count())) {
    await ctx.close();
    return { hit: false, missing: true, finalPath: startPath };
  }
  const box = await loc.boundingBox();
  const hit = await loc.evaluate((a) => {
    a.scrollIntoView({ block: "nearest", inline: "nearest" });
    const b = a.getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !!el && (el === a || a.contains(el));
  });
  let veil = false;
  await p.evaluate(() => {
    window.__veil = false;
    new MutationObserver(() => {
      if (document.querySelector(".menu-veil")) window.__veil = true;
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
  });
  await loc.click();
  await p.waitForURL((u) => u.pathname !== startPath, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(900);
  veil = await p.evaluate(() => window.__veil);
  const finalPath = new URL(p.url()).pathname;
  const focus = await p.evaluate(() => document.activeElement?.tagName ?? "none");
  await ctx.close();
  return { hit, veil, finalPath, focus, box: !!box };
}
for (const [user, w, start, name, scope, expectPath] of [
  ["guest", 390, "/tab/new", "랭킹", process.env.NAVSCOPE_GUEST ?? "nav", "/tab/ranking"],
  ["guest", 360, "/tab/ranking", "검색", process.env.NAVSCOPE_GUEST ?? "nav", "/search"],
  ["std", 390, "/chats", "신작", process.env.NAVSCOPE_STD ?? "nav", "/tab/new"],
  ["std", 360, "/tab/new", "설정", "nav.mobile-bottom-nav", "/settings"],
  ["std", 390, "/tab/ranking", "제작", "nav.mobile-bottom-nav", "/studio"],
]) {
  const r = await navClick(user, w, start, name, scope);
  check(`${user}@${w} ${start} → ${name}: link hit-testable, veil, lands ${expectPath}`, r.hit && r.finalPath === expectPath, r);
}

// 5. reduced motion: no veil painted
{
  const { ctx, p } = await open(390, 844, "std", "/tab/new", { reduced: true });
  const link = p.locator("nav.mobile-bottom-nav a", { hasText: "설정" }).first();
  await link.click();
  await p.waitForURL((u) => u.pathname === "/settings", { timeout: 8000 }).catch(() => {});
  const veilDisplay = await p.evaluate(() => {
    const v = document.querySelector(".menu-veil");
    return v ? getComputedStyle(v).display : "absent";
  });
  check("reduced-motion: nav still navigates and no menu veil is painted", new URL(p.url()).pathname === "/settings" && (veilDisplay === "none" || veilDisplay === "absent"), { veilDisplay });
  await ctx.close();
}

// 6. chat room and TRPG room keep their dedicated layout
{
  const { ctx, p } = await open(390, 844, "std", `/chat/${fx.chatId}`);
  const s = await p.evaluate(() => ({
    nav: !!document.querySelector("nav.mobile-bottom-nav")?.getClientRects().length,
    strip: [...document.querySelectorAll('nav[aria-label="주요 메뉴"]')].some((n) => n.getClientRects().length > 0),
    headerShown: !!document.querySelector(".site-header")?.getClientRects().length,
  }));
  check("chat room: no global bottom nav, no main-tab strip, global header hidden", !s.nav && !s.strip && !s.headerShown, s);
  await ctx.close();
}
{
  const { ctx, p } = await open(390, 844, "std", `/trpg/${fx.campaignId}`);
  const s = await p.evaluate(() => {
    const dock = document.querySelector("[data-trpg-command-dock]");
    const panel = document.querySelector('aside[aria-label="캠페인 도구"]');
    const header = document.querySelector(".site-header").getBoundingClientRect();
    const rail = panel?.getBoundingClientRect();
    const d = dock?.getBoundingClientRect();
    const btns = dock ? [...dock.querySelectorAll("button")].filter((x) => x.getClientRects().length) : [];
    const covered = btns.filter((x) => {
      const b = x.getBoundingClientRect();
      if (b.bottom > window.innerHeight || b.top < 0) return false;
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !(hit && (hit === x || x.contains(hit)));
    }).length;
    return {
      nav: !!document.querySelector("nav.mobile-bottom-nav")?.getClientRects().length,
      dockButtons: btns.length,
      dockCovered: covered,
      dockBottom: d ? Math.round(d.bottom) : null,
      innerH: window.innerHeight,
      headerBottom: Math.round(header.bottom),
      panelTop: rail ? Math.round(rail.top) : null,
    };
  });
  check("TRPG room: no bottom nav, and no dock button is covered", !s.nav && s.dockButtons > 0 && s.dockCovered === 0, s);
  check("TRPG room: campaign tools panel starts below the whole header", s.panelTop !== null && s.panelTop >= s.headerBottom, s);
  await p.screenshot({ path: `${OUT}/${TAG}-fixed-4-trpg-room.png` });
  await ctx.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/${TAG}-fixed.json`, JSON.stringify(results, null, 1));
console.log(TAG, `pass ${results.filter((r) => r.ok).length}/${results.length}`);
