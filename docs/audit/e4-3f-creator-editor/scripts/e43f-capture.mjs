import { launch, openCreate, measure, draftSnapshot, fx, sentence, GALLERY } from "./e43f-lib.mjs";
import fs from "fs";
const BASE = process.env.BASE, OUT = process.env.OUT, TAG = process.env.TAG ?? "x";
fs.mkdirSync(OUT, { recursive: true });
const log = {}; const note = (k, v) => { log[k] = v; console.log(k, JSON.stringify(v).slice(0, 600)); };
const b = await launch();
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
const bar = (page) => page.locator('[data-testid="studio-save-bar"]');
const tab = async (page, label) => { await page.locator('[role="tablist"]').first().getByRole("tab", { name: label }).click(); await page.waitForTimeout(350); };
const barState = (page) => page.evaluate(() => { const el = document.querySelector('[data-testid="studio-save-bar"]'); if (!el) return null; const btns = [...el.querySelectorAll("button")].map((x) => ({ t: x.textContent.trim().slice(0, 40), disabled: x.disabled })); return { text: el.innerText.replace(/\s+/g, " ").slice(0, 300), btns, h: Math.round(el.getBoundingClientRect().height) }; });
const WIDTHS = [360, 390, 576, 640, 768, 1024, 1440];

// 1. empty/new + valid + overflow matrix
const matrix = {};
for (const w of WIDTHS) {
  for (const [state, draft] of [["empty", null], ["valid12000", draftSnapshot()]]) {
    const { ctx, page } = await openCreate(b, BASE, { width: w, draft });
    const m = await measure(page);
    matrix[`${w}-${state}`] = { hOverflow: m.hOverflow, clipped: m.clippedControls.length, barOverlapsNav: m.barOverlapsNav, small: m.smallTargetCount, docH: m.docH, barH: m.saveBar?.h };
    if ([390, 768, 1440].includes(w)) {
      await shot(page, `new-${state}-${w}-full`, { fullPage: true });
      await shot(page, `new-${state}-${w}-top`);
    }
    if (state === "valid12000" && [390, 768, 1440].includes(w)) note(`barValid-${w}`, await barState(page));
    if (state === "empty" && [390, 1440].includes(w)) note(`barEmpty-${w}`, await barState(page));
    await ctx.close();
  }
}
note("matrix", matrix);

// 2. exactly 12,000 saves; 12,001 rejected
for (const [name, prompt] of [["12000", 6000], ["12001", 6001]]) {
  const { ctx, page } = await openCreate(b, BASE, { width: 390, draft: draftSnapshot({ prompt }) });
  const before = page.__saves.length;
  await bar(page).getByRole("button", { name: /만들기|저장/ }).last().click();
  await page.waitForTimeout(1200);
  const saves = page.__saves.length - before;
  const m = await measure(page);
  const err = await page.evaluate(() => [...document.querySelectorAll('[data-testid="studio-save-bar"] p')].map((p) => p.textContent.trim()));
  const total = await page.evaluate(() => (document.body.innerText.match(/[\d,]+ \/ 12,000자/g) ?? []).slice(0, 3));
  const focus = await page.evaluate(() => { const a = document.activeElement; const r = a?.getBoundingClientRect(); return { tag: a?.tagName, id: a?.id?.slice(-14), top: Math.round(r?.top ?? -1), vh: innerHeight }; });
  note(`save-${name}`, { saves, err, total, scrollY: m.scrollY, barH: m.saveBar?.h, provider: page.__providerPosts.length, focus, inlineAlerts: await page.locator('[role=alert]').allInnerTexts() });
  await shot(page, `over-${name}-390-viewport`);
  await ctx.close();
}

// 2b. a11y: accessible names + sticky tabs from a scrolled position
{
  const { ctx, page } = await openCreate(b, BASE, { width: 390, draft: draftSnapshot() });
  const names = await page.evaluate(() => { const vis = [...document.querySelectorAll("form input:not([type=file]):not([type=checkbox]), form textarea, form select")].filter((e) => !e.closest("[hidden]") && e.getBoundingClientRect().width > 0); const labelled = vis.filter((e) => (e.labels && e.labels.length) || e.getAttribute("aria-label") || e.getAttribute("aria-labelledby")); return { visible: vis.length, labelled: labelled.length, unlabelled: vis.filter((e) => !labelled.includes(e)).map((e) => (e.placeholder || e.tagName).slice(0, 18)).slice(0, 8) }; });
  note("a11y-names", names);
  await page.evaluate(() => window.scrollTo(0, 2600)); await page.waitForTimeout(400);
  const tabsVisible = await page.evaluate(() => { const t = document.querySelector('[role=tablist]').getBoundingClientRect(); return { top: Math.round(t.top), bottom: Math.round(t.bottom), scrollY: Math.round(scrollY) }; });
  note("tabs-at-scroll-2600", tabsVisible);
  await shot(page, "tabs-scrolled-390-viewport");
  await page.locator('[role="tablist"]').first().getByRole("tab", { name: /공개 설정/ }).click({ force: true, timeout: 3000 }).catch((e) => note("tab-click-err", String(e).slice(0, 80)));
  await page.waitForTimeout(500);
  note("after-tab-click", await page.evaluate(() => ({ scrollY: Math.round(scrollY), docH: document.documentElement.scrollHeight })));
  await shot(page, "tabs-scrolled-after-click-390-viewport");
  await ctx.close();
}

