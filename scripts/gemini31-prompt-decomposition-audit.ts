/**
 * Read-only prompt token decomposition — Phase 2 vs Phase 3-A vs Phase 3-A.1.
 * Uses frozen 18-turn RP fixture texts; no provider call.
 */
import fs from "node:fs";
import path from "node:path";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { HISTORY_TOKEN_BUDGET } from "../src/lib/contextTrack";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveProviderRawPoolExchangeCount,
  resolveProviderRawTrimFloorExchanges,
  splitOpeningPlayableTurns,
} from "../src/lib/hybridMemory";
import { trimProviderHistoryToBudget } from "../src/lib/providerHistoryPolicy";
import { estimateTokens } from "../src/lib/tokenEstimate";
import { buildContext } from "../src/services/contextBuilder";
import type { ChatMsg } from "../src/lib/ai";

const MEASURE_USER =
  "일단 네 옆에서 걸어갈게. 갑자기 멈추면 말해.";

const USER_TURNS = [
  "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
  "같이 갈래? *두리번*",
  "어디로 가? 안내해줘.",
  "*따라가며* 여기 처음이야.",
  "그 초커... 왜 차고 있어?",
  "귀 괜찮아? 방금 또 찡그린 것 같은데.",
  "잠깐 여기 서서 숨 좀 고를까.",
  "너는 여기서 오래 일했어?",
  "...나, 여기 오기 전에 뭐 하고 있었는지 전혀 기억이 안 나.",
  "일단 네 말대로 가볼게. 옆에 있어줄래?",
  "저쪽 복도 맞아? *걸음을 맞추며*",
  "사람들이 너 보면 슬쩍 피하던데. 왜 그래?",
  "이명, 지금은 좀 어때.",
  "목적지부터 말해줘. 어디까지 가는 거야.",
  "*초커를 흘깃* 저거 아프진 않아?",
  "렌인 건 알겠는데, 그 다음이 비어 있어.",
  "잠깐. 발소리 많아. 여기 서 있을까.",
  "너 혼자 이렇게 다녀도 괜찮아?",
] as const;

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

const JO_WORLD = `에이지스 컨트롤 본부. 센티넬/가이드. 중앙 로비, 지원국, 동기화 챔버, 환풍구, 지하 완충 덱.`;

const MOCK_SUMMARY =
  "짧지만 중요한 사건 하나만 기록함. 이후 전개에 영향을 주는 약속과 관계 변화만 남김. " +
  "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심만 유지.";

function loadAssistantRaw(turn: number): string {
  const p = path.join(
    process.cwd(),
    `docs/audits/gemini-37-flash-pricing/t${turn}-raw.txt`
  );
  return fs.readFileSync(p, "utf8").trim();
}

function buildFixtureTurns() {
  const rows: { role: "user" | "assistant"; content: string; model?: string }[] = [
    { role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL, model: "greeting" },
  ];
  for (let i = 0; i < USER_TURNS.length; i++) {
    rows.push({ role: "user", content: USER_TURNS[i]! });
    rows.push({ role: "assistant", content: loadAssistantRaw(i + 1) });
  }
  return messagesToTurns(rows);
}

function sealSummaryText(batchCount: 0 | 2 | 3): string {
  if (batchCount === 0) return "";
  const batches = batchCount >= 1 ? [MOCK_SUMMARY] : [];
  if (batchCount >= 2) batches.push(MOCK_SUMMARY);
  if (batchCount >= 3) batches.push(MOCK_SUMMARY);
  return batches.join("\n\n");
}

function summarizedThrough(batchCount: 0 | 2 | 3): number {
  if (batchCount === 0) return 0;
  if (batchCount === 2) return 10;
  return 15;
}

type Scenario = {
  id: string;
  label: string;
  summarizedTurnCount: number;
  trimFloor: number;
  summaryBatches: 0 | 2 | 3;
};

