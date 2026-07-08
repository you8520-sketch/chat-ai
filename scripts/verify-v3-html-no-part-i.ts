/**
 * PART I 제거 후 V3 HTML 시나리오 live 검증
 *
 * Usage:
 *   npx.cmd tsx scripts/verify-v3-html-no-part-i.ts
 *   npx.cmd tsx scripts/verify-v3-html-no-part-i.ts --live
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { loadEnvLocal } from "./load-env-local";
loadEnvLocal();

const live = process.argv.includes("--live");

type Scenario = {
  name: string;
  userMessage: string;
  assistantProse: string;
  userNote?: string;
};

const SCENARIOS: Scenario[] = [
  {
    name: "turn-trigger TOP5",
    userMessage: "HTML을 사용해서 맛집 TOP5를 띄워줘",
    assistantProse:
      "그는 스마트폰을 꺼내며 주변을 둘러봤다. \"오늘 저녁 어디 갈까?\"라고 물었다.",
  },
  {
    name: "messenger",
    userMessage: "HTML을 사용해서 카톡 대화 내역을 출력해줘",
    assistantProse: "휴대폰 화면을 그녀에게 보여주며 미소 지었다.",
  },
  {
    name: "standing status fields",
    userMessage: "계속 이야기해줘",
    userNote: `ooc:다음상태창을 본문하단에 HTML을 사용하여 표기할것
NPC의 속마음 한 줄
현재 상황을 짧게 요약`,
    assistantProse: "바람이 창문을 두드리는 가운데, 그는 조용히 한숨을 내쉬었다.",
  },
];

function detectIssues(name: string, html: string | null): string[] {
  const issues: string[] = [];
  if (!html?.trim()) return ["empty output"];
  const inner = html.replace(/^```html\s*/i, "").replace(/\s*```$/i, "").trim();
  if (/HTML OUTPUT MODE|REFERENCE TEMPLATE|\[ 카테고리 입력/i.test(inner)) {
    issues.push("legacy PART I placeholder leaked");
  }
  if (inner.length < 200) issues.push(`too short (${inner.length} chars)`);
  if (!/<(?:div|section|ul|ol|table)\b/i.test(inner)) issues.push("no HTML structure");
  if (name.includes("TOP5") && !/맛집|TOP|1\.|1위|일번/i.test(inner)) {
    issues.push("TOP5 content weak");
  }
  if (name.includes("messenger") && !/카톡|메시지|말풍선|bubble|background-color/i.test(inner)) {
    issues.push("messenger UI weak");
  }
  if (name.includes("status") && !/속마음|상황/i.test(inner)) {
    issues.push("status field labels missing in content");
  }
  return issues;
}

async function main() {
  const {
    resolveHtmlVisualCardPolicyFromSources,
    resolveHtmlFlashPlacement,
  } = await import("../src/lib/htmlVisualCardPolicy");
  const {
    buildHtmlFlashSystemPrompt,
    generateHtmlVisualCardWithFlash,
  } = await import("../src/lib/htmlVisualCardRecovery");

  console.log("=== PART I removed — V3 prompt check ===\n");
  for (const s of SCENARIOS) {
    const policy = resolveHtmlVisualCardPolicyFromSources({
      userMessage: s.userMessage,
      userNote: s.userNote,
      characterSetting: "현대 도시 RP.",
    });
    const placement = resolveHtmlFlashPlacement(policy, {
      userMessage: s.userMessage,
      userNote: s.userNote,
    });
    const system = buildHtmlFlashSystemPrompt(policy, placement);
    console.log(`[${s.name}] enabled=${policy.enabled} standing=${policy.standing} fields=${policy.statusFieldLabels.length}`);
    console.log(`  policyBlock len=${policy.policyBlock.length} (expect 0)`);
    console.log(`  system has PART I: ${/HTML OUTPUT MODE/.test(system)} (expect false)`);
    console.log(`  system has V3 brief: ${/HTML VISUAL CARD — V3|CREATIVE DESIGN/.test(system)}`);
  }

  if (!live) {
    console.log("\n[dry-run] Add --live for DeepSeek V3 calls.");
    return;
  }
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(1);
  }

  console.log("\n=== LIVE V3 generation ===\n");
  for (const s of SCENARIOS) {
    const policy = resolveHtmlVisualCardPolicyFromSources({
      userMessage: s.userMessage,
      userNote: s.userNote,
      characterSetting: "현대 도시 RP. NPC=민수, PC=지우.",
    });
    const placement = resolveHtmlFlashPlacement(policy, {
      userMessage: s.userMessage,
      userNote: s.userNote,
    });
    const result = await generateHtmlVisualCardWithFlash({
      chatId: 0,
      charName: "민수",
      personaName: "지우",
      userMessage: s.userMessage,
      assistantProse: s.assistantProse,
      userNote: s.userNote,
      characterSetting: "현대 도시 RP.",
      memoryBlock: "지우와 민수는 오래된 친구.",
      recentHistory: [
        { role: "user", content: "오늘 뭐 먹을까?" },
        { role: "assistant", content: "근처 맛집 찾아볼까?" },
      ],
      policy,
      placement,
    });
    const issues = detectIssues(s.name, result.html);
    console.log(`[${s.name}] chars=${result.html?.length ?? 0} tokens=${result.usage?.outputTokens ?? 0}`);
    console.log(`  issues: ${issues.length ? issues.join("; ") : "OK"}`);
    console.log(`  preview: ${(result.html ?? "").slice(0, 280).replace(/\n/g, " ")}...\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
