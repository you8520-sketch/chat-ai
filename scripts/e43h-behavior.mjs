import { chromium } from "playwright-core";
import fs from "fs";
import Database from "better-sqlite3";
const BASE = process.env.BASE;
const fx = JSON.parse(fs.readFileSync("/tmp/e43h-fixtures.json", "utf8"));
const SENS = ["ZZNSFW_NAME", "ZZNSFW_NOIMG", "ZZNARR_NSFW", "ZZNARR_NOIMG", "ZZNARR_BRANCH", "ZZQUOTE_NSFW", "ZZQUOTE_NOIMG", "ZZQUOTE_BRANCH", "ZZCHAT_TITLE_NSFW", "ZZCHAT_TITLE_NOIMG", "🔞", "ZZSECOND_IMG_SECRET", "official-pilot-rf-v4-03", `/chat/${fx.nsfwId}`, `/chat/${fx.nsfwId + 1}`];
const leakCount = (t) => SENS.reduce((n, m) => n + (t.split(m).length - 1), 0);
const db = new Database("/tmp/e43h-data/app.db");
const b = await chromium.launch();
const R = {};
const mk = async (user, w = 1440, h = 900) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: "ko-KR" });
  await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  return ctx;
};

// A. D-2: normal row -> veil + room; masked row -> /verify, no veil
{
  const ctx = await mk("std");
  const p = await ctx.newPage();
  await p.goto(BASE + "/settings", { waitUntil: "load" }); await p.waitForTimeout(1200);
  const rows = p.locator('aside a[data-trpg-recent-kind="character_chat"]');
  const marked = await rows.evaluateAll((as) => as.map((a) => ({ text: a.innerText.replace(/\n/g, " | "), marker: a.hasAttribute("data-chat-resume") })));
  let veil = false;
  const watch = p.waitForFunction(() => !!document.querySelector("[data-menu-transition]"), null, { timeout: 5000 }).then(() => { veil = true; }).catch(() => {});
  await p.locator('aside a[data-chat-resume]').first().click();
  await p.waitForURL((u) => new URL(u).pathname.startsWith("/chat/"), { timeout: 15000 }).catch(() => {});
  await watch; await p.waitForTimeout(2200);
  const room = await p.evaluate(() => ({ path: location.pathname + location.search, roomChar: document.querySelector("[data-chat-room-character]")?.getAttribute("data-chat-room-character") ?? null }));
  // sidebar collapse/expand (chat room)
  const aside = p.locator("aside").first();
  const w1 = Math.round((await aside.boundingBox()).width);
  await aside.click({ position: { x: 5, y: 300 }, force: true }).catch(() => {});
  await p.waitForTimeout(500);
  const w2 = Math.round((await aside.boundingBox()).width);
  const collapsedTitles = [];
  R.d2 = { marked, veil, room, asideWidths: [w1, w2] };
  await p.goto(BASE + "/settings", { waitUntil: "load" }); await p.waitForTimeout(1000);
  let veil2 = false;
  const watch2 = p.waitForFunction(() => !!document.querySelector("[data-menu-transition]"), null, { timeout: 2500 }).then(() => { veil2 = true; }).catch(() => {});
  await rows.first().click();
  await p.waitForURL((u) => new URL(u).pathname === "/verify", { timeout: 15000 }).catch(() => {});
  await watch2;
  R.d2.masked = { landed: new URL(p.url()).pathname, veil: veil2 };
  await ctx.close();
}

// B. sidebar collapsed (compact) shows only the neutral glyph and neutral titles
{
  const ctx = await mk("std");
  const p = await ctx.newPage();
  await p.goto(BASE + `/chat/${fx.safeId}`, { waitUntil: "load" }); await p.waitForTimeout(2000);
  const aside = p.locator("aside").first();
  const w = Math.round((await aside.boundingBox()).width);
  const html = await aside.innerHTML();
  const titles = await aside.locator('a[data-trpg-recent-kind="character_chat"]').evaluateAll((as) => as.map((a) => a.getAttribute("title")));
  R.collapsed = { width: w, leaks: leakCount(html), titles };
  await aside.click({ position: { x: 5, y: 300 }, force: true }).catch(() => {});
  await p.waitForTimeout(500);
  R.collapsed.afterExpand = Math.round((await aside.boundingBox()).width);
  await ctx.close();
}

// C. safety filter toggle without reload: ON -> OFF -> ON ; RSC responses scanned
{
  const ctx = await mk("adminOn");
  const p = await ctx.newPage();
  const rsc = [];
  p.on("response", async (r) => { if (r.url().includes("_rsc") || r.headers()["content-type"]?.includes("text/x-component")) { try { rsc.push({ url: r.url().replace(BASE, ""), leaks: leakCount(await r.text()) }); } catch {} } });
  await p.goto(BASE + "/chats", { waitUntil: "load" }); await p.waitForTimeout(1200);
  const state = async () => ({
    pressed: await p.getByRole("button", { name: "세이프티 필터" }).getAttribute("aria-pressed"),
    asideLeaks: leakCount(await p.locator("aside").first().innerHTML()),
    mainLeaks: leakCount(await p.locator("main").innerHTML()),
    sidebarRows: await p.locator('aside a[data-trpg-recent-kind="character_chat"]').evaluateAll((as) => as.map((a) => a.innerText.replace(/\n/g, " | "))),
    cards: await p.locator(".chats-page-grid article").count(),
  });
  const s0 = await state();
  const patch = (fn) => { const w = p.waitForResponse((r) => r.url().includes("/api/settings") && r.request().method() === "PATCH"); return fn().then(() => w); };
  const r1 = await patch(() => p.getByRole("button", { name: "세이프티 필터" }).click());
  await p.waitForTimeout(1500);
  const s1 = await state();
  await p.reload({ waitUntil: "load" }); await p.waitForTimeout(1000);
  const s1r = await state();
  const r2 = await patch(() => p.getByRole("button", { name: "세이프티 필터" }).click());
  await p.waitForTimeout(1500);
  const s2 = await state();
  await p.reload({ waitUntil: "load" }); await p.waitForTimeout(1000);
  const s2r = await state();
  R.toggle = { patch: [r1.status(), r2.status()], onInitial: s0, offAfterToggleNoReload: s1, offAfterReload: s1r, onAfterToggleNoReload: s2, onAfterReload: s2r, rscResponses: rsc.length, rscMaxLeaksWhileOn: "see per-phase", rscLeakTotal: rsc.reduce((a, x) => a + x.leaks, 0), rsc };
  await ctx.close();
}
await b.close();
fs.writeFileSync("/tmp/e43h-behavior.json", JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1).slice(0, 9000));
