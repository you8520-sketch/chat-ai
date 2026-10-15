import { chromium } from "playwright-core";
import { createRequire } from "module";
import fs from "fs";

const require = createRequire("/workspace/package.json");
const Database = require("better-sqlite3");

export const fx = JSON.parse(fs.readFileSync("/tmp/e43k-fixtures.json", "utf8"));
export const HEIGHTS = { 360: 800, 390: 844, 576: 900, 768: 1024, 1024: 800, 1440: 900 };
export const launch = () => chromium.launch();

export function db() {
  return new Database("/tmp/e43k-data/app.db");
}

export const SHIFT_DAYS = Number(process.env.E43K_SHIFT_DAYS ?? 3);
function kstToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + SHIFT_DAYS * 864e5),
  );
}
function addDays(ds, n) {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function mondayOf(ds) {
  const [y, m, d] = ds.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(ds, -(dow === 0 ? 6 : dow - 1));
}

/** Fixture-only: set this week's check-in count (n) with/without today. */
export function setAttendance(userKey, n, checkedToday) {
  const uid = fx.users[userKey];
  const conn = db();
  conn.prepare("DELETE FROM attendance_checkins WHERE user_id=?").run(uid);
  const today = kstToday();
  const monday = mondayOf(today);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const others = week.filter((d) => d !== today);
  const dates = checkedToday ? [today, ...others.slice(0, Math.max(0, n - 1))] : others.slice(0, n);
  const ins = conn.prepare("INSERT INTO attendance_checkins (user_id, attendance_date, streak, reward_points) VALUES (?,?,?,?)");
  dates.forEach((d, i) => ins.run(uid, d, i + 1, 0));
  conn.close();
  return { today, count: dates.length };
}

export function countAttendanceRows(userKey) {
  const conn = db();
  const uid = fx.users[userKey];
  const rows = conn.prepare("SELECT COUNT(*) c FROM attendance_checkins WHERE user_id=?").get(uid).c;
  const logs = conn
    .prepare("SELECT COUNT(*) c FROM point_logs WHERE user_id=? AND reason LIKE '주간 출석%' AND created_at >= datetime('now','-1 minute')")
    .get(uid).c;
  conn.close();
  return { rows, recentAttendanceLogs: logs };
}

export function pointState(userKey) {
  const conn = db();
  const uid = fx.users[userKey];
  const r = {
    points: conn.prepare("SELECT points FROM users WHERE id=?").get(uid).points,
    logs: conn.prepare("SELECT COUNT(*) c FROM point_logs WHERE user_id=?").get(uid).c,
    gifts: conn.prepare("SELECT COUNT(*) c FROM point_gifts WHERE sender_id=?").get(uid).c,
  };
  conn.close();
  return r;
}

/**
 * modes: attendance real|fail|network|slow, gift real|fail|network|slow, logs real|fail|slow,
 * cancel ok|fail|pending. Charge/cancel/prepare/complete are always stubbed; every request
 * that leaves the fixture origin is aborted.
 */
export async function openPage(browser, base, o) {
  const { path = "/points", user = "full", width = 390, height, wait = 1200, attendance = "real", gift = "real", logs = "real", cancel = "ok", dialog = "accept" } = o;
  const mobile = width < 576;
  const h = height ?? HEIGHTS[width] ?? 900;
  const ctx = await browser.newContext({
    viewport: { width, height: h },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    hasTouch: mobile,
    isMobile: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
    reducedMotion: "reduce",
  });
  if (user) await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: base }]);
  const page = await ctx.newPage();
  page.__posts = [];
  page.__external = [];
  page.__dialogs = [];
  page.__opts = { attendance, gift, logs, cancel };
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(base) && !u.startsWith("data:") && !u.startsWith("blob:")) page.__external.push(u.slice(0, 120));
    if (!["GET", "HEAD"].includes(r.method()) && u.startsWith(base)) page.__posts.push({ m: r.method(), p: new URL(u).pathname });
  });
  await page.route((url) => !url.href.startsWith(base) && !/^(data|blob):/.test(url.href), (route) => route.abort());
  await page.route(`${base}/api/points/logs**`, async (route) => {
    if (page.__opts.logs === "fail") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "fail" }) });
    if (page.__opts.logs === "slow") await new Promise((r) => setTimeout(r, 2500));
    return route.continue();
  });
  await page.route(`${base}/api/**`, async (route) => {
    const req = route.request();
    const m = req.method();
    if (m === "GET" || m === "HEAD") return route.continue();
    const p = new URL(req.url()).pathname;
    const json = (obj, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(obj) });
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    if (p === "/api/attendance") {
      if (page.__opts.attendance === "fail") return json({ error: "출석 처리에 실패했습니다. 잠시 후 다시 시도해 주세요." }, 500);
      if (page.__opts.attendance === "network") return route.abort("failed");
      if (page.__opts.attendance === "slow") await delay(1800);
      return route.continue();
    }
    if (p === "/api/points/gift") {
      if (page.__opts.gift === "fail") return json({ error: "포인트가 부족합니다.", code: "INSUFFICIENT_POINTS" }, 402);
      if (page.__opts.gift === "network") return route.abort("failed");
      if (page.__opts.gift === "slow") await delay(1800);
      return route.continue();
    }
    if (p === "/api/points/charge/cancel") {
      await delay(600);
      if (page.__opts.cancel === "fail") return json({ error: "결제 취소에 실패했습니다. 결제 후 7일이 지났거나 사용한 포인트가 있습니다." }, 400);
      if (page.__opts.cancel === "pending") return json({ status: "pending", message: "환불 처리가 진행 중입니다. 잠시 후 상태를 다시 확인해 주세요." });
      return json({ status: "refunded" });
    }
    if (p.startsWith("/api/payments/portone/")) {
      return json({ error: "격리 fixture: 결제 요청은 차단됩니다." }, 503);
    }
    return json({ ok: true });
  });
  page.on("dialog", async (d) => {
    page.__dialogs.push({ type: d.type(), message: d.message().slice(0, 400) });
    if (dialog === "dismiss") await d.dismiss();
    else await d.accept();
  });
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
    const small = [];
    for (const el of root.querySelectorAll('button, a[href], input, [role="tab"], select, textarea')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 44 || r.width < 44) {
        small.push({ tag: el.tagName, text: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().slice(0, 24), w: px(r.width), h: px(r.height) });
      }
    }
    let tinyText = 0;
    const tinySample = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || !visible(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12) {
        tinyText++;
        if (tinySample.length < 5) tinySample.push({ fs, text: n.textContent.trim().slice(0, 20) });
      }
    }
    const clipped = [];
    for (const el of root.querySelectorAll("*")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) clipped.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), right: px(r.right) });
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
      smallSample: small.slice(0, 8),
      tinyText,
      tinySample,
      outOfViewport: clipped,
      cellSize: cells[0] ?? null,
    };
  }, scope);
}

export async function snap(page, file, { full = false, locator } = {}) {
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
