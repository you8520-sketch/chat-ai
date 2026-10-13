// usage: node scripts/e43hd-capture.mjs <label> <baseUrl> [group,group,...]
import fs from "fs";
import { launch, openPage, measure, WIDTHS } from "./e43hd-lib.mjs";

const [label, base, groupArg] = process.argv.slice(2);
const groups = groupArg ? groupArg.split(",") : null;
const out = `/tmp/e43h-out/${label}`;
fs.mkdirSync(`${out}/raw`, { recursive: true });
const want = (g) => !groups || groups.includes(g);
const metrics = {};
const shot = (page, name, opts = {}) => page.screenshot({ path: `${out}/raw/${name}.png`, ...opts });

const tab = (page, name) => page.locator("button,[role=tab]", { hasText: new RegExp(`^${name}$`) }).first();
const heading = (page, re) => page.getByRole("heading", { name: re }).first();
async function toHeading(page, re, offset = 132) {
  const h = heading(page, re);
  await h.scrollIntoViewIfNeeded();
  await h.evaluate((el, off) => { el.scrollIntoView({ block: "start" }); scrollBy(0, -off); }, offset);
  await page.waitForTimeout(250);
}
const sectionOf = (page, re) => page.locator("section", { has: page.getByRole("heading", { name: re }) }).first();

const clickFallbacks = [];
const click = async (loc, tag) => {
  try { await loc.click({ timeout: 5000 }); } catch (e) { clickFallbacks.push(tag); await loc.evaluate((el) => el.click()); }
};
const staticSticky = (page) => page.addStyleTag({ content: '[data-testid="withdraw-action-bar"],[data-testid="creator-profile-save-bar"]{position:static !important}' });
const browser = await launch();
const dash = async (user, width, opts = {}) => openPage(browser, base, { path: "/creator", user, width, ...opts });

if (want("full")) {
  for (const [user, width] of [["standard", 390], ["standard", 768], ["standard", 1440], ["pro", 390], ["pro", 1440]]) {
    const { ctx, page } = await dash(user, width);
    await staticSticky(page);
    await shot(page, `full-${width}-${user}`, { fullPage: true });
    await shot(page, `top-${width}-${user}`);
    metrics[`full-${width}-${user}`] = await measure(page);
    await ctx.close();
  }
}

if (want("inactive")) {
  for (const width of [390, 1440]) {
    const { ctx, page } = await dash("newbie", width);
    await staticSticky(page);
    await shot(page, `inactive-${width}`, { fullPage: true });
    metrics[`inactive-${width}`] = await measure(page);
    await ctx.close();
  }
}

if (want("tiers")) {
  for (const user of ["below", "sprout", "standard", "pro"]) {
    const { ctx, page } = await dash(user, 390);
    await shot(page, `tier-390-${user}`);
    await ctx.close();
  }
}

if (want("cp")) {
  for (const user of ["standard", "pro"]) {
    const { ctx, page } = await dash(user, 390);
    await toHeading(page, /최근 적립 내역/);
    await shot(page, `earnings-390-${user}`);
    await ctx.close();
  }
}

if (want("share")) {
  for (const width of [390, 1440]) {
    for (const [pid, plabel] of [["day", "하루"], ["week", "일주일"], ["month", "한달"]]) {
      const { ctx, page } = await dash("pro", width);
      const sec = sectionOf(page, /캐릭터별 적립비중/);
      await click(sec.locator("button", { hasText: new RegExp(`^${plabel}$`) }).first(), `share-${width}-${pid}`);
      await page.waitForTimeout(200);
      await toHeading(page, /캐릭터별 적립비중/);
      await shot(page, `share-${width}-${pid}`);
      if (width === 390 && pid === "week") { await staticSticky(page); await shot(page, `share-${width}-${pid}-full`, { fullPage: true }); }
      await ctx.close();
    }
  }
  const { ctx, page } = await dash("standard", 390);
  const sec = sectionOf(page, /캐릭터별 적립비중/);
  await click(sec.locator("button", { hasText: /^하루$/ }).first(), "share-std-day");
  await toHeading(page, /캐릭터별 적립비중/);
  await shot(page, "share-390-standard-day");
  await ctx.close();
}

if (want("exchange")) {
  const run = async (name, mode, setup) => {
    const { ctx, page } = await dash("standard", 390, { routes: null });
    page.__mode = mode;
    await toHeading(page, /CP → 유료 포인트 교환/);
    await shot(page, `exchange-390-${name}-0`);
    const sec = sectionOf(page, /CP → 유료 포인트 교환/);
    await sec.locator("input").first().fill(setup);
    await click(sec.locator("button", { hasText: /^유료P 교환$/ }), "exchange");
    await page.waitForTimeout(mode === "slow" ? 400 : 900);
    await shot(page, `exchange-390-${name}-1`);
    if (mode === "slow") {
      await sec.locator("button", { hasText: /교환 중/ }).click({ force: true, timeout: 500 }).catch(() => {});
      await page.waitForTimeout(1800);
    }
    metrics[`exchange-${name}`] = {
      posts: page.__calls.filter((c) => c.m === "POST" && c.p === "/api/creator").length,
      bodies: page.__calls.filter((c) => c.m === "POST").map((c) => c.body),
      inputValue: await sec.locator("input").first().inputValue(),
      dialogs: page.__dialogs,
      buttonText: await sec.locator("button").allTextContents(),
    };
    await ctx.close();
  };
  await run("ok", "ok", "1000");
  await run("insufficient", "insufficient", "999999");
  await run("network", "network", "1000");
  await run("slow", "slow", "1000");
}

