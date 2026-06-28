/**
 * Relationship memory (관계메모) Flash extract cost audit — actual code paths.
 * Usage: npx tsx scripts/audit-relationship-memory-extract.ts
 */
import { createRequire } from "module";
import { loadEnvLocal } from "./load-env-local";

const require = createRequire(import.meta.url);

function mockServerModules(): void {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  } as NodeModule;
  const dbPath = require.resolve("../src/lib/db");
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { getDb: () => ({}) },
  } as NodeModule;
}

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

type Scenario = {
  id: string;
  label: string;
  userMessage: string;
  assistantMessage: string;
  prevMeta: import("../src/lib/chatMemory").MemoryMeta;
  /** Simulated Flash JSON output */
  flashOutputJson: string;
  /** Simulated main-model tail JSON (same schema) */
  mainTailJson: string;
};

function buildRelationshipExtractSystem(
  charName: string,
  userName: string,
  prevMeta: import("../src/lib/chatMemory").MemoryMeta,
  RELATIONSHIP_THOUGHT_EXTRACT_RULES: string
): string {
  const activePromises = prevMeta.promises.length
    ? prevMeta.promises
        .map((p) => `- ${p.text}${p.deadline ? ` (기한: ${p.deadline})` : ""}`)
        .join("\n")
    : "(없음)";

  return `너는 롤플레잉 관계 메모 추출기다. 이번 턴 본문(유저·캐릭터 대사·서술)에서 **새로 등장·변경**된 항목만 JSON으로 출력하라.

honorifics: **이번 턴 본문에 실제로 등장한 인물 이름**끼리 부르는 호칭만. from/to는 본문에 그대로 나온 이름(12자 이내·공백 없음)만 — 설정·카드 제목·시뮬 메타 라벨은 사용 금지. 호칭·애칭(왕비, ○○아 등)은 콜론 뒤 value에만. 형식: "이름→이름: 호칭". "캐릭터", "유저" 라벨 금지. 본문에 없는 이름은 from/to에 넣지 마라.
items: 인물별 소지품. **한 사람당 한 줄** — 형식 "이름: 물건1, 물건2, 물건3" (쉼표로 나열). 선물·전달은 "보낸이→받는이: 물건" 또는 "이름: 물건"으로. "캐릭터", "유저" 라벨 금지.
${RELATIONSHIP_THOUGHT_EXTRACT_RULES.replace(/캐릭터이름/g, charName).replace("유저 내면", `${userName}·유저 내면`)}
promisesAdd: 이번 턴에 **새로 맺은** 약속 [{ "text": "약속 내용", "deadline": "기한(있으면)" }]
promisesRemove: 아래 [기존 활성 약속] 중 **이번 턴에 지켜졌거나, 기한이 지나 더 이상 유효하지 않은** 약속의 text와 **정확히 일치**하는 문자열

[기존 활성 약속]
${activePromises}

없는 항목은 빈 배열. 순수 JSON만:
{"honorifics":[],"items":[],"thoughts":[],"promisesAdd":[],"promisesRemove":[]}`;
}

function buildExtractUserBlock(
  userName: string,
  charName: string,
  userMessage: string,
  assistantMessage: string
): string {
  return `유저(${userName}): ${userMessage.slice(0, 2000)}\n캐릭터(${charName}): ${assistantMessage.slice(0, 3000)}`;
}

const EMPTY_JSON =
  '{"honorifics":[],"items":[],"thoughts":[],"promisesAdd":[],"promisesRemove":[]}';

