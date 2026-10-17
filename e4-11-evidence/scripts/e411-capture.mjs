import fs from "fs";
import { chromium } from "playwright-core";

const [base, outDir, label] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 320, height: 568 },
  isMobile: true,
  locale: "ko-KR",
});
const page = await ctx.newPage();
await page.request.post(`${base}/api/auth/demo-login`);
await page.goto(`${base}/tab/ranking`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
await page.evaluate(() => {
  const span = document.querySelector('header.site-header [aria-label^="보유 포인트"] span');
  if (span) span.textContent = "123,456,789P";
});
const metrics = await page.evaluate(() => {
  const top = document.querySelector("header.site-header").children[0];
  const logo = top.querySelector('a[aria-label$="홈"]').getBoundingClientRect();
  const bell = top.querySelector('button[aria-label^="알림"]').getBoundingClientRect();
  const controls = [...top.querySelectorAll("a,button")]
    .filter((el) => !el.closest('nav[aria-label="주요 메뉴"]'))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 20),
        l: Math.round(r.left * 10) / 10,
        r: Math.round(r.right * 10) / 10,
      };
    })
    .filter((c) => c.r > c.l);
  const overlaps = [];
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i];
      const b = controls[j];
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      if (ox > 1) overlaps.push(`${a.label}|${b.label}:${Math.round(ox * 10) / 10}`);
    }
  }
  return {
    logoToBell: Math.round((bell.left - logo.right) * 10) / 10,
    overlaps,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    hasShop: !!top.querySelector('a[aria-label="포인트 충전"]'),
  };
});
await page.screenshot({ path: `${outDir}/header-320-pay-on-9digit-${label}.png` });
fs.writeFileSync(`${outDir}/metrics-320-${label}.json`, JSON.stringify(metrics, null, 2));

await ctx.close();
const ctx390 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const page390 = await ctx390.newPage();
await page390.request.post(`${base}/api/auth/demo-login`);
await page390.goto(`${base}/tab/ranking`);
await page390.waitForTimeout(500);
await page390.screenshot({ path: `${outDir}/header-390-pay-on-normal-${label}.png` });
await ctx390.close();
await browser.close();
console.log(label, metrics);
