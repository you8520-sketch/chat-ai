// usage: node scripts/e43hd-direct.mjs <label> <baseUrl>
import fs from "fs";
import { launch, openPage, fx } from "./e43hd-lib.mjs";

const [label, base] = process.argv.slice(2);
const out = `/tmp/e43h-out/${label}`;
fs.mkdirSync(out, { recursive: true });
const browser = await launch();
const res = {};
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString("ko-KR") : n.toLocaleString("ko-KR", { maximumFractionDigits: 1 }));
const norm = (s) => s.replace(/\s+/g, "");
const tab = (page, name) => page.locator("button,[role=tab]", { hasText: new RegExp(`^${name}$`) }).first();

async function api(page) {
  return page.evaluate(async () => (await (await fetch("/api/creator")).json()).dashboard ?? null);
}

// 1) values on screen == values from the owner payload, per user
res.values = {};
for (const user of ["newbie", "below", "sprout", "standard", "pro", "blocked", "pending"]) {
  const { ctx, page } = await openPage(browser, base, { path: "/creator", user, width: 1440, wait: 1200 });
  let d = await api(page);
  const text = norm(await page.locator("main").innerText());
  if (!d) {
    res.values[user] = { apiForbidden: true, zeroCpShown: text.includes("0CP"), belowThresholdShown: text.includes("등급조건미달") && text.includes("0%") };
    await ctx.close();
    continue;
  }
  const rate = Math.round(d.tier.rewardRate * 100);
  res.values[user] = {
    cp: text.includes(`${fmt(d.creatorPoints)}CP`),
    totalReward: text.includes(`${fmt(d.totalReward)}CP`),
    spent: text.includes(`${fmt(d.totalSpentOnChars)}P`),
    rate: d.tier.rewardRate > 0 ? text.includes(`${rate}%`) : text.includes("등급조건미달") && text.includes("0%"),
    apiCp: d.creatorPoints,
    apiRate: d.tier.rewardRate,
    pendingShown: d.hasPendingWithdrawal ? /PENDING|처리중|지급대기/.test(text) : null,
    blockedShown: !d.withdrawal.canWithdraw ? text.includes(norm(d.withdrawal.blockReason ?? "")) : null,
  };
  await ctx.close();
}

// 2) per-period share totals shown == sum of owner payload
res.shareTotals = {};
{
  const { ctx, page } = await openPage(browser, base, { path: "/creator", user: "pro", width: 1440, wait: 1200 });
  const d = await api(page);
  for (const [pid, plabel] of [["day", "하루"], ["week", "일주일"], ["month", "한달"]]) {
    const sec = page.locator("section", { has: page.getByRole("heading", { name: /캐릭터별 적립비중/ }) }).first();
    await sec.locator("button", { hasText: new RegExp(`^${plabel}$`) }).first().click();
    await page.waitForTimeout(200);
    const total = d.characterEarningShares[pid].reduce((s, r) => s + Number(r.period_reward ?? 0), 0);
    const text = norm(await sec.innerText());
    const top = d.characterEarningShares[pid][0];
    const pct = total > 0 ? Math.round(top.share_ratio * 1000) / 10 : 0;
    res.shareTotals[pid] = {
      total,
      totalShown: text.includes(`${fmt(total)}CP`),
      topPercentShown: text.includes(`${pct}%`),
      pressed: await sec.locator("button[aria-pressed=true]").first().textContent().catch(() => null),
    };
  }
  await ctx.close();
}

// 3) no other user's private numbers on a member's page / payload
res.privacy = {};
{
  const { ctx, page } = await openPage(browser, base, { path: "/creator", user: "standard", width: 390, wait: 1200 });
  const html = await page.content();
  const d = await api(page);
  res.privacy = {
    otherCpInHtml: html.includes("777,777") || html.includes("777777"),
    otherEmailInHtml: html.includes("other@e43h.local"),
    apiHasOtherCp: JSON.stringify(d).includes("777777"),
    residentInPayload: /resident|\b\d{6}-\d{7}\b/i.test(JSON.stringify(d)),
    ownAccountNumberInOwnPayload: d.recentWithdrawals.some((w) => /accountNumber/.test(String(w.account_info ?? ""))),
    accountShownMaskedOnScreen: !/000000000000/.test(await page.locator("main").innerText()),
  };
  await ctx.close();
}

