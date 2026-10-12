import { chromium } from "playwright-core";
import fs from "fs";

const [, , BASE, TAG] = process.argv;
const fx = JSON.parse(fs.readFileSync("/tmp/e43b-fixtures.json", "utf8"));
const OUT = process.env.OUT ?? "/tmp/e43b-out";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function session(user, w, h, start, steps, prefix) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "ko-KR", hasTouch: w < 600, isMobile: w < 600, deviceScaleFactor: 2 });
  if (user !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + start, { waitUntil: "load" });
  await p.waitForTimeout(1000);
  const ok = p.getByRole("button", { name: "확인", exact: true });
  if (await ok.count()) await ok.first().click().catch(() => {});
  let n = 1;
  await p.screenshot({ path: `${OUT}/${TAG}-${prefix}-${n}.png` });
  for (const label of steps) {
    const link = p.locator("nav a:visible", { hasText: label }).first();
    if (!(await link.count())) {
      console.log(TAG, prefix, "missing link", label);
      break;
    }
    await link.click();
    await p.waitForTimeout(1600);
    n += 1;
    await p.screenshot({ path: `${OUT}/${TAG}-${prefix}-${n}.png` });
    console.log(TAG, prefix, n, label, "→", new URL(p.url()).pathname);
  }
  await ctx.close();
}

await session("guest", 390, 844, "/", ["신작", "랭킹", "검색", "TRPG"], "flowGuest");
await session("std", 390, 844, "/chats", ["신작", "검색", "설정"], "flowStd");
await browser.close();
