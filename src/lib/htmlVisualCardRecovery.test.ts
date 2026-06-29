import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { responseHasHtmlVisualCard } from "@/lib/chatRichContent";
import { ABSOLUTE_MAX_RESPONSE_CHARS } from "@/lib/responseLength";
import { resolveHtmlVisualCardPolicyFromSources } from "@/lib/htmlVisualCardPolicy";
import {
  attachHtmlBlockAtPlacement,
  attachHtmlBlockBeforeProse,
  attachHtmlBlockWithinCap,
  buildFallbackHtmlVisualCard,
  buildHtmlFlashSystemPrompt,
  buildHtmlVisualCardFlashUserBlock,
  clampFullResponsePreservingHtml,
  ensureHtmlVisualCardBlock,
  generateHtmlVisualCardWithFlash,
  HTML_FLASH_RECENT_HISTORY_MAX_TOKENS,
  HTML_OOC_FLASH_INPUT_TARGET_TOKENS,
  OOC_FLASH_RECENT_HISTORY_MAX_TOKENS,
  resolveHtmlFlashContextBudget,
  resolveHtmlFlashOutputReserveChars,
  STATUS_WINDOW_BODY_GAP,
  stripBrokenHtmlFragmentAtEnd,
  stripBrokenHtmlFragmentPreservingOocBody,
} from "@/lib/htmlVisualCardRecovery";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  buildHtmlStatusWindowCardFromFields,
  extractStatusFieldPairsFromHtml,
  isGenericHtmlStatusWindowInner,
} from "@/lib/htmlVisualCardPolicy";

