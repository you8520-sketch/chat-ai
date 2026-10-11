import { chromium } from "playwright-core";
import fs from "fs";

const BASE = process.env.BASE;
const TAG = process.env.TAG ?? "before";
const OUT = process.env.OUT ?? `/opt/cursor/artifacts/e43/${TAG}`;
const fx = JSON.parse(fs.readFileSync("/tmp/e43-fixtures.json", "utf8"));
fs.mkdirSync(OUT, { recursive: true });

const VPS = [360, 390, 560, 576, 600, 640, 700, 768, 1024, 1440];
const USERS = ["guest", "std", "heavy", "admin", "huge"];
const ROUTES = [["home", "/"], ["new", "/tab/new"], ["search", "/search"], ["chats", "/chats"], ["studio", "/studio"], ["settings", "/settings"], ["trpg", "/trpg"]];

const measure = () => {
  const vw = document.documentElement.clientWidth;
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
  };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const header = document.querySelector(".site-header");
  const out = { vw, scrollW: document.documentElement.scrollWidth, overflowX: document.documentElement.scrollWidth > vw + 1 };
  if (header && vis(header)) {
    out.header = rect(header);
    const kids = [...header.querySelectorAll("a, button")].filter(vis).map((el) => ({ label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24), ...rect(el) }));
    out.headerItems = kids;
    out.headerClipped = kids.filter((k) => k.r > vw + 0.5 || k.l < -0.5).map((k) => k.label);
    const sorted = [...kids].sort((a, b) => a.l - b.l);
    const overlaps = [];
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) overlaps.push([a.label, b.label]);
    }
    out.headerOverlaps = overlaps;
    const hs = header.scrollWidth > header.clientWidth + 1;
    out.headerScrollOverflow = hs;
    out.headerH = Math.round(header.getBoundingClientRect().height);
  }
  const reach = {};
  const want = { 홈: "/", 신작: "/tab/new", 랭킹: "/tab/ranking", TRPG: "/trpg", 검색: "/search", 북마크: "/tab/following", 대화: "/chats", 제작: "/studio", 설정: "/settings", 페르소나: "/persona", 로그인: "/login", 포인트: "/points" };
  const links = [...document.querySelectorAll("a[href]")].filter(vis);
  for (const [k, href] of Object.entries(want)) {
    reach[k] = links.some((a) => { const h = a.getAttribute("href") || ""; return h === href || h.startsWith(href + "?") || h.startsWith(href + "#") || (href === "/chats" && h.startsWith("/login?redirect=/chats")); }) || false;
  }
  const profile = document.querySelector('button[aria-label="프로필 메뉴"]');
  reach.프로필메뉴 = !!(profile && vis(profile));
  out.reach = reach;
  const nav = {};
  for (const [k, sel] of Object.entries({ headerNav: 'nav[aria-label="주요 메뉴"]', bottom: "nav.mobile-bottom-nav", rail: "aside.app-left-rail, aside.chat-room-left-rail" })) {
    const el = document.querySelector(sel);
    nav[k] = el && vis(el) ? rect(el) : null;
  }
  out.nav = nav;
  const chrome = [...document.querySelectorAll(".site-header a, .site-header button, nav.mobile-bottom-nav a, aside.app-left-rail a, aside.app-left-rail button, aside.chat-room-left-rail a, aside.chat-room-left-rail button")].filter(vis);
  out.smallTargets = chrome.map((el) => ({ label: (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim().slice(0, 20), where: el.closest(".site-header") ? "header" : el.closest("nav.mobile-bottom-nav") ? "bottom" : "rail", ...rect(el) })).filter((x) => x.h < 40 || x.w < 40);
  const tiny = [];
  for (const el of document.querySelectorAll(".site-header *, nav.mobile-bottom-nav *, aside.app-left-rail *")) {
    if (!vis(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 11) tiny.push({ t: el.textContent.trim().slice(0, 18), fs });
  }
  out.tinyText = tiny;
  const bottomNav = document.querySelector("nav.mobile-bottom-nav");
  if (bottomNav && vis(bottomNav)) {
    const br = bottomNav.getBoundingClientRect();
    const fixedAbove = [...document.querySelectorAll("body *")].filter((el) => {
      if (bottomNav.contains(el) || !vis(el)) return false;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed") return false;
      const r = el.getBoundingClientRect();
      return r.bottom > br.top + 1 && r.top < br.bottom;
    }).map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 60), z: getComputedStyle(el).zIndex }));
    out.fixedOverlapBottom = fixedAbove;
    const main = document.querySelector("main");
    out.mainPadBottom = main ? Math.round(document.documentElement.scrollHeight - main.getBoundingClientRect().bottom - window.scrollY) : null;
  }
  const active = [...document.querySelectorAll('nav a[aria-current], aside a')].filter(vis);
  out.railActive = [...document.querySelectorAll("aside.app-left-rail nav a")].filter((a) => /text-violet-100/.test(a.className)).map((a) => a.textContent.trim());
  return out;
};

const b = await chromium.launch();
const results = {};
const shotSet = new Set((process.env.SHOTS ?? "").split(",").filter(Boolean));
for (const user of USERS) {
  for (const vw of VPS) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vw < 700 ? 800 : 900 }, locale: "ko-KR", hasTouch: vw < 600, isMobile: vw < 600 });
    if (user !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
    const page = await ctx.newPage();
    for (const [rn, path] of ROUTES) {
      const key = `${user}|${vw}|${rn}`;
      try {
        await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 });
        const ok = page.getByRole("button", { name: "확인" });
        if (await ok.count()) await ok.first().click().catch(() => {});
        await page.waitForTimeout(350);
        results[key] = await page.evaluate(measure);
        if (shotSet.has(`${user}|${vw}|${rn}`) || (process.env.SHOT_ALL && ["home", "chats"].includes(rn))) {
          await page.screenshot({ path: `${OUT}/${user}-${vw}-${rn}.png` });
        }
      } catch (e) { results[key] = { error: String(e).slice(0, 200) }; }
    }
    await ctx.close();
  }
}
fs.writeFileSync(`${OUT}/audit.json`, JSON.stringify(results, null, 1));
console.log("done", Object.keys(results).length);
await b.close();
