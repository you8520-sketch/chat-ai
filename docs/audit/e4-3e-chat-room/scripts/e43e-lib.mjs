import { chromium } from "playwright-core";
import fs from "fs";

export const fx = JSON.parse(fs.readFileSync("/tmp/e43e-fixtures.json", "utf8"));
export const HEIGHTS = { 360: 800, 390: 844, 576: 900, 768: 1024, 1024: 800, 1440: 900 };

export async function launch() {
  return chromium.launch();
}

export async function openChat(browser, base, { width, scenario, user = "std", prefs = {}, height, keyboard = false, noBlock = false }) {
  const mobile = width < 576;
  const h = height ?? HEIGHTS[width] ?? 900;
  const ctx = await browser.newContext({
    viewport: { width, height: h },
    locale: "ko-KR",
    hasTouch: mobile,
    isMobile: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
    reducedMotion: "reduce",
  });
  await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: base }]);
  const merged = { ...prefs };
  await ctx.addInitScript((p) => {
    if (Object.keys(p).length) {
      try { localStorage.setItem("playai-chat-display-prefs", JSON.stringify(p)); } catch {}
    }
  }, merged);
  const page = await ctx.newPage();
  const providerPosts = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /openrouter|api\.openai|anthropic|generativelanguage/.test(r.url())) providerPosts.push(r.url());
  });
  page.__providerPosts = providerPosts;
  const charId = scenario === "adult" || scenario === "blocked" ? fx.chars.adult : fx.chars.main;
  const chatId = fx.chats[scenario];
  await page.goto(`${base}/chat/${charId}?chat=${chatId}`, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

export async function scrollBottom(page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
}

/** In-page measurement of the chat room layout. */
export async function measure(page) {
  return page.evaluate(() => {
    const px = (v) => Math.round(v * 10) / 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: px(r.x), y: px(r.y), w: px(r.width), h: px(r.height), r: px(r.right), b: px(r.bottom) };
    };
    const lum = (rgb) => {
      const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map((x) => parseFloat(x)); return { rgb: p.slice(0, 3), a: p[3] ?? 1 }; };
    const contrast = (a, b) => { const la = lum(a), lb = lum(b); const [hi, lo] = la > lb ? [la, lb] : [lb, la]; return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100; };

    const dock = document.querySelector("textarea")?.closest("div.sticky") ?? null;
    const textarea = document.querySelector("textarea");
    const arts = [...document.querySelectorAll('article[id^="msg-"]')];
    const users = [...document.querySelectorAll('div[id^="msg-"]')].filter((e) => e.tagName === "DIV");
    const lastArt = arts[arts.length - 1] ?? null;
    const out = { vw, vh, scrollY: px(window.scrollY), docH: document.documentElement.scrollHeight };
    out.hOverflow = document.documentElement.scrollWidth > vw + 1;
    out.docScrollW = document.documentElement.scrollWidth;
    const clipped = [];
    for (const el of document.querySelectorAll("main *, aside *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.visibility === "hidden") continue;
      if (r.right > vw + 2 && !el.closest("[class*=overflow-x-auto]") && !el.closest("pre")) clipped.push(el.tagName + "." + (el.className?.toString?.().slice(0, 40) ?? ""));
      if (clipped.length > 6) break;
    }
    out.rightOverflowEls = clipped;

    out.dock = rect(dock);
    out.dockFrac = dock ? px(dock.getBoundingClientRect().height / vh) : null;
    out.textarea = rect(textarea);
    const note = document.getElementById("picker-estimate-note");
    out.estimateNote = rect(note);
    const sel = document.querySelector("select[aria-describedby='picker-estimate-note']");
    out.select = rect(sel);
    if (sel) {
      const opt = sel.options[sel.selectedIndex];
      const cs = getComputedStyle(sel);
      const c = document.createElement("canvas").getContext("2d");
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      out.selectLabel = opt?.text;
      out.selectLabelTextW = px(c.measureText(opt?.text ?? "").width);
      out.selectInnerW = px(sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20);
      out.selectTruncated = out.selectLabelTextW > out.selectInnerW + 1;
      out.selectFont = cs.fontSize;
    }
    const btn = (label) => [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().startsWith(label));
    for (const [k, l] of [["send", "전송"], ["continue", "자동진행"], ["suggest", "추천"]]) {
      const b = btn(l);
      out[k] = b ? { ...rect(b), fontSize: getComputedStyle(b).fontSize, disabled: b.disabled } : null;
    }
    out.toolbarBtns = [...document.querySelectorAll('[data-chat-message-toolbar] button')].slice(0, 12).map((b) => {
      const r = b.getBoundingClientRect();
      return { label: b.getAttribute("aria-label"), w: px(r.width), h: px(r.height) };
    });

    if (lastArt && dock) {
      const lr = lastArt.getBoundingClientRect();
      const dr = dock.getBoundingClientRect();
      out.lastArt = rect(lastArt);
      out.lastArtBottomVsDockTop = px(dr.top - lr.bottom);
    }
    const body = lastArt?.querySelector("[data-quote-assistant]") ?? null;
    if (body) {
      const p = body.querySelector("p, .chat-novel-prose p") ?? body;
      const cs = getComputedStyle(p);
      out.body = rect(body);
      out.bodyFont = { size: cs.fontSize, lh: cs.lineHeight, color: cs.color, family: cs.fontFamily.slice(0, 40) };
      const fs = parseFloat(cs.fontSize);
      out.charsPerLineEst = px(body.getBoundingClientRect().width / (fs * 0.62));
      out.lineHeightRatio = px(parseFloat(cs.lineHeight) / fs);
      const paras = [...body.querySelectorAll("p")];
      const gaps = [];
      for (let i = 1; i < Math.min(paras.length, 8); i++) {
        gaps.push(px(paras[i].getBoundingClientRect().top - paras[i - 1].getBoundingClientRect().bottom));
      }
      out.paraGaps = gaps;
      out.paraCount = paras.length;
      let best = null;
      for (const q of paras) {
        const t = q.textContent ?? "";
        if (t.length > (best?.textContent?.length ?? 0)) best = q;
      }
      if (best) {
        const range = document.createRange();
        range.selectNodeContents(best);
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 2).map((r) => Math.round(r.top / 4)));
        out.longestPara = { chars: best.textContent.length, lines: tops.size, charsPerLine: px(best.textContent.length / Math.max(1, tops.size)), widthPx: px(best.getBoundingClientRect().width) };
      }
      const dlg = body.querySelector(".chat-dialogue-accent");
      if (dlg) {
        const dcs = getComputedStyle(dlg);
        out.dialogue = { color: dcs.color, weight: dcs.fontWeight, size: dcs.fontSize };
      }
      const bgEl = document.querySelector(".chat-room-messages-column, main") ?? document.body;
      const bg = parse(getComputedStyle(document.body).backgroundColor) ?? { rgb: [18, 18, 18], a: 1 };
      const bgRgb = bg.a > 0 ? bg.rgb : [18, 18, 18];
      const nar = parse(cs.color);
      if (nar) out.narrationContrastVsBodyBg = contrast(nar.rgb, bgRgb);
      if (dlg) { const d = parse(getComputedStyle(dlg).color); if (d) out.dialogueContrastVsBodyBg = contrast(d.rgb, bgRgb); }
      out.bodyBgRgb = bgRgb;
    }
    if (users.length) {
      const u = users[users.length - 1];
      const up = u.querySelector("p, div");
      const ucs = up ? getComputedStyle(up) : null;
      out.userMsg = rect(u);
      out.userFont = ucs ? { size: ucs.fontSize, color: ucs.color, align: ucs.textAlign, lh: ucs.lineHeight } : null;
      if (body && ucs) {
        out.userVsAssistantFontRatio = px(parseFloat(ucs.fontSize) / parseFloat(getComputedStyle(body.querySelector("p") ?? body).fontSize));
      }
    }
    const bgPortrait = document.querySelector('[data-testid="mobile-chat-portrait-background"]');
    out.mobileBg = bgPortrait ? { present: true, ...rect(bgPortrait) } : { present: false };
    out.portraitRail = rect(document.querySelector(".chat-room-portrait-rail"));
    out.msgColumn = rect(document.querySelector(".chat-room-messages-column") ?? document.querySelector(".chat-room-portrait-chat-column"));
    out.focusable = [...document.querySelectorAll("button,select,textarea,a[href]")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length;
    const tiny = [];
    for (const e of document.querySelectorAll("button,select,a[href],[role=switch]")) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < 24 || r.height < 24) tiny.push({ label: (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 14), w: px(r.width), h: px(r.height) });
    }
    out.tinyTargets = tiny.slice(0, 10);
    out.mobileNav = rect(document.querySelector('nav[aria-label="모바일 메뉴"]'));
    out.titleBar = rect(document.querySelector(".chat-room-mobile-title-bar"));
    return out;
  });
}

