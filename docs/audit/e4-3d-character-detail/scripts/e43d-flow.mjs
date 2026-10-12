import { chromium } from "playwright-core";
import fs from "fs";

const [, , BASE, TAG] = process.argv;
const fx = JSON.parse(fs.readFileSync("/tmp/e43d-fixtures.json", "utf8"));
const browser = await chromium.launch();
const results = [];
const rec = (name, ok, detail = {}) => {
  results.push({ name, ok, ...detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
};

async function ctxFor(user, w = 1440, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "ko-KR", hasTouch: w < 600, isMobile: w < 600 });
  if (user !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  return ctx;
}
const detail = (key) => `${BASE}/character/${fx.ids[key]}`;

for (const w of [390, 1440]) {
  const ctx = await ctxFor("std", w, w < 600 ? 844 : 900);
  const p = await ctx.newPage();
  await p.goto(detail("rich"), { waitUntil: "load" });
  await p.waitForTimeout(1000);

  // start dialog (std has 2 chats with rich)
  const start = p.getByRole("button", { name: /대화 시작/ }).first();
  await start.scrollIntoViewIfNeeded();
  await start.click();
  await p.waitForTimeout(400);
  const dlg = p.getByRole("dialog");
  const dlgOk = (await dlg.count()) > 0;
  let dlgInfo = {};
  if (dlgOk) {
    const info = await p.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const r = d.getBoundingClientRect();
      const btns = [...d.querySelectorAll("button, a")].map((b) => {
        const br = b.getBoundingClientRect();
        const top = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
        return { t: b.textContent.trim().slice(0, 10), onTop: !!top && (b === top || b.contains(top)) };
      });
      const nav = document.querySelector('nav[aria-label="모바일 메뉴"]');
      const hdr = document.querySelector("header");
      return {
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        vh: innerHeight,
        btns,
        navOverlaps: nav && nav.getClientRects().length ? nav.getBoundingClientRect().top < r.bottom : false,
      };
    });
    dlgInfo = info;
    await p.screenshot({ path: `/opt/cursor/artifacts/e43d/flow-${TAG}-startdialog-${w}.png` });
  }
  rec(`start dialog opens, all buttons on top @${w}`, dlgOk && dlgInfo.btns?.every((b) => b.onTop) && dlgInfo.btns?.length >= 3, { btns: dlgInfo.btns?.length, rect: dlgInfo.rect });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(200);
  rec(`Escape closes start dialog @${w}`, (await p.getByRole("dialog").count()) === 0);

  // continue existing chat -> /chat/<id>?...
  await start.click();
  await p.waitForTimeout(300);
  const cont = p.getByRole("button", { name: /기존 대화 1/ }).first();
  const hasCont = (await cont.count()) > 0;
  if (hasCont) {
    await Promise.all([p.waitForURL(/\/chat\//, { timeout: 8000 }).catch(() => {}), cont.click()]);
    rec(`existing chat continue navigates @${w}`, /\/chat\//.test(p.url()), { url: p.url().replace(BASE, "") });
  } else rec(`existing chat continue navigates @${w}`, false, { reason: "no 기존 대화 button" });
  await p.goto(detail("rich"), { waitUntil: "load" });
  await p.waitForTimeout(800);

  // persona selector
  const personaBtn = p.getByTitle("페르소나 선택").first();
  const hasPersona = (await personaBtn.count()) > 0;
  if (hasPersona) {
    const optProbe = () =>
      p.evaluate(() => {
        const list = [...document.querySelectorAll("main div.absolute.z-30 button")];
        return list.map((b) => {
          const r = b.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { onTop: !!top && (b === top || b.contains(top)) && r.bottom <= innerHeight };
        });
      });
    await p.evaluate(() => window.scrollTo(0, 0));
    await personaBtn.click({ force: true }).catch(() => {});
    await p.waitForTimeout(250);
    const first = await optProbe();
    rec(`persona dropdown visible without scrolling @${w} (info)`, true, { visibleWithoutScroll: first.length > 0 && first.every((o) => o.onTop), personaY: await personaBtn.evaluate((e) => Math.round(e.getBoundingClientRect().top)) });
    await p.keyboard.press("Escape");
    await p.mouse.click(5, 5);
    await p.waitForTimeout(150);
    await personaBtn.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await p.waitForTimeout(150);
    if ((await p.locator("main div.absolute.z-30 button").count()) === 0) await personaBtn.click();
    await p.waitForTimeout(250);
    const opts = await p.evaluate(() => {
      const list = [...document.querySelectorAll("main div.absolute.z-30 button")];
      return list.map((b) => {
        const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { t: b.textContent.trim().slice(0, 14), inView: r.bottom <= innerHeight && r.top >= 0, onTop: !!top && (b === top || b.contains(top)) };
      });
    });
    await p.screenshot({ path: `/opt/cursor/artifacts/e43d/flow-${TAG}-persona-${w}.png` });
    rec(`persona dropdown not clipped @${w}`, opts.length >= 2 && opts.every((o) => o.onTop), { opts });
    const second = p.locator("main div.absolute.z-30 button").nth(1);
    const name2 = (await second.textContent())?.trim().slice(0, 8);
    await second.click();
    await p.waitForTimeout(300);
    const stored = await p.evaluate(() => localStorage.getItem("habi:lastPersonaId"));
    rec(`persona change persists @${w}`, !!stored, { stored, name2 });
  } else rec(`persona dropdown not clipped @${w}`, false, { reason: "no persona selector" });

  // gallery lightbox + lock
  const thumbs = p.getByRole("button", { name: /이미지 크게 보기/ });
  const nThumb = await thumbs.count();
  if (nThumb) {
    await thumbs.first().scrollIntoViewIfNeeded();
    await thumbs.first().click();
    await p.waitForTimeout(500);
    const lb = await p.evaluate(() => !!document.querySelector('[role="dialog"]') || !!document.querySelector("[data-asset-lightbox]"));
    await p.screenshot({ path: `/opt/cursor/artifacts/e43d/flow-${TAG}-lightbox-${w}.png` });
    rec(`gallery lightbox opens @${w}`, lb, { thumbs: nThumb });
    await p.keyboard.press("Escape");
    await p.waitForTimeout(200);
  } else rec(`gallery lightbox opens @${w}`, false, { reason: "no unlocked thumbs" });
  const lockedCount = await p.evaluate(() => document.body.innerText.split("\n").filter((l) => /숨김|잠김|잠금/.test(l)).length);
  rec(`locked gallery assets still locked @${w}`, lockedCount > 0, { lockedCount });

  // like/follow/gift buttons present; share
  const present = await p.evaluate(() => {
    const t = [...document.querySelectorAll("main button, main a")].map((e) => e.textContent.trim() + "|" + (e.getAttribute("aria-label") || ""));
    return { like: !!document.querySelector('main button[title^="좋아요"]'), follow: t.some((x) => /팔로우/.test(x)), gift: t.some((x) => /포인트 선물/.test(x)), share: t.some((x) => /링크/.test(x)), comments: /댓글/.test(document.body.innerText) };
  });
  rec(`like/follow/gift/share/comments present @${w}`, Object.values(present).every(Boolean), present);

  // action row density
  const dens = await p.evaluate(() => {
    const f = [...document.querySelectorAll("main button")].find((b) => /팔로우/.test(b.textContent));
    const row = f?.parentElement;
    const rr = row?.getBoundingClientRect();
    const btns = row ? [...row.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().height)) : [];
    return { rowH: rr ? Math.round(rr.height) : null, rowW: rr ? Math.round(rr.width) : null, btns };
  });
  rec(`action row measured @${w}`, true, dens);

  // bottom nav overlap with last content
  if (w < 600) {
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await p.waitForTimeout(300);
    const clear = await p.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="모바일 메뉴"]');
      const items = [...document.querySelectorAll("main button, main a, main textarea, main input, footer a")].filter((e) => e.getClientRects().length);
      const nt = nav?.getBoundingClientRect().top ?? innerHeight;
      const covered = items.filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > nt && r.top < innerHeight; });
      return { navTop: Math.round(nt), covered: covered.map((e) => e.textContent.trim().slice(0, 12)) };
    });
    rec("bottom nav does not cover last content @390", clear.covered.length === 0, clear);
    // start button not covered when scrolled to center
    await p.evaluate(() => { const b = [...document.querySelectorAll("main button")].find((x) => /대화 시작/.test(x.textContent)); b?.scrollIntoView({ block: "center" }); });
    await p.waitForTimeout(200);
    const cov = await p.evaluate(() => {
      const b = [...document.querySelectorAll("main button")].find((x) => /대화 시작/.test(x.textContent));
      const r = b.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { onTop: b === t || b.contains(t), bottom: Math.round(r.bottom) };
    });
    rec("start button reachable above bottom nav @390", cov.onTop, cov);
  }

  // keyboard focus order
  const p2 = await ctx.newPage();
  await p2.goto(detail("rich"), { waitUntil: "load" });
  await p2.waitForTimeout(900);
  const order = [];
  for (let i = 0; i < 40; i++) {
    await p2.keyboard.press("Tab");
    const t = await p2.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { t: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 10), y: Math.round(r.top + scrollY), ring: cs.outlineStyle !== "none" || /ring|shadow/.test(cs.boxShadow) };
    });
    if (t) order.push(t);
    if (/대화 시작/.test(t?.t || "")) break;
  }
  const idxStart = order.findIndex((o) => /대화 시작/.test(o.t));
  rec(`keyboard reaches start button early @${w}`, idxStart >= 0 && idxStart < 25, { tabsToStart: idxStart + 1, order: order.map((o) => o.t).join(" > ") });
  await p2.close();
  await ctx.close();
}