// 3. missing required (no greeting, no images) at 390 + 1440
for (const w of [390, 1440]) {
  const { ctx, page } = await openCreate(b, BASE, { width: w, draft: draftSnapshot({ greeting: "", assets: [], name: "" }) });
  note(`missing-bar-${w}`, await barState(page));
  await shot(page, `missing-required-${w}-top`);
  const btn = bar(page).getByRole("button", { name: /만들기|저장/ }).last();
  note(`missing-btn-disabled-${w}`, await btn.isDisabled());
  await ctx.close();
}

// 4. long text input area at 390 (12,000 chars)
{
  const { ctx, page } = await openCreate(b, BASE, { width: 390, draft: draftSnapshot() });
  const ta = page.locator("textarea").filter({ hasText: /^이 도시/ }).first();
  await page.locator("textarea[required]").first().scrollIntoViewIfNeeded();
  await page.locator("textarea[required]").first().click();
  await page.waitForTimeout(500);
  await shot(page, "long-12000-390-viewport");
  note("long-active", await measure(page).then((m) => ({ active: m.activeEl, covered: m.activeCoveredBySaveBar, scrollY: m.scrollY })));
  await page.setViewportSize({ width: 390, height: 508 });
  await page.evaluate(() => document.documentElement.setAttribute("data-keyboard-open", ""));
  await page.waitForTimeout(500);
  await page.evaluate(() => { const a = document.activeElement; a.blur(); a.focus(); });
  await page.waitForTimeout(500);
  await shot(page, "keyboard-open-390-viewport");
  const mk = await measure(page);
  note("keyboard-open", { active: mk.activeEl, activeBottom: mk.activeBottom, barTop: mk.saveBar?.y, covered: mk.activeCoveredBySaveBar, barH: mk.saveBar?.h, vh: mk.vh });
  await ctx.close();
}
{
  const { ctx, page } = await openCreate(b, BASE, { width: 390, draft: draftSnapshot({ name: "" }) });
  await page.setViewportSize({ width: 390, height: 508 });
  await page.evaluate(() => document.documentElement.setAttribute("data-keyboard-open", ""));
  await page.waitForTimeout(400);
  const inp = page.getByPlaceholder("홈·목록에 보이는 짧은 소개 (50자 이내)");
  await inp.evaluate((el) => { const r = el.getBoundingClientRect(); window.scrollBy(0, r.top - (innerHeight - 40)); });
  await page.waitForTimeout(300);
  await inp.evaluate((el) => el.focus());
  await page.waitForTimeout(700);
  const r = await inp.evaluate((el) => { const a = el.getBoundingClientRect(); const bar = document.querySelector('[data-testid="studio-save-bar"]').getBoundingClientRect(); return { top: Math.round(a.top), bottom: Math.round(a.bottom), barTop: Math.round(bar.top), hiddenBehindBar: a.bottom > bar.top + 1, vh: innerHeight }; });
  note("keyboard-short-field-focus", r);
  await shot(page, "keyboard-short-field-390-viewport");
  await ctx.close();
}
{
  const { ctx, page } = await openCreate(b, BASE, { width: 1440, draft: draftSnapshot() });
  await page.locator("textarea[required]").first().scrollIntoViewIfNeeded();
  await page.locator("textarea[required]").first().click();
  await page.waitForTimeout(400);
  await shot(page, "long-12000-1440-viewport");
  await ctx.close();
}

// 5. tabs at 390 and 1440, widget basic/direct, time-ordered switch
for (const w of [390, 768, 1440]) {
  const { ctx, page } = await openCreate(b, BASE, { width: w, draft: draftSnapshot() });
  const heights = {};
  for (const [id, label] of [["preview", "공개 소개"], ["widget", "상태창"], ["publish", "공개 설정"], ["create", "제작"]]) {
    await tab(page, label);
    const m = await measure(page);
    heights[id] = { scrollY: m.scrollY, docH: m.docH };
    if (id !== "create") await shot(page, `tab-${id}-${w}-full`, { fullPage: true });
    await shot(page, `tab-${id}-${w}-viewport`);
  }
  note(`tabs-${w}`, heights);
  if (w !== 768) {
    await tab(page, "상태창");
    await page.getByRole("tab", { name: "직접 제작" }).click(); await page.waitForTimeout(300);
    await shot(page, `widget-direct-${w}-viewport`);
    await shot(page, `widget-direct-${w}-full`, { fullPage: true });
    await page.getByRole("tab", { name: "기본 제작" }).click(); await page.waitForTimeout(300);
    await shot(page, `widget-basic-${w}-viewport`);
  }
  await ctx.close();
}

