import fs from "fs";
import { launch, openPage, measure, snap, setAttendance, countAttendanceRows, pointState, tap, HEIGHTS } from "./e43k-lib.mjs";

const [baseOff, baseOn, phase, outDir] = process.argv.slice(2);
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const results = {};
const browser = await launch();

const GIFT_NICK = 'input[placeholder="정확한 닉네임 입력"]';
const GIFT_AMT = 'input[placeholder="최소 10P"]';

async function docY(locator) {
  return locator.evaluate((el) => el.getBoundingClientRect().top + scrollY);
}

async function cropBetween(page, file, startHeading, endHeading) {
  const start = page.getByRole("heading", { name: startHeading }).first();
  const y0 = await docY(start);
  let y1;
  if (endHeading) y1 = await docY(page.getByRole("heading", { name: endHeading }).first());
  else {
    y1 = await page.evaluate(() => {
      const panel = document.querySelector('[role="tabpanel"]');
      const pag = [...document.querySelectorAll("button")].filter((b) => /^(이전|다음)$/.test((b.textContent || "").trim())).pop();
      const bottom = Math.max(panel ? panel.getBoundingClientRect().bottom : 0, pag ? pag.getBoundingClientRect().bottom : 0);
      return bottom + scrollY + 12;
    });
  }
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  fs.mkdirSync(file.replace(/\/[^/]+$/, ""), { recursive: true });
  await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: Math.max(0, y0 - 12), width: vw, height: Math.min(8000, y1 - y0 + 12) } });
}

async function attendanceCard(page) {
  return page.locator("h1").first().locator('xpath=ancestor::*[self::section or contains(@class,"rounded-2xl")][1]');
}

async function attBtn(page) {
  return page.locator("button", { hasText: /출석 체크|처리 중|출석 완료/ }).first();
}

async function scene(name, fn) {
  if (only && !only.test(name)) return;
  try {
    const t0 = Date.now();
    results[name] = (await fn()) ?? {};
    console.log("ok", name, Date.now() - t0, "ms");
  } catch (e) {
    results[name] = { error: String(e.message).slice(0, 300) };
    console.log("FAIL", name, String(e.message).slice(0, 160));
  }
}

const out = (w, n) => `${outDir}/${phase}/${w}/${n}.png`;
const WIDTHS_ALL = [360, 390, 768, 1440];

// 1. full pages
for (const w of WIDTHS_ALL) {
  await scene(`full-page-off-${w}`, async () => {
    setAttendance("full", 3, false);
    const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: w });
    await snap(page, out(w, "01-full-page-off"), { full: true });
    const m = await measure(page);
    await ctx.close();
    return m;
  });
}

// 2. attendance states
const ATT = [
  ["att-0-pending", 0, false],
  ["att-3-pending", 3, false],
  ["att-4-done", 4, true],
  ["att-6-pending", 6, false],
  ["att-7-done", 7, true],
];
for (const w of [360, 390, 768, 1440]) {
  for (const [name, n, today] of ATT) {
    if (w >= 768 && !["att-3-pending", "att-4-done"].includes(name)) continue;
    await scene(`${name}-${w}`, async () => {
      setAttendance("full", n, today);
      const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: w });
      const card = await attendanceCard(page);
      await snap(page, out(w, `02-${name}`), { locator: card });
      const m = await measure(page);
      const cells = await page.evaluate(() => {
        const g = document.querySelector('[aria-label="이번 주 출석 보상"], [aria-label="주간 출석 차트"]');
        return g ? [...g.children].map((c) => ({ w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height), fs: getComputedStyle(c.querySelector("div,span")).fontSize })) : null;
      });
      await ctx.close();
      return { ...m, cells };
    });
  }
}

