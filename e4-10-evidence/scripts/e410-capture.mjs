import fs from "fs";
import { chromium } from "playwright-core";

// visualViewport simulation only. usage: node scripts/e410-capture.mjs <base> <outDir>
const base = process.argv[2] || "http://127.0.0.1:3651";
const out = process.argv[3] || "/tmp/e410-before";
fs.mkdirSync(out, { recursive: true });

const login = await fetch(`${base}/api/auth/demo-login`, { method: "POST" });
if (!login.ok) throw new Error(`demo-login ${login.status}`);
const session = login.headers.get("set-cookie")?.match(/session=([^;]+)/)?.[1];
if (!session) throw new Error("no session");

const init = fs.readFileSync(new URL("./e47-vv.js", import.meta.url), "utf8");
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "ko-KR" });
await ctx.addInitScript(init);
await ctx.addCookies([{ name: "session", value: session, url: base, httpOnly: true, secure: true, sameSite: "Lax" }]);
const page = await ctx.newPage();

const shots = [
  ["create-667x375-kb0", "/create", 667, 375, 0],
  ["create-667x375-kb190", "/create", 667, 375, 190],
  ["create-740x360-kb180", "/create", 740, 360, 180],
  ["create-844x390-kb200", "/create", 844, 390, 200],
  ["create-932x430-kb215", "/create", 932, 430, 215],
  ["create-390x844-kb330", "/create", 390, 844, 330],
  ["create-1280x800-kb300", "/create", 1280, 800, 300],
  ["search-667x375-kb190", "/search", 667, 375, 190],
];

async function readState() {
  return page.evaluate(() => {
    const header = document.querySelector("header.site-header");
    const box = header?.getBoundingClientRect();
    const cssVar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--site-header-height")) || 0;
    const strip = document.querySelector(".site-header-nav-strip");
    const navs = [...document.querySelectorAll('nav[aria-label="주요 메뉴"]')].map((nav) => {
      const r = nav.getBoundingClientRect();
      return { display: getComputedStyle(nav).display, h: Math.round(r.height), w: Math.round(r.width) };
    });
    const vv = window.visualViewport;
    const tabs = document.querySelector('[role="tablist"][aria-label="캐릭터·시뮬레이션 제작 탭"]');
    const bar = document.querySelector('[data-testid="studio-save-bar"]');
    const pinned = (el) => !!el && ["fixed", "sticky"].includes(getComputedStyle(el).position);
    let top = pinned(header) ? box.bottom : 0;
    if (tabs && pinned(tabs) && tabs.getBoundingClientRect().top <= top + 1) top = Math.max(top, tabs.getBoundingClientRect().bottom);
    let bottom = (vv?.offsetTop ?? 0) + (vv?.height ?? innerHeight);
    if (bar && pinned(bar)) bottom = Math.min(bottom, bar.getBoundingClientRect().top);
    return {
      url: location.pathname,
      header: Math.round((box?.height ?? 0) * 10) / 10,
      cssVar,
      editor: document.documentElement.hasAttribute("data-studio-editor"),
      keyboard: document.documentElement.hasAttribute("data-keyboard-open"),
      strip: strip ? getComputedStyle(strip).display : "absent",
      navs,
      free: Math.round(bottom - top),
      vv: Math.round(vv?.height ?? innerHeight),
      tabs: tabs ? getComputedStyle(tabs).position : null,
      bar: bar ? getComputedStyle(bar).position : null,
    };
  });
}

const overlay = (kb) => {
  window.__setKeyboard(kb);
  document.getElementById("__kb")?.remove();
  if (kb > 0) {
    const d = document.createElement("div");
    d.id = "__kb";
    d.textContent = `KEYBOARD simulated ${kb}px (visualViewport, not a device)`;
    d.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${kb}px;z-index:80;pointer-events:none;background:repeating-linear-gradient(45deg,#3b3b46,#3b3b46 10px,#33333d 10px,#33333d 20px);color:#fff;font:700 13px sans-serif;display:flex;align-items:center;justify-content:center;opacity:.92`;
    document.body.appendChild(d);
  }
};

const metrics = {};
for (const [name, path, width, height, kb] of shots) {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  if (path === "/create") await page.locator('[data-testid="studio-save-bar"]').waitFor({ state: "visible" });
  else await page.locator("main").waitFor({ state: "visible" });
  await page.evaluate(overlay, kb);
  if (kb > 0) await page.waitForFunction(() => document.documentElement.hasAttribute("data-keyboard-open"));
  else await page.waitForFunction(() => !document.documentElement.hasAttribute("data-keyboard-open"));
  await page.waitForTimeout(250);
  metrics[name] = await readState();
  await page.screenshot({ path: `${out}/${name}.png` });
}

fs.writeFileSync(`${out}/metrics.json`, JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics, null, 2));
await browser.close();
