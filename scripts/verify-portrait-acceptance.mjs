/**
 * Portrait acceptance metrics — frame aspect vs natural, container-relative sizing.
 * Usage: PLAYWRIGHT_SKIP_WEB_SERVER=1 node scripts/verify-portrait-acceptance.mjs
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const CHAT_URL = `${BASE}/chat/2?chat=1`;
const OUT = "/opt/cursor/artifacts/portrait-acceptance-metrics.json";
const ASSET_BACKUP = "/tmp/char2-assets-backup.json";

const ASSET_META = {
  "3:4": { match: "300x400", width: 300, height: 400 },
  "1:1": { match: "400x400", width: 400, height: 400 },
  "16:9": { match: "800x450", width: 800, height: 450, patchPortraitPool: true },
};

function loadAssets() {
  return JSON.parse(readFileSync(ASSET_BACKUP, "utf8"));
}

function openDb() {
  const db = new Database("data/app.db");
  db.pragma("busy_timeout = 10000");
  return db;
}

function backupAssets() {
  const db = openDb();
  const row = db.prepare("SELECT assets FROM characters WHERE id=2").get();
  writeFileSync(ASSET_BACKUP, row.assets);
  db.close();
}

function restoreAssets() {
  const raw = readFileSync(ASSET_BACKUP, "utf8");
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const db = openDb();
      db.prepare("UPDATE characters SET assets=? WHERE id=2").run(raw);
      db.close();
      return;
    } catch (err) {
      if (attempt === 4) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

function writeAssets(assets) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const db = openDb();
      db.prepare("UPDATE characters SET assets=? WHERE id=2").run(JSON.stringify(assets));
      db.close();
      return;
    } catch (err) {
      if (attempt === 4) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

function prepareAssetCase(meta) {
  const assets = loadAssets();
  const patched = assets.map((asset) => {
    if (!asset.url?.includes(meta.match)) return asset;
    if (meta.patchPortraitPool) {
      return { ...asset, orientation: "portrait" };
    }
    return asset;
  });
  const idx = patched.findIndex((a) => a.url?.includes(meta.match));
  if (idx > 0) {
    const picked = patched[idx];
    writeAssets([picked, ...patched.slice(0, idx), ...patched.slice(idx + 1)]);
  } else {
    writeAssets(patched);
  }
}

function clearAssets() {
  writeAssets([]);
}

async function login(page) {
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email: "testportrait855d@test.com", password: "TestPass123!" },
  });
  if (!res.ok()) throw new Error(`login failed: ${await res.text()}`);
}

async function ensurePortraitOn(page, unlockUrls) {
  await page.addInitScript((urls) => {
    localStorage.setItem(
      "playai-chat-display-prefs",
      JSON.stringify({ showCharacterPortrait: true })
    );
    localStorage.setItem(
      "playai-character-asset-unlocks:2",
      JSON.stringify({ version: 1, urls })
    );
  }, unlockUrls);
}

async function openChat(page) {
  await page.goto(CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".chat-room-portrait-grid", { timeout: 20000 });
  async function waitPortraitCss() {
    await page.waitForFunction(
      () => {
        const grid = document.querySelector(".chat-room-portrait-grid");
        return (
          grid != null &&
          getComputedStyle(grid).getPropertyValue("--chat-portrait-min-chat-w").trim() === "360px"
        );
      },
      { timeout: 15000 }
    );
  }
  try {
    await waitPortraitCss();
  } catch {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".chat-room-portrait-grid", { timeout: 20000 });
    await waitPortraitCss();
  }
  await page.waitForTimeout(400);
}

async function pickAssetByDimensions(page, width, height) {
  for (let i = 0; i < 24; i++) {
    const current = await page.evaluate(() => {
      const img = document.querySelector(".chat-room-portrait-rail img:not([aria-hidden])");
      if (!(img instanceof HTMLImageElement)) return null;
      return { w: img.naturalWidth, h: img.naturalHeight, complete: img.complete };
    });
    if (current?.complete && current.w === width && current.h === height) return true;
    await page.evaluate(() =>
      document.querySelector('.chat-room-portrait-rail button[aria-label="다음 해금 이미지"]')?.click()
    );
    await page.waitForTimeout(350);
  }
  return false;
}

async function measure(page, meta = {}) {
  return page.evaluate((metaIn) => {
    const grid = document.querySelector(".chat-room-portrait-grid");
    const col = document.querySelector(".chat-room-portrait-column");
    const chatCol = document.querySelector(".chat-room-portrait-chat-column");
    const frame =
      document.querySelector(".chat-room-portrait-rail button > div[class*='rounded-[18px]']") ??
      document.querySelector(".chat-room-portrait-placeholder");
    const img = document.querySelector(".chat-room-portrait-rail img:not([aria-hidden])");
    const messages = document.querySelector(".chat-room-messages-column");
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        x: Math.round(b.x),
        y: Math.round(b.y),
        width: Math.round(b.width),
        height: Math.round(b.height),
      };
    };
    const gridR = r(grid);
    const frameR = r(frame);
    const imgR = r(img);
    const nat =
      img instanceof HTMLImageElement
        ? { width: img.naturalWidth, height: img.naturalHeight }
        : null;
    const metaW = metaIn.assetWidth ?? null;
    const metaH = metaIn.assetHeight ?? null;
    const frameAspect = frameR?.height ? frameR.width / frameR.height : null;
    const naturalAspect = nat?.height ? nat.width / nat.height : null;
    const metaAspect = metaW && metaH ? metaW / metaH : null;
    const styles = grid ? getComputedStyle(grid) : null;
    const colR = r(col);
    const chatColR = r(chatCol);
    const msgR = r(messages);
    return {
      viewport: document.documentElement.clientWidth,
      containerWidth: gridR?.width ?? null,
      portraitMaxVar: styles?.getPropertyValue("--chat-portrait-max-w").trim() || null,
      minChatVar: styles?.getPropertyValue("--chat-portrait-min-chat-w").trim() || null,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      portraitColumnWidth: colR?.width ?? null,
      chatColumnWidth: chatColR?.width ?? null,
      messagesColumnWidth: msgR?.width ?? null,
      gap:
        colR && chatColR
          ? Math.round(chatColR.x - (colR.x + colR.width))
          : null,
      frame: frameR,
      img: imgR,
      metadata: { width: metaW, height: metaH, aspect: metaAspect },
      natural: nat,
      naturalAspect,
      frameAspect,
      frameMatchesNatural:
        frameAspect != null && naturalAspect != null
          ? Math.abs(frameAspect - naturalAspect) < 0.02
          : frameAspect != null && metaAspect != null
            ? Math.abs(frameAspect - metaAspect) < 0.02
            : null,
      imgAspect: imgR?.height ? imgR.width / imgR.height : null,
    };
  }, meta);
}

function evaluateInvariants(row) {
  const notes = [];
  const chatMin = 360;
  const usableDesktop = row.viewport >= 768;
  if (usableDesktop && row.chatColumnWidth != null && row.chatColumnWidth < chatMin - 2) {
    notes.push(`FAIL: chat column ${row.chatColumnWidth}px < ${chatMin}px at ${row.viewport}`);
  }
  if (row.overflowX) notes.push("FAIL: horizontal overflow");
  if (row.asset !== "no-asset" && row.natural && row.metadata?.width) {
    if (row.natural.width !== row.metadata.width || row.natural.height !== row.metadata.height) {
      notes.push(
        `FAIL: natural ${row.natural.width}x${row.natural.height} != metadata ${row.metadata.width}x${row.metadata.height}`
      );
    }
  }
  if (row.asset !== "no-asset" && row.frameMatchesNatural === false) {
    notes.push(
      `FAIL: frame aspect ${row.frameAspect?.toFixed(3)} != natural ${row.naturalAspect?.toFixed(3)}`
    );
  }
  if (row.asset === "16:9" && row.frameAspect != null && Math.abs(row.frameAspect - 16 / 9) > 0.02) {
    notes.push(`FAIL: 16:9 frame aspect ${row.frameAspect.toFixed(3)}`);
  }
  if (notes.length === 0) notes.push("PASS");
  return notes;
}

const MATRIX = [
  { viewport: 1024, cases: ["3:4", "1:1", "16:9", "no-asset"] },
  { viewport: 768, cases: ["3:4", "no-asset"] },
  { viewport: 576, cases: ["3:4", "no-asset"] },
];

const EXTRA_VIEWPORTS = [900];

backupAssets();
const unlockUrls = loadAssets().map((a) => a.url);
const browser = await chromium.launch();
const results = [];

try {
  for (const { viewport, cases } of MATRIX) {
    for (const label of cases) {
      if (label === "no-asset") {
        clearAssets();
        const ctx = await browser.newContext({ viewport: { width: viewport, height: 900 } });
        const page = await ctx.newPage();
        await ensurePortraitOn(page, unlockUrls);
        await login(page);
        await openChat(page);
        const row = { viewport, asset: "no-asset", ...(await measure(page)) };
        row.invariants = evaluateInvariants(row);
        results.push(row);
        await ctx.close();
        restoreAssets();
        continue;
      }
      const meta = ASSET_META[label];
      prepareAssetCase(meta);
      const ctx = await browser.newContext({ viewport: { width: viewport, height: 900 } });
      const page = await ctx.newPage();
      await ensurePortraitOn(page, unlockUrls);
      await login(page);
      await openChat(page);
      const picked = await pickAssetByDimensions(page, meta.width, meta.height);
      const row = {
        viewport,
        asset: label,
        assetPicked: picked,
        ...(await measure(page, { assetWidth: meta.width, assetHeight: meta.height })),
      };
      row.invariants = evaluateInvariants(row);
      results.push(row);
      await ctx.close();
      restoreAssets();
    }
  }

  for (const viewport of EXTRA_VIEWPORTS) {
    prepareAssetCase(ASSET_META["3:4"]);
    const ctx = await browser.newContext({ viewport: { width: viewport, height: 900 } });
    const page = await ctx.newPage();
    await ensurePortraitOn(page, unlockUrls);
    await login(page);
    await openChat(page);
    await pickAssetByDimensions(page, 300, 400);
    const row = { viewport, asset: "3:4", extra: true, ...(await measure(page, ASSET_META["3:4"])) };
    row.invariants = evaluateInvariants(row);
    results.push(row);
    await ctx.close();
    restoreAssets();
  }

  const mob = await browser.newContext({ viewport: { width: 575, height: 900 } });
  const mpage = await mob.newPage();
  await ensurePortraitOn(mpage, unlockUrls);
  await login(mpage);
  await mpage.goto(CHAT_URL, { waitUntil: "domcontentloaded" });
  await mpage.waitForTimeout(1500);
  results.push({
    mobile575: true,
    ...(await mpage.evaluate(() => ({
      colDisplay: getComputedStyle(document.querySelector(".chat-room-portrait-column")).display,
      railDisplay: getComputedStyle(document.querySelector(".chat-room-portrait-rail")).display,
      mobileBgDisplay: getComputedStyle(document.querySelector(".chat-room-mobile-portrait-bg")).display,
    }))),
  });
  await mob.close();
} finally {
  restoreAssets();
  await browser.close();
}

writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