// 3. attendance interactions (real POST against isolated DB; reset afterwards)
for (const w of [360, 390]) {
  await scene(`att-claim-success-${w}`, async () => {
    setAttendance("full", 3, false);
    const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: w });
    const before = pointState("full");
    await tap(await attBtn(page));
    await page.waitForTimeout(1500);
    const card = await attendanceCard(page);
    await snap(page, out(w, "03-att-claim-success"), { locator: card });
    await snap(page, out(w, "03-att-claim-success-viewport"));
    const info = await page.evaluate(() => {
      const el = [...document.querySelectorAll("p")].find((p) => /출석 완료|지급/.test(p.textContent || ""));
      const r = el?.getBoundingClientRect();
      return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, inViewport: r.top >= 0 && r.bottom <= innerHeight } : null;
    });
    const res = { message: info, before, after: pointState("full"), posts: page.__posts.length, rows: countAttendanceRows("full") };
    await ctx.close();
    setAttendance("full", 3, false);
    return res;
  });
  await scene(`att-claim-loading-${w}`, async () => {
    setAttendance("full", 3, false);
    const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: w, attendance: "slow" });
    const b = await attBtn(page);
    await tap(b);
    await page.waitForTimeout(500);
    const card = await attendanceCard(page);
    await snap(page, out(w, "03-att-claim-loading"), { locator: card });
    await ctx.close();
    setAttendance("full", 3, false);
  });
  await scene(`att-claim-fail-${w}`, async () => {
    setAttendance("full", 3, false);
    const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: w, attendance: "fail" });
    await tap(await attBtn(page));
    await page.waitForTimeout(700);
    const card = await attendanceCard(page);
    await snap(page, out(w, "03-att-claim-fail"), { locator: card });
    const role = await page.evaluate(() => {
      const el = [...document.querySelectorAll("p")].find((p) => /출석 처리에 실패/.test(p.textContent || ""));
      return el ? { role: el.getAttribute("role"), color: getComputedStyle(el).color } : null;
    });
    await ctx.close();
    setAttendance("full", 3, false);
    return role;
  });
}
await scene("att-claim-network-390", async () => {
  setAttendance("full", 3, false);
  const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: 390, attendance: "network" });
  await tap(await attBtn(page));
  await page.waitForTimeout(700);
  const card = await attendanceCard(page);
  await snap(page, out(390, "03-att-claim-network"), { locator: card });
  const btnText = (await (await attBtn(page)).textContent())?.trim();
  await ctx.close();
  setAttendance("full", 3, false);
  return { btnText };
});
await scene("att-duplicate-server-390", async () => {
  setAttendance("full", 3, false);
  const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: 390 });
  const before = { rows: countAttendanceRows("full").rows, state: pointState("full") };
  const resp = await page.evaluate(async () => {
    const rs = await Promise.all([1, 2, 3].map(() => fetch("/api/attendance", { method: "POST" }).then((r) => r.json())));
    return rs.map((r) => ({ alreadyClaimed: r.alreadyClaimed, reward: r.reward, streak: r.streak }));
  });
  const after = { rows: countAttendanceRows("full").rows, state: pointState("full") };
  await ctx.close();
  setAttendance("full", 3, false);
  return { before, after, resp };
});

