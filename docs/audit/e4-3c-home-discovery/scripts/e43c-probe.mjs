import { chromium } from "playwright-core";
import fs from "fs";

const [, , BASE, TAG] = process.argv;
const fx = JSON.parse(fs.readFileSync("/tmp/e43c-fixtures.json", "utf8"));
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : [360, 390, 575, 576, 640, 767, 768, 1024, 1440];
const USERS = process.env.USERS ? process.env.USERS.split(",") : ["guest", "std", "adminOn", "adminOff"];
const browser = await chromium.launch();
const rows = [];

async function probe(w, user) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: w < 600 ? 844 : 900 },
    locale: "ko-KR",
    hasTouch: w < 600,
    isMobile: w < 600,
    deviceScaleFactor: 1,
  });
  if (user !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "load" });
  await p.waitForTimeout(900);
  const ok = p.getByRole("button", { name: "확인", exact: true });
  if (await ok.count()) await ok.first().click().catch(() => {});
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out = {};
    out.hOverflow = document.documentElement.scrollWidth > vw + 1;
    out.scrollWidth = document.documentElement.scrollWidth;

    const lineInfo = (el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const tops = new Set();
      let len = 0;
      let n;
      while ((n = walker.nextNode())) {
        const t = n.textContent.replace(/\s+/g, "");
        if (!t) continue;
        const rg = document.createRange();
        for (let i = 0; i < n.length; i++) {
          rg.setStart(n, i);
          rg.setEnd(n, i + 1);
          const rc = rg.getClientRects()[0];
          if (rc && rc.width > 0 && n.textContent[i].trim()) {
            tops.add(Math.round(rc.top / 4));
            len++;
          }
        }
      }
      return { len, lines: tops.size, perLine: tops.size ? len / tops.size : 0 };
    };

    const textEls = [...document.querySelectorAll("main h1, main h2, main section p, main section a, main section span.home-slab")]
      .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden")
      .filter((e) => !e.closest(".home-card"));
    const broken = [];
    for (const e of textEls) {
      const txt = e.textContent.trim();
      if (txt.length < 5) continue;
      const li = lineInfo(e);
      if (li.len >= 5 && li.lines >= 3 && li.perLine < 3.5) broken.push({ text: txt.slice(0, 24), lines: li.lines, perLine: +li.perLine.toFixed(1) });
    }
    out.charWrapped = broken;

    const banner = document.querySelector('section[aria-label="제작 이벤트"]');
    if (banner) {
      const br = banner.getBoundingClientRect();
      out.bannerH = Math.round(br.height);
      const cta = [...banner.querySelectorAll("a")].find((a) => a.textContent.includes("제작 이벤트 참여"));
      if (cta) {
        const cr = cta.getBoundingClientRect();
        out.ctaVisible = cr.right <= vw + 0.5 && cr.left >= -0.5 && cr.width > 40;
        out.ctaHref = cta.getAttribute("href");
        out.ctaRect = [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width), Math.round(cr.height)];
      }
      const titleEl = [...banner.querySelectorAll("p")].find((x) => x.textContent.includes("캐릭터를 만들면"));
      if (titleEl) {
        const tr = titleEl.getBoundingClientRect();
        out.eventTitleW = Math.round(tr.width);
        out.eventTitleH = Math.round(tr.height);
        out.eventTitleLines = lineInfo(titleEl).lines;
      }
      const kids = [...banner.querySelectorAll("*")];
      out.bannerChildOverflow = kids.some((k) => {
        const rc = k.getBoundingClientRect();
        return rc.width > 0 && (rc.right > vw + 1 || rc.left < -1);
      });
    }
    out.heads = [...document.querySelectorAll("main h1, main h2")].map((h) => {
      const rc = h.getBoundingClientRect();
      const li = lineInfo(h);
      return { t: h.textContent.trim(), w: Math.round(rc.width), h: Math.round(rc.height), lines: li.lines };
    });
    out.links = {
      ranking: [...document.querySelectorAll('main a[href="/tab/ranking"]')].map((a) => a.textContent.trim()),
      newTab: [...document.querySelectorAll('main a[href="/tab/new"]')].map((a) => a.textContent.trim()),
      cards: document.querySelectorAll("main .home-card a[href^='/character/']").length,
    };

    const frames = [...document.querySelectorAll("main .home-card-frame")];
    let seen = 0;
    let firstImgTop = null;
    for (const f of frames) {
      const rc = f.getBoundingClientRect();
      const vis = Math.max(0, Math.min(rc.right, vw) - Math.max(rc.left, 0)) * Math.max(0, Math.min(rc.bottom, vh) - Math.max(rc.top, 0));
      seen += vis;
      if (vis > 0 && firstImgTop == null) firstImgTop = Math.round(rc.top);
    }
    out.firstScreen = {
      vh,
      imageAreaPct: +((seen / (vw * vh)) * 100).toFixed(1),
      firstCardTop: firstImgTop,
      cardsIntersecting: frames.filter((f) => {
        const rc = f.getBoundingClientRect();
        return rc.top < vh && rc.bottom > 0 && rc.left < vw && rc.right > 0;
      }).length,
    };

    out.rows = [...document.querySelectorAll("main .home-card-row")].map((row) => {
      const rr = row.getBoundingClientRect();
      const cards = [...row.children];
      const partial = cards.filter((c) => {
        const rc = c.getBoundingClientRect();
        return rc.right > rr.right + 1 && rc.left < rr.right - 8;
      });
      const peek = partial.length ? Math.round(Math.min(partial[0].getBoundingClientRect().right, 1e9) - 0 - 0) : 0;
      const first = partial[0]?.getBoundingClientRect();
      return {
        cards: cards.length,
        scrollable: row.scrollWidth > row.clientWidth + 1,
        peekPx: first ? Math.round(rr.right - first.left) : 0,
        peekPct: first ? Math.round(((rr.right - first.left) / first.width) * 100) : 0,
        visibleCards: cards.filter((c) => {
          const rc = c.getBoundingClientRect();
          return rc.left >= rr.left - 1 && rc.right <= rr.right + 1;
        }).length,
      };
    });
    out.gridCols = (() => {
      const g = document.querySelector("main .home-grid-stagger");
      if (!g) return null;
      return getComputedStyle(g).gridTemplateColumns.split(" ").length;
    })();
    out.adultLabelsVisible = document.body.innerText.includes("성인 테스트 캐릭터");
    out.officialBadges = document.querySelectorAll("main .home-card").length;
    return out;
  });
  await ctx.close();
  return r;
}

for (const w of WIDTHS) {
  for (const u of USERS) {
    const r = await probe(w, u);
    rows.push({ w, user: u, ...r });
    const bad = r.charWrapped.length || r.hOverflow || r.ctaVisible === false || r.bannerChildOverflow;
    console.log(`${w} ${u} wrapped=${r.charWrapped.length} hOver=${r.hOverflow} cta=${r.ctaVisible} bannerH=${r.bannerH} img=${r.firstScreen.imageAreaPct}% ${bad ? "BAD" : "ok"}`);
  }
}
fs.writeFileSync(`/tmp/e43c-probe-${TAG}.json`, JSON.stringify(rows, null, 1));
const bad = rows.filter((r) => r.charWrapped.length || r.hOverflow || r.ctaVisible === false || r.bannerChildOverflow);
console.log(`SUMMARY ${TAG}: states=${rows.length} bad=${bad.length} charWrapped=${rows.filter((r) => r.charWrapped.length).length} hOverflow=${rows.filter((r) => r.hOverflow).length} ctaClipped=${rows.filter((r) => r.ctaVisible === false).length}`);
await browser.close();
