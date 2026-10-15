import fs from "fs";
import { launch, openPage, measure, setAttendance, countAttendanceRows, pointState, tap } from "./e43k-lib.mjs";

const [base, label, outFile] = process.argv.slice(2);
const out = { label, base };
const browser = await launch();

async function consoleErrors(page, fn) {
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 140)));
  page.on("pageerror", (e) => errs.push(`pageerror: ${String(e.message).slice(0, 140)}`));
  await fn?.();
  return errs;
}

// P-A: layout metrics per width (full user, 3 done, payments whatever the server says)
setAttendance("full", 3, false);
out.layout = {};
for (const w of [360, 390, 768, 1440]) {
  const { ctx, page } = await openPage(browser, base, { user: "full", width: w });
  out.layout[w] = await measure(page);
  out.layout[w].text = await page.evaluate(() => ({
    hasBalanceSummary: /유료 포인트/.test(document.body.innerText) && /출석 포인트/.test(document.body.innerText) && /보유 포인트/.test(document.body.innerText),
    hasClosedNotice: /준비 중/.test(document.body.innerText),
    h1: document.querySelector("h1")?.textContent?.trim(),
  }));
  await ctx.close();
}

// P-B: hydration / console errors on first load (390)
{
  const errs = [];
  const ctxPage = await openPage(browser, base, { user: "full", width: 390, wait: 0 }).catch(() => null);
  if (ctxPage) {
    const { ctx, page } = ctxPage;
    page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 140)));
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1500);
    out.consoleErrorsOnLoad = errs;
    await ctx.close();
  }
}

// P-C: gift confirmation kind + message position + network failure stuck state
{
  const { ctx, page } = await openPage(browser, base, { user: "gifter", width: 390 });
  await page.getByPlaceholder("정확한 닉네임 입력").fill("받는사람");
  await page.getByPlaceholder("최소 10P").fill("100");
  const before = pointState("gifter");
  await tap(page.getByRole("button", { name: "포인트 선물하기" }));
  await page.waitForTimeout(1800);
  out.gift = {
    dialogs: page.__dialogs,
    posts: page.__posts.filter((p) => p.p === "/api/points/gift").length,
    stateBefore: before,
    stateAfter: pointState("gifter"),
  };
  // where does the success message land relative to the viewport after submit
  out.gift.messagePosition = await page.evaluate(() => {
    const els = [...document.querySelectorAll("p")].filter((p) => /선물했습니다|선물했어요/.test(p.textContent || ""));
    const el = els[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, scrollY: Math.round(scrollY), inViewport: r.bottom > 0 && r.top < innerHeight };
  });
  await ctx.close();

  const net = await openPage(browser, base, { user: "gifter", width: 390, gift: "network" });
  await net.page.getByPlaceholder("정확한 닉네임 입력").fill("받는사람");
  await net.page.getByPlaceholder("최소 10P").fill("50");
  await tap(net.page.getByRole("button", { name: "포인트 선물하기" }));
  await net.page.waitForTimeout(1500);
  out.giftNetwork = await net.page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /선물하기|처리 중/.test(b.textContent || ""));
    return { buttonText: btn?.textContent?.trim(), disabled: btn?.disabled };
  });
  await net.ctx.close();
}

// P-D: history pagination failure is silent / row sizes
{
  const { ctx, page } = await openPage(browser, base, { user: "full", width: 390, logs: "real" });
  await tap(page.getByRole("tab", { name: "유료 충전" }));
  await page.waitForTimeout(300);
  out.history = await page.evaluate(() => {
    const px = (v) => Math.round(v * 10) / 10;
    const btns = [...document.querySelectorAll("button")].filter((b) => /결제취소|결제 취소|환불상태 확인|취소 마무리|취소마무리|환불상태/.test(b.textContent || ""));
    const tab = document.querySelector('[role="tab"]');
    const pag = [...document.querySelectorAll("button")].filter((b) => /^(이전|다음)$/.test((b.textContent || "").trim()));
    return {
      cancelButtons: btns.map((b) => ({ text: b.textContent.trim(), w: px(b.getBoundingClientRect().width), h: px(b.getBoundingClientRect().height), fs: getComputedStyle(b).fontSize })),
      tabHeight: px(tab.getBoundingClientRect().height),
      pagination: pag.map((b) => ({ text: b.textContent.trim(), h: px(b.getBoundingClientRect().height), w: px(b.getBoundingClientRect().width) })),
      firstRowDate: document.querySelector('[role="tabpanel"]')?.innerText.split("\n").find((l) => /\d{2}\. \d+\. \d+/.test(l)) ?? null,
    };
  });
  await ctx.close();

  const f = await openPage(browser, base, { user: "full", width: 390, logs: "fail" });
  await tap(f.page.getByRole("tab", { name: "유료 충전" }));
  const next = f.page.getByRole("button", { name: "다음" });
  await tap(next);
  await f.page.waitForTimeout(800);
  out.historyFail = await f.page.evaluate(() => ({
    panelText: document.querySelector('[role="tabpanel"]')?.innerText.slice(0, 120),
    anyErrorText: /불러오지 못/.test(document.body.innerText),
  }));
  await f.ctx.close();
}

// P-E: attendance double click + failure message + position
{
  setAttendance("full", 3, false);
  const { ctx, page } = await openPage(browser, base, { user: "full", width: 390, attendance: "slow" });
  const btn = page.locator("button", { hasText: /출석 체크|처리 중|출석 완료/ }).first();
  const rowsBefore = countAttendanceRows("full");
  await tap(btn);
  await tap(btn);
  await page.waitForTimeout(3000);
  out.attendance = {
    rowsBefore,
    rowsAfter: countAttendanceRows("full"),
    posts: page.__posts.filter((p) => p.p === "/api/attendance").length,
    buttonText: (await page.getByRole("button", { name: /출석/ }).first().textContent())?.trim(),
  };
  await ctx.close();
  setAttendance("full", 3, false);
  const fail = await openPage(browser, base, { user: "full", width: 390, attendance: "fail" });
  await tap(fail.page.getByRole("button", { name: /^출석 체크/ }));
  await fail.page.waitForTimeout(600);
  out.attendanceFail = await fail.page.evaluate(() => {
    const el = [...document.querySelectorAll("p")].find((p) => /출석 처리에 실패/.test(p.textContent || ""));
    return el ? { color: getComputedStyle(el).color, fs: getComputedStyle(el).fontSize, role: el.getAttribute("role") } : null;
  });
  await fail.ctx.close();
  setAttendance("full", 3, false);
}

// P-F: long-text rows at 360 (horizontal overflow)
{
  const { ctx, page } = await openPage(browser, base, { user: "full", width: 360 });
  out.longRows360 = await measure(page);
  await ctx.close();
}

out.external = null;
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
await browser.close();
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
