import fs from "fs";
import { chromium } from "playwright-core";

// Captures the merged-main TRPG targets for E4-9. Simulated visualViewport only.
// usage: node scripts/e49c-trpg.mjs http://127.0.0.1:3646 /tmp/e49-round3
const base = process.argv[2] || "http://127.0.0.1:3646";
const out = process.argv[3] || "/tmp/e49-round3";
fs.mkdirSync(out, { recursive: true });

const login = await fetch(`${base}/api/auth/demo-login`, { method: "POST" });
if (!login.ok) throw new Error(`demo-login ${login.status}`);
const session = login.headers.get("set-cookie")?.match(/session=([^;]+)/)?.[1];
if (!session) throw new Error("demo-login did not set a session cookie");

const created = await fetch(`${base}/api/trpg/scenarios`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: `session=${session}` },
  body: JSON.stringify({
    title: "E4-9 회귀 시나리오",
    content: "시작 상황입니다. 키보드가 열려도 저장 버튼에 닿을 수 있어야 합니다.",
  }),
});
const createdBody = await created.json();
if (!created.ok || !createdBody.scenario?.id) {
  throw new Error(`scenario create ${created.status} ${JSON.stringify(createdBody).slice(0, 300)}`);
}
const scenarioId = createdBody.scenario.id;

const init = fs.readFileSync(new URL("./e47-vv.js", import.meta.url), "utf8");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 667, height: 375 }, locale: "ko-KR" });
await ctx.addInitScript(init);
await ctx.addCookies([{
  name: "session",
  value: session,
  url: base,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
}]);
const page = await ctx.newPage();

const overlay = (kb) => {
  window.__setKeyboard(kb);
  document.getElementById("__kb")?.remove();
  if (kb > 0) {
    const d = document.createElement("div");
    d.id = "__kb";
    d.textContent = `KEYBOARD simulated ${kb}px (visualViewport, not a device)`;
    d.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${kb}px;z-index:99999;pointer-events:none;background:repeating-linear-gradient(45deg,#3b3b46,#3b3b46 10px,#33333d 10px,#33333d 20px);color:#fff;font:700 13px sans-serif;display:flex;align-items:center;justify-content:center;opacity:.96`;
    document.body.appendChild(d);
  }
};

async function readState() {
  return page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const bar = document.querySelector('[data-testid="studio-save-bar"]');
    const buttons = bar ? [...bar.querySelectorAll("button")] : [];
    const save = buttons.at(-1);
    const box = save?.getBoundingClientRect();
    const vv = window.visualViewport;
    const header = document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0;
    const bottom = (vv?.offsetTop ?? 0) + (vv?.height ?? innerHeight);
    return {
      url: location.pathname + location.search,
      heading: document.querySelector("h1")?.textContent?.trim() ?? "",
      editor: root.hasAttribute("data-studio-editor"),
      keyboardOpen: root.hasAttribute("data-keyboard-open"),
      simpleCreate: !!document.querySelector("[data-trpg-simple-create]"),
      saveBarCount: document.querySelectorAll('[data-testid="studio-save-bar"]').length,
      barPosition: bar ? getComputedStyle(bar).position : null,
      saveBarVar: cs.getPropertyValue("--studio-save-bar-h").trim(),
      scrollPaddingTop: cs.scrollPaddingTop,
      scrollPaddingBottom: cs.scrollPaddingBottom,
      inlineScrollPadding: root.style.scrollPaddingTop || root.style.scrollPaddingBottom || "",
      save: box
        ? {
            top: Math.round(box.top),
            bottom: Math.round(box.bottom),
            reachable: box.top >= header - 0.5 && box.bottom <= bottom + 0.5,
          }
        : null,
      visualViewportHeight: Math.round(vv?.height ?? innerHeight),
    };
  });
}

async function setKeyboard(kb) {
  await page.evaluate(overlay, kb);
  await page.waitForFunction(
    (open) => document.documentElement.hasAttribute("data-keyboard-open") === open,
    kb > 0,
  );
}

const metrics = { base, scenarioId, simulation: "visualViewport", shots: {} };

await page.goto(`${base}/trpg/scenarios/${scenarioId}`, { waitUntil: "domcontentloaded" });
await page.locator('[data-testid="studio-save-bar"]').waitFor({ state: "visible" });
await page.waitForTimeout(200);
metrics.shots.editKeyboardClosed = await readState();
await page.screenshot({ path: `${out}/scenario-edit-667x375-kb0-fixed.png` });

await setKeyboard(190);
await page.waitForTimeout(200);
metrics.shots.editKeyboardOpenTop = await readState();
await page.screenshot({ path: `${out}/scenario-edit-667x375-kb190-static-top.png` });

await page.mouse.move(661, 200);
let steps = 0;
let state = metrics.shots.editKeyboardOpenTop;
while (!state.save?.reachable && steps < 150) {
  const distance = (state.save?.top ?? 0) - state.visualViewportHeight;
  await page.mouse.wheel(0, distance > 240 ? 400 : (state.save?.bottom ?? 0) < 0 ? -20 : 20);
  await page.waitForTimeout(40);
  state = await readState();
  steps += 1;
}
metrics.shots.editKeyboardOpenScrolled = { ...state, steps };
await page.screenshot({ path: `${out}/scenario-edit-667x375-kb190-scrolled-to-save.png` });

await page.goto(`${base}/trpg/scenarios/new`, { waitUntil: "domcontentloaded" });
await page.locator("[data-trpg-simple-create]").waitFor({ state: "visible" });
await page.evaluate((kb) => window.__setKeyboard(kb), 190);
await page.waitForFunction(() => document.documentElement.hasAttribute("data-keyboard-open"));
await page.waitForTimeout(200);
metrics.shots.simpleCreateKeyboardOpen = await readState();
await page.screenshot({ path: `${out}/simple-create-667x375-kb190.png` });
await page.evaluate(overlay, 190);
await page.screenshot({ path: `${out}/simple-create-667x375-kb190-overlay.png` });

fs.writeFileSync(`${out}/metrics.json`, JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics, null, 2));
await browser.close();