// 4. products: payments off/on, normal vs reviewer
for (const w of WIDTHS_ALL) {
  await scene(`products-off-${w}`, async () => {
    const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: w });
    await cropBetween(page, out(w, "04-products-off"), "포인트 상품", "포인트 선물");
    const r = await page.evaluate(() => ({ closedNotice: /준비 중/.test(document.body.innerText), clickableRows: document.querySelectorAll('main button[class*="p-4"], [data-testid^="charge-row-"] button').length }));
    await ctx.close();
    return r;
  });
  await scene(`products-on-${w}`, async () => {
    const { ctx, page } = await openPage(browser, baseOn, { user: "full", width: w });
    await cropBetween(page, out(w, "04-products-on"), "포인트 상품", "포인트 선물");
    const r = await page.evaluate(() => ({ closedNotice: /준비 중/.test(document.body.innerText), buttons: [...document.querySelectorAll("button")].filter((b) => /₩[\d,]+/.test(b.textContent || "")).length }));
    await ctx.close();
    return r;
  });
}
for (const [label, base] of [["off", baseOff], ["on", baseOn]]) {
  await scene(`products-reviewer-${label}-390`, async () => {
    const { ctx, page } = await openPage(browser, base, { user: "reviewer", width: 390 });
    await cropBetween(page, out(390, `04-products-reviewer-${label}`), "포인트 상품", "포인트 선물");
    const r = await page.evaluate(() => ({ closedNotice: /준비 중/.test(document.body.innerText), buttons: [...document.querySelectorAll("button")].filter((b) => /₩[\d,]+/.test(b.textContent || "")).length }));
    await ctx.close();
    return r;
  });
}
await scene("products-on-click-390", async () => {
  const { ctx, page } = await openPage(browser, baseOn, { user: "full", width: 390 });
  const row = page.locator("button", { hasText: "₩10,000" }).first();
  await tap(row);
  await page.waitForTimeout(1500);
  await snap(page, out(390, "04-products-on-click-viewport"));
  const info = await page.evaluate(() => {
    const el = [...document.querySelectorAll("p")].find((p) => /결제|실패|차단|fixture/.test(p.textContent || "") && /(\.|요|다)$/.test((p.textContent || "").trim()) && p.closest("section, main"));
    const r = el?.getBoundingClientRect();
    return { text: el?.textContent?.slice(0, 80), inViewport: r ? r.top >= 0 && r.bottom <= innerHeight : null };
  });
  const res = { ...info, posts: page.__posts.map((p) => p.p), external: page.__external };
  await ctx.close();
  return res;
});

