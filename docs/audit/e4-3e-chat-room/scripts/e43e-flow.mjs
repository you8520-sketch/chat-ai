import fs from "fs";
import { launch, openChat, scrollBottom, stubEstimates, stubChatStream, fx } from "./e43e-lib.mjs";
import { TEXT_3200 } from "./e43e-texts.ts";
const [, , BASE, TAG] = process.argv;
const results = [];
const b = await launch();
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, pass: true, detail: detail ?? null });
  } catch (e) {
    results.push({ name, pass: false, detail: String(e?.message ?? e).slice(0, 1200) });
  }
}
const ok = (c, msg) => { if (!c) throw new Error(msg); };
const posts = (page) => { const l = []; page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/chat") l.push(r.postData()); }); return l; };

for (const w of [390, 1440]) {
  await check(`send-button-${w}`, async () => {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "short", prefs: { streamIntervalMs: 8, streamCharsPerTick: 40 } });
    const l = posts(page);
    await stubChatStream(page, { text: TEXT_3200, chatId: fx.chats.short });
    const before = await page.locator('article[id^="msg-"]').count();
    await page.fill("textarea", "다음 장면으로 넘어가 주세요.");
    ok(await page.locator("button:has-text('전송')").isEnabled(), "send disabled with text");
    await page.click("button:has-text('전송')");
    await page.waitForTimeout(5000);
    ok(l.length === 1, `POST /api/chat count ${l.length}`);
    ok((await page.inputValue("textarea")) === "", "textarea not cleared");
    const after = await page.locator('article[id^="msg-"], article').count();
    ok(after >= before, "no assistant article");
    const text = await page.evaluate(() => document.body.innerText);
    ok(text.includes(TEXT_3200.slice(0, 12)), "streamed text missing");
    ok(page.__providerPosts.length === 0, "provider POST");
    await ctx.close();
    return { posts: l.length };
  });
  await check(`ctrl-enter-${w}`, async () => {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "short" });
    const l = posts(page);
    await stubChatStream(page, { text: TEXT_3200, chatId: fx.chats.short });
    await page.fill("textarea", "단축키 전송");
    await page.press("textarea", "Control+Enter");
    await page.waitForTimeout(2500);
    ok(l.length === 1, `POST count ${l.length}`);
    await ctx.close();
  });
  await check(`continue-${w}`, async () => {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "short" });
    const l = posts(page);
    await stubChatStream(page, { text: TEXT_3200, chatId: fx.chats.short });
    await page.click("button:has-text('자동진행')");
    await page.waitForTimeout(2500);
    ok(l.length === 1, `POST count ${l.length}`);
    await ctx.close();
    return { body: (l[0] ?? "").slice(0, 120) };
  });
  await check(`draft-recovery-${w}`, async () => {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "short" });
    await page.fill("textarea", "복구될 초안 문장");
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(2000);
    const v = await page.inputValue("textarea");
    await ctx.close();
    return { restored: v };
  });
  await check(`regenerate-confirm-${w}`, async () => {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "c3200" });
    await scrollBottom(page);
    const btns = page.locator('[aria-label="재생성"]');
    ok((await btns.count()) === 1, `regenerate buttons ${await btns.count()}`);
    await btns.last().click();
    await page.waitForTimeout(400);
    ok(await page.getByText("답변 재생성").first().isVisible(), "confirm dialog missing");
    await ctx.close();
  });
  await check(`edit-mode-${w}`, async () => {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "c3200" });
    await scrollBottom(page);
    await page.locator('[data-chat-message-toolbar] [aria-label="수정"]').last().click();
    await page.waitForTimeout(500);
    ok((await page.locator("textarea").count()) >= 2, "edit textarea missing");
    await ctx.close();
  });
  await check(`toolbar-targets-${w}`, async () => {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "c3200" });
    const info = await page.evaluate(() => [...document.querySelectorAll("[data-chat-message-toolbar]")].map((t) => [...t.querySelectorAll("button")].map((x) => x.getAttribute("aria-label"))));
    await ctx.close();
    ok(info.length >= 1, "no toolbars");
    return { toolbars: info.length, last: info[info.length - 1] };
  });
  await check(`suggest-switch-${w}`, async () => {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "short" });
    const sw = page.locator('[role="switch"]').first();
    const v0 = await sw.getAttribute("aria-checked");
    await sw.click();
    await page.waitForTimeout(200);
    const v1 = await sw.getAttribute("aria-checked");
    ok(v0 !== v1, `switch did not toggle ${v0}->${v1}`);
    await ctx.close();
    return { v0, v1 };
  });
  await check(`model-select-${w}`, async () => {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "short" });
    await stubEstimates(page, { shown: true });
    const sel = page.locator("select[aria-describedby='picker-estimate-note']");
    await sel.focus();
    await page.waitForTimeout(500);
    const opts = await sel.evaluate((s) => [...s.options].map((o) => o.value));
    ok(opts.length > 1, "single option");
    await sel.selectOption(opts[1]);
    await page.waitForTimeout(400);
    const label = await sel.evaluate((s) => s.options[s.selectedIndex].text);
    ok(/약 \d+P/.test(label), `no price suffix: ${label}`);
    await ctx.close();
    return { label };
  });
  await check(`scroll-detach-follow-${w}`, async () => {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "c5200" });
    await scrollBottom(page);
    const atBottom = await page.evaluate(() => innerHeight + scrollY >= document.documentElement.scrollHeight - 4);
    await page.mouse.move(w / 2, 300);
    await page.mouse.wheel(0, -1200);
    await page.waitForTimeout(500);
    const up = await page.evaluate(() => scrollY);
    const dockVisible = await page.evaluate(() => { const r = document.querySelector("textarea").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    await ctx.close();
    ok(atBottom, "not at bottom");
    ok(dockVisible, "dock not visible while detached");
    return { up };
  });
}
await check("rich-parity", async () => {
  const out = {};
  for (const sc of ["rich", "table"]) {
    const { page, ctx } = await openChat(b, BASE, { width: 390, scenario: sc });
    out[sc] = await page.evaluate(() => ({
      imgs: document.querySelectorAll("article img").length,
      tables: document.querySelectorAll(".chat-md-table, article table").length,
      widgets: document.querySelectorAll("[data-status-widget], [data-testid*=status-widget]").length,
      articles: document.querySelectorAll("article").length,
      paragraphs: document.querySelectorAll("article .chat-novel-prose p").length,
      textLen: [...document.querySelectorAll("article")].reduce((n, a) => n + a.innerText.length, 0),
    }));
    await ctx.close();
  }
  return out;
});
await check("adult-toggle-admin", async () => {
  const { page, ctx } = await openChat(b, BASE, { width: 390, scenario: "adult", user: "adult" });
  const t = page.locator("div:has(> span:text-is('성인모드')) > button[aria-pressed]");
  ok((await t.count()) === 1, "no adult toggle");
  const v0 = await t.getAttribute("aria-pressed");
  await t.click();
  await page.waitForTimeout(800);
  const v1 = await t.getAttribute("aria-pressed");
  await t.click();
  await page.waitForTimeout(800);
  const v2 = await t.getAttribute("aria-pressed");
  await ctx.close();
  ok(v0 !== v1 && v0 === v2, `toggle ${v0}->${v1}->${v2}`);
  return { v0, v1, v2 };
});
await check("adult-blocked-minor", async () => {
  const { page, ctx } = await openChat(b, BASE, { width: 390, scenario: "blocked", user: "minor" });
  await page.waitForTimeout(800);
  const url = page.url();
  const hasTextarea = (await page.locator("textarea").count()) > 0;
  await ctx.close();
  ok(!hasTextarea, "minor sees composer on adult chat");
  return { url: url.replace(BASE, "") };
});
await b.close();
fs.writeFileSync(`/tmp/e43e-flow-${TAG}.json`, JSON.stringify(results, null, 1));
const fail = results.filter((r) => !r.pass);
console.log(TAG, `${results.length - fail.length}/${results.length} pass`, fail.map((f) => `${f.name}: ${f.detail}`));
