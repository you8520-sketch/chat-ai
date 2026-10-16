import fs from "fs";
import { launch, openPage, measure, snap, fx } from "./e44-lib.mjs";

const [base, label, outRoot = "/tmp/e44-shots", onlyArg = ""] = process.argv.slice(2);
const only = onlyArg ? new Set(onlyArg.split(",")) : null;
const WIDTHS = [360, 390, 768, 1440];
const U = fx.users;

const PAGES = [
  ["home-guest", "/", null],
  ["new-guest", "/tab/new", null],
  ["ranking-guest", "/tab/ranking", null],
  ["search-guest", "/search?q=%EC%83%88%EB%B2%BD", null],
  ["detail-guest", "/character/10", null],
  ["creator-public", `/creator/${U.creatorA}`, null],
  ["login", "/login", null],
  ["home-user", "/", "safe"],
  ["points", "/points", "safe"],
  ["settings", "/settings", "safe"],
  ["persona", "/persona", "safe"],
  ["chats", "/chats", "safe"],
  ["bookmarks", "/bookmarks", "safe"],
  ["notifications", "/notifications", "safe"],
  ["detail-user", "/character/10", "safe"],
  ["search-user", "/search?q=%EC%83%88%EB%B2%BD", "safe"],
  ["studio", "/studio", "creatorA"],
  ["my-characters", "/my-characters", "creatorA"],
  ["creator-dash", "/creator", "creatorA"],
  ["create", "/create", "creatorA"],
  ["creator-public-user", `/creator/${U.creatorA}`, "safe"],
  ["points-creator", "/points", "creatorA"],
  ["home-admin", "/", "admin"],
];

function extra(page) {
  return page.evaluate(async () => {
    const px = (v) => Math.round(v * 10) / 10;
    const vw = innerWidth;
    const vh = innerHeight;
    const nav = performance.getEntriesByType("navigation")[0];
    const header = document.querySelector("header");
    const hr = header?.getBoundingClientRect();
    const hs = header ? getComputedStyle(header) : null;
    const bottom = document.querySelector('nav[aria-label="모바일 메뉴"]');
    const bcs = bottom ? getComputedStyle(bottom) : null;
    const bottomVisible = bottom && bcs.display !== "none" ? bottom.getBoundingClientRect() : null;
    const active = [...document.querySelectorAll('[aria-current="page"], [aria-current="true"]')]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 16));
    const navActive = [...document.querySelectorAll("header a[aria-current], aside a[aria-current], nav[aria-label='모바일 메뉴'] a[aria-current]")]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => (e.textContent || "").trim().slice(0, 16));
    scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    await new Promise((r) => setTimeout(r, 500));
    let lowest = 0;
    let lowestEl = "";
    for (const el of document.querySelectorAll("main *, footer *")) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.position === "fixed") continue;
      if (el.children.length > 0 && !(el.matches("p,span,a,button,li,h1,h2,h3,label,input,img"))) continue;
      if (r.bottom > lowest) {
        lowest = r.bottom;
        lowestEl = `${el.tagName}:${(el.textContent || "").trim().slice(0, 24)}`;
      }
    }
    const bottomTop = bottomVisible ? bottomVisible.top : null;
    const scrollbarX = document.documentElement.scrollWidth > vw + 1;
    const fixedEls = [...document.querySelectorAll("body *")]
      .filter((e) => getComputedStyle(e).position === "fixed" && e.getBoundingClientRect().width > 0)
      .map((e) => ({ tag: e.tagName, label: e.getAttribute("aria-label") || "", h: px(e.getBoundingClientRect().height), top: px(e.getBoundingClientRect().top), bottom: px(e.getBoundingClientRect().bottom) }));
    const h1 = [...document.querySelectorAll("h1")].map((e) => e.textContent.trim().slice(0, 30));
    const h1el = document.querySelector("main h1") ?? document.querySelector("h1");
    const mainEl = document.querySelector("main");
    const mr = mainEl?.getBoundingClientRect();
    const h1r = h1el?.getBoundingClientRect();
    let maxRight = 0;
    let minLeft = 1e9;
    for (const el of document.querySelectorAll("main *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).position === "fixed") continue;
      if (r.right > maxRight) maxRight = r.right;
      if (r.left < minLeft) minLeft = r.left;
    }
    const aside = document.querySelector("aside.app-left-rail");
    const ar = aside && getComputedStyle(aside).display !== "none" ? aside.getBoundingClientRect() : null;
    const layout = { h1Left: h1r ? px(h1r.left) : null, h1Top: h1r ? px(h1r.top + scrollY) : null, mainLeft: mr ? px(mr.left) : null, mainWidth: mr ? px(mr.width) : null, contentLeft: px(minLeft), contentRight: px(maxRight), asideRight: ar ? px(ar.right) : null, asideTop: ar ? px(ar.top) : null, asideBottom: ar ? px(ar.bottom) : null };
    scrollTo({ top: 0, behavior: "instant" });
    return {
      status: nav?.responseStatus,
      title: document.title,
      h1,
      layout,
      headerH: hr ? px(hr.height) : null,
      headerPos: hs?.position ?? null,
      headerShare: hr ? px((hr.height / vh) * 100) : null,
      bottomNav: bottomVisible ? { top: px(bottomVisible.top), h: px(bottomVisible.height) } : null,
      lowestContent: px(lowest),
      lowestEl,
      contentCoveredByBottomNav: bottomTop != null ? lowest > bottomTop + 1 : false,
      overlapPx: bottomTop != null ? px(Math.max(0, lowest - bottomTop)) : 0,
      active,
      navActive,
      fixedEls,
      hScrollDoc: scrollbarX,
    };
  });
}

