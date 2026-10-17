import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
// usage: e49b-reach.mjs <base> <label>  — wheel-scroll to the save button with a simulated keyboard open (667x375, kb190)
const [base, label] = process.argv.slice(2);
const out = `/tmp/e49b/${label}`;
fs.mkdirSync(out, { recursive: true });
const init = fs.readFileSync("/workspace/scripts/e47-vv.js", "utf8");
const b = await launch();
const overlay = (k) => {
  window.__setKeyboard(k);
  document.getElementById("__kb")?.remove();
  if (k > 0) {
    const d = document.createElement("div");
    d.id = "__kb";
    d.textContent = `KEYBOARD (simulated ${k}px)`;
    d.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${k}px;z-index:99999;pointer-events:none;background:repeating-linear-gradient(45deg,#3b3b46,#3b3b46 10px,#33333d 10px,#33333d 20px);color:#fff;font:700 14px sans-serif;display:flex;align-items:center;justify-content:center;opacity:.96`;
    document.body.appendChild(d);
  }
};
const res = {};
for (const [name, path] of [["create", "/create"], ["world", "/world/create"]]) {
  const { page, ctx } = await openPage(b, base, { path, user: "creatorA", width: 667, height: 375, wait: 900, until: "domcontentloaded", init });
  await page.evaluate(overlay, 190);
  await page.waitForTimeout(300);
  await page.mouse.move(661, 200);
  const state = () => page.evaluate(() => {
    const vv = visualViewport.height;
    const hdr = document.querySelector(".site-header").getBoundingClientRect().bottom;
    const btn = [...document.querySelectorAll('[data-testid="studio-save-bar"] button')].pop().getBoundingClientRect();
    const bar = getComputedStyle(document.querySelector('[data-testid="studio-save-bar"]')).position;
    return { vv, hdr: Math.round(hdr), top: Math.round(btn.top), bottom: Math.round(btn.bottom), bar, ok: btn.top >= hdr - 0.5 && btn.bottom <= vv + 0.5 };
  });
  let s = await state(), steps = 0;
  while (!s.ok && steps < 150) {
    const dist = s.top - vv(s);
    await page.mouse.wheel(0, dist > 240 ? 400 : s.bottom < s.hdr ? -20 : 20);
    await page.waitForTimeout(40);
    s = await state(); steps++;
  }
  res[name] = { ...s, steps };
  await page.screenshot({ path: `${out}/${name}-kb190-scrolled-to-save.png` });
  await ctx.close();
}
function vv(s) { return s.vv; }
fs.writeFileSync(`${out}/reach.json`, JSON.stringify(res, null, 1));
console.log(label, JSON.stringify(res));
await b.close();