// 4) keyboard + semantics
res.a11y = {};
{
  const { ctx, page } = await openPage(browser, base, { path: "/creator", user: "standard", width: 1440, wait: 1200 });
  res.a11y.roles = await page.evaluate(() => ({
    tablist: document.querySelectorAll("[role=tablist]").length,
    tabs: document.querySelectorAll("[role=tab]").length,
    selected: [...document.querySelectorAll("[role=tab][aria-selected=true]")].map((e) => e.textContent.trim()),
    tabpanel: document.querySelectorAll("[role=tabpanel]").length,
    pressedButtons: document.querySelectorAll("button[aria-pressed]").length,
    labelledInputs: [...document.querySelectorAll("main input:not([type=hidden]), main textarea")].filter((e) => e.labels?.length).length,
    totalInputs: document.querySelectorAll("main input:not([type=hidden]), main textarea").length,
    liveRegions: document.querySelectorAll("[aria-live],[role=status],[role=alert]").length,
  }));
  const first = tab(page, "대시보드");
  if (res.a11y.roles.tabs > 0) {
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    res.a11y.arrowRight = await page.evaluate(() => ({ focus: document.activeElement?.textContent?.trim(), selected: document.querySelector("[role=tab][aria-selected=true]")?.textContent?.trim() }));
    await page.keyboard.press("End");
    await page.waitForTimeout(200);
    res.a11y.end = await page.evaluate(() => ({ focus: document.activeElement?.textContent?.trim(), selected: document.querySelector("[role=tab][aria-selected=true]")?.textContent?.trim() }));
  }
  await ctx.close();
}

// 5) failure states announce themselves
res.alerts = {};
for (const mode of ["insufficient", "network"]) {
  const { ctx, page } = await openPage(browser, base, { path: "/creator", user: "standard", width: 390, wait: 1200 });
  page.__mode = mode;
  const sec = page.locator("section", { has: page.getByRole("heading", { name: /CP → 유료 포인트 교환/ }) }).first();
  await sec.locator("input").first().fill("1000");
  await sec.locator("button", { hasText: /^유료P 교환$/ }).click();
  await page.waitForTimeout(900);
  res.alerts[`exchange-${mode}`] = {
    alertText: await page.locator("[role=alert]").allInnerTexts(),
    buttonTexts: await sec.locator("button").allTextContents(),
    inputKept: await sec.locator("input").first().inputValue(),
  };
  await ctx.close();
}
{
  const { ctx, page } = await openPage(browser, base, { path: "/creator", user: "standard", width: 390, wait: 1200 });
  page.__mode = "insufficient";
  const sec = page.locator("section", { has: page.getByRole("heading", { name: /CP → 현금 출금 신청/ }) }).first();
  const inputs = sec.locator("input:not([type=checkbox])");
  await inputs.nth(0).fill("40000");
  await inputs.nth(1).fill("가상은행");
  await inputs.nth(2).fill("000000000000");
  await inputs.nth(3).fill("9001011234567");
  await sec.locator("input[type=checkbox]").check();
  await sec.locator("button", { hasText: /^출금 신청$/ }).click();
  await page.waitForTimeout(900);
  res.alerts["withdraw-server-error"] = {
    alertText: await page.locator("[role=alert]").allInnerTexts(),
    keptCp: await inputs.nth(0).inputValue(),
    keptAccount: await inputs.nth(2).inputValue(),
    posts: page.__calls.filter((c) => c.p === "/api/creator/withdraw").length,
  };
  await ctx.close();
}

// 6) navigation owners
res.nav = {};
{
  const { ctx, page } = await openPage(browser, base, { path: "/creator", user: "standard", width: 1440, wait: 1200 });
  res.nav.studioLinks = await page.locator("main a[href='/studio']").count();
  res.nav.profileLinks = await page.locator(`main a[href='/creator/${fx.users.standard}']`).count();
  if (res.nav.studioLinks > 0) {
    await page.locator("main a[href='/studio']").first().click();
    await page.waitForURL(/\/studio/, { timeout: 15000 }).catch(() => {});
    res.nav.studioUrl = new URL(page.url()).pathname;
  }
  await ctx.close();
}
{
  const { ctx, page } = await openPage(browser, base, { path: `/creator/${fx.users.standard}`, user: "other", width: 1440, wait: 800 });
  res.nav.publicProfileOtherViewer = { url: new URL(page.url()).pathname, bodyHasCp: (await page.locator("body").innerText()).includes("45,000CP") };
  await ctx.close();
}

// 7) next-action / jump anchors
res.anchors = {};
{
  const { ctx, page } = await openPage(browser, base, { path: "/creator", user: "standard", width: 390, wait: 1200 });
  const btn = page.locator("button", { hasText: /^(바로가기)$/ }).first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(700);
    res.anchors.nextAction = await page.evaluate(() => ({ scrollY: Math.round(scrollY), exchangeTop: Math.round(document.getElementById("creator-exchange")?.getBoundingClientRect().top ?? -1), withdrawTop: Math.round(document.getElementById("creator-withdraw")?.getBoundingClientRect().top ?? -1), vh: innerHeight }));
  }
  await ctx.close();
}

fs.writeFileSync(`${out}/direct.json`, JSON.stringify({ ...res, providerPosts: globalThis.__prov ?? [] }, null, 1));
console.log("direct done", label);
await browser.close();