async function main() {
  mockServerModules();

  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { RELATIONSHIP_THOUGHT_EXTRACT_RULES, MEMORY_META_MAX } = await import(
    "../src/lib/chatMemory"
  );
  const { BACKGROUND_OPENROUTER_MODEL } = await import("../src/lib/ai");
  const { openRouterUsdCostFromRates } = await import("../src/lib/openRouterModelPricing");
  const { convertUsdToKrw, resolveBillingExchangeRateSnapshot } = await import(
    "../src/lib/exchangeRate"
  );
  const {
    OPENROUTER_GEMINI_25_PRO_MODEL,
    OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    OPENROUTER_QWEN_37_MAX_MODEL,
  } = await import("../src/lib/chatModels");
  const { ROLLING_SUMMARY_INTERVAL } = await import("../src/lib/hybridMemory");

  const charName = "백하율";
  const userName = "렌";

  const typicalAssistant =
    `${charName}은 잠시 귀를 기울였다. 밤바람 사이로 희미한 소리가 스쳐 지나갔다.\n` +
    `"…들리시나요?" 그는 낮게 물었다. 손끝이 미세하게 떨리는 것이 보였다.\n` +
    `렌의 시선이 어둠 속으로 향했다. 멀리서 또 한 번, 금이 가는 듯한 소리가 울려 퍼졌다.\n` +
    `${charName}은 렌 쪽으로 몸을 돌리며 한 걸음 물러섰다. "위험할 수도 있어요. 그래도… 같이 가시죠."`;

  const scenarios: Scenario[] = [
    {
      id: "short-empty-meta",
      label: "짧은 턴 · 빈 관계메모",
      userMessage: "…방금 소리, 들었어?",
      assistantMessage: `${charName}은 조용히 고개를 끄덕였다.\n"…같이 가시죠."`,
      prevMeta: { honorifics: [], items: [], thoughts: [], promises: [] },
      flashOutputJson: EMPTY_JSON,
      mainTailJson: EMPTY_JSON,
    },
    {
      id: "typical-mid-meta",
      label: "중간 RP 턴 · 일반 관계메모",
      userMessage: "…방금 소리, 들었어? 무서워.",
      assistantMessage: typicalAssistant,
      prevMeta: {
        honorifics: [`${charName}→${userName}: 하율`, `${userName}→${charName}: 하율아`],
        items: [`${charName}: 손전등, 우산`, `${userName}: 이어폰`],
        thoughts: [`${charName}: 왜 이렇게 떨리지`],
        promises: [{ text: "다음 주말에 같이 산책하기" }],
      },
      flashOutputJson: JSON.stringify({
        honorifics: [],
        items: [],
        thoughts: [`${charName}: 숨기면 안 되는데`],
        promisesAdd: [],
        promisesRemove: [],
      }),
      mainTailJson: JSON.stringify({
        honorifics: [],
        items: [],
        thoughts: [`${charName}: 숨기면 안 되는데`],
        promisesAdd: [],
        promisesRemove: [],
      }),
    },
    {
      id: "rich-promise-turn",
      label: "약속·호칭 변화 턴 · 활성 약속 5개",
      userMessage: "다음 주말 약속, 그때까지는 무사히 지내자. 약속해.",
      assistantMessage:
        typicalAssistant +
        `\n"${userName}." 그가 잠시 멈추더니, "…약속할게요. 무사히."`,
      prevMeta: {
        honorifics: Array.from({ length: 8 }, (_, i) => `NPC${i}→${charName}: 형`),
        items: Array.from({ length: 12 }, (_, i) => `NPC${i}: 물건${i}, 지도`),
        thoughts: Array.from({ length: MEMORY_META_MAX.thoughts }, (_, i) =>
          `${charName}: 속마음 샘플 ${i}`
        ),
        promises: [
          { text: "다음 주말에 같이 산책하기" },
          { text: "위험한 곳은 같이 가기", deadline: "이번 달" },
          { text: "비밀 유지하기" },
          { text: "매일 연락하기" },
          { text: "밤산책은 10시 전에 끝내기", deadline: "매일" },
        ],
      },
      flashOutputJson: JSON.stringify({
        honorifics: [`${charName}→${userName}: ${userName}`],
        items: [`${charName}: 손전등, 우산, 나이트`],
        thoughts: [`${charName}: 반드시 지켜야 해`],
        promisesAdd: [{ text: "다음 주말까지 무사히 지내기", deadline: "다음 주말" }],
        promisesRemove: ["매일 연락하기"],
      }),
      mainTailJson: JSON.stringify({
        honorifics: [`${charName}→${userName}: ${userName}`],
        items: [`${charName}: 손전등, 우산, 나이트`],
        thoughts: [`${charName}: 반드시 지켜야 해`],
        promisesAdd: [{ text: "다음 주말까지 무사히 지내기", deadline: "다음 주말" }],
        promisesRemove: ["매일 연락하기"],
      }),
    },
    {
      id: "max-output-delta",
      label: "이론상 최대 delta (스키마 한도)",
      userMessage: "x".repeat(400),
      assistantMessage: "y".repeat(2800),
      prevMeta: {
        honorifics: [],
        items: [],
        thoughts: [],
        promises: Array.from({ length: MEMORY_META_MAX.promises }, (_, i) => ({
          text: `활성 약속 항목 ${i} — 상세 설명 포함`,
          deadline: "기한",
        })),
      },
      flashOutputJson: JSON.stringify({
        honorifics: Array.from({ length: 5 }, () => `${charName}→${userName}: 호칭`),
        items: Array.from({ length: 5 }, () => `${charName}: 물건1, 물건2, 물건3`),
        thoughts: Array.from({ length: 3 }, () => `${charName}: 속마음 한 줄`),
        promisesAdd: [{ text: "새 약속", deadline: "내일" }],
        promisesRemove: ["활성 약속 항목 0 — 상세 설명 포함"],
      }),
      mainTailJson: JSON.stringify({
        honorifics: Array.from({ length: 5 }, () => `${charName}→${userName}: 호칭`),
        items: Array.from({ length: 5 }, () => `${charName}: 물건1, 물건2, 물건3`),
        thoughts: Array.from({ length: 3 }, () => `${charName}: 속마음 한 줄`),
        promisesAdd: [{ text: "새 약속", deadline: "내일" }],
        promisesRemove: ["활성 약속 항목 0 — 상세 설명 포함"],
      }),
    },
  ];

  const flashModel = BACKGROUND_OPENROUTER_MODEL;
  const krwPerUsd = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;

  function usdToKrw(usd: number): number {
    return convertUsdToKrw(usd, krwPerUsd);
  }

  function flashTurnCost(inputTokens: number, outputTokens: number): number {
    return usdToKrw(
      openRouterUsdCostFromRates({
        promptTokens: inputTokens,
        outputTokens,
        modelId: flashModel,
      }).usdCost
    );
  }

  function mainModelOutputDeltaKrw(modelId: string, extraOutputTokens: number): number {
    return usdToKrw(
      openRouterUsdCostFromRates({
        promptTokens: 0,
        outputTokens: extraOutputTokens,
        modelId,
      }).usdCost
    );
  }

  const measured = scenarios.map((s) => {
    const system = buildRelationshipExtractSystem(
      charName,
      userName,
      s.prevMeta,
      RELATIONSHIP_THOUGHT_EXTRACT_RULES
    );
    const userBlock = buildExtractUserBlock(
      userName,
      charName,
      s.userMessage,
      s.assistantMessage
    );
    const inputText = `${system}\n${userBlock}`;
    const inputTokens = estimateTokens(inputText);
    const flashOutTokens = estimateTokens(s.flashOutputJson);
    const mainTailTokens = estimateTokens(s.mainTailJson);
    const flashCostKrw = flashTurnCost(inputTokens, flashOutTokens);

    return {
      id: s.id,
      label: s.label,
      systemChars: system.length,
      userBlockChars: userBlock.length,
      inputTokens,
      flashOutputChars: s.flashOutputJson.length,
      flashOutputTokens: flashOutTokens,
      mainTailOutputChars: s.mainTailJson.length,
      mainTailOutputTokens: mainTailTokens,
      flashCostKrwPerTurn: Math.round(flashCostKrw * 10000) / 10000,
    };
  });

  const typical = measured.find((m) => m.id === "typical-mid-meta")!;
  const avgInput =
    measured.reduce((a, m) => a + m.inputTokens, 0) / measured.length;
  const avgFlashOut =
    measured.reduce((a, m) => a + m.flashOutputTokens, 0) / measured.length;
  const avgMainTailOut =
    measured.reduce((a, m) => a + m.mainTailOutputTokens, 0) / measured.length;
  const avgFlashCost =
    measured.reduce((a, m) => a + m.flashCostKrwPerTurn, 0) / measured.length;

  const mainModels = [
    { id: OPENROUTER_GEMINI_25_PRO_MODEL, label: "Gemini 2.5 Pro" },
    { id: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, label: "DeepSeek V4 Pro" },
    { id: OPENROUTER_QWEN_37_MAX_MODEL, label: "Qwen 3.7 Max" },
  ];

  const comparison = mainModels.map(({ id, label }) => {
    const typicalMainDelta = mainModelOutputDeltaKrw(id, typical.mainTailOutputTokens);
    const avgMainDelta = mainModelOutputDeltaKrw(id, avgMainTailOut);
    return {
      modelId: id,
      label,
      typicalMainTailOutputTokens: typical.mainTailOutputTokens,
      typicalOutputCostDeltaKrw: Math.round(typicalMainDelta * 10000) / 10000,
      avgMainTailOutputTokens: Math.round(avgMainTailOut),
      avgOutputCostDeltaKrw: Math.round(avgMainDelta * 10000) / 10000,
      vsTypicalFlashCostKrw: typical.flashCostKrwPerTurn,
      cheaper: typicalMainDelta < typical.flashCostKrwPerTurn ? "main-json-tail" : "flash-extract",
      ratioTypical: typical.flashCostKrwPerTurn / (typicalMainDelta || 1),
    };
  });

  const dailyTurns = 10000;
  const dailyFlashKrw = typical.flashCostKrwPerTurn * dailyTurns;
  const dailyMainDelta = comparison.map((c) => ({
    label: c.label,
    krw: Math.round(c.typicalOutputCostDeltaKrw * dailyTurns),
  }));

  const report = {
    callFrequency: {
      relationshipMetaExtract: "every successful chat turn (1×)",
      path: "route.ts → scheduleMemoryUpdate → mergeRelationshipMetaFromTurn → extractRelationshipMetaFromTurn → callBackgroundMemory",
      gates: [
        "MEMORY_FEATURE_ENABLED must not be 0/false/no/off",
        "not gemini isolation mode",
        "runs in post-stream async IIFE after successful save",
      ],
      notSameAsRollingSummary: `rolling summary is every ${ROLLING_SUMMARY_INTERVAL} turns (separate Flash job)`,
      regeneratePath: "extractRelationshipMetaAfterRegenerate (larger prompt, same frequency per regen)",
    },
    flashModel,
    pricingNote:
      "Flash uses resolveOpenRouterModelRates — gemini-2.5-flash falls to GENERIC $0.4/M in/out unless upstream_cost reported",
    scenarios: measured,
    averages: {
      inputTokens: Math.round(avgInput),
      flashOutputTokens: Math.round(avgFlashOut),
      mainTailOutputTokens: Math.round(avgMainTailOut),
      flashCostKrwPerTurn: Math.round(avgFlashCost * 10000) / 10000,
    },
    typicalMidMeta: typical,
    mainModelJsonTailComparison: comparison,
    daily10000Turns: {
      flashExtractKrw: Math.round(dailyFlashKrw),
      mainModelOutputDeltaKrw: dailyMainDelta,
    },
    recommendation:
      comparison.every((c) => c.cheaper === "flash-extract")
        ? "Flash background extract cheaper than main-model JSON tail for all sampled main models"
        : "mixed",
  };

  console.log("=== Relationship Memory Flash Extract Cost Audit ===\n");
  console.log("1. Call frequency:");
  console.log(`   관계메모 추출: 성공 턴마다 1회 (매턴)`);
  console.log(`   롤링 요약(장기기억): ${ROLLING_SUMMARY_INTERVAL}턴마다 별도 (본 감사 제외)`);
  console.log(`   Flash model: ${flashModel}`);
  console.log(`   requestKind: background-memory-extract, maxOutput: 2048\n`);

  console.log("2–3. Per-scenario input/output tokens:");
  for (const m of measured) {
    console.log(
      `   [${m.id}] in ${m.inputTokens} · flash out ${m.flashOutputTokens} · main tail out ${m.mainTailOutputTokens} · flash ${m.flashCostKrwPerTurn.toFixed(4)} KRW`
    );
  }
  console.log(
    `\n   Averages: in ${report.averages.inputTokens} · flash out ${report.averages.flashOutputTokens} · main tail out ${report.averages.mainTailOutputTokens}`
  );
  console.log(
    `   Typical mid-meta: in ${typical.inputTokens} · flash out ${typical.flashOutputTokens} · flash ${typical.flashCostKrwPerTurn.toFixed(4)} KRW/turn\n`
  );

  console.log("4. Daily 10,000 turns (typical-mid-meta Flash cost):");
  console.log(`   Flash extract: ~${report.daily10000Turns.flashExtractKrw.toLocaleString()} KRW/day`);
  for (const d of report.daily10000Turns.mainModelOutputDeltaKrw) {
    console.log(`   Main JSON tail delta (${d.label}): ~${d.krw.toLocaleString()} KRW/day extra output`);
  }

  console.log("\n5–6. Main model JSON tail vs Flash (typical turn):");
  for (const c of comparison) {
    console.log(
      `   ${c.label}: main +${c.typicalMainTailOutputTokens} out tok → +${c.typicalOutputCostDeltaKrw.toFixed(4)} KRW vs Flash ${c.vsTypicalFlashCostKrw.toFixed(4)} KRW (${c.cheaper === "flash-extract" ? "Flash cheaper" : "main cheaper"}, ×${c.ratioTypical.toFixed(1)})`
    );
  }

  const fs = await import("fs");
  const path = await import("path");
  const outPath = path.join(process.cwd(), "tmp", "relationship-memory-extract-audit.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nFull JSON: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