// 5. gift
async function giftFill(page, nick, amt) {
  if (nick != null) await page.locator(GIFT_NICK).fill(nick);
  if (amt != null) await page.locator(GIFT_AMT).fill(String(amt));
}
for (const w of [390, 768, 1440]) {
  await scene(`gift-empty-${w}`, async () => {
    const { ctx, page } = await openPage(browser, baseOff, { user: "gifter", width: w });
    await cropBetween(page, out(w, "05-gift-empty"), "포인트 선물", "포인트 내역");
    const m = await measure(page);
    await ctx.close();
    return m;
  });
  await scene(`gift-filled-${w}`, async () => {
    const { ctx, page } = await openPage(browser, baseOff, { user: "gifter", width: w });
    await giftFill(page, "받는사람", "1000");
    await page.waitForTimeout(200);
    await cropBetween(page, out(w, "05-gift-filled"), "포인트 선물", "포인트 내역");
    await ctx.close();
  });
}
await scene("gift-confirm-390", async () => {
  const { ctx, page } = await openPage(browser, baseOff, { user: "gifter", width: 390, dialog: "dismiss" });
  await giftFill(page, "받는사람", "1000");
  const before = pointState("gifter");
  await tap(page.getByRole("button", { name: "포인트 선물하기" }));
  await page.waitForTimeout(600);
  await snap(page, out(390, "05-gift-confirm-viewport"));
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('[role="alertdialog"]');
    if (!d) return null;
    const btns = [...d.querySelectorAll("button")].map((b) => ({ t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) }));
    return { text: d.innerText.slice(0, 300), btns };
  });
  const res = { dialog: dlg, nativeDialogs: page.__dialogs, posts: page.__posts.length, state: { before, after: pointState("gifter") } };
  await ctx.close();
  return res;
});
await scene("gift-confirm-cancel-keeps-input-390", async () => {
  const { ctx, page } = await openPage(browser, baseOff, { user: "gifter", width: 390, dialog: "dismiss" });
  await giftFill(page, "받는사람", "1000");
  await tap(page.getByRole("button", { name: "포인트 선물하기" }));
  await page.waitForTimeout(400);
  const dlg = page.locator('[role="alertdialog"]');
  if (await dlg.count()) await tap(dlg.getByRole("button", { name: "취소" }));
  await page.waitForTimeout(300);
  const vals = { nick: await page.locator(GIFT_NICK).inputValue(), amt: await page.locator(GIFT_AMT).inputValue(), posts: page.__posts.length };
  await ctx.close();
  return vals;
});
for (const [name, nick, amt, user, extra] of [
  ["gift-error-notfound", "없는닉네임", 100, "gifter", {}],
  ["gift-error-over-limit", "받는사람", 99999, "gifter", {}],
  ["gift-error-min", "받는사람", 5, "gifter", {}],
  ["gift-error-no-nick", "", 100, "gifter", {}],
  ["gift-error-attendance-only", "받는사람", 500, "attonly", {}],
  ["gift-error-reviewer", "받는사람", 100, "reviewer", {}],
  ["gift-error-server-fail", "받는사람", 100, "gifter", { gift: "fail" }],
  ["gift-error-network", "받는사람", 100, "gifter", { gift: "network" }],
]) {
  await scene(`${name}-390`, async () => {
    const { ctx, page } = await openPage(browser, baseOff, { user, width: 390, ...extra });
    await giftFill(page, nick, amt);
    const before = pointState(user);
    await tap(page.getByRole("button", { name: "포인트 선물하기" }));
    await page.waitForTimeout(500);
    const dlg = page.locator('[role="alertdialog"]');
    if (await dlg.count()) {
      await tap(dlg.getByRole("button", { name: "선물하기", exact: true }));
      await page.waitForTimeout(1200);
    }
    await cropBetween(page, out(390, `05-${name}`), "포인트 선물", "포인트 내역");
    const res = await page.evaluate((sel) => {
      const btn = [...document.querySelectorAll("button")].find((b) => /선물하기|처리 중/.test(b.textContent || ""));
      return { btnText: btn?.textContent?.trim(), btnDisabled: btn?.disabled, nick: document.querySelector(sel[0])?.value, amt: document.querySelector(sel[1])?.value };
    }, [GIFT_NICK, GIFT_AMT]);
    const out2 = { ...res, before, after: pointState(user), nativeDialogs: page.__dialogs.length };
    await ctx.close();
    return out2;
  });
}
await scene("gift-success-390", async () => {
  const { ctx, page } = await openPage(browser, baseOff, { user: "gifter", width: 390 });
  await giftFill(page, "받는사람", "100");
  const before = pointState("gifter");
  await tap(page.getByRole("button", { name: "포인트 선물하기" }));
  await page.waitForTimeout(500);
  const dlg = page.locator('[role="alertdialog"]');
  if (await dlg.count()) {
    await tap(dlg.getByRole("button", { name: "선물하기", exact: true }));
  }
  await page.waitForTimeout(1500);
  await snap(page, out(390, "05-gift-success-viewport"));
  const info = await page.evaluate(() => {
    const el = [...document.querySelectorAll("p")].find((p) => /선물했/.test(p.textContent || ""));
    const r = el?.getBoundingClientRect();
    return r ? { top: Math.round(r.top), vh: innerHeight, scrollY: Math.round(scrollY), inViewport: r.top >= 0 && r.bottom <= innerHeight } : null;
  });
  const res = { message: info, before, after: pointState("gifter"), posts: page.__posts.filter((p) => p.p === "/api/points/gift").length };
  await ctx.close();
  return res;
});
await scene("gift-double-submit-390", async () => {
  const { ctx, page } = await openPage(browser, baseOff, { user: "gifter", width: 390, gift: "slow" });
  await giftFill(page, "받는사람", "100");
  const before = pointState("gifter");
  await tap(page.getByRole("button", { name: "포인트 선물하기" }));
  await page.waitForTimeout(300);
  const dlg = page.locator('[role="alertdialog"]');
  const hasDialog = (await dlg.count()) > 0;
  if (hasDialog) {
    const confirm = dlg.getByRole("button", { name: /^선물하기$|처리 중/ });
    await confirm.dispatchEvent("click");
    await confirm.dispatchEvent("click").catch(() => {});
    await page.waitForTimeout(300);
    await snap(page, out(390, "05-gift-double-submit-viewport"));
  } else {
    await page.getByRole("button", { name: /선물하기|처리 중/ }).first().dispatchEvent("click").catch(() => {});
  }
  await page.waitForTimeout(3000);
  const res = { hasDialog, posts: page.__posts.filter((p) => p.p === "/api/points/gift").length, before, after: pointState("gifter") };
  await ctx.close();
  return res;
});