// access states
{
  const g = await ctxFor("guest");
  const pg = await g.newPage();
  await pg.goto(detail("rich"), { waitUntil: "load" });
  rec("guest detail redirects to login", /\/login/.test(pg.url()), { url: pg.url().replace(BASE, "") });
  await g.close();

  const s = await ctxFor("std");
  const p = await s.newPage();
  await p.goto(detail("private"), { waitUntil: "load" });
  const txt = await p.evaluate(() => document.body.innerText);
  rec("private character blocked for non-owner", /열람할 수 없습니다/.test(txt) && (await p.locator("[data-character-hero]").count()) === 0, { url: p.url().replace(BASE, "") });
  await p.goto(detail("adult"), { waitUntil: "load" });
  rec("adult character access state recorded", true, { url: p.url().replace(BASE, ""), hero: await p.locator("[data-character-hero]").count() });
  await p.goto(detail("rich") + "?embed=chat-intro", { waitUntil: "load" });
  await p.waitForTimeout(800);
  const emb = await p.evaluate(() => ({ hero: document.querySelectorAll("[data-character-hero]").length, start: [...document.querySelectorAll("button")].some((b) => /새 대화 시작/.test(b.textContent)), h1: document.querySelector("h1")?.textContent.trim().slice(0, 12), hOverflow: document.documentElement.scrollWidth > innerWidth + 1 }));
  rec("chat-intro embed unchanged (no poster hero, 새 대화 시작)", emb.hero === 0 && emb.start && !emb.hOverflow, emb);
  await p.screenshot({ path: `/opt/cursor/artifacts/e43d/flow-${TAG}-embed.png` });
  await s.close();

  const o = await ctxFor("owner");
  const po = await o.newPage();
  await po.goto(detail("rich"), { waitUntil: "load" });
  const ot = await po.evaluate(() => ({ edit: [...document.querySelectorAll("main a")].some((a) => a.textContent.trim() === "수정"), toggle: /공개 설정/.test(document.body.innerText), gift: [...document.querySelectorAll("main button")].some((b) => /포인트 선물/.test(b.textContent)) }));
  rec("owner sees edit + 공개 설정, no self gift", ot.edit && ot.toggle && !ot.gift, ot);
  await po.screenshot({ path: `/opt/cursor/artifacts/e43d/flow-${TAG}-owner-1440.png` });
  await po.goto(`${BASE}/create?edit=${fx.ids.rich}`, { waitUntil: "load" });
  await po.waitForTimeout(1500);
  const cr = await po.evaluate(() => ({ hero: document.querySelectorAll("[data-character-hero]").length, ok: !/error|500/i.test(document.title) , hOverflow: document.documentElement.scrollWidth > innerWidth + 1 }));
  rec("creator edit/preview page loads, no poster hero", cr.hero === 0 && !cr.hOverflow, cr);
  await po.screenshot({ path: `/opt/cursor/artifacts/e43d/flow-${TAG}-creator-preview.png` });
  await o.close();

  const a = await ctxFor("adminOn");
  const pa = await a.newPage();
  await pa.goto(detail("official"), { waitUntil: "load" });
  const at = await pa.evaluate(() => ({ full: [...document.querySelectorAll("main a")].some((x) => /전체 설정 수정/.test(x.textContent)), manage: [...document.querySelectorAll("main a")].some((x) => /공식 관리/.test(x.textContent)) }));
  rec("admin sees official manage links", at.full && at.manage, at);
  await a.close();
}

