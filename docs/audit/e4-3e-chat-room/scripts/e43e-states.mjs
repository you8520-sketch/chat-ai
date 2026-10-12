import fs from "fs";
import { launch, openChat, measure, scrollBottom, stubEstimates, stubChatStream, fx } from "./e43e-lib.mjs";
import { TEXT_5200 } from "./e43e-texts.ts";
const [, , BASE, TAG] = process.argv;
const ONLY = (process.env.ONLY || "dock,long,locked,keyboard,stream,fail,fonts,modes,bg,adult").split(",");
const dir = `/opt/cursor/artifacts/e43e/${TAG}`;
fs.mkdirSync(dir, { recursive: true });
const metrics = {};
const b = await launch();
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

async function clipDock(page, path) {
  const box = await page.evaluate(() => {
    const d = document.querySelector("textarea").closest("div.sticky");
    const r = d.getBoundingClientRect();
    return { x: 0, y: Math.max(0, r.y - 6), width: window.innerWidth, height: Math.min(window.innerHeight - Math.max(0, r.y - 6), r.height + 14) };
  });
  await page.screenshot({ path, clip: box });
}
async function pickLongestModel(page) {
  await page.evaluate(() => {
    const s = document.querySelector("select[aria-describedby='picker-estimate-note']");
    s.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
  });
}