if (want("withdraw")) {
  for (const user of ["standard", "blocked", "pending", "sprout"]) {
    const { ctx, page } = await dash(user, 390);
    await toHeading(page, /CP → 현금 출금 신청/);
    await shot(page, `withdraw-390-${user}-a`);
    await page.evaluate(() => scrollBy(0, 560));
    await page.waitForTimeout(150);
    await shot(page, `withdraw-390-${user}-b`);
    await ctx.close();
  }
  {
    const { ctx, page } = await dash("standard", 390);
    const sec = sectionOf(page, /CP → 현금 출금 신청/);
    const inputs = sec.locator("input:not([type=checkbox])");
    await inputs.nth(0).fill("40000");
    await inputs.nth(1).fill("가상은행");
    await inputs.nth(2).fill("000000000000");
    await inputs.nth(3).fill("9001011234567");
    await sec.locator("input[type=checkbox]").check();
    await toHeading(page, /CP → 현금 출금 신청/);
    await page.evaluate(() => scrollBy(0, 380));
    await shot(page, "withdraw-390-standard-filled");
    await click(sec.locator("button", { hasText: /^출금 신청$/ }), "withdraw");
    await page.waitForTimeout(900);
    await shot(page, "withdraw-390-standard-submitted");
    metrics["withdraw-submit"] = {
      posts: page.__calls.filter((c) => c.p === "/api/creator/withdraw").length,
      dialogs: page.__dialogs,
      body: page.__calls.find((c) => c.p === "/api/creator/withdraw")?.body ?? null,
    };
    await ctx.close();
  }
  {
    const { ctx, page } = await dash("standard", 390);
    page.__mode = "network";
    const sec = sectionOf(page, /CP → 현금 출금 신청/);
    const inputs = sec.locator("input:not([type=checkbox])");
    await inputs.nth(0).fill("40000");
    await inputs.nth(1).fill("가상은행");
    await inputs.nth(2).fill("000000000000");
    await inputs.nth(3).fill("9001011234567");
    await sec.locator("input[type=checkbox]").check();
    await click(sec.locator("button", { hasText: /^출금 신청$/ }), "withdraw");
    await page.waitForTimeout(900);
    await toHeading(page, /CP → 현금 출금 신청/);
    await page.evaluate(() => scrollBy(0, 380));
    await shot(page, "withdraw-390-standard-network");
    metrics["withdraw-network"] = {
      keptCp: await inputs.nth(0).inputValue(),
      keptBank: await inputs.nth(1).inputValue(),
      buttons: await sec.locator("button").allTextContents(),
    };
    await ctx.close();
  }
}

if (want("profile")) {
  for (const [user, name] of [["pro", "pro"], ["newbie", "empty"]]) {
    for (const width of [390, 1440]) {
      const { ctx, page } = await dash(user, width);
      await click(tab(page, "소개/공지"), "tab");
      await page.waitForTimeout(400);
      await shot(page, `profile-${width}-${name}`);
      if (width === 390) { await staticSticky(page); await shot(page, `profile-${width}-${name}-full`, { fullPage: true }); }
      metrics[`profile-${width}-${name}`] = await measure(page);
      await ctx.close();
    }
  }
  {
    const { ctx, page } = await dash("standard", 390);
    await click(tab(page, "소개/공지"), "tab");
    const ta = page.locator("textarea").first();
    await ta.fill('<h2>안녕하세요</h2><p>소개 <b>굵게</b></p><script>window.__x=1</script><img src=x onerror="window.__y=1">');
    await page.waitForTimeout(250);
    await ta.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(page, "profile-390-sanitize-input");
    metrics["profile-sanitize"] = await page.evaluate(() => ({
      hasScript: !!document.querySelector(".creator-comment-html script"),
      hasOnerror: /onerror/i.test(document.querySelector(".creator-comment-html")?.innerHTML ?? ""),
      previewHtml: (document.querySelector(".creator-comment-html")?.innerHTML ?? "").slice(0, 300),
    }));
    await click(page.locator("button", { hasText: /^저장$/ }).first(), "save");
    await page.waitForTimeout(700);
    await shot(page, "profile-390-saved");
    metrics["profile-save"] = { calls: page.__calls.filter((c) => c.m === "PATCH").map((c) => ({ p: c.p, b: c.body?.slice(0, 80) })), visibleFeedback: await page.getByText("크리에이터 소개를 저장했습니다.").count() };
    await ctx.close();
  }
}