// 6. history
for (const w of [360, 390, 768, 1440]) {
  await scene(`history-usage-${w}`, async () => {
    const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: w });
    await cropBetween(page, out(w, "06-history-usage"), "포인트 내역");
    const m = await measure(page);
    await ctx.close();
    return m;
  });
}
for (const w of [390, 1440]) {
  await scene(`history-paid-${w}`, async () => {
    const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: w });
    await tap(page.getByRole("tab", { name: "유료 충전" }));
    await page.waitForTimeout(400);
    await cropBetween(page, out(w, "06-history-paid"), "포인트 내역");
    const m = await measure(page);
    await ctx.close();
    return m;
  });
  await scene(`history-free-${w}`, async () => {
    const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: w });
    await tap(page.getByRole("tab", { name: "무료 적립·출석" }));
    await page.waitForTimeout(400);
    await cropBetween(page, out(w, "06-history-free"), "포인트 내역");
    await ctx.close();
  });
}
await scene("history-paid-page2-390", async () => {
  const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: 390 });
  await tap(page.getByRole("tab", { name: "유료 충전" }));
  await tap(page.getByRole("button", { name: "다음", exact: true }));
  await page.waitForTimeout(900);
  await cropBetween(page, out(390, "06-history-paid-page2"), "포인트 내역");
  const txt = await page.evaluate(() => document.querySelector('[role="tabpanel"]')?.innerText.slice(0, 80));
  await ctx.close();
  return { txt };
});
for (const [tabName, key] of [["사용 내역", "usage"], ["유료 충전", "paid"], ["무료 적립·출석", "free"]]) {
  await scene(`history-empty-${key}-390`, async () => {
    const { ctx, page } = await openPage(browser, baseOff, { user: "empty", width: 390 });
    await tap(page.getByRole("tab", { name: tabName }));
    await page.waitForTimeout(300);
    await cropBetween(page, out(390, `06-history-empty-${key}`), "포인트 내역");
    const t = await page.evaluate(() => document.querySelector('[role="tabpanel"]')?.innerText.trim());
    await ctx.close();
    return { panel: t };
  });
}
await scene("history-loading-390", async () => {
  const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: 390, logs: "slow" });
  await tap(page.getByRole("tab", { name: "유료 충전" }));
  await tap(page.getByRole("button", { name: "다음", exact: true }));
  await page.waitForTimeout(500);
  await cropBetween(page, out(390, "06-history-loading"), "포인트 내역");
  const panel = await page.evaluate(() => document.querySelector('[role="tabpanel"]')?.innerText.trim().slice(0, 40));
  await ctx.close();
  return { panel };
});
await scene("history-failed-390", async () => {
  const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: 390, logs: "fail" });
  await tap(page.getByRole("tab", { name: "유료 충전" }));
  await tap(page.getByRole("button", { name: "다음", exact: true }));
  await page.waitForTimeout(900);
  await cropBetween(page, out(390, "06-history-failed"), "포인트 내역");
  const panel = await page.evaluate(() => document.querySelector('[role="tabpanel"]')?.innerText.trim().slice(0, 100));
  await ctx.close();
  return { panel };
});
for (const mode of ["ok", "fail", "pending"]) {
  await scene(`history-cancel-${mode}-390`, async () => {
    const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: 390, cancel: mode });
    await tap(page.getByRole("tab", { name: "유료 충전" }));
    await page.waitForTimeout(300);
    const btn = page.locator("button", { hasText: /^결제\s?취소$/ }).first();
    await tap(btn);
    await page.waitForTimeout(500);
    if (mode === "ok") await snap(page, out(390, "06-history-cancel-confirm-viewport"));
    const dlg = page.locator('[role="alertdialog"]');
    if (await dlg.count()) {
      await tap(dlg.getByRole("button", { name: /결제\s?취소/ }));
      await page.waitForTimeout(1500);
    }
    await snap(page, out(390, `06-history-cancel-${mode}-viewport`));
    const note = await page.evaluate(() => {
      const el = [...document.querySelectorAll("p")].find((p) => /취소|환불|진행/.test(p.textContent || "") && p.closest('[data-testid="point-history"], main'));
      const r = el?.getBoundingClientRect();
      return { text: el?.textContent?.slice(0, 80), inViewport: r ? r.top >= 0 && r.bottom <= innerHeight : null };
    });
    const res = { note, posts: page.__posts.map((p) => p.p) };
    await ctx.close();
    return res;
  });
}

