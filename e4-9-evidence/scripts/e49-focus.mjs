import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
// usage: e49-focus.mjs <base> <label> <w> <h> [kb] [path]
const [base, label, W, H, KB = "0", pathArg = "/create"] = process.argv.slice(2);
const w = Number(W), h = Number(H), kb = Number(KB);
const init = fs.readFileSync("/workspace/scripts/e47-vv.js", "utf8");
const POPUP_OFF = fs.readFileSync("/workspace/scripts/e48-menu.mjs", "utf8").match(/const POPUP_OFF = `([^`]*)`/)[1];
fs.mkdirSync(`/tmp/e49/${label}`, { recursive: true });

const PROBE = `(() => {
  const px = (v) => Math.round(v * 10) / 10;
  const rect = (el) => { const b = el.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, h: b.height }; };
  const covers = () => {
    const vv = window.visualViewport;
    const vh = vv.height;
    const hdr = document.querySelector(".site-header");
    const tabs = document.querySelector('[role="tablist"]');
    const bar = document.querySelector('[data-testid="studio-save-bar"]');
    const nav = document.querySelector(".mobile-bottom-nav");
    const navOn = nav && getComputedStyle(nav).display !== "none";
    let top = 0;
    if (hdr && getComputedStyle(hdr).position !== "static") top = Math.max(top, rect(hdr).b);
    if (tabs && getComputedStyle(tabs).position === "sticky" && rect(tabs).t <= top + 1) top = Math.max(top, rect(tabs).b);
    let bottom = vh;
    if (bar) bottom = Math.min(bottom, rect(bar).t);
    if (navOn) bottom = Math.min(bottom, rect(nav).t);
    return { top, bottom, vh };
  };
  const caretRect = (ta) => {
    const cs = getComputedStyle(ta);
    const m = document.createElement("div");
    for (const p of ["boxSizing","width","fontFamily","fontSize","fontWeight","lineHeight","letterSpacing","paddingTop","paddingRight","paddingBottom","paddingLeft","borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth","whiteSpace","wordBreak","overflowWrap","textIndent","tabSize"]) m.style[p] = cs[p];
    m.style.position = "absolute"; m.style.visibility = "hidden"; m.style.whiteSpace = "pre-wrap"; m.style.overflowWrap = "break-word"; m.style.top = "0"; m.style.left = "-9999px";
    const pos = ta.selectionEnd;
    m.textContent = ta.value.slice(0, pos);
    const s = document.createElement("span"); s.textContent = "\\u200b"; m.appendChild(s);
    document.body.appendChild(m);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const y = s.offsetTop - ta.scrollTop;
    const tb = ta.getBoundingClientRect();
    m.remove();
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const top = tb.top + bt + y;
    return { t: top, b: top + lh };
  };
  window.__probe = () => {
    const el = document.activeElement;
    const c = covers();
    if (!el || el === document.body) return { none: true, covers: c };
    const r = rect(el);
    const free0 = Math.max(r.t, c.top), free1 = Math.min(r.b, c.bottom);
    const visible = Math.max(0, free1 - free0);
    const out = { tag: el.tagName, id: el.id.slice(-18), name: (el.labels && el.labels[0] ? el.labels[0].textContent : el.getAttribute("aria-label") || "").trim().slice(0, 20), h: px(r.h), visiblePx: px(visible), visibleRatio: px(visible / Math.max(1, r.h)), free: px(c.bottom - c.top), covers: { top: px(c.top), bottom: px(c.bottom), vh: px(c.vh) } };
    if (el.tagName === "TEXTAREA") {
      const cr = caretRect(el);
      out.caret = { t: px(cr.t), b: px(cr.b), hidden: !(cr.t >= c.top - 0.5 && cr.b <= c.bottom + 0.5) };
    }
    return out;
  };
})();`;

const b = await launch();
const { page, ctx } = await openPage(b, base, { path: pathArg, user: "creatorA", width: w, height: h, wait: 900, until: "domcontentloaded", init: init + POPUP_OFF });
await page.evaluate(PROBE);
await page.evaluate((k) => window.__setKeyboard(k), kb);
await page.waitForTimeout(300);
const probe = () => page.evaluate(() => window.__probe());
const res = { vp: `${w}x${h}`, kb, tab: [], shift: [], touch: [], typing: [] };
const shot = (n) => page.screenshot({ path: `/tmp/e49/${label}/${w}x${h}-kb${kb}-${n}.png` });

const LONG = Array.from({ length: 30 }, (_, i) => `줄 ${i + 1}: 이 문장은 입력 중 캐럿이 저장 바와 탭 뒤로 숨는지 확인하기 위한 긴 테스트 문장입니다.`).join("\n");
// fill every visible textarea with long text first (so rows grow), then reset scroll
const tas = page.locator("#studio-character-form textarea");
const nTa = await tas.count();
for (let i = 0; i < nTa; i++) {
  const t = tas.nth(i);
  if (await t.isVisible()) await t.evaluate((el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); }, LONG);
}
await page.waitForTimeout(300);
await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement && document.activeElement.blur(); });
await page.waitForTimeout(250);

// Tab forward through focusables inside the form, record each textarea
await page.locator("#studio-character-form input:visible").first().focus();
await page.evaluate(() => window.scrollTo(0, 0));
for (let i = 0; i < 40; i++) {
  await page.keyboard.press("Tab");
  await page.waitForTimeout(60);
  const p = await probe();
  if (!p.none && p.tag === "TEXTAREA") res.tab.push(p);
  const inForm = await page.evaluate(() => !!document.activeElement.closest("#studio-character-form"));
  if (!inForm) break;
}
if (res.tab[0]) await shot("tab-first");
const worstTab = res.tab.reduce((a, x) => (!a || x.visibleRatio < a.visibleRatio ? x : a), null);
if (worstTab) await shot("tab-worst");
// Shift+Tab back
for (let i = 0; i < 40; i++) {
  await page.keyboard.press("Shift+Tab");
  await page.waitForTimeout(60);
  const p = await probe();
  if (!p.none && p.tag === "TEXTAREA") res.shift.push(p);
  const inForm = await page.evaluate(() => !!document.activeElement.closest("#studio-character-form"));
  if (!inForm) break;
}
const worstShift = res.shift.reduce((a, x) => (!a || x.visibleRatio < a.visibleRatio ? x : a), null);
if (worstShift) await shot("shift-worst");

// Touch / mouse: scroll each textarea to its natural position, click its visible middle, then type
for (let i = 0; i < nTa; i++) {
  const t = tas.nth(i);
  if (!(await t.isVisible())) continue;
  await page.evaluate(() => window.scrollTo(0, 0));
  await t.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForTimeout(120);
  const pos = await t.evaluate((el) => { const c = window.__probe; const r = el.getBoundingClientRect(); return { r: { t: r.top, b: r.bottom, l: r.left, w: r.width } }; });
  const cov = await page.evaluate(() => { const hdr = document.querySelector(".site-header").getBoundingClientRect().bottom; const bar = document.querySelector('[data-testid="studio-save-bar"]').getBoundingClientRect().top; return { hdr, bar }; });
  const y = Math.min(Math.max(pos.r.t + 20, cov.hdr + 60), Math.min(pos.r.b - 10, cov.bar - 10));
  await page.mouse.click(pos.r.l + pos.r.w / 2, y);
  await page.waitForTimeout(150);
  const before = await probe();
  if (before.tag !== "TEXTAREA") continue;
  // move caret to end and type, simulating the user continuing to write at the end of long text
  await page.keyboard.press("Control+End");
  await page.waitForTimeout(120);
  const atEnd = await probe();
  await page.keyboard.type("\n마지막 줄에 이어서 입력");
  await page.waitForTimeout(250);
  const typed = await probe();
  res.touch.push({ name: before.name, click: before, atEnd, typed });
  if (i === 0) await shot(`typed-${i}`);
}

fs.writeFileSync(`/tmp/e49/${label}/focus-${w}x${h}-kb${kb}.json`, JSON.stringify(res, null, 1));
const sum = (arr) => arr.map((x) => `${x.name}:${x.visibleRatio}${x.caret ? (x.caret.hidden ? "!c" : "") : ""}`).join(" ");
console.log(`${label} ${w}x${h} kb=${kb} textareas=${nTa}`);
console.log(" tab  ", sum(res.tab));
console.log(" shift", sum(res.shift));
console.log(" end  ", res.touch.map((x) => `${x.name}: caretHidden(end)=${x.atEnd.caret?.hidden} typed=${x.typed.caret?.hidden} free=${x.typed.free}`).join(" | "));
await ctx.close();
await b.close();