const SCENARIOS: Scenario[] = [
  {
    id: "phase2_steady",
    label: "Phase 2 steady (barrier sealed through 15)",
    summarizedTurnCount: 15,
    trimFloor: 4,
    summaryBatches: 3,
  },
  {
    id: "phase3a_cold_broken",
    label: "Phase 3-A cold backlog (broken trim floor = unsummarized)",
    summarizedTurnCount: 0,
    trimFloor: 18,
    summaryBatches: 0,
  },
  {
    id: "phase3a1_cold_fixed",
    label: "Phase 3-A.1 cold backlog (bounded trim floor RAW4)",
    summarizedTurnCount: 0,
    trimFloor: 4,
    summaryBatches: 0,
  },
  {
    id: "phase3a1_steady",
    label: "Phase 3-A.1 steady (summaries through 15)",
    summarizedTurnCount: 15,
    trimFloor: 4,
    summaryBatches: 3,
  },
  {
    id: "phase3a1_one_batch",
    label: "Phase 3-A.1 one-batch-behind (summarized through 10)",
    summarizedTurnCount: 10,
    trimFloor: 4,
    summaryBatches: 2,
  },
];

function historyTokens(history: ChatMsg[]): number {
  return history.reduce((n, m) => n + estimateTokens(m.content), 0);
}

function analyzeScenario(scenario: Scenario) {
  const allTurns = buildFixtureTurns();
  const completedTurns = USER_TURNS.length;
  const pool = resolveProviderRawPoolExchangeCount({
    memoryFeatureEnabled: true,
    completedTurns,
    summarizedTurnCount: scenario.summarizedTurnCount,
  });
  const rawFull = rawRecentTurnsToHistory(allTurns, pool, {
    memoryFeatureEnabled: true,
    summarizedTurnCount: scenario.summarizedTurnCount,
  });
  const trimmed = trimProviderHistoryToBudget(rawFull, HISTORY_TOKEN_BUDGET, {
    minRealPlayableExchanges: scenario.trimFloor,
    protectOpening: false,
  });

  const ltm = sealSummaryText(scenario.summaryBatches);
  const built = buildContext({
    charName: "조태형",
    characterCard: JO_TAEHYUNG_CARD,
    worldLore: JO_WORLD,
    exampleDialog: "유저: …무서워.\n조태형: …괜찮아.",
    chunks: [],
    userNickname: "렌",
    shortTermHistory: trimmed,
    currentUserMessage: MEASURE_USER,
    nsfw: true,
    provider: "cheaperinference",
    modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    completedTurns,
    completedTurnsForMemoryCoverage: completedTurns,
    summarizedTurnCount: scenario.summarizedTurnCount,
    longTermMemory: ltm,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    historyMinTurnFloor: scenario.trimFloor,
    providerHistoryMinRealPlayableExchanges: scenario.trimFloor,
    providerHistoryAbsoluteTurnFloor: scenario.trimFloor,
    providerHistoryProtectOpening: false,
    suppressMemoryCoverageDegradedLog: true,
  });

  const audit = built.meta.promptAudit!;

  const rawFullTokens = historyTokens(rawFull);
  const rawTrimmedTokens = historyTokens(trimmed);
  const unsummarizedExtra =
    scenario.summarizedTurnCount === 0
      ? rawTrimmedTokens
      : Math.max(0, rawTrimmedTokens - historyTokens(
          trimProviderHistoryToBudget(
            rawRecentTurnsToHistory(allTurns, 4, {
              memoryFeatureEnabled: true,
              summarizedTurnCount: scenario.summarizedTurnCount,
            }),
            HISTORY_TOKEN_BUDGET,
            { minRealPlayableExchanges: 4, protectOpening: false }
          )
        ));

  return {
    scenario: scenario.id,
    label: scenario.label,
    pool_exchanges: pool,
    trim_floor_exchanges: scenario.trimFloor,
    playable_pairs_injected: trimmed.length / 2,
    sections: {
      TOTAL_PROMPT_TOKENS: audit.totalAssembledTokens,
      SYSTEM_STATIC_TOKENS: audit.breakdown.systemRules,
      CHARACTER_WORLD_TOKENS:
        audit.breakdown.characterSetting + audit.breakdown.worldLore,
      MEMORY_SUMMARY_TOKENS: audit.breakdown.memory,
      EPISODIC_MEMORY_TOKENS: 0,
      RAW_HISTORY_TOKENS: audit.breakdown.recentConversation,
      UNSUMMARIZED_RAW_EXTRA_TOKENS: unsummarizedExtra,
      CURRENT_USER_TOKENS: audit.currentUserTurnTokens,
      OTHER_DYNAMIC_TOKENS:
        audit.breakdown.persona +
        audit.breakdown.userNote +
        audit.breakdown.dialogueExamples,
    },
    provider_estimated_input: built.meta.estimatedInputTokens,
    raw_pool_tokens: rawFullTokens,
    raw_injected_tokens: rawTrimmedTokens,
    history_token_budget: HISTORY_TOKEN_BUDGET,
  };
}

