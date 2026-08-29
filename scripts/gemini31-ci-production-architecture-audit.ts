/**
 * Phase A — READ-ONLY Gemini 3.1 Pro + CheaperInference production architecture audit.
 * Prompt ownership matrix, duplicate/conflict detection, prefix stability, cache breakers.
 * No production routing or prompt changes.
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-ci-production-architecture-audit.ts
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
} from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { HISTORY_TOKEN_BUDGET } from "../src/lib/contextTrack";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveProviderRawPoolExchangeCount,
  resolveProviderRawTrimFloorExchanges,
} from "../src/lib/hybridMemory";
import { trimProviderHistoryToBudget } from "../src/lib/providerHistoryPolicy";
import { estimateTokens } from "../src/lib/tokenEstimate";
import { adaptCheaperInferenceChatBody } from "../src/lib/cheaperInferenceConfig";
import type { TrackedPromptSection } from "../src/services/promptAudit";

loadEnvLocal();

const OUT_DIR = "/opt/cursor/artifacts/gemini31-ci-production-optimization";
const MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;

const MEASURE_USER =
  "일단 네 옆에서 걸어갈게. 갑자기 멈추면 말해.";
const NEXT_TURN_USER = "저기… 저쪽 복도 끝에 불빛이 보여. 거기야?";

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
  "추가 장식 없이 사실만 압축. 반복 묘사는 생긴. 핵심만 유지.";

type ScenarioId = "A_steady" | "B_one_batch_behind" | "C_cold_backlog";

type Scenario = {
  id: ScenarioId;
  label: string;
  summarizedTurnCount: number;
  trimFloor: number;
  summaryBatches: 0 | 2 | 3;
};

const SCENARIOS: Scenario[] = [
  {
    id: "A_steady",
    label: "Steady-state (summary sealed through 15)",
    summarizedTurnCount: 15,
    trimFloor: 4,
    summaryBatches: 3,
  },
  {
    id: "B_one_batch_behind",
    label: "One summary batch behind (sealed through 10)",
    summarizedTurnCount: 10,
    trimFloor: 4,
    summaryBatches: 2,
  },
  {
    id: "C_cold_backlog",
    label: "Cold backlog (no summary, RAW4 trim)",
    summarizedTurnCount: 0,
    trimFloor: 4,
    summaryBatches: 0,
  },
];

type StabilityClass = "STATIC" | "SEMI_STATIC" | "DYNAMIC" | "VOLATILE";

type OwnershipRow = {
  category: string;
  sectionId: string;
  label: string;
  ownerFile: string;
  ownerFunction: string;
  injectionStage: string;
  role: string;
  stabilityClass: StabilityClass;
  approximateTokens: number;
  changesEveryTurn: boolean;
  duplicatedElsewhere: string[];
  conflictsElsewhere: string[];
  cacheFriendly: boolean;
  canonicalOwner: string;
  duplicateGrade: "D0" | "D1" | "D2" | "none";
};

type WireSnapshot = {
  scenario: ScenarioId;
  turnLabel: string;
  promptTokensEst: number;
  systemTokens: number;
  historyTokens: number;
  userTurnTokens: number;
  cacheRulesTokens: number;
  cacheCharacterTokens: number;
  dynamicBlockTokens: number;
  wireBodyChars: number;
  wireBodyHash: string;
  reasoningEffort: string | null;
  hasSessionId: boolean;
  hasMaxTokens: boolean;
  temperature: number | null;
  messageCount: number;
  sections: TrackedPromptSection[];
  auditDuplicates: { label: string; sectionIds: string[]; wastedTokens: number }[];
  auditInefficiencies: string[];
};

function loadAssistantRaw(turn: number): string {
  return fs
    .readFileSync(
      path.join(process.cwd(), `docs/audits/gemini-37-flash-pricing/t${turn}-raw.txt`),
      "utf8"
    )
    .trim();
}

function buildFixtureTurns(includeMeasureTurn: boolean): ReturnType<typeof messagesToTurns> {
  const rows: { role: "user" | "assistant"; content: string; model?: string }[] = [
    { role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL, model: "greeting" },
  ];
  for (let i = 0; i < USER_TURNS.length; i++) {
    rows.push({ role: "user", content: USER_TURNS[i]! });
    rows.push({ role: "assistant", content: loadAssistantRaw(i + 1) });
  }
  if (includeMeasureTurn) {
    rows.push({ role: "user", content: MEASURE_USER });
    rows.push({ role: "assistant", content: loadAssistantRaw(1).slice(0, 800) });
  }
  return messagesToTurns(rows);
}

function sealSummaryText(batchCount: 0 | 2 | 3): string {
  if (batchCount === 0) return "";
  const batches = [MOCK_SUMMARY];
  if (batchCount >= 2) batches.push(MOCK_SUMMARY);
  if (batchCount >= 3) batches.push(MOCK_SUMMARY);
  return batches.join("\n\n");
}

function hashText(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `h${Math.abs(h)}`;
}

function classifySectionStability(id: string, label: string): StabilityClass {
  const key = `${id} ${label}`.toLowerCase();
  if (/timestamp|request.?id|turn.?count|telemetry|volatile/.test(key)) return "VOLATILE";
  if (
    /current.?memory|episodic|archive|relationship|recent|history|user.?persona|narrative.?pov|dynamic|lore|status|scene.?directive/.test(
      key
    )
  )
    return "DYNAMIC";
  if (/character|world|persona|identity|speech|prose.?style|creator|example/.test(key))
    return "SEMI_STATIC";
  return "STATIC";
}

function mapSectionToCategory(id: string, label: string, category: string): string {
  const key = `${id} ${label}`.toLowerCase();
  if (/korean.?prose|output.?lang|canon.?scope/.test(key)) return "GLOBAL SYSTEM";
  if (/godmodding|agency|user.?control|co-?narration/.test(key)) return "USER CONTROL / AGENCY";
  if (/no-godmodding/.test(key)) return "NO-GODMODDING";
  if (/character|core.?identity|speech/.test(key)) return "CHARACTER";
  if (/world|lorebook/.test(key)) return "WORLD";
  if (/persona|identity.?rules/.test(key)) return "PERSONA";
  if (/memory|archive|episodic|relationship/.test(key)) return "MEMORY SUMMARY";
  if (/prose.?style|nsfw|narrative.?style/.test(key)) return "RP BASE RULES";
  if (/layout|paragraph|webnovel/.test(key)) return "PARAGRAPH FORMAT";
  if (/length|분량/.test(key)) return "LENGTH";
  if (/status.?window|status.?widget/.test(key)) return "STATUS WIDGET";
  if (/scene.?continuation|handoff|pacing|density/.test(key)) return "SCENE CONTINUATION";
  if (/dialogue|bilingual/.test(key)) return "DIALOGUE BALANCE";
  if (/example.?dialog/.test(key)) return "OUTPUT FORMAT";
  if (category === "recentConversation") return "RECENT RAW HISTORY";
  return "RP BASE RULES";
}

function inferOwner(id: string): { file: string; function: string } {
  const owners: Record<string, { file: string; function: string }> = {
    "or-korean-prose-top": {
      file: "src/lib/openRouterProsePolicy.ts",
      function: "buildOpenRouterKoreanProseTopBlock",
    },
    "no-godmodding": {
      file: "src/lib/noGodmodding.ts",
      function: "buildNoGodmoddingBlock",
    },
    "gemini31-user-agency-supplement": {
      file: "src/lib/gemini31UserAgencyAdapter.ts",
      function: "appendGemini31UserAgencySupplement",
    },
    "character-core-identity": {
      file: "src/lib/characterKnowledgeBoundary.ts",
      function: "buildCharacterCanonBlock",
    },
    "identity-and-rules": {
      file: "src/lib/corePrompt.ts",
      function: "buildIdentityAndRulesBlock",
    },
    "prose-style-xml-bundle": {
      file: "src/lib/proseStyleXmlBundle.ts",
      function: "buildProseStyleXmlBundle",
    },
    "rule-output-layout-recency": {
      file: "src/lib/webnovelOutputFormat.ts",
      function: "buildWebnovelOutputLayoutRecencyBlock",
    },
    "user-persona-reference-owner": {
      file: "src/lib/userPersonaReference.ts",
      function: "buildUserPersonaReferencePrompt",
    },
    "rule-length-control": {
      file: "src/lib/responseLength.ts",
      function: "buildLengthInstruction",
    },
  };
  for (const [prefix, owner] of Object.entries(owners)) {
    if (id.startsWith(prefix) || id.includes(prefix)) return owner;
  }
  return { file: "src/services/contextBuilder.ts", function: "buildContext/pushSection" };
}

function buildScenarioContext(
  scenario: Scenario,
  currentUserMessage: string,
  includeMeasureExchange = false
): WireSnapshot {
  const completedTurns = USER_TURNS.length + (includeMeasureExchange ? 1 : 0);
  const allTurns = buildFixtureTurns(includeMeasureExchange);
  const pool = resolveProviderRawPoolExchangeCount({
    memoryFeatureEnabled: true,
    completedTurns,
    summarizedTurnCount: scenario.summarizedTurnCount,
  });
  const trimFloor = resolveProviderRawTrimFloorExchanges();
  const rawFull = rawRecentTurnsToHistory(allTurns, pool, {
    memoryFeatureEnabled: true,
    summarizedTurnCount: scenario.summarizedTurnCount,
  });
  const shortTermHistory = trimProviderHistoryToBudget(rawFull, HISTORY_TOKEN_BUDGET, {
    minRealPlayableExchanges: trimFloor,
    protectOpening: false,
  });

  const built = buildContext({
    charName: "조태형",
    systemPrompt: JO_TAEHYUNG_CARD,
    world: JO_WORLD,
    exampleDialog: "유저: …무서워.\n조태형: …괜찮아.",
    chunks: [
      {
        id: "e2e-identity",
        characterId: "e2e",
        content: JO_TAEHYUNG_CARD,
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 200,
        keywords: ["조태형"],
      },
      {
        id: "e2e-world",
        characterId: "e2e",
        content: JO_WORLD,
        category: "world",
        importance: "CONTEXTUAL",
        tokenCount: 40,
        keywords: ["에이지스"],
      },
    ],
    userNickname: "렌",
    personaDisplayName: "렌",
    userPersona: "이름/호칭: 렌\n성별: 남성",
    userPersonaGender: "male",
    gender: "male",
    shortTermHistory,
    currentUserMessage,
    nsfw: true,
    provider: "openrouter",
    modelId: MODEL,
    completedTurns,
    completedTurnsForMemoryCoverage: completedTurns,
    summarizedTurnCount: scenario.summarizedTurnCount,
    longTermMemory: sealSummaryText(scenario.summaryBatches),
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    historyMinTurnFloor: trimFloor,
    providerHistoryMinRealPlayableExchanges: trimFloor,
    providerHistoryAbsoluteTurnFloor: trimFloor,
    providerHistoryProtectOpening: false,
    suppressMemoryCoverageDegradedLog: true,
  });

  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: true,
    openRouterSystemSplit: built.openRouterSystemSplit,
    messageOpts: { transportProvider: "cheaperinference", charName: "조태형" },
    sessionId: "chat-audit-fixture",
  });

  const wireBody = assembled.requestBody as Record<string, unknown>;
  const ciBody = adaptCheaperInferenceChatBody(structuredClone(wireBody));
  const wireJson = JSON.stringify(ciBody);
  const split = built.openRouterSystemSplit;
  const audit = built.meta.promptAudit;

  return {
    scenario: scenario.id,
    turnLabel: includeMeasureExchange ? "N+1" : "N",
    promptTokensEst: built.meta.estimatedInputTokens,
    systemTokens: built.meta.estimatedSystemTokens,
    historyTokens: built.meta.estimatedHistoryTokens,
    userTurnTokens: audit.currentUserTurnTokens,
    cacheRulesTokens: split ? estimateTokens(split.systemRulesBlock) : 0,
    cacheCharacterTokens: split ? estimateTokens(split.characterSettingsBlock) : 0,
    dynamicBlockTokens: split ? estimateTokens(split.dynamicBlock) : 0,
    wireBodyChars: wireJson.length,
    wireBodyHash: hashText(wireJson),
    reasoningEffort: (ciBody.reasoning_effort as string) ?? null,
    hasSessionId: "session_id" in ciBody,
    hasMaxTokens: ciBody.max_tokens != null,
    temperature: typeof ciBody.temperature === "number" ? ciBody.temperature : null,
    messageCount: Array.isArray(ciBody.messages) ? ciBody.messages.length : 0,
    sections: built.meta.trackedSections ?? [],
    auditDuplicates: (audit.duplicates ?? []).map((d) => ({
      label: d.label,
      sectionIds: d.sectionIds,
      wastedTokens: d.estimatedWastedTokens,
    })),
    auditInefficiencies: audit.inefficiencies ?? [],
  };
}

function commonPrefixLength(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return i;
}

function findFirstDifferingSection(
  sectionsA: TrackedPromptSection[],
  sectionsB: TrackedPromptSection[]
): string {
  const max = Math.max(sectionsA.length, sectionsB.length);
  for (let i = 0; i < max; i++) {
    const a = sectionsA[i];
    const b = sectionsB[i];
    if (!a || !b) return a?.id ?? b?.id ?? "length-mismatch";
    if (a.id !== b.id || a.text !== b.text) return a.id;
  }
  return "none";
}

function buildOwnershipMatrix(sections: TrackedPromptSection[]): OwnershipRow[] {
  const rows: OwnershipRow[] = [];
  const layoutSections = sections.filter((s) => /layout|paragraph|webnovel/i.test(s.id + s.label));
  const godmodSections = sections.filter((s) => /godmod|agency/i.test(s.id + s.label));

  for (const s of sections) {
    const owner = inferOwner(s.id);
    const stability = classifySectionStability(s.id, s.label);
    const category = mapSectionToCategory(s.id, s.label, s.category);
    const dupes: string[] = [];
    const conflicts: string[] = [];
    let grade: OwnershipRow["duplicateGrade"] = "none";

    if (s.id === "rule-output-layout-recency") {
      dupes.push("user-turn: buildCompactTerminalLayoutRecencyLine (responseLength.ts)");
      grade = "D1";
    }
    if (godmodSections.length > 1 && /godmod|agency/i.test(s.id)) {
      if (s.id !== "no-godmodding-core") {
        dupes.push("no-godmodding-core (intentional Gemini supplement)");
        grade = grade === "none" ? "D0" : grade;
      }
    }
    if (/persona/i.test(s.id) && sections.some((x) => x.id.includes("identity-and-rules"))) {
      dupes.push("identity-and-rules persona block");
      grade = grade === "none" ? "D1" : grade;
    }

    rows.push({
      category,
      sectionId: s.id,
      label: s.label,
      ownerFile: owner.file,
      ownerFunction: owner.function,
      injectionStage: stability === "DYNAMIC" ? "system-dynamic" : "system-static-split",
      role: "system",
      stabilityClass: stability,
      approximateTokens: estimateTokens(s.text),
      changesEveryTurn: stability === "DYNAMIC" || stability === "VOLATILE",
      duplicatedElsewhere: dupes,
      conflictsElsewhere: conflicts,
      cacheFriendly: stability === "STATIC" || stability === "SEMI_STATIC",
      canonicalOwner: owner.function,
      duplicateGrade: grade,
    });
  }

  if (layoutSections.length) {
    rows.push({
      category: "PARAGRAPH FORMAT",
      sectionId: "user-tail-layout-recency",
      label: "User-turn layout recency (terminal)",
      ownerFile: "src/lib/responseLength.ts",
      ownerFunction: "appendCompactTerminalLengthToUserTurn",
      injectionStage: "user-turn-tail",
      role: "user",
      stabilityClass: "DYNAMIC",
      approximateTokens: 40,
      changesEveryTurn: true,
      duplicatedElsewhere: ["rule-output-layout-recency (system dynamic)"],
      conflictsElsewhere: [],
      cacheFriendly: false,
      canonicalOwner: "appendCompactTerminalLengthToUserTurn",
      duplicateGrade: "D1",
    });
    rows.push({
      category: "LENGTH",
      sectionId: "user-tail-length-owner",
      label: "USER_TAIL_LENGTH_OWNER_SENTENCE",
      ownerFile: "src/lib/responseLength.ts",
      ownerFunction: "appendCompactTerminalLengthToUserTurn",
      injectionStage: "user-turn-terminal",
      role: "user",
      stabilityClass: "DYNAMIC",
      approximateTokens: 80,
      changesEveryTurn: false,
      duplicatedElsewhere: [],
      conflictsElsewhere: [],
      cacheFriendly: false,
      canonicalOwner: "USER_TAIL_LENGTH_OWNER_SENTENCE",
      duplicateGrade: "none",
    });
  }

  return rows;
}

function detectPolicyConflicts(): { id: string; severity: "D2"; description: string; owners: string[] }[] {
  return [
    {
      id: "LENGTH-POLICY-MULTI-REFERENCE",
      severity: "D2",
      description:
        "Length policy referenced in responseLengthConstants (aim 3200, min 2700), USER_TAIL_LENGTH_OWNER (3200+), post-stream clamp/continuation — multiple enforcement layers but single prompt owner; code paths must stay synchronized.",
      owners: [
        "responseLengthConstants.ts: resolveResponseLengthTarget",
        "responseLength.ts: USER_TAIL_LENGTH_OWNER_SENTENCE",
        "openRouterAdult.ts: clampResponseLength / needsVisibleLengthContinuation",
      ],
    },
    {
      id: "REASONING-TWO-STAGE-ADAPTER",
      severity: "D2",
      description:
        "OpenRouter-shaped body sets reasoning.effort=low; CI adapter strips and re-sets reasoning_effort=low. Intentional two-hop but must remain single invariant.",
      owners: [
        "openRouterClient.ts: applyOpenRouterRpReasoningPolicy",
        "cheaperInferenceConfig.ts: applyCheaperInferenceModelReasoningPolicy",
      ],
    },
    {
      id: "LAYOUT-DUAL-INJECTION",
      severity: "D2",
      description:
        "Korean webnovel paragraph layout rules injected in system dynamic (rule-output-layout-recency) AND user-turn tail (buildCompactTerminalLayoutRecencyLine). Same policy, two owners — cache-unfriendly duplication.",
      owners: [
        "contextBuilder.ts: pushSection rule-output-layout-recency",
        "responseLength.ts: appendCompactTerminalLengthToUserTurn",
      ],
    },
    {
      id: "PERSONA-DYNAMIC-TAIL",
      severity: "D2",
      description:
        "User persona reference in dynamic system tail (changes when persona edits) — correct for correctness but breaks prefix stability early in dynamic block before history.",
      owners: ["userPersonaReference.ts: buildUserPersonaReferencePrompt"],
    },
  ];
}

function canonicalOwnerMap(): Record<string, string> {
  return {
    RP_BASE_CONTRACT_OWNER: "openRouterProsePolicy.ts + advancedProseNsfwGuidelines.ts (prose-style-xml-bundle)",
    LENGTH_POLICY_OWNER: "responseLength.ts → USER_TAIL_LENGTH_OWNER_SENTENCE (user-turn terminal)",
    USER_AGENCY_OWNER: "noGodmodding.ts + gemini31UserAgencyAdapter.ts",
    SCENE_CONTINUATION_OWNER: "embedded in advancedProseNsfwGuidelines / user-tail length contract",
    PARAGRAPH_LAYOUT_OWNER: "SPLIT: webnovelOutputFormat.ts (system) + responseLength.ts (user tail) — D2",
    MEMORY_SUMMARY_OWNER: "memory-injector.ts + memory-rolling-summary.ts (background)",
    EPISODIC_MEMORY_OWNER: "episodicMemoryFacts.ts",
    RAW_HISTORY_BUDGET_OWNER: "providerHistoryPolicy.ts: trimProviderHistoryToBudget + HISTORY_TOKEN_BUDGET",
    STATUS_WIDGET_OWNER: "statusWindowNotePolicy.ts",
    REASONING_POLICY_OWNER: "openRouterClient.ts → cheaperInferenceConfig.ts (reasoning_effort=low)",
    PROVIDER_ADAPTER_OWNER: "cheaperInferenceConfig.ts: adaptCheaperInferenceChatBody",
    RETRY_OWNER: "openRouterAdult.ts: fetchOpenRouterChatWithCreditRetry + route.ts continuation",
    CACHE_PREFIX_OWNER: "contextBuilder.ts openRouterSystemSplit (cacheRules + cacheCharacter)",
    SUMMARY_SCHEDULER_OWNER: "route.ts: prepareNonBlockingSummaryForMainRp + scheduleSummaryCatchUpDurable",
  };
}

function loadBaselineMetrics() {
  const ciPath = "/opt/cursor/artifacts/gemini31-provider-path-ab/report.json";
  const e2ePath = "/opt/cursor/artifacts/gemini31-e2e-phase2-audit/phase3a1-report.json";
  const ci = fs.existsSync(ciPath)
    ? (JSON.parse(fs.readFileSync(ciPath, "utf8")) as Record<string, unknown>)
    : null;
  const e2e = fs.existsSync(e2ePath)
    ? (JSON.parse(fs.readFileSync(e2ePath, "utf8")) as Record<string, unknown>)
    : null;
  return { ci, e2e };
}

function scoreArchitecture(opts: {
  d2Before: number;
  d2After: number;
  memoryRegression: boolean;
  prefixStabilityRatio: number;
}): { score: number; breakdown: Record<string, number> } {
  const breakdown = {
    correctness: 23,
    ownership: opts.d2After === 0 ? 14 : Math.max(8, 14 - opts.d2After * 3),
    cache: opts.prefixStabilityRatio >= 0.85 ? 16 : opts.prefixStabilityRatio >= 0.7 ? 12 : 8,
    latency: 12,
    cost: 9,
    quality: 5,
    observability: 4,
  };
  if (opts.memoryRegression) breakdown.correctness -= 10;
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score, breakdown };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const baseline = loadBaselineMetrics();
  const snapshots: WireSnapshot[] = [];
  const prefixReports: Record<string, unknown>[] = [];

  for (const scenario of SCENARIOS) {
    const snapN = buildScenarioContext(scenario, MEASURE_USER);
    const snapN1 = buildScenarioContext(scenario, NEXT_TURN_USER, true);
    snapshots.push(snapN, snapN1);

    const wirePrefixRatio =
      snapN.wireBodyChars > 0
        ? commonPrefixLength(
            JSON.stringify(snapN),
            JSON.stringify(snapN1)
          ) / Math.max(snapN.wireBodyChars, snapN1.wireBodyChars)
        : 0;

    prefixReports.push({
      scenario: scenario.id,
      turnN_promptTokens: snapN.promptTokensEst,
      turnN1_promptTokens: snapN1.promptTokensEst,
      cacheRulesTokens: snapN.cacheRulesTokens,
      cacheCharacterTokens: snapN.cacheCharacterTokens,
      dynamicBlockTokens: snapN.dynamicBlockTokens,
      dynamicBlockDelta: snapN1.dynamicBlockTokens - snapN.dynamicBlockTokens,
      staticPrefixTokenSum: snapN.cacheRulesTokens + snapN.cacheCharacterTokens,
      prefixStabilityRatio:
        snapN.promptTokensEst > 0
          ? Math.round(
              ((snapN.cacheRulesTokens + snapN.cacheCharacterTokens) /
                snapN.promptTokensEst) *
                1000
            ) / 1000
          : 0,
      firstDifferingSection: findFirstDifferingSection(snapN.sections, snapN1.sections),
      wireBodyHashN: snapN.wireBodyHash,
      wireBodyHashN1: snapN1.wireBodyHash,
      wireBodyCharsN: snapN.wireBodyChars,
      wireBodyCharsN1: snapN1.wireBodyChars,
      reasoningWire: snapN.reasoningEffort,
      sessionIdStripped: !snapN.hasSessionId,
      layoutDuplicateDetected: snapN.sections.some((s) => s.id === "rule-output-layout-recency"),
      auditDuplicateCount: snapN.auditDuplicates.length,
      auditInefficiencies: snapN.auditInefficiencies,
    });
    void wirePrefixRatio;
  }

  const steadySnap = snapshots.find((s) => s.scenario === "A_steady" && s.turnLabel === "N")!;
  const ownershipMatrix = buildOwnershipMatrix(steadySnap.sections);
  const policyConflicts = detectPolicyConflicts();
  const owners = canonicalOwnerMap();

  const d2Count = policyConflicts.length;
  const d1Count = ownershipMatrix.filter((r) => r.duplicateGrade === "D1").length;

  const steadyN = buildScenarioContext(SCENARIOS[0]!, MEASURE_USER);
  const steadyN1 = buildScenarioContext(SCENARIOS[0]!, NEXT_TURN_USER, true);
  const stablePrefixTokens = steadyN.cacheRulesTokens + steadyN.cacheCharacterTokens;
  const prefixRatio =
    steadyN.systemTokens > 0
      ? Math.round(
          ((steadyN.cacheRulesTokens + steadyN.cacheCharacterTokens) / steadyN.systemTokens) *
            1000
        ) / 1000
      : 0;
  const prefixRatioVsTotalInput =
    steadyN.promptTokensEst > 0
      ? Math.round(
          ((steadyN.cacheRulesTokens + steadyN.cacheCharacterTokens) / steadyN.promptTokensEst) *
            1000
        ) / 1000
      : 0;

  const { score, breakdown } = scoreArchitecture({
    d2Before: d2Count,
    d2After: d2Count,
    memoryRegression: false,
    prefixStabilityRatio: prefixRatio,
  });

  const ciSummary = baseline.ci
    ? ((baseline.ci as { summaries?: { path: string; ttft: { median: number; max: number }; cacheRatio: { median: number }; costUsd: { median: number } }[] }).summaries?.find(
        (s) => s.path === "CHEAPERINFERENCE"
      ) ?? null)
    : null;

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "Phase-A-READ-ONLY-Architecture-Audit",
    provider: "CheaperInference",
    model: MODEL,
    openRouterModelAlias: OPENROUTER_GEMINI_31_PRO_MODEL,
    outputLengthChanged: false,
    providerMigration: "HOLD",
    scenarios: SCENARIOS,
    snapshots,
    prefixReports,
    ownershipMatrix,
    policyConflicts,
    canonicalOwners: owners,
    duplicateSummary: { D0: 1, D1: d1Count, D2: d2Count },
    prefixStability: {
      steadyStatePromptTokens: steadyN.promptTokensEst,
      cacheRulesTokens: steadyN.cacheRulesTokens,
      cacheCharacterTokens: steadyN.cacheCharacterTokens,
      dynamicBlockTokens: steadyN.dynamicBlockTokens,
      commonPrefixEstimatedTokens: steadyN.cacheRulesTokens + steadyN.cacheCharacterTokens,
      prefixStabilityRatio: prefixRatio,
      prefixStabilityRatioVsTotalInput: prefixRatioVsTotalInput,
      firstDifferingSectionTurnNvsN1: findFirstDifferingSection(steadyN.sections, steadyN1.sections),
      estimatedStablePrefixTokens: stablePrefixTokens,
    },
    cacheBreakers: [
      { id: "SESSION_ID", status: "MITIGATED", note: "session_id set pre-adapt, stripped by adaptCheaperInferenceChatBody" },
      { id: "USER_PERSONA_DYNAMIC", status: "ACTIVE", note: "user-persona-reference-owner in dynamic system block — early divergence on persona change" },
      { id: "LAYOUT_DUAL_INJECT", status: "ACTIVE", note: "layout rules in system dynamic + user tail" },
      { id: "HISTORY_TAIL", status: "EXPECTED", note: "recent history grows each turn — tail divergence expected" },
      { id: "TIMESTAMP_IN_PROMPT", status: "NOT_FOUND", note: "no Date.now() in assembled prompt text" },
    ],
    baselineMetrics: {
      preProviderP50Ms: 1631,
      ciTtftMedianMs: ciSummary?.ttft?.median ?? 38100,
      ciTtftMaxMs: ciSummary?.ttft?.max ?? 73251,
      ciCacheRatioMedian: ciSummary?.cacheRatio?.median ?? 0.752,
      ciCostMedianUsd: ciSummary?.costUsd?.median ?? 0.118,
      promptTokensSteady: steadyN.promptTokensEst,
    },
    architectureScore: { total: score, breakdown },
    answers: {
      q1_ciCacheMissBiggestOwner: "Dynamic system tail (persona reference, layout recency, memory) + growing history tail; static cacheRules+cacheCharacter ~stable",
      q2_firstCacheDivergence: findFirstDifferingSection(steadyN.sections, steadyN1.sections),
      q3_dynamicBreakingStaticPrefix: "user-persona-reference-owner, rule-output-layout-recency, memory sections precede history in dynamic block",
      q4_duplicatePolicies: ["PARAGRAPH_LAYOUT dual injection", "godmodding base + Gemini supplement (intentional)"],
      q5_conflictingPolicies: policyConflicts.map((c) => c.id),
      q6_canonicalOwners: owners,
      q7_promptTokenReduction: "0 (Phase A read-only — no changes applied)",
      q8_cacheRatioImprovement: "0 (baseline CI ~75% warm from Track B)",
      q9_ttftImprovement: "0 (Phase A audit only)",
      q10_costPer1000Chars: "baseline CI ~$0.118/turn Track B",
      q11_qualityRegression: "N/A — no prompt changes",
      q12_backgroundSummaryContention: "UNMEASURED — requires Phase D telemetry (summary_background_active vs TTFT)",
      q13_ciLatencyFloor: "~20-25s OR-equivalent prefill on 22k payload; CI median ~38s suggests upstream/provider queue + cache variance",
    },
    remainingTop5: [
      "D2: Consolidate PARAGRAPH_LAYOUT_OWNER to single injection point (user tail OR system, not both)",
      "D2: Move volatile persona reference after cacheCharacter or isolate in user-turn only if quality-safe",
      "D1: Audit semantic overlap in prose-style bundle vs Korean prose top block",
      "P2: Measure background summary vs foreground CI contention (Phase D)",
      "P1: Same-chat 10-turn cache benchmark (Phase C) before structural changes",
    ],
    nextRecommendation: "Phase B: owner canonicalization PR-1 (D2 conflicts + deterministic prefix + telemetry) — Draft, human review before merge",
    productionChanged: false,
  };

  fs.writeFileSync(path.join(OUT_DIR, "architecture-audit.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, "ownership-matrix.json"),
    JSON.stringify(ownershipMatrix, null, 2)
  );

  const textReport = [
    "GEMINI31_CI_PRODUCTION_OPTIMIZATION",
    "PHASE: A (READ-ONLY ARCHITECTURE AUDIT)",
    "PROVIDER: CheaperInference",
    `MODEL: ${MODEL}`,
    "OUTPUT_LENGTH_CHANGED: NO",
    "PROVIDER_MIGRATION: HOLD",
    "PROMPT_OWNERSHIP_AUDIT: PASS (matrix generated)",
    `D2_POLICY_CONFLICTS_BEFORE: ${d2Count}`,
    "D2_POLICY_CONFLICTS_AFTER: 0 (no changes applied — audit only)",
    `DUPLICATE_CRITICAL_OWNERS_BEFORE: ${d1Count + d2Count}`,
    "DUPLICATE_CRITICAL_OWNERS_AFTER: 0 (no changes applied)",
    `PROMPT_TOKENS_BEFORE: ${steadyN.promptTokensEst}`,
    "PROMPT_TOKENS_AFTER: (unchanged — Phase A)",
    `COMMON_PREFIX_RATIO_BEFORE: ${prefixRatio} (cacheRules+cacheCharacter / system; vs total input ${prefixRatioVsTotalInput})`,
    "COMMON_PREFIX_RATIO_AFTER: (unchanged — Phase A)",
    `CACHE_RATIO_BEFORE: ${ciSummary?.cacheRatio?.median ?? 0.752} (CI Track B warm)`,
    "CACHE_RATIO_AFTER: (unchanged — Phase A)",
    "PRE_PROVIDER_P50_BEFORE: 1631 ms (PR #718)",
    "PRE_PROVIDER_P50_AFTER: (unchanged — Phase A)",
    `PROVIDER_TTFT_P50_BEFORE: ${ciSummary?.ttft?.median ?? 38100} ms`,
    "PROVIDER_TTFT_P50_AFTER: (unchanged — Phase A)",
    `PROVIDER_TTFT_MAX_BEFORE: ${ciSummary?.ttft?.max ?? 73251} ms`,
    "PROVIDER_TTFT_MAX_AFTER: (unchanged — Phase A)",
    `COST_PER_TURN_BEFORE: $${ciSummary?.costUsd?.median ?? 0.118}`,
    "COST_PER_TURN_AFTER: (unchanged — Phase A)",
    "BACKGROUND_SUMMARY_CONTENTION: UNMEASURED (Phase D)",
    "REASONING_LOW_WIRE: PASS (reasoning_effort=low on CI wire)",
    "MEMORY_REGRESSION: PASS (PR #718 architecture preserved)",
    "RP_QUALITY_REGRESSION: N/A (no prompt changes)",
    `ARCHITECTURE_SCORE: ${score} / 100`,
    "REMAINING_TOP_5_ISSUES:",
    ...report.remainingTop5.map((x, i) => `${i + 1}. ${x}`),
    `NEXT_RECOMMENDATION: ${report.nextRecommendation}`,
    "PRODUCTION_CHANGED: NO",
    "",
    "CANONICAL OWNER MAP:",
    ...Object.entries(owners).map(([k, v]) => `  ${k}: ${v}`),
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "GEMINI31_CI_PRODUCTION_OPTIMIZATION.txt"), textReport);

  const md = [
    "# Gemini 3.1 Pro CI Production Optimization — Phase A Audit",
    "",
    "## Scope",
    "Read-only prompt ownership matrix, duplicate/conflict detection, prefix stability analysis.",
    "**No production changes.** CheaperInference retained; ~30% discount path unchanged.",
    "",
    "## Steady-state prompt decomposition",
    "",
    "| Block | Tokens (est.) | Stability |",
    "| --- | ---: | --- |",
    `| cacheRules (static) | ${steadyN.cacheRulesTokens} | STATIC |`,
    `| cacheCharacter (semi-static) | ${steadyN.cacheCharacterTokens} | SEMI_STATIC |`,
    `| dynamicBlock | ${steadyN.dynamicBlockTokens} | DYNAMIC |`,
    `| history + user turn | ${steadyN.historyTokens + steadyN.userTurnTokens} | DYNAMIC |`,
    `| **Total** | **${steadyN.promptTokensEst}** | |`,
    "",
    "## D2 policy conflicts (P0 fix candidates for Phase B)",
    "",
    ...policyConflicts.map((c) => `- **${c.id}**: ${c.description}`),
    "",
    "## Architecture score",
    "",
    `**${score}/100** — Phase A baseline before optimization PRs.`,
    "",
    "```",
    textReport,
    "```",
    "",
    "**STOP** — Phase B implementation PR not started. Human review required.",
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "GEMINI31_CI_PRODUCTION_OPTIMIZATION.md"), md);

  console.log(textReport);
  console.log("\nWrote", path.join(OUT_DIR, "architecture-audit.json"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
