import { chromium } from "playwright-core";
import fs from "fs";

const [, , BASE, TAG] = process.argv;
const fx = JSON.parse(fs.readFileSync("/tmp/e43c-fixtures.json", "utf8"));
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
};

async function open(w, user, { reducedMotion = "no-preference", path = "/" } = {}) {
  const mobile = w < 600;
  const ctx = await browser.newContext({
    viewport: { width: w, height: mobile ? 844 : 900 },
    locale: "ko-KR",
    hasTouch: mobile,
    isMobile: mobile,
    reducedMotion,
  });
  if (user !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + path, { waitUntil: "load" });
  await p.waitForTimeout(900);
  const ok = p.getByRole("button", { name: "확인", exact: true });
  if (await ok.count()) await ok.first().click().catch(() => {});
  await p.waitForTimeout(250);
  return { ctx, p };
}

for (const w of [390, 640, 1440]) {
  const { ctx, p } = await open(w, "std");
  const main = p.locator("main");
  const eventCta = main.getByRole("link", { name: /제작 이벤트 참여/ });
  check(`${w} event CTA href`, (await eventCta.getAttribute("href")) === "/events/create-migration");
  check(`${w} event reward copy`, (await main.locator('section[aria-label="제작 이벤트"]').innerText()).includes("3,000P"));
  const links = await main.locator("a").evaluateAll((as) => as.map((a) => [a.getAttribute("href"), a.textContent.trim()]));
  check(`${w} ranking/new links`, links.some(([h, t]) => h === "/tab/ranking" && t.includes("전체보기")) && links.some(([h, t]) => h === "/tab/new" && t.includes("더보기")) && links.some(([h, t]) => h === "/tab/ranking" && t.includes("인기 이야기")), JSON.stringify(links.filter(([h]) => h?.startsWith("/tab") || h?.startsWith("/events"))));
  const navHrefs = await p.locator("header a, nav a").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  check(`${w} main nav destinations`, ["/tab/new", "/tab/ranking", "/trpg", "/search"].every((h) => navHrefs.includes(h)), navHrefs.join(","));

  const row = main.locator(".home-card-row").first();
  await row.scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, -40));
  await p.waitForTimeout(200);
  const before = await row.evaluate((e) => e.scrollLeft);
  if (w >= 600) {
    const box = await row.boundingBox();
    await p.mouse.move(box.x + 300, box.y + 150);
    await p.mouse.down();
    await p.mouse.move(box.x + 120, box.y + 150, { steps: 8 });
    await p.mouse.up();
    await p.waitForTimeout(150);
    const after = await row.evaluate((e) => e.scrollLeft);
    check(`${w} row drag scroll`, after > before + 40, `scrollLeft ${before} -> ${after}`);
    check(`${w} drag does not navigate`, new URL(p.url()).pathname === "/", p.url());
  } else {
    const cdp = await ctx.newCDPSession(p);
    const box = await row.boundingBox();
    const y = box.y + 150;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 300, y }] });
    for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 300 - i * 20, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(400);
    const after = await row.evaluate((e) => e.scrollLeft);
    check(`${w} row touch swipe`, after > before + 40, `scrollLeft ${before} -> ${after}`);
  }
  const lastReach = await row.evaluate((e) => { e.scrollLeft = e.scrollWidth; return Math.round(e.scrollLeft + e.clientWidth - e.scrollWidth) >= -1; });
  check(`${w} row end reachable (last card not clipped)`, lastReach);
  await row.evaluate((e) => (e.scrollLeft = 0));

  const firstCard = main.locator(".home-card a[href^='/character/']").first();
  await firstCard.focus();
  await p.keyboard.press("Tab");
  const focusedInRow = await p.evaluate(() => !!document.activeElement?.closest(".home-card"));
  check(`${w} keyboard focus moves between cards`, focusedInRow);

  const href = await firstCard.getAttribute("href");
  const attr = await main.locator("[data-character-card]").first().getAttribute("data-character-card");
  check(`${w} D-1 marker on card`, !!attr);
  await firstCard.click();
  let reveal = false;
  try {
    await p.waitForSelector("[data-character-reveal]", { timeout: 2500, state: "attached" });
    reveal = true;
  } catch {}
  await p.waitForURL((u) => u.pathname === href, { timeout: 8000 }).catch(() => {});
  check(`${w} D-1 reveal overlay + navigation`, reveal && new URL(p.url()).pathname === href, `reveal=${reveal} url=${p.url()}`);
  await ctx.close();
}

for (const user of ["guest", "std", "adminOn", "adminOff"]) {
  const { ctx, p } = await open(1440, user);
  const adult = (await p.locator("main").innerText()).includes("성인 테스트 캐릭터");
  const expectAdult = user === "adminOff";
  check(`adult card visibility ${user}`, adult === expectAdult, `visible=${adult} expected=${expectAdult}`);
  const officialBadges = await p.locator("main .home-card").filter({ hasText: "공식" }).count();
  check(`official cards render ${user}`, officialBadges > 0, `n=${officialBadges}`);
  const ambientImgs = await p.locator(".home-ambient img").evaluateAll((is) => is.map((i) => i.getAttribute("src")));
  if (ambientImgs.length) check(`ambient never uses adult art ${user}`, !ambientImgs.some((s) => s?.includes("NEVER")), ambientImgs.join(","));
  await ctx.close();
}

{
  const { ctx, p } = await open(1440, "std", { reducedMotion: "reduce" });
  const dur = await p.locator("main .home-card-media").first().evaluate((e) => getComputedStyle(e).transitionDuration);
  const ambientAnim = await p.evaluate(() => [...document.querySelectorAll(".home-ambient, .home-ambient img")].map((e) => getComputedStyle(e).animationName + "/" + getComputedStyle(e).transitionDuration));
  check("reduced-motion: card transitions off", /^0s/.test(dur), dur);
  check("reduced-motion: ambient has no animation", ambientAnim.every((a) => a.startsWith("none/0s")), ambientAnim.join("|"));
  await ctx.close();
}

{
  const { ctx, p } = await open(390, "std");
  const order = [];
  for (let i = 0; i < 14; i++) {
    await p.keyboard.press("Tab");
    order.push(await p.evaluate(() => { const a = document.activeElement; return (a?.getAttribute("aria-label") || a?.textContent || a?.tagName || "").trim().slice(0, 18); }));
  }
  const iEvent = order.findIndex((t) => t.includes("제작 이벤트"));
  const iCard = order.findIndex((t) => t.includes("달빛") || t.includes("세라핀") || t.includes("공식"));
  check("tab order: event CTA before first section card", iEvent >= 0 && (iCard < 0 || iEvent < iCard), order.join(" > "));
  await ctx.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`SUMMARY ${TAG}: checks=${results.length} failed=${failed}`);
fs.writeFileSync(`/tmp/e43c-flow-${TAG}.json`, JSON.stringify(results, null, 1));
await browser.close();
