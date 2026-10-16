import fs from "fs";
import { launch, openPage, fx } from "./e44-lib.mjs";

const [base, label, outRoot = "/tmp/e45-shots", onlyArg = "", widthsArg = ""] = process.argv.slice(2);
const only = onlyArg ? new Set(onlyArg.split(",")) : null;
const WIDTHS = widthsArg ? widthsArg.split(",").map(Number) : [360, 390, 575, 576, 768, 1023, 1024, 1440];
const U = fx.users;
const dir = `${outRoot}/${label}`;
fs.mkdirSync(dir, { recursive: true });

const PAGES = [
  ["home-guest", "/", null],
  ["home-user", "/", "safe"],
  ["new-guest", "/tab/new", null],
  ["ranking-guest", "/tab/ranking", null],
  ["ranking-user", "/tab/ranking", "safe"],
  ["search-guest", "/search?q=%EC%83%88%EB%B2%BD", null],
  ["search-user", "/search?q=%EC%83%88%EB%B2%BD", "safe"],
  ["studio", "/studio", "creatorA"],
  ["creator-dash", "/creator", "creatorA"],
  ["my-characters", "/my-characters", "creatorA"],
  ["creator-public", `/creator/${U.creatorA}`, "safe"],
  ["creator-public-guest", `/creator/${U.creatorA}`, null],
  ["detail-user", "/character/10", "safe"],
  ["points", "/points", "safe"],
  ["settings", "/settings", "safe"],
  ["persona", "/persona", "safe"],
  ["chats", "/chats", "safe"],
  ["login", "/login", null],
];

function measure(page) {
  return page.evaluate(async () => {
    const px = (v) => Math.round(v * 10) / 10;
    const vw = innerWidth;
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: px(r.left), t: px(r.top), r: px(r.right), b: px(r.bottom), w: px(r.width), h: px(r.height) };
    };
    const header = document.querySelector("header.site-header");
    const hb = box(header);
    const rows = header ? [...header.children].filter((c) => c.getBoundingClientRect().height > 0).map((c) => box(c)) : [];
    const topRow = header?.children[0];
    const items = [];
    if (topRow) {
      for (const el of topRow.querySelectorAll("a, button, [role=switch], label, input")) {
        if (!vis(el)) continue;
        if (el.closest('nav[aria-label="주요 메뉴"]')) continue;
        const b = box(el);
        items.push({ tag: el.tagName, label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 14), ...b, clipped: el.scrollWidth > el.clientWidth + 1 });
      }
    }
    const overlaps = [];
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const c = items[j];
        const ix = Math.min(a.r, c.r) - Math.max(a.l, c.l);
        const iy = Math.min(a.b, c.b) - Math.max(a.t, c.t);
        if (ix > 1 && iy > 1) overlaps.push(`${a.label}|${c.label}`);
      }
    }
    const navs = [...document.querySelectorAll('nav[aria-label="주요 메뉴"]')].filter(vis);
    const nav = navs[0];
    const navTabs = nav ? [...nav.querySelectorAll("a")].map((a) => ({ label: a.textContent.trim(), ...box(a), active: a.getAttribute("aria-current") === "page", clipped: a.scrollWidth > a.clientWidth + 1 })) : [];
    const navInfo = nav ? { ...box(nav), scrollW: nav.scrollWidth, clientW: nav.clientWidth, scrollLeft: nav.scrollLeft, strip: nav.className.includes("lg:hidden") } : null;
    const activeTab = navTabs.find((t) => t.active);
    const activeVisible = nav && activeTab ? activeTab.l >= navInfo.l - 1 && activeTab.r <= navInfo.r + 1 : null;

    const main = document.querySelector("main");
    const shell = document.querySelector(".app-shell");
    const h1el = main?.querySelector("h1") ?? document.querySelector("h1");
    const chain = [];
    if (h1el && main) {
      for (let el = h1el; el && el !== main.parentElement; el = el.parentElement) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        chain.push({ n: `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).filter((c) => /^(max-w|mx-|px-|pl-|w-|ml-|container|app-|creator)/.test(c)).join(".").slice(0, 70)}`, l: px(r.left), w: px(r.width), pl: px(parseFloat(cs.paddingLeft)), ml: cs.marginLeft });
        if (el === main) break;
      }
    }
    const cards = [...document.querySelectorAll("main article")].filter(vis);
    const cardL = cards.length ? Math.min(...cards.map((c) => c.getBoundingClientRect().left)) : null;
    const cardR = cards.length ? Math.max(...cards.map((c) => c.getBoundingClientRect().right)) : null;
    const firstTop = cards[0]?.getBoundingClientRect().top ?? null;
    let cols = null;
    if (cards.length) {
      const tops = cards.map((c) => Math.round(c.getBoundingClientRect().top));
      cols = tops.filter((t) => t === tops[0]).length;
    }
    let minL = 1e9;
    let maxR = 0;
    for (const el of document.querySelectorAll("main *")) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed") continue;
      if (el.closest("[class*='overflow-x-auto'], [class*='snap-x']")) continue;
      const r = el.getBoundingClientRect();
      if (r.left < minL) minL = r.left;
      if (r.right > maxR) maxR = r.right;
    }
    const aside = document.querySelector("aside.app-left-rail");
    const ab = aside && getComputedStyle(aside).display !== "none" ? box(aside) : null;
    const footer = document.querySelector(".site-legal-footer");
    const doc = document.documentElement;
    const hv = parseFloat(getComputedStyle(doc).getPropertyValue("--site-header-height"));
    const smallTargets = items.filter((i) => i.h < 44 || i.w < 44).map((i) => `${i.label}:${i.w}x${i.h}`);
    return {
      vw,
      header: hb,
      headerRows: rows,
      cssHeaderVar: hv,
      topItems: items,
      overlaps,
      navInfo,
      navTabs,
      activeVisible,
      smallTargets,
      h1: h1el ? { text: h1el.textContent.trim().slice(0, 24), l: px(h1el.getBoundingClientRect().left), w: px(h1el.getBoundingClientRect().width) } : null,
      chain,
      main: box(main),
      shell: box(shell),
      cardL,
      cardR,
      cols,
      firstCardTop: firstTop === null ? null : px(firstTop + scrollY),
      contentL: px(minL),
      contentR: px(maxR),
      aside: ab,
      asideTopVsHeader: ab && hb ? px(ab.t - hb.b) : null,
      footerTop: footer ? px(footer.getBoundingClientRect().top + scrollY) : null,
      docW: doc.scrollWidth,
      hOverflow: doc.scrollWidth > vw + 1,
      title: document.title,
    };
  });
}

const b = await launch();
const results = {};
let n = 0;
for (const [name, path, user] of PAGES) {
  if (only && !only.has(name)) continue;
  for (const width of WIDTHS) {
    const { ctx, page } = await openPage(b, base, { path, user, width, wait: 700 });
    try {
      await page.evaluate(() => {
        document.querySelector('[role="dialog"] button[aria-label="공지 닫기"]')?.click();
      });
      await page.waitForTimeout(250);
      const m = await measure(page);
      results[`${name}-${width}`] = { path, user, width, ...m };
      await page.screenshot({ path: `${dir}/${name}-${width}.png` });
      n += 1;
    } catch (e) {
      results[`${name}-${width}`] = { path, user, width, error: String(e).slice(0, 200) };
      console.log("ERR", name, width, String(e).slice(0, 120));
    }
    await ctx.close();
  }
  console.log("ok", name);
}
fs.writeFileSync(`${dir}/measure.json`, JSON.stringify(results, null, 1));
console.log("done", label, n);
await b.close();
