import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
const [base, label, mode = "matrix"] = process.argv.slice(2);
const out = `/tmp/e48-shots/${label}`;
fs.mkdirSync(out, { recursive: true });

const INSTALL = () => {
  const m = (window.__m = { t0: null, path0: location.pathname, tUrl: null, veilFirst: null, veilLast: null, coverFirst: null, coverLast: null, coverMax: 0, coverClasses: [], frames: 0 });
  window.addEventListener("click", () => { if (m.t0 == null) m.t0 = performance.now(); m.path0 = location.pathname; }, true);
  const vw = () => innerWidth, vh = () => innerHeight;
  const tick = () => {
    const now = performance.now();
    if (m.t0 != null) {
      const rel = now - m.t0;
      if (m.tUrl == null && location.pathname !== m.path0) m.tUrl = rel;
      if (document.querySelector(".menu-veil")) { if (m.veilFirst == null) m.veilFirst = rel; m.veilLast = rel; }
      let cover = 0, cls = "";
      for (const el of document.querySelectorAll("body > *, body > * > *")) {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) continue;
        const r = el.getBoundingClientRect();
        const f = (Math.max(0, Math.min(r.right, vw()) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh()) - Math.max(r.top, 0))) / (vw() * vh());
        if (f > 0.8 && f > cover) { cover = f; cls = `${el.tagName}.${(el.className || "").toString().slice(0, 40)}`; }
      }
      if (cover > 0.8) { if (m.coverFirst == null) m.coverFirst = rel; m.coverLast = rel; m.coverMax = Math.max(m.coverMax, cover); if (!m.coverClasses.includes(cls)) m.coverClasses.push(cls); }
      m.frames++;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const POPUP_OFF = `(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { if (String(k).startsWith("home-popup-notice:")) { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); } return g.call(this, k); }; })();`;
const browser = await launch();
const rows = [];
const round = (v) => (v == null ? null : Math.round(v));

async function measure(width, height, user, from, linkSel, expectPath, tag, shotName) {
  const { page, ctx } = await openPage(browser, base, { path: from, user, width, height, wait: 700, until: "domcontentloaded", reduced: "no-preference", init: POPUP_OFF });
  await page.evaluate(INSTALL);
  const link = page.locator(`${linkSel} >> visible=true`).first();
  if (!(await link.count())) { rows.push({ tag, width, from, err: "no link " + linkSel }); await ctx.close(); return; }
  const shotAt = shotName ? [120, 400] : [];
  try { await link.click({ timeout: 8000 }); } catch (e) { rows.push({ tag, width, from, err: String(e).slice(0, 80) }); await ctx.close(); return; }
  let t = 0;
  for (const at of shotAt) { await page.waitForTimeout(at - t); t = at; await page.screenshot({ path: `${out}/${shotName}-t${at}.png` }); }
  await page.waitForFunction(() => window.__m.tUrl != null, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2300 - t);
  const m = await page.evaluate(() => window.__m);
  const info = await page.evaluate(() => ({ path: location.pathname, active: [...document.querySelectorAll('[aria-current="page"]')].map((a) => a.textContent.trim().slice(0, 12)), veilNow: document.querySelectorAll(".menu-veil").length }));
  if (shotName) await page.screenshot({ path: `${out}/${shotName}-settled.png` });
  rows.push({ tag, width, from, expectPath, path: info.path, ok: info.path === expectPath, active: info.active.join("|"), veilNow: info.veilNow, tUrl: round(m.tUrl), veilFirst: round(m.veilFirst), veilLast: round(m.veilLast), coverFirst: round(m.coverFirst), coverLast: round(m.coverLast), coverMax: Math.round(m.coverMax * 100) / 100, coverCls: m.coverClasses.join(",") });
  await ctx.close();
}

// per-menu clicks. PC: top nav row (HeaderMainNavRow) + sidebar. Mobile: strip + bottom nav.
const MENUS = [
  ["홈", "/", "main-nav"], ["신작", "/tab/new", "main-nav"], ["랭킹", "/tab/ranking", "main-nav"], ["TRPG", "/trpg", "main-nav"],
  ["검색", "/search", "main-nav"], ["북마크/팔로잉", "/tab/following", "main-nav"],
];
const SIDE = [["대화 목록", "/chats"], ["페르소나·노트", "/persona"], ["제작", "/studio"], ["크리에이터", "/creator"]];
const width = mode === "matrix" ? [1440, 390] : [1440, 390];
if (mode === "matrix") {
  for (const w of width) {
    const h = w === 1440 ? 900 : 844;
    for (const [name, dest] of MENUS) {
      const from = dest === "/tab/new" ? "/" : "/tab/new";
      const sel = w === 1440 ? `nav[aria-label="주요 메뉴"] >> a:has-text("${name}")` : `nav[aria-label="주요 메뉴"] >> a:has-text("${name}")`;
      await measure(w, h, "creatorA", from, sel, dest, `menu:${name}`, null);
    }
    for (const [name, dest] of SIDE) {
      const sel = w === 1440 ? `aside nav a[href="${dest}"]` : `nav[aria-label="모바일 메뉴"] a[href="${dest}"]`;
      const mobileAlt = w < 576 && !["/chats", "/studio"].includes(dest);
      await measure(w, h, "creatorA", mobileAlt ? "/settings" : "/tab/new", mobileAlt ? `main a[href="${dest}"]` : sel, dest, `side:${name}`, null);
    }
  }
}
console.log(label, "rows", rows.length);
for (const r of rows) console.log(JSON.stringify(r));
fs.writeFileSync(`${out}/menu-matrix.json`, JSON.stringify(rows, null, 1));
await browser.close();