export async function stubEstimates(page, { shown = true } = {}) {
  await page.route("**/api/chat/next-turn-estimates", async (route) => {
    const opts = await page.evaluate(() => [...document.querySelectorAll("select[aria-describedby='picker-estimate-note'] option")].map((o) => o.value));
    const estimates = {};
    const models = {};
    if (shown) opts.forEach((id, i) => { estimates[id] = [14, 38, 72, 160][i % 4]; models[id] = { forecastSource: i % 2 ? "same_model_actual_anchored_delta" : "uncalibrated_assembled" }; });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ estimates, models }) });
  });
}

const sseBody = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

/** Saved raw-text fixture stream — no provider call; echoes the client's own request id. */
export async function stubChatStream(page, { text, chatId, mode = "done", error = "" }) {
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() ?? {};
    const requestId = body.clientRequestId;
    const base = { requestId, chatId, messageId: 99001, userMessageId: 99000 };
    if (mode === "error") {
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sseBody([{ type: "turn_persisted", ...base }, { type: "error", error }]) });
    }
    const chunks = [];
    for (let i = 0; i < text.length; i += 120) chunks.push({ type: "append", text: text.slice(i, i + 120) });
    return route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: sseBody([
        { type: "turn_persisted", ...base },
        ...chunks,
        { type: "done", ...base, finalContent: text, remainingPoints: 1900, mode: "safe", generationStatus: "completed" },
      ]),
    });
  });
}
