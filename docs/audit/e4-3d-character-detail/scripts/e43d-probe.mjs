import { chromium } from "playwright-core";
import fs from "fs";

const [, , BASE, TAG] = process.argv;
const fx = JSON.parse(fs.readFileSync("/tmp/e43d-fixtures.json", "utf8"));
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : [360, 390, 576, 640, 768, 1024, 1440];
const CHARS = process.env.CHARS ? process.env.CHARS.split(",") : ["rich", "long", "noimg", "single", "official", "sim"];
const USER = process.env.USER_KEY || "std";
const browser = await chromium.launch();
const rows = [];

async function probe(w, key) {
  const vhIn = w < 600 ? 844 : 900;
  const ctx = await browser.newContext({ viewport: { width: w, height: vhIn }, locale: "ko-KR", hasTouch: w < 600, isMobile: w < 600, deviceScaleFactor: 1 });
  if (USER !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[USER], url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/character/${fx.ids[key]}`, { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const R = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top + scrollY), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom + scrollY) };
    };
    const lines = (el) => {
      if (!el) return 0;
      const rg = document.createRange();
      const tops = new Set();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        for (let i = 0; i < n.length; i++) {
          if (!n.textContent[i].trim()) continue;
          rg.setStart(n, i);
          rg.setEnd(n, i + 1);
          const rc = rg.getClientRects()[0];
          if (rc && rc.width > 0) tops.add(Math.round(rc.top / 4));
        }
      }
      return tops.size;
    };
    const out = { vw, vh };
    out.hOverflow = document.documentElement.scrollWidth > vw + 1;
    out.scrollWidth = document.documentElement.scrollWidth;
    out.docH = document.documentElement.scrollHeight;
    const hero = document.querySelector("[data-character-hero]");
    const poster = document.querySelector("[data-character-hero-image]");
    const h1 = hero?.querySelector("h1");
    const tagline = hero?.querySelector('[data-hero-item="tagline"]') || [...(hero?.querySelectorAll("p") || [])].find((x) => x.getAttribute("data-hero-item"));
    out.hero = R(hero);
    out.poster = R(poster);
    out.h1 = R(h1);
    out.h1Lines = lines(h1);
    out.h1Font = h1 ? parseFloat(getComputedStyle(h1).fontSize) : null;
    out.h1Text = h1?.textContent.trim();
    out.tagline = R(tagline);
    out.taglineLines = lines(tagline);
    const nav = document.querySelector('nav[aria-label="모바일 메뉴"]');
    const navVisible = nav && nav.getClientRects().length > 0;
    out.nav = navVisible ? { h: Math.round(nav.getBoundingClientRect().height), top: Math.round(nav.getBoundingClientRect().top) } : null;
    const effVh = vh - (out.nav ? out.nav.h : 0);
    out.effVh = effVh;
    const vis = (rc) => (rc ? Math.max(0, Math.min(rc.b, effVh) - Math.max(rc.y, 0)) / rc.h : 0);
    out.posterVisPct = Math.round(vis(out.poster) * 100);
    out.h1VisPct = Math.round(vis(out.h1) * 100);
    out.taglineVisPct = Math.round(vis(out.tagline) * 100);
    const startBtn = [...document.querySelectorAll("main button")].find((b) => /대화 시작/.test(b.textContent));
    out.start = R(startBtn);
    out.startText = startBtn?.textContent.trim();
    out.startVisibleFirstScreen = out.start ? out.start.y >= 0 && out.start.b <= effVh : false;
    out.startFoldPx = out.start ? out.start.y - effVh : null;
    out.startBg = startBtn ? getComputedStyle(startBtn).backgroundColor : null;
    const trpg = [...document.querySelectorAll("main a")].find((a) => /TRPG로 시작/.test(a.textContent));
    out.trpg = R(trpg);
    const gal = document.querySelector("[data-asset-gallery], section[aria-label*='갤러리']") || [...document.querySelectorAll("main h2, main h3")].find((h) => /갤러리|이미지/.test(h.textContent))?.closest("section,div");
    out.gallery = R(gal);
    const intro = [...document.querySelectorAll("main h2, main h3")].find((h) => /소개|캐릭터 소개|설명/.test(h.textContent));
    out.introHead = intro ? { t: intro.textContent.trim(), ...R(intro) } : null;
    const likeBtns = [...document.querySelectorAll("main button")].filter((b) => /좋아요|팔로우|선물|후원|공유/.test(b.textContent + (b.getAttribute("aria-label") || "")));
    out.actions = likeBtns.map((b) => ({ t: b.textContent.trim().slice(0, 12), ...R(b) }));
    const row = startBtn?.closest("div.flex")?.parentElement;
    out.actionRow = R(row);
    out.buttonsBelowStart = out.start ? [...document.querySelectorAll("main button, main a.rounded-full")].filter((b) => R(b).y > out.start.b - 4 && b.getClientRects().length).length : 0;
    const pending = [...document.querySelectorAll("main *")].filter((e) => {
      if (e.closest(".sr-only") || e.classList.contains("sr-only")) return false;
      if (!e.getClientRects().length) return false;
      const cs = getComputedStyle(e);
      if (!e.childNodes.length || ![...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) return false;
      const clipH = e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== "visible";
      const clipV = e.scrollHeight > e.clientHeight + 2 && cs.overflowY !== "visible" && cs.display !== "inline";
      return clipH || clipV;
    });
    out.clipped = pending.slice(0, 8).map((e) => ({ tag: e.tagName, t: e.textContent.trim().slice(0, 20), sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight }));
    out.offscreenX = [...document.querySelectorAll("main *")].filter((e) => {
      if (!e.getClientRects().length) return false;
      const b = e.getBoundingClientRect();
      if (b.width === 0) return false;
      if (e.closest("[data-asset-lightbox], [data-asset-gallery-scroll]")) return false;
      return b.right > vw + 1 || b.left < -1;
    }).slice(0, 6).map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 40), l: Math.round(e.getBoundingClientRect().left), r: Math.round(e.getBoundingClientRect().right) }));
    out.order = ["h1", "tagline", "gallery", "introHead", "start"].map((k) => [k, out[k]?.y]).filter(([, y]) => y != null);
    return out;
  });
  const imgs = await p.evaluate(() => [...document.querySelectorAll("main img")].map((i) => ({ w: i.naturalWidth, h: i.naturalHeight, rw: Math.round(i.getBoundingClientRect().width), rh: Math.round(i.getBoundingClientRect().height), cmpl: i.complete })));
  r.imgs = imgs.length;
  await ctx.close();
  return r;
}

for (const w of WIDTHS) {
  for (const k of CHARS) {
    const r = await probe(w, k);
    rows.push({ w, char: k, ...r });
    console.log(
      `${w} ${k.padEnd(8)} hO=${r.hOverflow ? "Y" : "n"} poster=${r.poster?.w}x${r.poster?.h}@${r.poster?.y} vis=${r.posterVisPct}% h1L=${r.h1Lines} h1vis=${r.h1VisPct}% tagvis=${r.taglineVisPct}% start@${r.start?.y} fold=${r.startFoldPx} startVis=${r.startVisibleFirstScreen} clip=${r.clipped.length} off=${r.offscreenX.length}`,
    );
  }
}
fs.writeFileSync(`/tmp/e43d-probe-${TAG}.json`, JSON.stringify(rows, null, 1));
await browser.close();