function main() {
  const results = SCENARIOS.map(analyzeScenario);
  const phase2 = results.find((r) => r.scenario === "phase2_steady")!;
  const phase3a = results.find((r) => r.scenario === "phase3a_cold_broken")!;
  const phase3a1Cold = results.find((r) => r.scenario === "phase3a1_cold_fixed")!;
  const phase3a1Steady = results.find((r) => r.scenario === "phase3a1_steady")!;

  const e2ePhase2 = 22955;
  const e2ePhase3a = 66793;
  const rawExpansionDelta =
    phase3a.sections.RAW_HISTORY_TOKENS - phase2.sections.RAW_HISTORY_TOKENS;
  const otherDelta =
    e2ePhase3a - e2ePhase2 - rawExpansionDelta;
  const promptDeltaTotal = e2ePhase3a - e2ePhase2;

  const report = {
    generatedAt: new Date().toISOString(),
    methodology:
      "Frozen 18-turn fixture + buildContext/auditAssembledPrompt; E2E provider counts for Phase 2/3-A baseline",
    e2e_baselines: { phase2_prompt_tokens: e2ePhase2, phase3a_prompt_tokens: e2ePhase3a },
    scenarios: results,
    delta_analysis: {
      PROMPT_DELTA_TOTAL: promptDeltaTotal,
      RAW_EXPANSION_DELTA: rawExpansionDelta,
      OTHER_DELTA: otherDelta,
      RAW_EXPANSION_SHARE_OF_DELTA:
        promptDeltaTotal > 0 ? rawExpansionDelta / promptDeltaTotal : 0,
      root_cause:
        "Phase 3-A set minRealPlayableExchanges=unsummarized (18), bypassing HISTORY_TOKEN_BUDGET (10k) trim",
    },
    cold_vs_steady: {
      COLD_PROMPT_TOKENS: phase3a1Cold.sections.TOTAL_PROMPT_TOKENS,
      STEADY_PROMPT_TOKENS: phase3a1Steady.sections.TOTAL_PROMPT_TOKENS,
      phase3a1_cold_vs_phase2_e2e_delta:
        phase3a1Cold.sections.TOTAL_PROMPT_TOKENS - e2ePhase2,
    },
    budget_owners: {
      RAW_HISTORY_TOKEN_OWNER: "trimProviderHistoryToBudget (providerHistoryPolicy.ts)",
      HISTORY_TOKEN_BUDGET: HISTORY_TOKEN_BUDGET,
      PROVIDER_INJECTION_BUDGET_OWNER:
        "resolveProviderRawPoolExchangeCount (candidate pool) + trimProviderHistoryToBudget with resolveProviderRawTrimFloorExchanges() floor (RAW4)",
      SOURCE_RETENTION_OWNER: "messages table + chat_turn_summaries (DB, lossless)",
    },
    impossible_triangle: {
      cannot_simultaneously: [
        "never await summary LLM",
        "always bounded provider prompt",
        "always inject 100% unsummarized raw when backlog is large",
      ],
      policy:
        "Durable source preserved in DB; model injection bounded by HISTORY_TOKEN_BUDGET + RAW4 floor; background catch-up reduces backlog",
    },
  };

  const outDir = "/opt/cursor/artifacts/gemini31-e2e-phase2-audit";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prompt-decomposition.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("\nWrote", outPath);
}

main();