if (want("notice")) {
  {
    const { ctx, page } = await dash("pro", 390);
    await click(tab(page, "소개/공지"), "tab");
    await page.getByText("공지 게시판").first().scrollIntoViewIfNeeded();
    await page.getByText("공지 게시판").first().evaluate((el) => { el.scrollIntoView({ block: "start" }); scrollBy(0, -90); });
    await shot(page, "notice-390-pro-list");
    await ctx.close();
  }
  {
    const { ctx, page } = await dash("standard", 390);
    await click(tab(page, "소개/공지"), "tab");
    await page.getByText("공지 게시판").first().evaluate((el) => { el.scrollIntoView({ block: "start" }); scrollBy(0, -90); });
    await page.locator("input[maxlength='80']").first().fill("정기 점검 안내");
    await page.locator("textarea").last().fill("이번 주 금요일 새벽에 점검이 있습니다.");
    await shot(page, "notice-390-create-filled");
    await click(page.locator("button", { hasText: /^공지 등록$/ }).first(), "notice-create");
    await page.waitForTimeout(700);
    await shot(page, "notice-390-create-done");
    await click(page.locator("button", { hasText: /^삭제$/ }).first(), "notice-delete");
    await page.waitForTimeout(700);
    await shot(page, "notice-390-delete-done");
    metrics["notice-flow"] = {
      calls: page.__calls.filter((c) => c.p === "/api/creator/notices").map((c) => ({ m: c.m, b: c.body })),
      dialogs: page.__dialogs,
    };
    await ctx.close();
  }
}

if (want("comments")) {
  for (const [user, width] of [["pro", 390], ["standard", 390], ["pro", 1440]]) {
    const { ctx, page } = await dash(user, width);
    await click(tab(page, "댓글·알림"), "tab");
    await page.waitForTimeout(400);
    if (width === 390) await staticSticky(page);
    await shot(page, `comments-${width}-${user}`, width === 390 ? { fullPage: true } : {});
    metrics[`comments-${width}-${user}`] = await measure(page);
    metrics[`comments-${width}-${user}`].switches = await page.locator("[role=switch]").evaluateAll((els) => els.map((e) => ({ l: e.getAttribute("aria-label"), c: e.getAttribute("aria-checked"), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) })));
    await ctx.close();
  }
}

if (want("keyboard")) {
  for (const [name, setup] of [
    ["exchange", async (page) => { await toHeading(page, /CP → 유료 포인트 교환/); await sectionOf(page, /CP → 유료 포인트 교환/).locator("input").first().click(); }],
    ["withdraw", async (page) => { await toHeading(page, /CP → 현금 출금 신청/); await sectionOf(page, /CP → 현금 출금 신청/).locator("input:not([type=checkbox])").nth(2).click(); }],
    ["profile", async (page) => { await click(tab(page, "소개/공지"), "tab"); await page.locator("textarea").first().click(); }],
  ]) {
    const { ctx, page } = await dash("standard", 390);
    await setup(page);
    await page.setViewportSize({ width: 390, height: 400 });
    await page.evaluate(() => document.activeElement?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(500);
    await shot(page, `keyboard-390-${name}`);
    metrics[`keyboard-${name}`] = await page.evaluate(() => {
      const a = document.activeElement;
      const r = a?.getBoundingClientRect();
      const btns = [...document.querySelectorAll("main button")].filter((b) => /^(유료P 교환|출금 신청|저장|공지 등록)$/.test(b.textContent.trim())).map((b) => { const q = b.getBoundingClientRect(); return { t: b.textContent.trim(), top: Math.round(q.top), bottom: Math.round(q.bottom), inView: q.bottom > 0 && q.top < innerHeight }; });
      return { active: a?.tagName, activeInView: r ? r.bottom > 0 && r.top < innerHeight : null, vh: innerHeight, btns };
    });
    await ctx.close();
  }
}

if (want("matrix")) {
  for (const width of WIDTHS) {
    for (const [user, tabName] of [["standard", null], ["pro", null], ["newbie", null], ["pro", "소개/공지"], ["pro", "댓글·알림"]]) {
      const { ctx, page } = await dash(user, width, { wait: 1200 });
      if (tabName) { await click(tab(page, tabName), "tab"); await page.waitForTimeout(300); }
      const m = await measure(page);
      metrics[`matrix-${width}-${user}${tabName ? "-" + tabName : ""}`] = m;
      await ctx.close();
    }
  }
}

if (want("loggedout")) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/creator`, { waitUntil: "load" });
  metrics.loggedout = { url: new URL(page.url()).pathname + new URL(page.url()).search };
  await ctx.close();
}

fs.writeFileSync(`${out}/metrics${groups ? "-" + groups.join("_") : ""}.json`, JSON.stringify({ ...metrics, clickFallbacks, providerPosts: globalThis.__prov ?? [] }, null, 1));
console.log("done", label, Object.keys(metrics).length, "providerPosts", (globalThis.__prov ?? []).length);
await browser.close();
