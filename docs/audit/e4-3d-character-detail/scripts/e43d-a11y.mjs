import { chromium } from "playwright-core";
import fs from "fs";
const [, , BASE, TAG] = process.argv;
const fx = JSON.parse(fs.readFileSync("/tmp/e43d-fixtures.json", "utf8"));
const b = await chromium.launch();
const out = {};
for (const w of [390, 1440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, locale: "ko-KR", reducedMotion: "reduce", hasTouch: w < 600, isMobile: w < 600 });
  await ctx.addCookies([{ name: "session", value: fx.tokens.std, url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/tab/new`, { waitUntil: "load" });
  await p.waitForTimeout(1200);
  const ok = p.getByRole("button", { name: "확인", exact: true });
  if (await ok.count()) await ok.first().click().catch(() => {});
  await p.locator(`[data-character-card="${fx.ids.rich}"] a`).first().click({ noWaitAfter: true });
  await p.waitForURL(/\/character\//, { timeout: 8000 });
  await p.waitForTimeout(1500);
  const rm = await p.evaluate(() => ({
    veil: !!document.querySelector(".rv-veil"),
    hiddenItems: [...document.querySelectorAll("[data-hero-item]")].filter((e) => getComputedStyle(e).visibility === "hidden").length,
    anims: document.getAnimations().length,
  }));
  const btn = p.getByRole("button", { name: /대화 시작/ }).first();
  await btn.focus();
  await p.keyboard.press("Tab");
  await p.keyboard.press("Shift+Tab");
  const focus = await btn.evaluate((e) => {
    const cs = getComputedStyle(e);
    return { outline: cs.outlineStyle + " " + cs.outlineWidth, focusVisible: e.matches(":focus-visible"), shadow: cs.boxShadow.slice(0, 60) };
  });
  await btn.scrollIntoViewIfNeeded();
  await p.screenshot({ path: `/opt/cursor/artifacts/e43d/a11y-${TAG}-focus-${w}.png` });
  out[w] = { reducedMotion: rm, focus };
  await ctx.close();
}
console.log(TAG, JSON.stringify(out));
await b.close();