if (ONLY.includes("dock")) {
  for (const w of [360, 390, 576, 768, 1440]) {
    for (const est of ["hidden", "shown"]) {
      const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "c3200" });
      await stubEstimates(page, { shown: est === "shown" });
      if (est === "shown") {
        await page.locator("select[aria-describedby='picker-estimate-note']").focus();
        await page.waitForTimeout(500);
        const vals = await page.evaluate(() => [...document.querySelector("select[aria-describedby='picker-estimate-note']").options].map((o) => [o.value, o.text]));
        const longest = vals.sort((a, c) => c[1].length - a[1].length)[0][0];
        await page.selectOption("select[aria-describedby='picker-estimate-note']", longest);
        await page.waitForTimeout(500);
      }
      await scrollBottom(page);
      metrics[`dock-${est}-${w}`] = await measure(page);
      await clipDock(page, `${dir}/dock-${est}-${w}.png`);
      await ctx.close();
    }
  }
}
if (ONLY.includes("long")) {
  for (const w of [360, 390, 1440]) {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "short" });
    await page.fill("textarea", "긴 입력 ".repeat(250).slice(0, 1500));
    await scrollBottom(page);
    metrics[`longinput-${w}`] = await measure(page);
    await page.screenshot({ path: `${dir}/longinput-${w}.png` });
    await ctx.close();
  }
}
if (ONLY.includes("locked")) {
  for (const w of [390, 1440]) {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "short" });
    await page.route("**/api/chat", () => new Promise(() => {}));
    await page.fill("textarea", "다음 장면으로 넘어가 주세요.");
    await clipDock(page, `${dir}/dock-ready-${w}.png`);
    await page.click("button:has-text('전송')");
    await page.waitForTimeout(1200);
    await scrollBottom(page);
    metrics[`locked-${w}`] = await measure(page);
    await page.screenshot({ path: `${dir}/locked-${w}.png` });
    await clipDock(page, `${dir}/dock-locked-${w}.png`);
    await ctx.close();
  }
}
if (ONLY.includes("keyboard")) {
  for (const sc of ["short", "c5200"]) {
    const { page, ctx } = await openChat(b, BASE, { width: 390, scenario: sc });
    await scrollBottom(page);
    await page.screenshot({ path: `${dir}/kb-closed-${sc}.png` });
    metrics[`kb-closed-${sc}`] = await measure(page);
    await page.setViewportSize({ width: 390, height: 508 });
    await page.focus("textarea");
    await page.waitForTimeout(700);
    await scrollBottom(page);
    await page.screenshot({ path: `${dir}/kb-open-${sc}.png` });
    metrics[`kb-open-${sc}`] = await measure(page);
    await ctx.close();
  }
}
if (ONLY.includes("stream")) {
  for (const w of [390, 1440]) {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "short", prefs: { streamIntervalMs: 16, streamCharsPerTick: 4 } });
    await stubChatStream(page, { text: TEXT_5200, chatId: fx.chats.short });
    await scrollBottom(page);
    await page.fill("textarea", "계속 이야기해 주세요.");
    await page.click("button:has-text('전송')");
    const frames = [];
    for (const t of [500, 1500, 3000, 6000]) {
      await page.waitForTimeout(t - (frames.length ? frames[frames.length - 1].t : 0));
      const m = await measure(page);
      const attr = await page.evaluate(() => ({
        live: document.querySelector("[data-chat-live-reading-active]")?.getAttribute("data-chat-live-reading-active"),
        follow: document.querySelector("[data-chat-follow-latest]")?.getAttribute("data-chat-follow-latest"),
        detached: document.querySelector("[data-chat-manual-detached]")?.getAttribute("data-chat-manual-detached"),
      }));
      frames.push({ t, scrollY: m.scrollY, docH: m.docH, dockTop: m.dock?.y, lastGap: m.lastArtBottomVsDockTop, attr });
      await page.screenshot({ path: `${dir}/stream-${w}-t${t}.png` });
    }
    // manual detach: scroll up and see whether scroll follows
    await page.mouse.move(w / 2, 300);
    await page.mouse.wheel(0, -700);
    await page.waitForTimeout(300);
    const y0 = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(2500);
    const y1 = await page.evaluate(() => window.scrollY);
    const detachAttr = await page.evaluate(() => document.querySelector("[data-chat-manual-detached]")?.getAttribute("data-chat-manual-detached"));
    metrics[`stream-${w}`] = { frames, manualDetach: { y0, y1, stayed: Math.abs(y1 - y0) < 40, attr: detachAttr } };
    await page.screenshot({ path: `${dir}/stream-${w}-detached.png` });
    await ctx.close();
  }
}
if (ONLY.includes("fail")) {
  for (const w of [390, 1440]) {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "short" });
    await stubChatStream(page, { text: "", chatId: fx.chats.short, mode: "error", error: "일시적인 오류가 발생했습니다. 다시 시도해 주세요." });
    await page.fill("textarea", "실패 상태 확인");
    await page.click("button:has-text('전송')");
    await page.waitForTimeout(1500);
    await scrollBottom(page);
    metrics[`fail-${w}`] = await measure(page);
    await page.screenshot({ path: `${dir}/fail-${w}.png` });
    await ctx.close();
  }
}
if (ONLY.includes("fonts")) {
  for (const w of [390, 1440]) {
    for (const f of ["small", "medium", "large", "xlarge"]) {
      const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "c3200", prefs: { fontSizePreset: f } });
      await scrollBottom(page);
      await page.screenshot({ path: `${dir}/font-${f}-${w}.png` });
      metrics[`font-${f}-${w}`] = await measure(page);
      await ctx.close();
    }
  }
}
if (ONLY.includes("modes")) {
  for (const w of [390, 768, 1440]) {
    for (const mode of ["left", "inline", "off"]) {
      const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "rich", prefs: { assetDisplayMode: mode } });
      await scrollBottom(page);
      await page.screenshot({ path: `${dir}/mode-${mode}-${w}.png` });
      metrics[`mode-${mode}-${w}`] = await measure(page);
      await ctx.close();
    }
  }
}
if (ONLY.includes("bg")) {
  for (const [w, op] of [[360, 0.22], [390, 0.22], [390, 0.5], [390, 0.8], [390, 1]]) {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: "c3200", prefs: { portraitBackgroundOpacity: op } });
    await page.evaluate(() => {
      const arts = [...document.querySelectorAll('article[id^="msg-"]')];
      const a = arts[arts.length - 1];
      window.scrollTo(0, window.scrollY + a.getBoundingClientRect().top + 400);
    });
    await page.waitForTimeout(400);
    const rects = await page.evaluate(() => [...document.querySelectorAll(".chat-novel-prose p")].map((p) => { const r = p.getBoundingClientRect(); const cs = getComputedStyle(p.querySelector("span") ?? p); return { x: r.x, y: r.y, w: r.width, h: r.height, color: cs.color, dlg: !!p.querySelector(".chat-dialogue-accent") }; }).filter((r) => r.y > 60 && r.y + r.h < innerHeight - 160));
    await page.addStyleTag({ content: ".chat-novel-prose, .chat-novel-prose *{color:transparent!important;background:none!important} .chat-novel-prose p::before{display:none!important} [data-chat-message-toolbar]{visibility:hidden!important}" });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}/bg-notext-${w}-${op}.png` });
    metrics[`bg-${w}-${op}`] = { rects };
    await ctx.close();
  }
}
if (ONLY.includes("adult")) {
  for (const [w, user, sc] of [[390, "adult", "adult"], [1440, "adult", "adult"], [390, "minor", "blocked"]]) {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: sc, user });
    await scrollBottom(page);
    await page.screenshot({ path: `${dir}/adult-${sc}-${w}.png` });
    metrics[`adult-${sc}-${w}`] = { url: page.url() };
    await ctx.close();
  }
}
await b.close();
fs.writeFileSync(`/tmp/e43e-metrics-states-${TAG}.json`, JSON.stringify(metrics, null, 1));
console.log("done", Object.keys(metrics));