// 7. balances
for (const u of ["empty", "new", "low", "big"]) {
  await scene(`balance-${u}-390`, async () => {
    const { ctx, page } = await openPage(browser, baseOff, { user: u, width: 390 });
    await snap(page, out(390, `07-balance-${u}`), { full: true });
    const m = await measure(page);
    await ctx.close();
    return m;
  });
}
await scene("balance-big-360", async () => {
  const { ctx, page } = await openPage(browser, baseOff, { user: "big", width: 360 });
  await snap(page, out(360, "07-balance-big"), { full: true });
  const m = await measure(page);
  await ctx.close();
  return m;
});

// 8. resize + keyboard
await scene("resize-keeps-input", async () => {
  const { ctx, page } = await openPage(browser, baseOff, { user: "gifter", width: 390 });
  await giftFill(page, "받는사람닉네임", "1234");
  const seq = [];
  for (const [w, h] of [[768, 1024], [360, 800], [1440, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    seq.push({ w, nick: await page.locator(GIFT_NICK).inputValue(), amt: await page.locator(GIFT_AMT).inputValue() });
  }
  await cropBetween(page, out(390, "08-resize-keeps-input"), "포인트 선물", "포인트 내역");
  await ctx.close();
  return { seq };
});
await scene("keyboard-open-390", async () => {
  const { ctx, page } = await openPage(browser, baseOff, { user: "gifter", width: 390 });
  await page.locator(GIFT_AMT).scrollIntoViewIfNeeded();
  await page.setViewportSize({ width: 390, height: 440 });
  await page.locator(GIFT_AMT).focus();
  await page.keyboard.type("1000");
  await page.waitForTimeout(400);
  await snap(page, out(390, "08-keyboard-open-viewport"));
  const info = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    const btn = [...document.querySelectorAll("button")].find((b) => /^포인트 선물하기$/.test((b.textContent || "").trim()));
    const br = btn?.getBoundingClientRect();
    return { inputVisible: r.top >= 0 && r.bottom <= innerHeight, vh: innerHeight, btnTop: br ? Math.round(br.top) : null, inputMode: el.getAttribute("inputmode"), type: el.getAttribute("type") };
  }, GIFT_AMT);
  await ctx.close();
  return info;
});
await scene("keyboard-order-390", async () => {
  const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: 390 });
  const order = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const d = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const r = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      return { tag: a.tagName, label: (a.getAttribute("aria-label") || a.textContent || a.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 28), role: a.getAttribute("role"), h: Math.round(r.height), outline: cs.outlineStyle !== "none" ? cs.outlineWidth : cs.boxShadow !== "none" ? "shadow" : "none" };
    });
    order.push(d);
  }
  await ctx.close();
  return { order: order.filter(Boolean) };
});
await scene("tabs-arrow-keys-390", async () => {
  const { ctx, page } = await openPage(browser, baseOff, { user: "full", width: 390 });
  const tab = page.getByRole("tab", { name: "사용 내역" });
  await tab.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const afterRight = await page.evaluate(() => ({ focus: document.activeElement?.textContent?.trim(), selected: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() }));
  await ctx.close();
  return afterRight;
});

const tag = process.env.TAG ? `-${process.env.TAG}` : "";
fs.mkdirSync(`${outDir}/${phase}`, { recursive: true });
fs.writeFileSync(`${outDir}/${phase}/results${tag}.json`, JSON.stringify(results, null, 1));
await browser.close();
const fails = Object.entries(results).filter(([, v]) => v?.error);
console.log(`done ${phase}: ${Object.keys(results).length} scenes, ${fails.length} failed`);
for (const [k, v] of fails) console.log(" -", k, v.error);
