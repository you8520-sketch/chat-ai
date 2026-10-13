import { chromium } from "playwright-core";
import fs from "fs";

export const fx = JSON.parse(fs.readFileSync("/tmp/e43f-fixtures.json", "utf8"));
export const HEIGHTS = { 360: 800, 390: 844, 576: 900, 640: 900, 768: 1024, 1024: 800, 1440: 900 };
export const launch = () => chromium.launch();

export const DRAFT_KEY = (userId, edit) => `hobbyai.characterCreateDraft.v1:${userId}:${edit ?? "new"}`;

export function sentence(n, seed = 0) {
  const S = [
    "이 도시의 서쪽 끝에는 달빛이 가장 얇아지는 시간에만 문을 여는 고서점이 있다.",
    "주인은 손님이 잊고 싶은 문장을 하나씩 받아 두꺼운 장부에 옮겨 적고, 대신 아직 읽히지 않은 이야기를 한 권 내어 준다.",
    "그는 목소리를 높이는 법이 없고, 거절할 때에도 먼저 차를 따라 주는 사람이다.",
    "서점의 규칙은 단순하다. 문이 닫히기 전에 도착한 사람만 맞이하고, 읽은 문장은 돌려주지 않는다.",
    "손끝은 늘 차갑지만 난로 앞에서는 오래 머무르고, 감정이 흔들릴 때면 안경을 벗어 천천히 닦는다.",
  ];
  let out = "", i = seed;
  while (out.length < n) { out += S[i % S.length] + (i % 4 === 3 ? "\n\n" : " "); i++; }
  return out.slice(0, n).trimEnd().padEnd(n, "。");
}

const GALLERY = [
  { url: "/uploads/g-poster.webp", tag: "대표", public: true, chat: true, representativeRank: 1 },
  { url: "/uploads/g-b.webp", tag: "미소", public: true, chat: true },
  { url: "/uploads/g-3.webp", tag: "비밀", public: true, chat: true, viewerBlur: true },
  { url: "/uploads/g-wide1.webp", tag: "장면", public: true, chat: true },
  { url: "/uploads/g-wide2.webp", tag: "장면2", public: true, chat: true },
  { url: "/uploads/g-b2.webp", tag: "표정", public: true, chat: true },
];

/** Draft snapshot for a NEW character. Exact 12,000 split: world+prompt+speech_personality. */
export function draftSnapshot({ world = 4000, prompt = 6000, speech = 2000, assets = GALLERY, name = "세라핀 에르하르트", greeting = "달빛이 가장 얇아지는 밤, 서점의 종이 울렸다.", gender = "male", genres = ["romance_fantasy"], tab = "create", extra = {} } = {}) {
  return {
    savedAt: Date.now(),
    form: {
      content_kind: "character", name, tagline: "달빛 아래서만 문을 여는 고서점의 주인", description: "", greeting,
      system_prompt: sentence(prompt, 1), world: sentence(world, 0), speech_personality: sentence(speech, 2), speech_traits: "",
      speech_examples: "", speech_forbidden: "", speech_contextual_registers: [], status_window_prompt: "",
      genres, tags: ["고서점"], nsfw: false, participant_min_age: 27, emoji: "✨", hue: 260, audience: "all", gender,
      gender_public: false, height_cm: "", weight_kg: "", world_public_name: "", world_public: false, visibility: "public",
      narration_style_instructions: "", comments_enabled: true, creator_comment: "", trpg_reuse_allowed: false,
      simulation_cast: "", simulation_rules: "", ...extra,
    },
    assets, visualSubjects: { version: 1, subjects: [] }, selectedWorldRef: "", selectedLorebookIds: [], pageTab: tab, simulationImports: [],
  };
}
export { GALLERY };