// trpg link
{
  const s = await ctxFor("owner");
  const p = await s.newPage();
  await p.goto(detail("rich"), { waitUntil: "load" });
  await p.waitForTimeout(900);
  const l = await p.evaluate(() => [...document.querySelectorAll("main a")].filter((a) => /TRPG로 시작/.test(a.textContent)).map((a) => a.getAttribute("href")));
  rec("TRPG start link present with characterId", l.length === 1 && /characterId=/.test(l[0]), { l });
  await s.close();
}

// D-1 reveal from home card
for (const w of [1440, 390]) {
  const ctx = await ctxFor("std", w, w < 600 ? 844 : 900);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/tab/new`, { waitUntil: "load" });
  await p.waitForTimeout(1200);
  const okBtn = p.getByRole("button", { name: "확인", exact: true });
  if (await okBtn.count()) await okBtn.first().click().catch(() => {});
  const card = p.locator(`[data-character-card="${fx.ids.rich}"]`).first();
  if ((await card.count()) === 0) { rec(`D-1 card present on /tab/new @${w}`, false); await ctx.close(); continue; }
  await p.evaluate(() => {
    window.__phases = [];
    new MutationObserver(() => {
      const v = document.querySelector(".rv-veil");
      const ph = v ? v.getAttribute("data-phase") : "none";
      const last = window.__phases[window.__phases.length - 1];
      if (!last || last.ph !== ph) window.__phases.push({ ph, t: Math.round(performance.now()), url: location.pathname });
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-phase"] });
  });
  await card.scrollIntoViewIfNeeded();
  await card.locator("a").first().click({ noWaitAfter: true });
  await p.waitForURL(/\/character\//, { timeout: 8000 }).catch(() => {});
  let sawReveal = false;
  let posterAtReveal = null;
  for (let i = 0; i < 60; i++) {
    await p.waitForTimeout(100);
    const s = await p.evaluate(() => {
      const v = document.querySelector(".rv-veil");
      const el = document.querySelector("[data-character-hero-image]");
      const r = el?.getBoundingClientRect();
      return { phase: v?.getAttribute("data-phase") ?? null, poster: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null };
    });
    if (s.phase === "reveal" && !posterAtReveal) { sawReveal = true; posterAtReveal = s.poster; await p.screenshot({ path: `/opt/cursor/artifacts/e43d/flow-${TAG}-d1-reveal-${w}.png` }); }
    if (!s.phase && /\/character\//.test(p.url())) break;
  }
  await p.waitForTimeout(300);
  const fin = await p.evaluate(() => {
    const el = document.querySelector("[data-character-hero-image]");
    const r = el?.getBoundingClientRect();
    const hidden = [...document.querySelectorAll("[data-hero-item]")].filter((e) => getComputedStyle(e).visibility === "hidden").length;
    return { veil: !!document.querySelector(".rv-veil"), poster: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null, hiddenItems: hidden, scrollY: Math.round(scrollY) };
  });
  const phases = await p.evaluate(() => window.__phases ?? []).catch(() => []);
  const stable = posterAtReveal && fin.poster ? posterAtReveal.every((v, i) => Math.abs(v - fin.poster[i]) <= 3) : null;
  rec(`D-1 reveal runs and lands on hero @${w}`, sawReveal && !fin.veil && fin.hiddenItems === 0 && stable !== false, { sawReveal, veilGone: !fin.veil, hiddenItems: fin.hiddenItems, posterAtReveal, finalPoster: fin.poster, stable });
  await p.screenshot({ path: `/opt/cursor/artifacts/e43d/flow-${TAG}-d1-final-${w}.png` });
  await ctx.close();
}

fs.writeFileSync(`/tmp/e43d-flow-${TAG}.json`, JSON.stringify(results, null, 1));
console.log(`SUMMARY ${TAG}: ${results.filter((r) => r.ok).length}/${results.length} pass`);
await browser.close();