const b = await launch();
const results = {};
let fail = 0;
for (const [name, path, user] of PAGES) {
  if (only && !only.has(name)) continue;
  for (const width of WIDTHS) {
    const key = `${name}-${width}`;
    const t0 = Date.now();
    try {
      const { ctx, page } = await openPage(b, base, { path, user, width, wait: 700 });
      let notice = null;
      const dlg = page.locator('[role="dialog"][aria-labelledby="home-popup-notice-title"]');
      if (await dlg.count()) {
        await snap(page, `${outRoot}/${label}/${width}/${name}-notice.png`);
        notice = await page.evaluate(() => {
          const d = document.querySelector('[role="dialog"]');
          const out = [];
          for (const el of d.querySelectorAll("button, input, a, label")) {
            const r = el.getBoundingClientRect();
            out.push({ tag: el.tagName, text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 14), w: Math.round(r.width), h: Math.round(r.height) });
          }
          const r = d.getBoundingClientRect();
          return { dialog: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }, controls: out, activeTag: document.activeElement?.tagName, inDialog: d.contains(document.activeElement) };
        });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);
        notice.escapeClosed = (await dlg.count()) === 0;
        if (!notice.escapeClosed) await dlg.getByRole("button", { name: "확인" }).click();
        await page.waitForTimeout(250);
      }
      const m = await measure(page);
      const e = await extra(page);
      m.errors = page.__errors.slice(0, 4);
      m.external = page.__external.length;
      m.posts = page.__posts;
      m.finalUrl = new URL(page.url()).pathname + new URL(page.url()).search;
      const dir = `${outRoot}/${label}/${width}`;
      await snap(page, `${dir}/${name}.png`);
      if (width === 390 || width === 360) {
        await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${dir}/${name}-bottom.png` });
        await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      }
      if (width === 390 || (width === 1440 && ["home-guest", "studio", "points", "creator-public"].includes(name))) {
        await snap(page, `${dir}/${name}-full.png`, { full: true });
      }
      results[key] = { path, user, width, notice, ...m, ...e };
      await ctx.close();
      console.log("ok", key, Date.now() - t0, "ms", e.status, m.finalUrl);
    } catch (err) {
      fail++;
      results[key] = { path, user, width, error: String(err).slice(0, 200) };
      console.log("FAIL", key, String(err).slice(0, 120));
    }
  }
}
fs.mkdirSync(`${outRoot}/${label}`, { recursive: true });
fs.writeFileSync(`${outRoot}/${label}/results.json`, JSON.stringify(results, null, 1));
console.log(`done ${label}: ${Object.keys(results).length} scenes, ${fail} failed`);
await b.close();