export async function openCreate(browser, base, { width, user = "creator", query = "", draft = null, height, noBlock = false, wait = 2200 }) {
  const mobile = width < 576;
  const h = height ?? HEIGHTS[width] ?? 900;
  const ctx = await browser.newContext({ viewport: { width, height: h }, locale: "ko-KR", hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1, reducedMotion: "reduce" });
  await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: base }]);
  if (draft) {
    const uid = fx.users[user];
    const m = /edit=(\d+)/.exec(query);
    await ctx.addInitScript(([key, val]) => { try { localStorage.setItem(key, val); } catch {} }, [DRAFT_KEY(uid, m ? +m[1] : null), JSON.stringify(draft)]);
  }
  const page = await ctx.newPage();
  const providerPosts = [], saves = [];
  page.__providerPosts = providerPosts; page.__saves = saves;
  page.on("request", (r) => {
    const u = r.url();
    if (r.method() === "POST" && /openrouter|api\.openai|anthropic|generativelanguage/.test(u)) providerPosts.push(u);
    if (["POST", "PUT", "PATCH"].includes(r.method()) && /\/api\/characters(\/\d+)?$/.test(new URL(u).pathname)) saves.push({ method: r.method(), body: r.postData() });
  });
  if (!noBlock) {
    await page.route("**/api/characters", async (route) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: 999, moderationStatus: "approved", visibility: "public" }) });
      return route.continue();
    });
    await page.route(/\/api\/characters\/\d+$/, async (route) => {
      const m = route.request().method();
      if (m === "PUT" || m === "PATCH") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: 10, moderationStatus: "approved", visibility: "public" }) });
      return route.continue();
    });
  }
  await page.goto(`${base}/create${query}`, { waitUntil: "load" });
  await page.waitForTimeout(wait);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

export async function measure(page) {
  return page.evaluate(() => {
    const px = (v) => Math.round(v * 10) / 10;
    const vw = innerWidth, vh = innerHeight;
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: px(r.x), y: px(r.y), w: px(r.width), h: px(r.height), b: px(r.bottom), r: px(r.right) }; };
    const out = { vw, vh, scrollY: px(scrollY), docH: document.documentElement.scrollHeight, hOverflow: document.documentElement.scrollWidth > vw + 1 };
    const bar = document.querySelector('[data-testid="studio-save-bar"]');
    out.saveBar = rect(bar);
    const nav = document.querySelector('nav[aria-label="모바일 메뉴"]');
    out.mobileNav = rect(nav);
    out.barOverlapsNav = !!(bar && nav && getComputedStyle(nav).display !== "none" && rect(bar).b > rect(nav).y + 1 && rect(bar).y < rect(nav).b);
    const tabs = document.querySelector('[role="tablist"]');
    out.tabs = rect(tabs);
    out.tabBtns = [...document.querySelectorAll('[role="tab"]')].map((b) => ({ t: b.textContent.trim().slice(0, 12), sel: b.getAttribute("aria-selected"), ...rect(b) }));
    const clipped = [];
    for (const el of document.querySelectorAll("form input, form textarea, form select, form button")) {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden") continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      if (r.right > vw + 1 || r.left < -1) clipped.push((el.tagName + ":" + (el.getAttribute("placeholder") ?? el.textContent ?? "")).slice(0, 40));
    }
    out.clippedControls = clipped.slice(0, 8);
    const small = [];
    for (const el of document.querySelectorAll("form button, form [role=tab], form [role=switch]")) {
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      if (r.height < 32 || r.width < 32) small.push({ l: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 12), w: px(r.width), h: px(r.height) });
    }
    out.smallTargets = small.slice(0, 20);
    out.smallTargetCount = small.length;
    const active = document.activeElement;
    if (active && active !== document.body && bar) {
      const ar = active.getBoundingClientRect(); const br = bar.getBoundingClientRect();
      out.activeEl = (active.tagName + ":" + (active.getAttribute("placeholder") ?? "")).slice(0, 40);
      out.activeBottom = px(ar.bottom); out.activeCoveredBySaveBar = ar.bottom > br.top + 1 && ar.top < br.bottom;
    }
    out.panelHeights = [...document.querySelectorAll("form > div > div")].map((d) => px(d.getBoundingClientRect().height));
    return out;
  });
}