describe("htmlVisualCardFlash", () => {
  it("V3 system prompt uses compact brief, not PART I templates", () => {
    const policy = resolveHtmlVisualCardPolicyFromSources({
      userMessage: "HTML을 사용해서 맛집 TOP5를 띄워줘",
    });
    const system = buildHtmlFlashSystemPrompt(policy, "top");
    assert.match(system, /HTML VISUAL CARD — V3/);
    assert.doesNotMatch(system, /HTML OUTPUT MODE/);
    assert.doesNotMatch(system, /REFERENCE TEMPLATE/);
  });

  it("standing status fields use creative design path", () => {
    const policy = resolveHtmlVisualCardPolicyFromSources({
      userNote: `ooc:다음상태창을 본문하단에 HTML을 사용하여 표기할것
NPC의 속마음 한 줄
현재 상황을 짧게 요약`,
    });
    const system = buildHtmlFlashSystemPrompt(policy, "bottom");
    assert.match(system, /HTML STATUS WINDOW — CREATIVE DESIGN/);
    assert.doesNotMatch(system, /HTML OUTPUT MODE/);
  });

  it("detects missing HTML when only prose present", () => {
    assert.equal(responseHasHtmlVisualCard("RP 본문만 있습니다."), false);
  });

  it("standing policy triggers flash eligibility", () => {
    const policy = resolveHtmlVisualCardPolicyFromSources({
      userNote: "다음상태창을 본문하단에 HTML을 사용하여 표기할것",
    });
    assert.equal(policy.enabled, true);
    assert.equal(policy.standing, true);
  });

  it("flash user block includes memory, setting, history sections", () => {
    const block = buildHtmlVisualCardFlashUserBlock({
      chatId: 1,
      charName: "NPC",
      personaName: "유저",
      userMessage: "안녕",
      assistantProse: "NPC가 고개를 끄덕였다.",
      userNote: "HTML 상태창 매 턴",
      userPersona: "25세 직장인",
      characterSetting: "판타지 세계관",
      memoryBlock: "지난번 약속 기억",
      archiveMemory: "아카이브 요약",
      recentHistory: [
        { role: "user", content: "어제 뭐 했어?" },
        { role: "assistant", content: "산책했어." },
      ],
      loreBlock: "키워드 로어북",
    });
    assert.match(block, /\[LONG-TERM MEMORY\]/);
    assert.match(block, /\[CHARACTER & WORLD SETTING\]/);
    assert.match(block, /\[RECENT CHAT HISTORY\]/);
    assert.match(block, /\[USER PERSONA\]/);
    assert.match(block, /\[ACTIVE LORE/);
  });

  it("caps OOC RECENT CHAT HISTORY at 8k tokens and routes older context to memory", () => {
    const longTurn = "가".repeat(800);
    const block = buildHtmlVisualCardFlashUserBlock(
      {
        chatId: 1,
        charName: "NPC",
        personaName: "유저",
        userMessage:
          "OOC: 지금까지의 대화와 누적 서사를 참고해서 HTML로 정리해줘",
        assistantProse: "",
        memoryBlock: "장기기억에 저장된 과거 사건 요약",
        recentHistory: Array.from({ length: 40 }, (_, i) => ({
          role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
          content: `${i}턴 ${longTurn}`,
        })),
      },
      undefined,
      "bottom",
      { htmlOnlyDedicatedTurn: true, chatOocExclusive: true, oocCreativeBrief: true }
    );
    assert.match(block, /\[HISTORY vs MEMORY\]/);
    assert.match(block, /8,000 tokens/);
    assert.match(block, /\[LONG-TERM MEMORY\]\n/);
    assert.equal((block.match(/\[LONG-TERM MEMORY\]/g) ?? []).length, 1);
    const historyMatch = block.match(/\[RECENT CHAT HISTORY\]\n([\s\S]*?)\n\n\[/);
    assert.ok(historyMatch?.[1]);
    assert.ok(estimateTokens(historyMatch![1]) <= OOC_FLASH_RECENT_HISTORY_MAX_TOKENS);
    assert.doesNotMatch(historyMatch![1], /0턴/);
  });

  it("OOC category card keeps assembled input near 20k token target, not full dump", () => {
    const chuGumiOoc =
      "[OOC: 지금의 대화 잠시 중지. NPC의 '추구미'와 그 이유를 가볍고 코믹한 분위기로 알아본다. " +
      "항목은 [외형 · 키워드 · 모에화 · 기타 상징 · 대외적 이미지]로 5개. " +
      "내용은 인라인 HTML을 활용하여 가독성 좋게 작성하고, 코드블럭으로 감싸서 출력한다. " +
      "모든 내용은 PC와 NPC의 캐릭터 설정/성격/말투/세계관/관계성/유저노트/누적대화 등을 참조하여 자세히 작성할 것.]";
    const huge = "X".repeat(25_000);
    const block = buildHtmlVisualCardFlashUserBlock(
      {
        chatId: 1,
        charName: "레온",
        personaName: "유저",
        userMessage: chuGumiOoc,
        assistantProse: "",
        userNote: huge,
        userPersona: "페르소나 " + huge.slice(0, 5000),
        characterSetting: "코어 설정 " + huge,
        memoryBlock: "기억 " + huge,
        archiveMemory: "아카이브 " + huge,
        loreBlock: "로어 " + huge,
        recentHistory: Array.from({ length: 30 }, (_, i) => ({
          role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
          content: `턴${i} ${"가".repeat(600)}`,
        })),
      },
      undefined,
      "bottom",
      { htmlOnlyDedicatedTurn: true, chatOocExclusive: true, oocCreativeBrief: true }
    );
    const tokens = estimateTokens(block);
    assert.ok(
      tokens <= HTML_OOC_FLASH_INPUT_TARGET_TOKENS + 3000,
      `expected ≤ ~${HTML_OOC_FLASH_INPUT_TARGET_TOKENS + 3000}, got ${tokens}`
    );
    assert.match(block, /\[CHARACTER & WORLD SETTING\]/);
    assert.match(block, /\[LONG-TERM MEMORY\]/);
    assert.match(block, /\[RECENT CHAT HISTORY\]/);
    assert.doesNotMatch(block, /X{1000}/);
  });

  it("flash user block includes status field labels when policy provided", () => {
    const block = buildHtmlVisualCardFlashUserBlock(
      {
        chatId: 1,
        charName: "NPC",
        personaName: "유저",
        userMessage: "안녕",
        assistantProse: "NPC가 고개를 끄덕였다.",
      },
      { standing: true, statusFieldLabels: ["속마음", "현재 상황"] },
      "bottom"
    );
    assert.match(block, /\[STATUS FIELD LABELS/);
    assert.match(block, /속마음/);
    assert.match(block, /\[UI PLACEMENT\]/);
    assert.match(block, /BELOW RP prose/);
  });

  it("attachHtmlBlockBeforeProse puts html before prose", () => {
    const html = buildFallbackHtmlVisualCard(["속마음"]);
    const prose = "RP 본문입니다.";
    const merged = attachHtmlBlockBeforeProse(prose, html);
    assert.ok(merged.indexOf("```html") < merged.indexOf("RP 본문"));
    assert.match(merged, /RP 본문입니다/);
  });

  it("attachHtmlBlockAtPlacement respects top vs bottom", () => {
    const html = buildFallbackHtmlVisualCard(["상황"]);
    const prose = "본문";
    const top = attachHtmlBlockAtPlacement(prose, html, "top");
    const bottom = attachHtmlBlockAtPlacement(prose, html, "bottom");
    assert.ok(top.indexOf("```html") < top.indexOf("본문"));
    assert.ok(bottom.indexOf("본문") < bottom.indexOf("```html"));
  });

  it("attachHtmlBlockWithinCap keeps full prose and html when no char cap", () => {
    const html = buildFallbackHtmlVisualCard(["속마음", "상황"]);
    const prose = "가".repeat(4900);
    const merged = attachHtmlBlockWithinCap(prose, html, ABSOLUTE_MAX_RESPONSE_CHARS);
    assert.ok(merged.length > ABSOLUTE_MAX_RESPONSE_CHARS);
    assert.match(merged, /```html/);
    assert.ok(responseHasHtmlVisualCard(merged));
    const htmlFence = merged.slice(merged.indexOf("```html"));
    assert.ok(htmlFence.length > 500, "HTML block should retain meaningful size, not a tiny fragment");
  });

  it("attachHtmlBlockAtPlacement separates prose and html with two blank lines", () => {
    const html = buildFallbackHtmlVisualCard(["속마음"]);
    const prose = "RP 본문입니다.";
    const bottom = attachHtmlBlockAtPlacement(prose, html, "bottom");
    assert.ok(bottom.startsWith(`RP 본문입니다.${STATUS_WINDOW_BODY_GAP}\`\`\`html`));
    const top = attachHtmlBlockAtPlacement(prose, html, "top");
    assert.ok(top.startsWith("```html"));
    const proseIdx = top.lastIndexOf(prose);
    assert.ok(proseIdx > 0);
    assert.equal(top.slice(proseIdx - STATUS_WINDOW_BODY_GAP.length, proseIdx), STATUS_WINDOW_BODY_GAP);
  });

  it("resolveHtmlFlashOutputReserveChars scales with status field labels", () => {
    const labels = ["속마음", "현재 상황", "다음 행동"];
    const reserve = resolveHtmlFlashOutputReserveChars(labels);
    assert.ok(reserve >= 900);
    assert.ok(reserve <= 1800);
    assert.ok(reserve >= buildFallbackHtmlVisualCard(labels).length);
  });

  it("fallback template is fenced html when status labels exist", () => {
    const block = buildFallbackHtmlVisualCard(["NPC 속마음"]);
    assert.match(block, /^```html/);
    assert.match(block, /NPC 속마음/);
    assert.match(block, /<section\b/i);
    const inner = block.replace(/^```html\n/, "").replace(/\n```$/, "");
    assert.equal(isGenericHtmlStatusWindowInner(inner), false);
  });

  it("buildFallbackHtmlVisualCard returns empty when no status labels", () => {
    assert.equal(buildFallbackHtmlVisualCard([]), "");
  });

  it("ensureHtmlVisualCardBlock rejects generic status template in OOC skipGenericFallback mode", () => {
    const oldGeneric = `\`\`\`html\n<div style="padding:8px;border-left:3px solid #4a90e2"><p style="font-weight:700">현재 상황</p><p>x</p><p style="font-weight:700">속마음</p><p>y</p><p style="font-weight:700">다음 행동</p><p>z</p></div>\n\`\`\``;
    const ensured = ensureHtmlVisualCardBlock(oldGeneric, [], 5000, { skipGenericFallback: true });
    assert.equal(ensured, "");
  });

  it("ensureHtmlVisualCardBlock rejects default section status placeholders in OOC mode", () => {
    const triple = buildHtmlStatusWindowCardFromFields([
      { label: "현재 상황", content: "—" },
      { label: "속마음", content: "—" },
      { label: "다음 행동", content: "—" },
    ]);
    const block = `\`\`\`html\n${triple}\n\`\`\``;
    const ensured = ensureHtmlVisualCardBlock(block, [], 5000, { skipGenericFallback: true });
    assert.equal(ensured, "");
  });

  it("ensureHtmlVisualCardBlock keeps custom OOC HTML in skipGenericFallback mode", () => {
    const inner =
      '<section style="padding:12px;color:#222"><h3>익명 메시지함</h3>' +
      "<ul><li>Q1</li><li>A1</li></ul>".repeat(6) +
      "</section>";
    const block = `\`\`\`html\n${inner}\n\`\`\``;
    const ensured = ensureHtmlVisualCardBlock(block, [], 5000, { skipGenericFallback: true });
    assert.match(ensured, /익명 메시지함/);
    assert.doesNotMatch(ensured, /현재 상황/);
  });

  it("ensureHtmlVisualCardBlock adds section spacing for crammed 추구미 OOC HTML", () => {
    const ooc =
      "OOC: 대화 잠시 중지. 항목은[외형 · 키워드 · 모에화 · 기타 상징 · 대외적 이미지]로 작성";
    const pad = (s: string) => s.repeat(12);
    const crammed = `\`\`\`html\n<div style="padding:12px">외형: ${pad("은발 롱헤어 ")}키워드: ${pad("츤데레 ")}모에화: ${pad("고양이 ")}기타 상징: ${pad("겨울 ")}대외적 이미지: ${pad("빙공주 ")}</div>\n\`\`\``;
    const ensured = ensureHtmlVisualCardBlock(crammed, [], 5000, {
      skipGenericFallback: true,
      oocUserMessage: ooc,
    });
    assert.match(ensured, /margin-bottom:14px/);
    assert.match(ensured, /키워드/);
  });

  it("stripBrokenHtmlFragmentAtEnd removes unclosed html tail", () => {
    const input = `RP 본문입니다. ${"가".repeat(90)}\n\n\`\`\`html\n\`\`\`html\n<div style`;
    const { text, stripped } = stripBrokenHtmlFragmentAtEnd(input);
    assert.equal(stripped, true);
    assert.equal(text, `RP 본문입니다. ${"가".repeat(90)}`);
  });

  it("stripBrokenHtmlFragmentAtEnd leaves valid fenced html", () => {
    const input = 'RP 본문.\n\n```html\n<div>ok</div>\n```';
    const { text, stripped } = stripBrokenHtmlFragmentAtEnd(input);
    assert.equal(stripped, false);
    assert.equal(text, input);
  });

  it("stripBrokenHtmlTailSafely preserves prose when html tail is broken", () => {
    const prose = `백하율은 렌의 손목을 잡았다. ${"그의 맥박이 빠르게 뛰고 있었다.".repeat(4)}`;
    const input = `${prose}\n\n\`\`\`html\n\`\`\`html\n<div style`;
    const { text, stripped } = stripBrokenHtmlFragmentAtEnd(input);
    assert.equal(stripped, true);
    assert.equal(text, prose);
    assert.doesNotMatch(text, /```html/i);
  });

  it("stripBrokenHtmlTailSafely refuses to wipe entire html-only garbage", () => {
    const input = "```html\n<div style=color:red";
    const { text, stripped } = stripBrokenHtmlFragmentAtEnd(input);
    assert.equal(stripped, false);
    assert.equal(text, input);
  });

  it("generateHtmlVisualCardWithFlash returns fallback when disabled", async () => {
    const result = await generateHtmlVisualCardWithFlash({
      chatId: 1,
      charName: "A",
      personaName: "B",
      userMessage: "hi",
      assistantProse: "prose",
      policy: { enabled: false, standing: false, statusFieldLabels: [], policyBlock: "" },
    });
    assert.equal(result.html, null);
    assert.equal(result.usage, null);
  });

  it("ensureHtmlVisualCardBlock rejects truncated partial flash HTML", () => {
    const partial = `\`\`\`html\n\`\`\`html\n<div style="max-width:550px;margin:12px auto;padding:12px;border:1px solid #eaeaea;fo`;
    const ensured = ensureHtmlVisualCardBlock(partial, ["현재 상황", "속마음"], 5000);
    assert.match(ensured, /```html/);
    assert.match(ensured, /<\/div>/);
    assert.doesNotMatch(ensured, /```html[\s\S]*```html/);
    assert.ok(ensured.length > 400);
  });

  it("clampFullResponsePreservingHtml under cap normalizes nested fences without truncating", () => {
    const inner = buildHtmlStatusWindowCardFromFields([
      { label: "현재 상황", content: "장면 요약" },
    ]);
    const broken = `RP 본문.\n\n\`\`\`html\n\`\`\`html\n${inner}`;
    const clamped = clampFullResponsePreservingHtml(broken, 5000);
    assert.match(clamped, /RP 본문/);
    assert.match(clamped, /장면 요약/);
    assert.doesNotMatch(clamped, /```html[\s\S]*```html/);
  });

  it("clampFullResponsePreservingHtml keeps OOC creative HTML without balanced divs", () => {
    const inner =
      '<section style="max-width:400px;padding:12px;color:#222;background:#fff">' +
      "<h3>익명 메시지함</h3>".repeat(3) +
      "<ul><li>질문1</li><li>답변1</li></ul>".repeat(5) +
      "</section>";
    assert.ok(inner.length >= 180);
    const htmlOnly = `\`\`\`html\n${inner}\n\`\`\``;
    const clamped = clampFullResponsePreservingHtml(htmlOnly, 5000);
    assert.ok(responseHasHtmlVisualCard(clamped));
    assert.match(clamped, /익명 메시지함/);
    assert.match(clamped, /질문1/);
  });

  it("stripBrokenHtmlFragmentPreservingOocBody keeps rich inbox when tail strip would leave header only", () => {
    const inboxOoc = "OOC: 익명 메시지함 HTML. 질문과 답변을 각각 5개 이상";
    const qaBlock =
      "<section><p>익명 질문 " +
      "팬덤 논쟁 ".repeat(15) +
      "</p><p>답변 " +
      "코믹 상세 ".repeat(15) +
      "</p></section>";
    const inner =
      `<div><h2>@공식계정</h2><p>bio</p>${qaBlock.repeat(5)}` + "<section";
    const fenced = `\`\`\`html\n${inner}\n\`\`\``;
    const { text, stripped } = stripBrokenHtmlFragmentPreservingOocBody(fenced, inboxOoc);
    assert.equal(stripped, false);
    assert.match(text, /익명 질문/);
    assert.match(text, /답변/);
  });

  it("attachHtmlBlockWithinCap preserves flash field content when rebuilding compact", () => {
    const verboseInner = buildHtmlStatusWindowCardFromFields([
      { label: "현재 상황", content: "벽에 기댄 채 키스가 이어지는 장면" },
      { label: "속마음", content: "백하율은 렌의 반응을 즐기고 있다" },
      { label: "다음 행동", content: "더 깊은 접촉을 요구할 예정" },
    ])
      .replace(/padding:8px/g, "padding:24px")
      .replace(/font-size:13px/g, "font-size:18px");
    const verboseHtml = `\`\`\`html\n${verboseInner}\n\`\`\``;
    assert.ok(verboseHtml.length > 900);

    const prose = "RP 본문입니다.";
    const merged = attachHtmlBlockWithinCap(prose, verboseHtml, 5000, [
      "현재 상황",
      "속마음",
      "다음 행동",
    ]);
    assert.match(merged, /벽에 기댄 채 키스가 이어지는 장면/);
    assert.match(merged, /백하율은 렌의 반응을 즐기고 있다/);
    assert.doesNotMatch(merged, /장면에 맞게 RP 본문을 참고하세요/);
    const pairs = extractStatusFieldPairsFromHtml(merged);
    assert.equal(pairs.length, 3);
  });
});