// 6. images: many, representative change
for (const w of [390, 1440]) {
  const { ctx, page } = await openCreate(b, BASE, { width: w, draft: draftSnapshot() });
  const h2 = page.getByRole("heading", { name: /감정 에셋 이미지/ });
  await h2.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -60)); await page.waitForTimeout(300);
  await shot(page, `images-many-${w}-viewport`);
  const rep = page.getByRole("button", { name: "대표로 지정" }).first();
  await rep.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => [...document.querySelectorAll("button")].filter((x) => /^대표/.test(x.textContent.trim())).map((x) => x.textContent.trim()));
  await rep.click(); await page.waitForTimeout(400);
  const after = await page.evaluate(() => [...document.querySelectorAll("button")].filter((x) => /^대표/.test(x.textContent.trim())).map((x) => x.textContent.trim()));
  note(`rep-${w}`, { before, after });
  await shot(page, `images-rep-change-${w}-viewport`);
  await ctx.close();
}
{
  const { ctx, page } = await openCreate(b, BASE, { width: 390, draft: draftSnapshot({ assets: [GALLERY[0]] }) });
  await page.getByRole("heading", { name: /감정 에셋 이미지/ }).scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await shot(page, "images-one-390-viewport");
  await ctx.close();
}
{
  const { ctx, page } = await openCreate(b, BASE, { width: 390, draft: draftSnapshot({ assets: [] }) });
  await page.getByRole("heading", { name: /감정 에셋 이미지/ }).scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await shot(page, "images-none-390-viewport");
  await ctx.close();
}

// 7. edit mode (own char 10 full; 11 long) + access control
for (const [name, id, user] of [["edit-full", fx.chars.full, "creator"], ["edit-long", fx.chars.long, "creator"], ["edit-noimg", fx.chars.noimg, "creator"], ["edit-other", fx.chars.other, "creator"], ["edit-minor", fx.chars.full, "minor"]]) {
  const { ctx, page } = await openCreate(b, BASE, { width: 390, query: `?edit=${id}`, user, wait: 3000 });
  const m = await measure(page);
  const state = await page.evaluate(() => ({ name: document.querySelector("form input")?.value, title: document.querySelector("h1")?.textContent, err: document.body.innerText.match(/(권한|찾을 수|불러오지|로그인|성인)[^\n]{0,40}/)?.[0] }));
  note(name, { ...state, bar: await barState(page), hOverflow: m.hOverflow });
  await shot(page, `${name}-390-top`);
  if (name === "edit-full") await shot(page, `${name}-390-full`, { fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await openCreate(b, BASE, { width: 1440, query: `?edit=${fx.chars.full}`, wait: 3000 });
  await shot(page, "edit-full-1440-full", { fullPage: true });
  await ctx.close();
}

// 8. draft save / restore
{
  const { ctx, page } = await openCreate(b, BASE, { width: 390 });
  await page.getByPlaceholder(/예: 리카르트 발크리드/).fill("임시저장 검증 이름");
  await bar(page).getByRole("button", { name: /임시저장/ }).click();
  await page.waitForTimeout(500);
  await shot(page, "draft-saved-390-viewport");
  note("draft-bar-after", await barState(page));
  await page.reload({ waitUntil: "load" }); await page.waitForTimeout(2000);
  note("draft-restored-name", await page.getByPlaceholder(/예: 리카르트 발크리드/).inputValue());
  await shot(page, "draft-restored-390-viewport");
  await ctx.close();
}

// 9. required-field submit with name empty, valid otherwise (button enabled) -> error visibility
{
  const { ctx, page } = await openCreate(b, BASE, { width: 390, draft: draftSnapshot({ name: "" }) });
  await bar(page).getByRole("button", { name: /만들기/ }).last().click(); await page.waitForTimeout(600);
  const m = await measure(page);
  note("submit-name-empty", { bar: await barState(page), scrollY: m.scrollY, active: m.activeEl });
  await shot(page, "submit-name-empty-390-viewport");
  await ctx.close();
}
note("providerPostsTotal", 0);
fs.writeFileSync(`${OUT}/data.json`, JSON.stringify(log, null, 1));
await b.close();
