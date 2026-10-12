import { chromium } from "playwright-core";
import fs from "fs";

const [, , BASE, TAG] = process.argv;
const fx = JSON.parse(fs.readFileSync("/tmp/e43b-fixtures.json", "utf8"));
const OUT = process.env.OUT ?? "/tmp/e43b-out";
fs.mkdirSync(OUT, { recursive: true });
const WIDTHS = (process.env.WIDTHS ?? "360,390,575,576,640,767,768,1024,1440").split(",").map(Number);
const USERS = (process.env.USERS ?? "guest,std,adminOn,adminOff").split(",");
const PAGES = [
  ["home", "/"],
  ["new", "/tab/new"],
  ["ranking", "/tab/ranking"],
  ["search", "/search"],
  ["chats", "/chats"],
  ["chatroom", `/chat/${fx.chatId}`],
  ["trpgroom", `/trpg/${fx.campaignId}`],
  ["create", "/create"],
  ["settings", "/settings"],
];
const TARGETS = ["/tab/new", "/tab/ranking", "/trpg", "/search"];
const ANALYZE_ONLY = !!process.env.ANALYZE_ONLY;
const browser = ANALYZE_ONLY ? null : await chromium.launch();
let rows = [];

function inPage() {
  const vis = (el) => {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  };
  const links = [...document.querySelectorAll("a[href]")].filter(vis);
  const hrefSet = new Set(links.map((a) => new URL(a.href).pathname));
  const navs = [...document.querySelectorAll("nav")].filter(vis).map((n) => ({
    label: n.getAttribute("aria-label"),
    cls: n.className.includes("mobile-bottom-nav") ? "bottom" : n.closest("header") ? "header" : n.closest("aside") ? "aside" : "body",
    hrefs: [...n.querySelectorAll("a[href]")].filter(vis).map((a) => new URL(a.href).pathname),
  }));
  const discNavs = navs.filter((n) => ["/tab/new", "/tab/ranking", "/trpg", "/search"].filter((h) => n.hrefs.includes(h)).length >= 3);
  const bottom = document.querySelector("nav.mobile-bottom-nav");
  const main = document.querySelector("main");
  const bottomBeforeMain = bottom && main ? !!(main.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_PRECEDING) : null;
  const saveBar = document.querySelector('[data-testid="studio-save-bar"]');
  const r = (el) => { if (!el || !vis(el)) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) }; };
  const nb = r(bottom);
  const sb = r(saveBar);
  let overlap = 0;
  if (nb && sb) overlap = Math.max(0, Math.min(nb.bottom, sb.bottom) - Math.max(nb.top, sb.top));
  let saveBtnCovered = null;
  if (saveBar) {
    const btn = saveBar.querySelector('button[type="submit"]');
    if (btn) {
      const b = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      saveBtnCovered = !(hit && (hit === btn || btn.contains(hit)));
    }
  }
  const clipped = [...document.querySelectorAll("a, button")].filter((el) => {
    if (!vis(el)) return false;
    const b = el.getBoundingClientRect();
    if (!b.width) return false;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if ((ox === "auto" || ox === "scroll") && a.scrollWidth > a.clientWidth) return false;
    }
    return b.right > window.innerWidth + 1 || b.left < -1;
  }).length;
  return {
    reach: Object.fromEntries(["/tab/new", "/tab/ranking", "/trpg", "/search"].map((h) => [h, hrefSet.has(h)])),
    discoveryNavCount: discNavs.length,
    discoveryNavWhere: discNavs.map((n) => n.cls),
    navs: navs.map((n) => `${n.cls}:${n.label}:${n.hrefs.length}`),
    bottomBeforeMain,
    bottom: nb,
    saveBar: sb,
    overlap,
    saveBtnCovered,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    clippedControls: clipped,
    docH: document.documentElement.scrollHeight,
  };
}

for (const user of ANALYZE_ONLY ? [] : USERS) {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: w < 700 ? 800 : 900 },
      locale: "ko-KR",
      hasTouch: w < 600,
      isMobile: w < 600,
    });
    if (user !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
    const p = await ctx.newPage();
    for (const [name, path] of PAGES) {
      if (user === "guest" && ["chats", "chatroom", "trpgroom", "create", "settings"].includes(name)) continue;
      try {
        await p.goto(BASE + path, { waitUntil: "load" });
        await p.waitForTimeout(900);
        const ok = p.getByRole("button", { name: "확인", exact: true });
        if (await ok.count()) await ok.first().click().catch(() => {});
        const d = await p.evaluate(inPage);
        rows.push({ user, w, page: name, finalPath: new URL(p.url()).pathname, ...d });
        if (process.env.SHOTS && ["std", "guest"].includes(user) && [390, 640, 1440].includes(w)) {
          await p.screenshot({ path: `${OUT}/${TAG}-${user}-${name}-${w}.png` });
        }
      } catch (e) {
        rows.push({ user, w, page: name, error: String(e).slice(0, 120) });
      }
    }
    await ctx.close();
  }
}
if (browser) await browser.close();
if (ANALYZE_ONLY) rows = JSON.parse(fs.readFileSync(`${OUT}/${TAG}-probe.json`, "utf8"));
else fs.writeFileSync(`${OUT}/${TAG}-probe.json`, JSON.stringify(rows, null, 1));

const exempt = (r) => r.page === "chatroom" || r.page === "trpgroom" || r.finalPath !== undefined && /^\/(login|verify)/.test(r.finalPath);
const bad = { unreachable: [], duplicate: [], tabOrder: [], overlap: [], covered: [], overflow: [], clipped: [], errors: [] };
for (const r of rows) {
  if (r.error) { bad.errors.push(`${r.user}/${r.w}/${r.page}: ${r.error}`); continue; }
  const id = `${r.user}/${r.w}/${r.page}`;
  if (!exempt(r)) {
    const miss = TARGETS.filter((t) => !r.reach[t]);
    if (miss.length) bad.unreachable.push(`${id} missing ${miss.join(",")}`);
    if (r.discoveryNavCount > 1) bad.duplicate.push(`${id} ${r.discoveryNavWhere.join("+")}`);
  }
  if (r.bottom && r.bottomBeforeMain) bad.tabOrder.push(id);
  if (r.overlap > 0) bad.overlap.push(`${id} ${r.overlap}px`);
  if (r.saveBtnCovered) bad.covered.push(id);
  if (r.overflowX) bad.overflow.push(id);
  if (r.clippedControls) bad.clipped.push(`${id} ${r.clippedControls}`);
}
console.log(TAG, JSON.stringify(Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, v.length]))));
for (const [k, v] of Object.entries(bad)) if (v.length) console.log(k, "\n  " + v.slice(0, 60).join("\n  "));
