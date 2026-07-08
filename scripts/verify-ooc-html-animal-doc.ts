/**
 * OOC HTML 동물 문서 턴 — 라우팅·프롬프트·(선택) 실제 V3 호출 검증
 *
 * Usage:
 *   npx.cmd tsx scripts/verify-ooc-html-animal-doc.ts
 *   npx.cmd tsx scripts/verify-ooc-html-animal-doc.ts --live
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { loadEnvLocal } from "./load-env-local";
loadEnvLocal();

const USER_MSG = `*[OOC: 이전 rp 일시 중단. PC는 NPC가 자리를 비운 동안, NPC가 요 며칠 몰래 작성하던 문서 하나를 보게 된다. 거기에는 PC가 인간이 아니라 특정 동물(예시: 개, 고양이, 너구리, 판다 등 다양하게)일 수도 있을 것 같다는 진지하고 현실적인 고찰들이 적혀 있다. 특정 동물의 동물적 습성과 PC의 행동이 묘한 일치를 이루는 포인트를 정리해 둔 진지하고 웃긴 글. 이것을 html 형태로 백틱으로 감싸 1300단어 이상 출력한다. html은 모바일 기준으로 반드시 가독성 있게 정렬할 것.]*`;

const live = process.argv.includes("--live");

function hasPartH(text: string): boolean {
  return /\[HTML OUTPUT OWNERSHIP\]/i.test(text);
}
function hasPartI(text: string): boolean {
  return /\[SYSTEM: HTML OUTPUT MODE\]/i.test(text);
}

function detectBrokenHtml(text: string): string[] {
  const inner = text.replace(/^```html\s*/i, "").replace(/\s*```$/i, "").trim();
  const issues: string[] = [];
  if (/REFERENCE TEMPLATE/i.test(inner)) issues.push("REFERENCE TEMPLATE leaked in output");
  if (/<!--\s*1\.\s*카테고리/i.test(inner)) issues.push("placeholder template comments in output");
  if (/\[ 카테고리 입력/i.test(inner)) issues.push("unfilled template placeholders");
  if (inner.length < 500) issues.push(`output too short (${inner.length} chars)`);
  if (!/<div[\s>]/i.test(inner) && !/<section[\s>]/i.test(inner))
    issues.push("no div/section structure");
  if (/^<html/i.test(inner) && !/<\/html>/i.test(inner)) issues.push("unclosed html tag");
  return issues;
}

async function main() {
  const {
    isHtmlFlashOnlyTurn,
    isOocCreativeHtmlTurn,
    isHtmlDisplayOnlyTurn,
  } = await import("../src/lib/htmlDisplayOnlyTurn");
  const {
    userRequestsHtmlOutput,
    resolveHtmlVisualCardPolicyFromSources,
    applyChatOocExclusiveHtmlPolicy,
    resolveHtmlFlashPlacement,
  } = await import("../src/lib/htmlVisualCardPolicy");
  const { classifyChatOocIntent, chatOocSuppressesUserNoteExtras } = await import(
    "../src/lib/chatOocPriority"
  );
  const { RP_STOP_OR_FLASH_ONLY } = await import("../src/lib/oocHtmlTurnPatterns");
  const { extractOocSnippets } = await import("../src/lib/userImpersonationPolicy");
  const { buildPrimaryModelFlashFirewallBlock } = await import(
    "../src/lib/flashOwnedOutputFirewall"
  );
  const {
    generateHtmlVisualCardWithFlash,
  } = await import("../src/lib/htmlVisualCardRecovery");

  console.log("=== OOC HTML animal document — routing ===\n");
  console.log("userRequestsHtmlOutput:", userRequestsHtmlOutput(USER_MSG));
  console.log("RP_STOP_OR_FLASH_ONLY (full msg):", RP_STOP_OR_FLASH_ONLY.test(USER_MSG));
  for (const s of extractOocSnippets(USER_MSG)) {
    console.log("  snippet RP_STOP:", RP_STOP_OR_FLASH_ONLY.test(s));
  }
  console.log("classifyChatOocIntent:", classifyChatOocIntent(USER_MSG));
  console.log("chatOocSuppressesUserNoteExtras:", chatOocSuppressesUserNoteExtras(USER_MSG));
  console.log("isHtmlDisplayOnlyTurn:", isHtmlDisplayOnlyTurn(USER_MSG));
  console.log("isOocCreativeHtmlTurn:", isOocCreativeHtmlTurn(USER_MSG));
  console.log("isHtmlFlashOnlyTurn:", isHtmlFlashOnlyTurn(USER_MSG));

  const chatOocRpUnrelated = classifyChatOocIntent(USER_MSG) === "rp_unrelated";
  const htmlFlashOnlyTurn = chatOocRpUnrelated || isHtmlFlashOnlyTurn(USER_MSG);
  const oocCreativeHtmlTurn = isOocCreativeHtmlTurn(USER_MSG) || chatOocRpUnrelated;

  const policy = applyChatOocExclusiveHtmlPolicy(
    resolveHtmlVisualCardPolicyFromSources({ userMessage: USER_MSG })
  );
  console.log("\npolicy.enabled:", policy.enabled);
  console.log("htmlFlashOnlyTurn (route):", htmlFlashOnlyTurn);
  console.log("oocCreativeHtmlTurn:", oocCreativeHtmlTurn);
  console.log("chatOocRpUnrelated:", chatOocRpUnrelated);

  const placement = resolveHtmlFlashPlacement(policy, { userMessage: USER_MSG });
  const flashMode = {
    displayUserInputOnly: isHtmlDisplayOnlyTurn(USER_MSG),
    oocCreativeBrief: oocCreativeHtmlTurn && !isHtmlDisplayOnlyTurn(USER_MSG),
    chatOocExclusive: chatOocRpUnrelated,
    htmlOnlyDedicatedTurn: htmlFlashOnlyTurn,
  };

  console.log("\n=== PART H/I relevance (from code path) ===");
  const mainFirewall = buildPrimaryModelFlashFirewallBlock({});
  console.log("PART H on MAIN model (Gemini etc.):", hasPartH(mainFirewall));
  console.log("MAIN OpenRouter on this turn:", htmlFlashOnlyTurn ? "SKIPPED" : "runs");
  console.log(
    "V3 system uses OOC CREATIVE path (not PART I templates):",
    flashMode.oocCreativeBrief || flashMode.chatOocExclusive
  );
  console.log("PART H is NOT injected into V3 — only main-model firewall");
  console.log(
    "PART I templates only used for standing/turn-trigger status cards, not OOC creative turns"
  );

  if (!live) {
    console.log("\n[dry-run] Add --live to call DeepSeek V3 and inspect output.");
    return;
  }

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing — cannot run --live");
    process.exit(1);
  }

  console.log("\n=== LIVE DeepSeek V3 HTML-only ===");
  const result = await generateHtmlVisualCardWithFlash({
    chatId: 0,
    charName: "TestNPC",
    personaName: "TestPC",
    userMessage: USER_MSG,
    assistantProse: "",
    characterSetting: "판타지 RP. PC는 호기심 많은 모험가.",
    memoryBlock: "PC는 NPC와 함께 여행 중.",
    recentHistory: [
      { role: "user", content: "잠깐 쉬자." },
      { role: "assistant", content: "그래, 잠시 쉬자." },
    ],
    policy,
    placement,
    ...flashMode,
  });

  const html = result.html ?? "";
  console.log("output chars:", html.length);
  console.log("api output tokens:", result.usage?.outputTokens);
  const issues = detectBrokenHtml(html);
  console.log(issues.length === 0 ? "broken check: OK" : `broken issues: ${issues.join("; ")}`);
  console.log("\n--- output preview (3000 chars) ---");
  console.log(html.slice(0, 3000));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
