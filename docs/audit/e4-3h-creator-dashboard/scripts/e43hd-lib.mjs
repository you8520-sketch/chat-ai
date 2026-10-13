import { chromium } from "playwright-core";
import fs from "fs";

export const fx = JSON.parse(fs.readFileSync("/tmp/e43h-fixtures.json", "utf8"));
export const HEIGHTS = { 360: 800, 390: 844, 576: 900, 640: 900, 768: 1024, 1024: 800, 1440: 900 };
export const WIDTHS = [360, 390, 576, 640, 768, 1024, 1440];
export const launch = () => chromium.launch();

export async function openPage(browser, base, { path, user = "member", width = 390, height, wait = 1800, routes = null, dialog = "accept" }) {
  const mobile = width < 576;
  const h = height ?? HEIGHTS[width] ?? 900;
  const ctx = await browser.newContext({ viewport: { width, height: h }, locale: "ko-KR", hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1, reducedMotion: "reduce" });
  await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: base }]);
  const page = await ctx.newPage();
  page.__providerPosts = [];
  page.__calls = [];
  page.__dialogs = [];
  page.__bodies = [];
  page.on("request", (r) => {
    const u = r.url();
    if (r.method() === "POST" && /openrouter|api\.openai|anthropic|generativelanguage/.test(u)) { page.__providerPosts.push(u); (globalThis.__prov ??= []).push(u); }
    if (!["GET", "HEAD"].includes(r.method()) && u.startsWith(base)) page.__calls.push({ m: r.method(), p: new URL(u).pathname, body: r.postData()?.slice(0, 400) ?? null });
  });
  page.__mode = "ok";
  await page.route(`${base}/api/**`, async (route) => {
    const req = route.request();
    const m = req.method();
    if (m === "GET" || m === "HEAD") return route.continue();
    const p = new URL(req.url()).pathname;
    const body = (() => { try { return JSON.parse(req.postData() || "{}"); } catch { return {}; } })();
    if (page.__mode === "network" && /^\/api\/creator(\/withdraw)?$/.test(p) && m === "POST") return route.abort("failed");
    if (page.__mode === "insufficient" && /^\/api\/creator(\/withdraw)?$/.test(p) && m === "POST")
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: p.endsWith("withdraw") ? "보유 CP가 부족합니다." : "크리에이터 포인트가 부족합니다." }) });
    if (page.__mode === "slow" && m === "POST") await new Promise((r) => setTimeout(r, 1500));
    const json = (o) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
    if (p === "/api/creator" && m === "POST") return json({ exchanged: Number(body.amount) });
    if (p === "/api/creator/withdraw") return json({ payoutAmount: Math.round(Number(body.amount) * 0.8) });
    if (p === "/api/creator" && m === "PATCH") return json({ creator_profile_html: body.creator_profile_html });
    return json({ ok: true });
  });
  page.on("dialog", async (d) => {
    page.__dialogs.push({ type: d.type(), message: d.message().slice(0, 120) });
    if (dialog === "dismiss") await d.dismiss(); else await d.accept();
  });
  if (routes) await routes(page);
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(wait);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

export function measure(page) {
  return page.evaluate(() => {
    const px = (v) => Math.round(v * 10) / 10;
    const vw = innerWidth, vh = innerHeight;
    const out = { vw, vh, scrollY: px(scrollY), docH: document.documentElement.scrollHeight, hOverflow: document.documentElement.scrollWidth > vw + 1 };
    const nav = document.querySelector('nav[aria-label="모바일 메뉴"]');
    const navR = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect() : null;
    out.mobileNavTop = navR ? px(navR.top) : null;
    const small = [];
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !el.closest('[aria-hidden="true"]') && !el.closest("[hidden]") && !el.closest("header") && !el.closest("nav"); };
    for (const el of document.querySelectorAll("main button, main a[href], main select, main input:not([type=hidden]), main textarea, [data-page] button")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (el.tagName === "A" && el.closest("p, li") && el.textContent.trim().length > 12 && r.height < 32 && false) continue;
      if (r.height < 32 || r.width < 32) small.push({ l: (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("placeholder") ?? "").trim().slice(0, 14), w: px(r.width), h: px(r.height) });
    }
    out.smallTargets = small.slice(0, 20);
    out.smallTargetCount = small.length;
    const clipped = [];
    for (const el of document.querySelectorAll("main *")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) clipped.push((el.tagName + ":" + (el.textContent ?? "").trim().slice(0, 20)));
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 2 && ["hidden", "clip"].includes(cs.overflowX) && cs.textOverflow !== "ellipsis" && el.clientWidth > 0 && !["TEXTAREA", "INPUT", "SELECT"].includes(el.tagName)) clipped.push("OVERFLOW-HIDDEN:" + (el.textContent ?? "").trim().slice(0, 20));
    }
    out.clipped = clipped.slice(0, 8);
    const ctl = [...document.querySelectorAll("main input:not([type=hidden]):not([type=file]):not([type=checkbox]), main textarea, main select")].filter(vis);
    const named = (e) => (e.labels && e.labels.length) || e.getAttribute("aria-label") || e.getAttribute("aria-labelledby");
    out.controls = { visible: ctl.length, named: ctl.filter(named).length, unnamed: ctl.filter((e) => !named(e)).map((e) => (e.getAttribute("placeholder") || e.tagName).slice(0, 18)).slice(0, 8) };
    const fs = [...document.querySelectorAll("main *")].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && vis(e)).map((e) => parseFloat(getComputedStyle(e).fontSize));
    out.tinyTextCount = fs.filter((f) => f < 12).length;
    return out;
  });
}

export function inViewport(page, locator) {
  return locator.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.bottom > 0 && r.top < innerHeight, vh: innerHeight }; }).catch(() => null);
}
