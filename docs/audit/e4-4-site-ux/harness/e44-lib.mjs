import { chromium } from "playwright-core";
import { createRequire } from "module";
import fs from "fs";

const require = createRequire("/workspace/package.json");
const Database = require("better-sqlite3");

export const fx = JSON.parse(fs.readFileSync("/tmp/e44-fixtures.json", "utf8"));
export const HEIGHTS = { 360: 800, 390: 844, 576: 900, 768: 1024, 1024: 800, 1440: 900 };
export const launch = () => chromium.launch();
export const db = () => new Database("/tmp/e44-data/app.db");

export async function openPage(browser, base, o) {
  const { path = "/search", user = null, width = 390, height, wait = 900, reduced = "reduce" } = o;
  const mobile = width < 576;
  const h = height ?? HEIGHTS[width] ?? 900;
  const ctx = await browser.newContext({
    viewport: { width, height: h },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    hasTouch: mobile,
    isMobile: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
    reducedMotion: reduced,
  });
  if (user) await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: base }]);
  const page = await ctx.newPage();
  page.__posts = [];
  page.__external = [];
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && page.__errors.push(m.text().slice(0, 200)));
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(base) && !u.startsWith("data:") && !u.startsWith("blob:")) page.__external.push(u.slice(0, 120));
    if (!["GET", "HEAD"].includes(r.method()) && u.startsWith(base)) page.__posts.push({ m: r.method(), p: new URL(u).pathname });
  });
  await page.route((url) => !url.href.startsWith(base) && !/^(data|blob):/.test(url.href), (route) => route.abort());
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(wait);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

export function measure(page, scope = "main") {
  return page.evaluate((scopeSel) => {
    const px = (v) => Math.round(v * 10) / 10;
    const vw = document.documentElement.clientWidth;
    const root = document.querySelector(scopeSel) ?? document.body;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const inCard = (el) => Boolean(el.closest("div.grid.grid-cols-2"));
    const small = [];
    for (const el of root.querySelectorAll('button, a[href], input, [role="tab"], select, textarea')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 44 || r.width < 44) {
        small.push({ card: inCard(el), tag: el.tagName, text: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().slice(0, 24), w: px(r.width), h: px(r.height) });
      }
    }
    let tinyText = 0;
    let tinyCard = 0;
    const tinySample = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || !visible(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12) {
        if (inCard(el)) tinyCard++;
        tinyText++;
        if (tinySample.length < 5) tinySample.push({ fs, text: n.textContent.trim().slice(0, 20) });
      }
    }
    const clipped = [];
    for (const el of root.querySelectorAll("*")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      let scrolled = false;
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") { scrolled = true; break; }
      }
      if (!scrolled && (r.right > vw + 1 || r.left < -1)) clipped.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), right: px(r.right) });
      if (clipped.length > 5) break;
    }
    const cells = [...document.querySelectorAll('[data-testid^="attendance-cell-"], #attendance-grid > *')].map((el) => {
      const r = el.getBoundingClientRect();
      return { w: px(r.width), h: px(r.height) };
    });
    return {
      vw,
      docH: document.documentElement.scrollHeight,
      hOverflow: document.documentElement.scrollWidth > vw + 1,
      smallTargets: small.length,
      smallTargetsPage: small.filter((x) => !x.card).length,
      smallTargetsCard: small.filter((x) => x.card).length,
      tinyCard,
      tinyPage: tinyText - tinyCard,
      smallSample: small.filter((x) => !x.card).slice(0, 8),
      tinyText,
      tinySample,
      outOfViewport: clipped,
      cellSize: cells[0] ?? null,
    };
  }, scope);
}

/** Scroll through the page so lazy images load, then wait for every image to finish. */
export async function settle(page) {
  await page.evaluate(async () => {
    const step = Math.max(300, innerHeight - 100);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    scrollTo(0, 0);
    await Promise.all(
      [...document.images].map((img) => (img.complete ? 1 : new Promise((r) => { img.onload = img.onerror = r; }))),
    );
    await new Promise((r) => setTimeout(r, 200));
  });
}

export async function snap(page, file, { full = false, locator } = {}) {
  if (full) await settle(page);
  fs.mkdirSync(file.replace(/\/[^/]+$/, ""), { recursive: true });
  if (locator) {
    await locator.scrollIntoViewIfNeeded();
    await locator.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: full });
  }
}

/** Click that survives the BEFORE page's horizontally-overflowing layout (overlay hit-test failures). */
export async function tap(locator) {
  try {
    await locator.click({ timeout: 2500 });
  } catch {
    await locator.dispatchEvent("click");
  }
}
