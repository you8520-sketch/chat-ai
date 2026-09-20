/**
 * AUDIT ONLY — production memory input pressure + turn price forensics (#980 baseline).
 * ONE_OFF_FORENSIC: not a runtime owner; zero provider generation calls.
 *
 * PRIMARY objectives: MAX INPUT PRESSURE, TURN PRICE AMPLIFICATION, CAPACITY vs DISPLACEMENT.
 * Subscription = monthly memory add-on; Main RP turn billing remains usage-based.
 *
 * Uses real buildContext() assembly with audit-only global capacity simulation
 * (pre-trimmed longTermMemory text — does not mutate MEMORY_CAPACITY_FIXED).
 */
import { resolveBackgroundPrimaryModelId } from "@/lib/ai";
import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  selectedAIProvider,
  type SelectedAI,
} from "@/lib/chatModels";
import { resolveEpisodicMemoryMaxChars } from "@/lib/episodicMemoryFacts";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import { buildUserLorebookPromptBlock } from "@/lib/userLorebook";
import {
  computeOpenRouterTurnCost,
  openRouterInputTokenSurchargeKrw,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";
import { PERSONA_CONTENT_MAX } from "@/lib/persona";
import {
  openRouterUsdCostFromRates,
  resolveOpenRouterModelRates,
  type OpenRouterModelRates,
} from "@/lib/openRouterModelPricing";
import {
  UNIFIED_TIER_AIM_CHARS,
  UNIFIED_TIER_MIN_CHARS,
} from "@/lib/responseLengthConstants";
import { measureMediumGlobalLiteralDuplicateChars } from "./memory-medium-term";
import { buildContext } from "@/services/contextBuilder";
import type { CharacterChunk, ContextBuildInput } from "@/types";
import { MODEL_SYSTEM_BUDGETS } from "@/types";
import { estimateTokens } from "@/lib/tokenEstimate";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { ROLLING_SUMMARY_INTERVAL, ROLLING_SUMMARY_TARGET_CHARS } from "./memory-constants";
import {
  sealedSummaryRangesThrough,
  type RingSize,
} from "./memory-architecture-audit";
import { formatMemoryBlock } from "./memory-turn-summary";
import { trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import { LOREBOOK_COMPACT_FILL_RATIO } from "./memory-constants";
import { assembleMovingMediumRingText } from "./memory-medium-term-audit";
import {
  buildRaw4History,
  listMainRpModelProfiles,
  resolveAuditContextProvider,
} from "./memory-medium-term-prompt-budget-audit";
import { MEDIUM_TERM_BLOCK_COUNT } from "./memory-medium-term";
import {
  FREE_CAPABILITY,
  SUBSCRIBED_CAPABILITY,
  type SubscriptionMemoryCapability,
} from "@/lib/subscriptionMemoryCapability";

export const AUDIT_CODE_CLASSIFICATION = "ONE_OFF_FORENSIC" as const;

export type PaidMemoryConfigId =
  | "FREE_CURRENT"
  | "PAID_CURRENT"
  | "PAID_GLOBAL_15K"
  | "PAID_GLOBAL_20K_REFERENCE";

export type HistoryStage = 100 | 300 | 1000 | 2000;
export type LoadLevel = "NORMAL" | "PEAK_MEMORY";

export const PAID_MEMORY_HISTORY_STAGES: readonly HistoryStage[] = [100, 300, 1000, 2000];
export const PAID_MEMORY_LOAD_LEVELS: readonly LoadLevel[] = ["NORMAL", "PEAK_MEMORY"];

export const GLOBAL_SOURCE_MARKERS = {
  OLD_IDENTITY_FACT: "OLD_IDENTITY_FACT",
  OLD_RELATIONSHIP_MILESTONE: "OLD_RELATIONSHIP_MILESTONE",
  OLD_PROMISE: "OLD_PROMISE",
  MID_MAJOR_EVENT: "MID_MAJOR_EVENT",
  RECENT_MAJOR_EVENT: "RECENT_MAJOR_EVENT",
} as const;

export type GlobalSourceMarkerId = keyof typeof GLOBAL_SOURCE_MARKERS;

export type PaidMemoryConfig = {
  id: PaidMemoryConfigId;
  label: string;
  capability: SubscriptionMemoryCapability;
  /** Audit-only simulated Global capacity — not production runtime. */
  simulatedGlobalCapacity: number;
  simulationOnly: boolean;
};

export const PAID_MEMORY_CONFIGS: readonly PaidMemoryConfig[] = [
  {
    id: "FREE_CURRENT",
    label: "Free tier — current production",
    capability: FREE_CAPABILITY,
    simulatedGlobalCapacity: MEMORY_CAPACITY_FIXED,
    simulationOnly: false,
  },
  {
    id: "PAID_CURRENT",
    label: "Subscribed — current production Global 10K",
    capability: SUBSCRIBED_CAPABILITY,
    simulatedGlobalCapacity: MEMORY_CAPACITY_FIXED,
    simulationOnly: false,
  },
  {
    id: "PAID_GLOBAL_15K",
    label: "Subscribed — Global 15K simulation",
    capability: SUBSCRIBED_CAPABILITY,
    simulatedGlobalCapacity: 15_000,
    simulationOnly: true,
  },
  {
    id: "PAID_GLOBAL_20K_REFERENCE",
    label: "Subscribed — Global 20K reference ceiling",
    capability: SUBSCRIBED_CAPABILITY,
    simulatedGlobalCapacity: 20_000,
    simulationOnly: true,
  },
];

export const PRODUCT_MODEL = {
  subscriptionType: "MONTHLY_MEMORY_ADDON_PLUS_USAGE_BILLING" as const,
  normalUsageBilling: "CONTINUES" as const,
  subscriptionDoesNotUnlimitTurns: true,
  memoryAddOnGrants: ["Focus", "User Lorebook", "future Global capacity"],
} as const;

/** Production canonical output aim; historical presets retained for comparison only. */
export const AUDIT_OUTPUT_PRESET_CHARS = {
  canonical: UNIFIED_TIER_AIM_CHARS,
  historicalShort: 1_500,
  historicalMid: 2_500,
  historicalLong: 3_500,
  unifiedMin: UNIFIED_TIER_MIN_CHARS,
} as const;

export const AUDIT_OUTPUT_PRESETS = [
  AUDIT_OUTPUT_PRESET_CHARS.historicalShort,
  AUDIT_OUTPUT_PRESET_CHARS.historicalMid,
  AUDIT_OUTPUT_PRESET_CHARS.canonical,
  AUDIT_OUTPUT_PRESET_CHARS.historicalLong,
] as const;

export type OutputPresetChars = (typeof AUDIT_OUTPUT_PRESETS)[number];

export const OWNER_MAP = {
  finalContextBuilder: "src/services/contextBuilder.ts — buildContext()",
  systemMessages: "buildContext pushSection trackedSections",
  historyMessages: "buildContext shortTermHistory → trim → history",
  currentUserTurn: "buildContext currentUserMessage + adapters",
  modelAdapter: "OpenRouter split / DeepSeek XML / Gemini bulk in contextBuilder",
  focusInjection: "userNote + focusMaxChars via splitUserNotePromptZones",
  creatorLorebook: "keywordLorebookBlock → keyword-lorebook or dynamic lore prefix",
  userLorebook: "userLorebookBlock → user-lorebook section",
  globalMemory: "longTermMemory → current-memory section",
  mediumMemory: "mediumTermMemoryBlock → medium-term-memory section",
  episodicMemory: "episodicMemoryBlock → episodic-memory-retrieved-facts",
  relationshipMemory: "memoryMeta → relationship-meta or bundled in current-memory",
  rawHistory: "shortTermHistory RAW4 in buildContext",
  historyTrimming: "trimHistoryToBudget / trimProviderHistoryToBudget",
  systemBudgetTelemetry: "MODEL_SYSTEM_BUDGETS → meta.tokenBudget (soft telemetry)",
  localTokenEstimate: "estimateTokens() — LOCAL_ESTIMATED_TOKENS diagnostic",
  providerPromptTokens: "Provider usage.prompt_tokens — canonical when request exists",
  serializedWireRequest: "route OpenRouter/Gemini wire builders post-buildContext",
  cacheTelemetry: "usage cache_read/write fields + openRouterSystemSplit",
  mainRpModels: "chatModels.MAIN_RP_MODEL_IDS",
  usagePointCharge: "points.computeOpenRouterTurnCost",
  rawProviderCost: "openRouterModelPricing.openRouterUsdCostFromRates",
  fx: "exchangeRate.resolveBillingExchangeRateSnapshot",
  globalCompaction: "memory-global-compaction-execution + ai.resolveBackgroundPrimaryModelId",
} as const;

export const TOKEN_OWNER_MAP = {
  localEstimate: OWNER_MAP.localTokenEstimate,
  providerCanonical: OWNER_MAP.providerPromptTokens,
  contextBuilder: OWNER_MAP.finalContextBuilder,
  systemBudget: OWNER_MAP.systemBudgetTelemetry,
  historyTrim: OWNER_MAP.historyTrimming,
  serializedWire: OWNER_MAP.serializedWireRequest,
  cacheTelemetry: OWNER_MAP.cacheTelemetry,
} as const;

export const COST_OWNER_MAP = {
  rawProviderUsd: OWNER_MAP.rawProviderCost,
  rates: "openRouterModelPricing.resolveOpenRouterModelRates (LIVE_CATALOG merge + FALLBACK)",
  userPoints: OWNER_MAP.usagePointCharge,
  fx: OWNER_MAP.fx,
  globalMaintenanceModel: OWNER_MAP.globalCompaction,
  outputChars: `responseLengthConstants — canonical ${UNIFIED_TIER_AIM_CHARS} chars`,
} as const;

export type InputPressureBand =
  | "UNDER_28K"
  | "28K_TO_40K"
  | "40K_TO_50K"
  | "50K_TO_60K"
  | "60K_OR_MORE";

export function classifyInputPressureBand(tokens: number): InputPressureBand {
  if (tokens >= 60_000) return "60K_OR_MORE";
  if (tokens >= 50_000) return "50K_TO_60K";
  if (tokens >= 40_000) return "40K_TO_50K";
  if (tokens >= 28_000) return "28K_TO_40K";
  return "UNDER_28K";
}

export function classifyInputThresholds(tokens: number): {
  crossed28k: boolean;
  crossed40k: boolean;
  crossed50k: boolean;
  crossed60k: boolean;
} {
  return {
    crossed28k: tokens >= 28_000,
    crossed40k: tokens >= 40_000,
    crossed50k: tokens >= 50_000,
    crossed60k: tokens >= 60_000,
  };
}

function padToChars(text: string, chars: number): string {
  let body = text.trim();
  if (chars <= 0) return "";
  while (body.length < chars) body += " → PAD";
  return body.slice(0, chars);
}

function markerForTurnRange(turnStart: number, turnEnd: number, currentTurn: number): string {
  if (turnStart <= 20) return GLOBAL_SOURCE_MARKERS.OLD_IDENTITY_FACT;
  if (turnStart <= 35) return GLOBAL_SOURCE_MARKERS.OLD_RELATIONSHIP_MILESTONE;
  if (turnStart <= 50) return GLOBAL_SOURCE_MARKERS.OLD_PROMISE;
  const midAnchor = Math.max(21, Math.floor(currentTurn * 0.45));
  const midBlockStart =
    Math.floor((midAnchor - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL + 1;
  if (turnStart === midBlockStart) return GLOBAL_SOURCE_MARKERS.MID_MAJOR_EVENT;
  const recentAnchor = Math.max(21, currentTurn - 25);
  const recentBlockStart =
    Math.floor((recentAnchor - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL + 1;
  if (turnStart === recentBlockStart) return GLOBAL_SOURCE_MARKERS.RECENT_MAJOR_EVENT;
  void turnEnd;
  return `FILLER_${turnStart}_${turnEnd}`;
}

function padSummaryWithMarker(marker: string, turnStart: number, turnEnd: number): string {
  const clauses = [
    `${marker} ${turnStart}~${turnEnd}구간에서 사건이 발생했다`,
    "인물이 그 흐름에 반응했다",
    "관계가 조금 달라졌다",
    "다음 만남을 남긴 채 장면이 닫혔다",
  ];
  let body = clauses.join(" → ");
  while (body.length < ROLLING_SUMMARY_TARGET_CHARS) {
    body += " → 같은 구간의 배경이 짧게 이어졌다";
  }
  return body.slice(0, ROLLING_SUMMARY_TARGET_CHARS);
}

/** Deterministic sealed Korean RP global history with audit source markers. */
export function buildGlobalMemoryFixture(currentTurn: number, globalCapacity: number): string {
  const summarizedThrough = Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const ranges = sealedSummaryRangesThrough(summarizedThrough);
  const blocks = ranges.map((range) => {
    const marker = markerForTurnRange(range.turnStart, range.turnEnd, currentTurn);
    const body = padSummaryWithMarker(marker, range.turnStart, range.turnEnd);
    return formatMemoryBlock(range.turnStart, range.turnEnd, body);
  });
  const full = blocks.join("\n\n");
  if (!full.trim()) {
    return padToChars(`${GLOBAL_SOURCE_MARKERS.RECENT_MAJOR_EVENT} early chat`, globalCapacity);
  }
  return trimLorebookToBudgetSync(full, globalCapacity);
}

function buildUserLorebookFixture(injectMaxChars: number, load: LoadLevel): string {
  const target = load === "PEAK_MEMORY" ? injectMaxChars : Math.floor(injectMaxChars * 0.55);
  const entries = [
    "유저 로어북: 검은 코트를 입은 남자는 과거 동맹이었다.",
    "유저 로어북: 카페 '별빛'은 두 사람의 비밀 만남 장소다.",
    "유저 로어북: 약속 — 다음 보름달에 고백한다.",
  ];
  let combined = entries.join("\n\n");
  combined = padToChars(combined, target);
  return buildUserLorebookPromptBlock([combined]);
}

function buildCreatorLorebookFixture(load: LoadLevel): string {
  const target = load === "PEAK_MEMORY" ? 1_800 : 900;
  const body = padToChars(
    "크리에이터 로어북: 폐역 지하 통로는 밀수 조직의 거점이다.",
    target
  );
  return `[KEYWORD LOREBOOK - 최근 visible 대화/현재 입력 키워드 매칭, 원문 그대로 적용]\n${body}`;
}

function buildEpisodicFixture(load: LoadLevel): string {
  const max = resolveEpisodicMemoryMaxChars({} as NodeJS.ProcessEnv);
  const target = load === "PEAK_MEMORY" ? max : Math.floor(max * 0.6);
  return padToChars(
    "[Episodic memory]\n- T120 setting/abandoned_station: 폭우가 쏟아지는 폐역 안으로 피신했다.",
    target
  );
}

function buildRelationshipFixture(load: LoadLevel): string {
  const target = load === "PEAK_MEMORY" ? 2_400 : 1_200;
  return padToChars(
    '{"honorifics":{"user_to_char":"너","char_to_user":"오빠"},"promises":["약속_ledger"],"items":["커피잔"]}',
    target
  );
}

function fixtureSizes(load: LoadLevel, capability: SubscriptionMemoryCapability): {
  canonIdentity: number;
  canonPersonality: number;
  canonWorld: number;
  userPersona: number;
  focus: number;
} {
  if (load === "PEAK_MEMORY") {
    return {
      canonIdentity: 6_000,
      canonPersonality: 2_400,
      canonWorld: 1_800,
      userPersona: PERSONA_CONTENT_MAX,
      focus: capability.focusMaxChars,
    };
  }
  return {
    canonIdentity: 4_500,
    canonPersonality: 800,
    canonWorld: 600,
    userPersona: 900,
    focus: Math.floor(capability.focusMaxChars * 0.55),
  };
}

export function buildPaidMemoryAuditInput(opts: {
  modelId: string;
  config: PaidMemoryConfig;
  currentTurn: HistoryStage;
  load: LoadLevel;
}): ContextBuildInput {
  const { capability } = opts.config;
  const sizes = fixtureSizes(opts.load, capability);
  const mediumRingN = MEDIUM_TERM_BLOCK_COUNT as RingSize;
  const mediumText = assembleMovingMediumRingText(opts.currentTurn, mediumRingN);

  const chunk = (category: CharacterChunk["category"], content: string): CharacterChunk => ({
    id: `audit-${category}`,
    characterId: "audit-char",
    category,
    content,
    importance: "CRITICAL",
    tokenCount: estimateTokens(content),
    keywords: [],
  });

  return {
    charName: "AuditChar",
    userNickname: "AuditUser",
    personaDisplayName: "AuditUser",
    chunks: [
      chunk(
        "identity",
        padToChars(
          "[Identity] AuditChar — representative Main RP canon for paid-memory audit.",
          sizes.canonIdentity
        )
      ),
      chunk("personality", padToChars("Personality traits for audit fixture.", sizes.canonPersonality)),
      chunk("world", padToChars("World background for audit fixture.", sizes.canonWorld)),
    ],
    userPersona: padToChars("User persona block for audit fixture.", sizes.userPersona),
    userNote: padToChars("Focus user note — audit fixture.", sizes.focus),
    focusMaxChars: capability.focusMaxChars,
    userLorebookBlock: buildUserLorebookFixture(capability.userLorebookTurnInjectMaxChars, opts.load),
    keywordLorebookBlock: buildCreatorLorebookFixture(opts.load),
    shortTermHistory: buildRaw4History(),
    currentUserMessage: "continue the scene — audit fixture user turn",
    nsfw: false,
    provider: resolveAuditContextProvider(opts.modelId),
    modelId: opts.modelId,
    longTermMemory: buildGlobalMemoryFixture(opts.currentTurn, opts.config.simulatedGlobalCapacity),
    mediumTermMemoryBlock: mediumText,
    memoryMeta: buildRelationshipFixture(opts.load),
    episodicMemoryBlock: buildEpisodicFixture(opts.load),
    targetResponseChars: UNIFIED_TIER_AIM_CHARS,
    completedTurns: opts.currentTurn,
    summarizedTurnCount: Math.floor((opts.currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL,
  };
}

export type SectionInventoryRow = {
  id: string;
  label: string;
  category: string;
  chars: number;
  localEstimatedTokens: number;
  pctOfTotalInput: number;
};

export type PromptAssemblyRow = {
  modelId: string;
  configId: PaidMemoryConfigId;
  currentTurn: HistoryStage;
  load: LoadLevel;
  localSystemTokens: number;
  localHistoryTokens: number;
  localUserTurnTokens: number;
  localEstimatedTokensTotal: number;
  serializedRequestChars: number;
  serializedRequestTokensEst: number;
  inputPressureBand: InputPressureBand;
  crossed28k: boolean;
  crossed40k: boolean;
  crossed50k: boolean;
  crossed60k: boolean;
  historyCountBeforeTrim: number;
  historyCountAfterTrim: number;
  trimmedHistoryMessages: number;
  tokenBudget: number;
  telemetry28kCrossed: boolean;
  modelBudgetCrossed: boolean;
  criticalSectionOmitted: boolean;
  truncatedMemory: boolean;
  rawPresent: boolean;
  mediumPresent: boolean;
  episodicPresent: boolean;
  relationshipPresent: boolean;
  userLorebookChars: number;
  globalChars: number;
  mediumChars: number;
  episodicChars: number;
  relationshipChars: number;
  rawHistoryTokens: number;
  sectionInventory: SectionInventoryRow[];
  globalSourceCoverage: Record<GlobalSourceMarkerId, "SOURCE_PRESENT" | "SOURCE_ABSENT">;
};

export type DuplicationAudit = {
  modelId: string;
  configId: PaidMemoryConfigId;
  currentTurn: HistoryStage;
  load: LoadLevel;
  duplicatePromptBloat: "YES" | "NO";
  mediumGlobalLiteralDuplicateChars: number;
  relationshipBundledInGlobal: boolean;
  classification: Array<
    | "MEMORY_LAYER_OVERLAP"
    | "EXPECTED_CAPACITY_SUM"
    | "DUPLICATE_INJECTION"
    | "OTHER"
  >;
  detail: string;
};

export type SixtyKRootCause = {
  modelId: string;
  configId: PaidMemoryConfigId;
  currentTurn: HistoryStage;
  load: LoadLevel;
  totalInputTokens: number;
  sectionContributions: Array<{
    id: string;
    label: string;
    tokens: number;
    pctOfTotal: number;
  }>;
  primaryCause:
    | "EXPECTED_CAPACITY_SUM"
    | "DUPLICATE_INJECTION"
    | "HISTORY_NOT_TRIMMED"
    | "MODEL_ADAPTER_OVERHEAD"
    | "SYSTEM_PROMPT_OVERHEAD"
    | "MEMORY_LAYER_OVERLAP"
    | "OTHER";
  detail: string;
};

export type AbsoluteMaxInputRow = {
  modelId: string;
  freeMaxInput: number;
  paidCurrentMaxInput: number;
  paidGlobal15MaxInput: number;
  paidGlobal20MaxInput: number;
  global15Gte28k: boolean;
  global15Gte40k: boolean;
  global15Gte50k: boolean;
  global15Gte60k: boolean;
  maxStage: HistoryStage;
  maxLoad: LoadLevel;
};

export type PrimaryDecisionRow = {
  modelId: string;
  configId: PaidMemoryConfigId;
  tStage: HistoryStage;
  load: LoadLevel;
  inputTokens: number;
  outputTarget: number;
  pCharge: number;
  pDeltaVsFree: number;
  pDeltaPercentVsFree: number;
  inputAmplificationVsFree: number;
  turnPriceAmplificationVsFree: number;
  crossed28k: boolean;
  crossed40k: boolean;
  crossed50k: boolean;
  crossed60k: boolean;
  trimOccurred: boolean;
  criticalLoss: boolean;
};

export type TurnPriceRow = {
  modelId: string;
  configId: PaidMemoryConfigId;
  currentTurn: HistoryStage;
  load: LoadLevel;
  outputPresetChars: OutputPresetChars;
  inputTokens: number;
  outputTokensEst: number;
  rawCostKrw: number;
  pCharge: number;
  pDeltaVsFree: number;
  pDeltaPercentVsFree: number;
  rawKrwDeltaVsFree: number;
};

export type InputAmplificationRow = {
  modelId: string;
  currentTurn: HistoryStage;
  load: LoadLevel;
  freeInput: number;
  paidCurrentInput: number;
  paidGlobal15Input: number;
  paidCurrentRatio: number;
  paidCurrentPctIncrease: number;
  paidCurrentAddedTokens: number;
  global15Ratio: number;
  global15PctIncrease: number;
  global15AddedTokens: number;
};

export type TurnPriceAmplificationRow = {
  modelId: string;
  currentTurn: HistoryStage;
  load: LoadLevel;
  outputPresetChars: OutputPresetChars;
  freeP: number;
  paidCurrentP: number;
  paidGlobal15P: number;
  paidCurrentAmplification: number;
  global15Amplification: number;
  global15PDeltaPercent: number;
};

export type ExpensiveTurnBoundaryRow = {
  modelId: string;
  cheapestNormalCurrent: { inputTokens: number; pCharge: number; rawKrw: number; turn: HistoryStage };
  normalPaidCurrent: { inputTokens: number; pCharge: number; rawKrw: number; turn: HistoryStage };
  normalPaidGlobal15: { inputTokens: number; pCharge: number; rawKrw: number; turn: HistoryStage };
  peakPaidCurrent: { inputTokens: number; pCharge: number; rawKrw: number; turn: HistoryStage };
  peakPaidGlobal15: { inputTokens: number; pCharge: number; rawKrw: number; turn: HistoryStage };
  maxObserved: { inputTokens: number; pCharge: number; rawKrw: number; turn: HistoryStage; configId: PaidMemoryConfigId; load: LoadLevel };
};

export type MemoryCostPassThrough =
  | "FULLY_RECOVERED"
  | "PARTIALLY_RECOVERED"
  | "NOT_RECOVERED";

export type MemoryCostPassThroughRow = {
  modelId: string;
  currentTurn: HistoryStage;
  load: LoadLevel;
  outputPresetChars: OutputPresetChars;
  rawKrwDeltaGlobal15: number;
  pDeltaGlobal15: number;
  recovery: MemoryCostPassThrough;
};

export type LongRpPriceDriftRow = {
  modelId: string;
  configId: PaidMemoryConfigId;
  outputPresetChars: OutputPresetChars;
  t100P: number;
  t300P: number;
  t1000P: number;
  t2000P: number;
  driftPercentT100ToT2000: number;
};

export type InputBandSummary = {
  band: InputPressureBand;
  fixtureCount: number;
};

export type PointTopUpEconomicsRow = {
  krwPaid: number;
  normalCreditsP: number;
  subscriberCreditsP: number;
  subscriberBonusP: number;
  normalEffectiveKrwPerP: number;
  subscriberEffectiveKrwPerP: number;
  discountDifferencePctPoints: number;
};

const POINT_TOPUP_TIERS = [
  { krw: 5_000, normalP: 5_000, subscriberP: 5_250 },
  { krw: 10_000, normalP: 10_000, subscriberP: 10_500 },
  { krw: 30_000, normalP: 31_500, subscriberP: 33_000 },
  { krw: 50_000, normalP: 52_500, subscriberP: 55_000 },
  { krw: 100_000, normalP: 107_000, subscriberP: 112_000 },
] as const;

const rowCache = new Map<string, PromptAssemblyRow>();

function rowCacheKey(opts: {
  modelId: string;
  config: PaidMemoryConfig;
  currentTurn: HistoryStage;
  load: LoadLevel;
}): string {
  return `${opts.modelId}|${opts.config.id}|${opts.currentTurn}|${opts.load}`;
}

export function clearPaidMemoryAuditRowCache(): void {
  rowCache.clear();
}

const SECTION_INVENTORY_IDS = [
  "openrouter-korean-prose-top",
  "identity-and-rules",
  "character-core-identity",
  "current-memory",
  "medium-term-memory",
  "episodic-memory-retrieved-facts",
  "relationship-meta",
  "user-lorebook",
  "keyword-lorebook",
] as const;

function classifyGlobalSourceCoverage(globalText: string): Record<
  GlobalSourceMarkerId,
  "SOURCE_PRESENT" | "SOURCE_ABSENT"
> {
  const result = {} as Record<GlobalSourceMarkerId, "SOURCE_PRESENT" | "SOURCE_ABSENT">;
  for (const key of Object.keys(GLOBAL_SOURCE_MARKERS) as GlobalSourceMarkerId[]) {
    result[key] = globalText.includes(GLOBAL_SOURCE_MARKERS[key])
      ? "SOURCE_PRESENT"
      : "SOURCE_ABSENT";
  }
  return result;
}

function auditCriticalSections(
  built: ReturnType<typeof buildContext>,
  input: ContextBuildInput
): boolean {
  const trackedIds = new Set((built.meta.trackedSections ?? []).map((s) => s.id));
  return (
    (Boolean(input.mediumTermMemoryBlock?.trim()) && !trackedIds.has("medium-term-memory")) ||
    (Boolean(input.longTermMemory?.trim()) && !trackedIds.has("current-memory")) ||
    (Boolean(input.chunks?.length) && !trackedIds.has("character-core-identity"))
  );
}

export function assemblePaidMemoryPromptRow(opts: {
  modelId: string;
  config: PaidMemoryConfig;
  currentTurn: HistoryStage;
  load: LoadLevel;
}): PromptAssemblyRow {
  const cached = rowCache.get(rowCacheKey(opts));
  if (cached) return cached;

  const input = buildPaidMemoryAuditInput(opts);
  const built = buildContext(input);
  const sections = built.meta.trackedSections ?? [];
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  const historyBefore = input.shortTermHistory.length;
  const historyAfter = built.history.length - 1;
  const userTurn = built.history[built.history.length - 1]?.content ?? "";
  const historyOnly = built.history.slice(0, -1);

  const serialized = `${built.systemPrompt}\n${built.history.map((m) => m.content).join("\n")}`;

  const globalSection = sectionById.get("current-memory");
  const globalText = globalSection?.text ?? input.longTermMemory ?? "";
  const userLorebookSection = sectionById.get("user-lorebook");
  const mediumSection = sectionById.get("medium-term-memory");
  const episodicSection = sectionById.get("episodic-memory-retrieved-facts");
  const relationshipSection = sectionById.get("relationship-meta");

  const tokenBudget = built.meta.tokenBudget;
  const systemTokens = built.meta.estimatedSystemTokens;
  const historyTokens = built.meta.estimatedHistoryTokens;
  const userTurnTokens = estimateTokens(userTurn);
  const totalInput =
    built.meta.estimatedInputTokens ?? systemTokens + historyTokens + userTurnTokens;
  const thresholds = classifyInputThresholds(totalInput);

  const inventory: SectionInventoryRow[] = [];
  const pushInventory = (section: NonNullable<(typeof sections)[number]>) => {
    const tok = estimateTokens(section.text);
    inventory.push({
      id: section.id,
      label: section.label,
      category: section.category,
      chars: section.text.length,
      localEstimatedTokens: tok,
      pctOfTotalInput: totalInput > 0 ? (tok / totalInput) * 100 : 0,
    });
  };
  for (const id of SECTION_INVENTORY_IDS) {
    const section = sectionById.get(id);
    if (section) pushInventory(section);
  }
  for (const section of sections) {
    if (SECTION_INVENTORY_IDS.includes(section.id as (typeof SECTION_INVENTORY_IDS)[number])) continue;
    if (inventory.some((r) => r.id === section.id)) continue;
    pushInventory(section);
  }

  const row: PromptAssemblyRow = {
    modelId: opts.modelId,
    configId: opts.config.id,
    currentTurn: opts.currentTurn,
    load: opts.load,
    localSystemTokens: systemTokens,
    localHistoryTokens: historyTokens,
    localUserTurnTokens: userTurnTokens,
    localEstimatedTokensTotal: totalInput,
    serializedRequestChars: serialized.length,
    serializedRequestTokensEst: estimateTokens(serialized),
    inputPressureBand: classifyInputPressureBand(totalInput),
    ...thresholds,
    historyCountBeforeTrim: historyBefore,
    historyCountAfterTrim: historyAfter,
    trimmedHistoryMessages: Math.max(0, historyBefore - historyAfter),
    tokenBudget,
    telemetry28kCrossed: systemTokens > tokenBudget,
    modelBudgetCrossed: systemTokens > tokenBudget,
    criticalSectionOmitted: auditCriticalSections(built, input),
    truncatedMemory: built.meta.truncatedMemory === true,
    rawPresent: historyAfter >= 4,
    mediumPresent: Boolean(mediumSection),
    episodicPresent: Boolean(episodicSection),
    relationshipPresent:
      Boolean(relationshipSection) || globalText.includes("honorifics"),
    userLorebookChars: userLorebookSection?.text.length ?? 0,
    globalChars: globalText.length,
    mediumChars: mediumSection?.text.length ?? 0,
    episodicChars: episodicSection?.text.length ?? 0,
    relationshipChars: relationshipSection?.text.length ?? 0,
    rawHistoryTokens: estimateTokens(historyOnly.map((m) => m.content).join("\n")),
    sectionInventory: inventory,
    globalSourceCoverage: classifyGlobalSourceCoverage(globalText),
  };
  rowCache.set(rowCacheKey(opts), row);
  return row;
}

export function auditDuplicationOverlap(opts: {
  modelId: string;
  config: PaidMemoryConfig;
  currentTurn: HistoryStage;
  load: LoadLevel;
}): DuplicationAudit {
  const row = assemblePaidMemoryPromptRow(opts);
  const input = buildPaidMemoryAuditInput(opts);
  const mediumText = input.mediumTermMemoryBlock ?? "";
  const globalText = input.longTermMemory ?? "";
  const mediumGlobalDup = measureMediumGlobalLiteralDuplicateChars(mediumText, globalText);
  const relationshipBundled =
    row.relationshipPresent && !row.sectionInventory.some((s) => s.id === "relationship-meta");

  const classification: DuplicationAudit["classification"] = [];
  if (mediumGlobalDup > 200) classification.push("MEMORY_LAYER_OVERLAP");
  if (relationshipBundled) classification.push("DUPLICATE_INJECTION");

  const duplicatePromptBloat =
    mediumGlobalDup > 500 || relationshipBundled ? "YES" : "NO";

  return {
    modelId: opts.modelId,
    configId: opts.config.id,
    currentTurn: opts.currentTurn,
    load: opts.load,
    duplicatePromptBloat,
    mediumGlobalLiteralDuplicateChars: mediumGlobalDup,
    relationshipBundledInGlobal: relationshipBundled,
    classification: classification.length > 0 ? classification : ["EXPECTED_CAPACITY_SUM"],
    detail:
      duplicatePromptBloat === "YES"
        ? `medium↔global literal dup=${mediumGlobalDup} chars; relationshipBundled=${relationshipBundled}`
        : "No evidence of unintended duplicate injection beyond complementary memory layers",
  };
}

export function analyzeSixtyKRootCause(row: PromptAssemblyRow): SixtyKRootCause | null {
  if (!row.crossed60k) return null;
  const sorted = [...row.sectionInventory].sort(
    (a, b) => b.localEstimatedTokens - a.localEstimatedTokens
  );
  const top = sorted.slice(0, 8);
  const systemShare =
    top.filter((s) => s.category === "systemRules").reduce((s, r) => s + r.pctOfTotalInput, 0);
  const memoryShare =
    top.filter((s) => s.category === "memory").reduce((s, r) => s + r.pctOfTotalInput, 0);

  let primaryCause: SixtyKRootCause["primaryCause"] = "EXPECTED_CAPACITY_SUM";
  if (row.rawHistoryTokens > row.localEstimatedTokensTotal * 0.25) {
    primaryCause = "HISTORY_NOT_TRIMMED";
  } else if (systemShare > 45) {
    primaryCause = "SYSTEM_PROMPT_OVERHEAD";
  } else if (memoryShare > 50) {
    primaryCause = "EXPECTED_CAPACITY_SUM";
  } else if (row.localUserTurnTokens > row.localEstimatedTokensTotal * 0.2) {
    primaryCause = "MODEL_ADAPTER_OVERHEAD";
  }

  return {
    modelId: row.modelId,
    configId: row.configId,
    currentTurn: row.currentTurn,
    load: row.load,
    totalInputTokens: row.localEstimatedTokensTotal,
    sectionContributions: top.map((s) => ({
      id: s.id,
      label: s.label,
      tokens: s.localEstimatedTokens,
      pctOfTotal: s.pctOfTotalInput,
    })),
    primaryCause,
    detail: `systemRules=${systemShare.toFixed(1)}% memory=${memoryShare.toFixed(1)}% history=${row.localHistoryTokens} userTurn=${row.localUserTurnTokens}`,
  };
}

function configById(id: PaidMemoryConfigId): PaidMemoryConfig {
  return PAID_MEMORY_CONFIGS.find((c) => c.id === id)!;
}

export function buildAbsoluteMaxInputTable(modelId: string): AbsoluteMaxInputRow {
  let freeMax = 0;
  let paidMax = 0;
  let g15Max = 0;
  let g20Max = 0;
  let maxStage: HistoryStage = 100;
  let maxLoad: LoadLevel = "NORMAL";

  for (const config of PAID_MEMORY_CONFIGS) {
    for (const turn of PAID_MEMORY_HISTORY_STAGES) {
      for (const load of PAID_MEMORY_LOAD_LEVELS) {
        const row = assemblePaidMemoryPromptRow({ modelId, config, currentTurn: turn, load });
        if (config.id === "FREE_CURRENT") freeMax = Math.max(freeMax, row.localEstimatedTokensTotal);
        if (config.id === "PAID_CURRENT") paidMax = Math.max(paidMax, row.localEstimatedTokensTotal);
        if (config.id === "PAID_GLOBAL_15K") {
          if (row.localEstimatedTokensTotal > g15Max) {
            g15Max = row.localEstimatedTokensTotal;
            maxStage = turn;
            maxLoad = load;
          }
        }
        if (config.id === "PAID_GLOBAL_20K_REFERENCE") {
          g20Max = Math.max(g20Max, row.localEstimatedTokensTotal);
        }
      }
    }
  }

  return {
    modelId,
    freeMaxInput: freeMax,
    paidCurrentMaxInput: paidMax,
    paidGlobal15MaxInput: g15Max,
    paidGlobal20MaxInput: g20Max,
    global15Gte28k: g15Max >= 28_000,
    global15Gte40k: g15Max >= 40_000,
    global15Gte50k: g15Max >= 50_000,
    global15Gte60k: g15Max >= 60_000,
    maxStage,
    maxLoad,
  };
}

export function buildInputAmplificationTable(
  modelId: string,
  turn: HistoryStage,
  load: LoadLevel
): InputAmplificationRow {
  const free = assemblePaidMemoryPromptRow({
    modelId,
    config: configById("FREE_CURRENT"),
    currentTurn: turn,
    load,
  });
  const paid = assemblePaidMemoryPromptRow({
    modelId,
    config: configById("PAID_CURRENT"),
    currentTurn: turn,
    load,
  });
  const g15 = assemblePaidMemoryPromptRow({
    modelId,
    config: configById("PAID_GLOBAL_15K"),
    currentTurn: turn,
    load,
  });
  const paidRatio = free.localEstimatedTokensTotal > 0
    ? paid.localEstimatedTokensTotal / free.localEstimatedTokensTotal
    : 1;
  const g15Ratio = paid.localEstimatedTokensTotal > 0
    ? g15.localEstimatedTokensTotal / paid.localEstimatedTokensTotal
    : 1;
  return {
    modelId,
    currentTurn: turn,
    load,
    freeInput: free.localEstimatedTokensTotal,
    paidCurrentInput: paid.localEstimatedTokensTotal,
    paidGlobal15Input: g15.localEstimatedTokensTotal,
    paidCurrentRatio: paidRatio,
    paidCurrentPctIncrease: (paidRatio - 1) * 100,
    paidCurrentAddedTokens: paid.localEstimatedTokensTotal - free.localEstimatedTokensTotal,
    global15Ratio: g15Ratio,
    global15PctIncrease: (g15Ratio - 1) * 100,
    global15AddedTokens: g15.localEstimatedTokensTotal - paid.localEstimatedTokensTotal,
  };
}

export function buildTurnPriceRow(opts: {
  modelId: string;
  configId: PaidMemoryConfigId;
  currentTurn: HistoryStage;
  load: LoadLevel;
  outputPresetChars: OutputPresetChars;
}): TurnPriceRow {
  const row = assemblePaidMemoryPromptRow({
    modelId: opts.modelId,
    config: configById(opts.configId),
    currentTurn: opts.currentTurn,
    load: opts.load,
  });
  const freeRow = assemblePaidMemoryPromptRow({
    modelId: opts.modelId,
    config: configById("FREE_CURRENT"),
    currentTurn: opts.currentTurn,
    load: opts.load,
  });
  const outputTokens = outputTokensFromChars(opts.outputPresetChars);
  const pCharge = computeUserPointCharge(opts.modelId, row.localEstimatedTokensTotal, opts.outputPresetChars);
  const freeP = computeUserPointCharge(opts.modelId, freeRow.localEstimatedTokensTotal, opts.outputPresetChars);
  const raw = computeRawProviderCost({
    modelId: opts.modelId,
    configId: opts.configId,
    inputTokens: row.localEstimatedTokensTotal,
    outputPresetChars: opts.outputPresetChars,
    scenario: "NO_CACHE",
  });
  const freeRaw = computeRawProviderCost({
    modelId: opts.modelId,
    configId: "FREE_CURRENT",
    inputTokens: freeRow.localEstimatedTokensTotal,
    outputPresetChars: opts.outputPresetChars,
    scenario: "NO_CACHE",
  });
  const pDelta = pCharge - freeP;
  return {
    modelId: opts.modelId,
    configId: opts.configId,
    currentTurn: opts.currentTurn,
    load: opts.load,
    outputPresetChars: opts.outputPresetChars,
    inputTokens: row.localEstimatedTokensTotal,
    outputTokensEst: outputTokens,
    rawCostKrw: raw.rawKrw,
    pCharge,
    pDeltaVsFree: pDelta,
    pDeltaPercentVsFree: freeP > 0 ? (pDelta / freeP) * 100 : 0,
    rawKrwDeltaVsFree: raw.rawKrw - freeRaw.rawKrw,
  };
}

export function classifyMemoryCostPassThrough(opts: {
  modelId: string;
  rawKrwDelta: number;
  pDelta: number;
}): MemoryCostPassThrough {
  if (opts.pDelta <= 0 && opts.rawKrwDelta > 0) return "NOT_RECOVERED";
  if (opts.rawKrwDelta <= 0) return "FULLY_RECOVERED";
  const ratio = opts.pDelta / opts.rawKrwDelta;
  if (ratio >= 0.85) return "FULLY_RECOVERED";
  if (ratio >= 0.35) return "PARTIALLY_RECOVERED";
  return "NOT_RECOVERED";
}

export function buildPrimaryDecisionTable(modelId: string): PrimaryDecisionRow[] {
  const rows: PrimaryDecisionRow[] = [];
  for (const config of PAID_MEMORY_CONFIGS) {
    for (const turn of PAID_MEMORY_HISTORY_STAGES) {
      for (const load of PAID_MEMORY_LOAD_LEVELS) {
        const row = assemblePaidMemoryPromptRow({ modelId, config, currentTurn: turn, load });
        const freeRow = assemblePaidMemoryPromptRow({
          modelId,
          config: configById("FREE_CURRENT"),
          currentTurn: turn,
          load,
        });
        const pCharge = computeUserPointCharge(
          modelId,
          row.localEstimatedTokensTotal,
          AUDIT_OUTPUT_PRESET_CHARS.canonical
        );
        const freeP = computeUserPointCharge(
          modelId,
          freeRow.localEstimatedTokensTotal,
          AUDIT_OUTPUT_PRESET_CHARS.canonical
        );
        const pDelta = pCharge - freeP;
        const inputAmp =
          freeRow.localEstimatedTokensTotal > 0
            ? row.localEstimatedTokensTotal / freeRow.localEstimatedTokensTotal
            : 1;
        const turnAmp = freeP > 0 ? pCharge / freeP : 1;
        rows.push({
          modelId,
          configId: config.id,
          tStage: turn,
          load,
          inputTokens: row.localEstimatedTokensTotal,
          outputTarget: AUDIT_OUTPUT_PRESET_CHARS.canonical,
          pCharge,
          pDeltaVsFree: pDelta,
          pDeltaPercentVsFree: freeP > 0 ? (pDelta / freeP) * 100 : 0,
          inputAmplificationVsFree: inputAmp,
          turnPriceAmplificationVsFree: turnAmp,
          crossed28k: row.crossed28k,
          crossed40k: row.crossed40k,
          crossed50k: row.crossed50k,
          crossed60k: row.crossed60k,
          trimOccurred: row.trimmedHistoryMessages > 0 || row.truncatedMemory,
          criticalLoss: row.criticalSectionOmitted,
        });
      }
    }
  }
  return rows;
}

export function buildTurnPriceAmplificationTable(modelId: string): TurnPriceAmplificationRow[] {
  const rows: TurnPriceAmplificationRow[] = [];
  for (const turn of PAID_MEMORY_HISTORY_STAGES) {
    for (const load of PAID_MEMORY_LOAD_LEVELS) {
      for (const output of AUDIT_OUTPUT_PRESETS) {
        const freeP = computeUserPointCharge(
          modelId,
          assemblePaidMemoryPromptRow({
            modelId,
            config: configById("FREE_CURRENT"),
            currentTurn: turn,
            load,
          }).localEstimatedTokensTotal,
          output
        );
        const paidP = computeUserPointCharge(
          modelId,
          assemblePaidMemoryPromptRow({
            modelId,
            config: configById("PAID_CURRENT"),
            currentTurn: turn,
            load,
          }).localEstimatedTokensTotal,
          output
        );
        const g15P = computeUserPointCharge(
          modelId,
          assemblePaidMemoryPromptRow({
            modelId,
            config: configById("PAID_GLOBAL_15K"),
            currentTurn: turn,
            load,
          }).localEstimatedTokensTotal,
          output
        );
        rows.push({
          modelId,
          currentTurn: turn,
          load,
          outputPresetChars: output,
          freeP,
          paidCurrentP: paidP,
          paidGlobal15P: g15P,
          paidCurrentAmplification: freeP > 0 ? paidP / freeP : 1,
          global15Amplification: paidP > 0 ? g15P / paidP : 1,
          global15PDeltaPercent: paidP > 0 ? ((g15P - paidP) / paidP) * 100 : 0,
        });
      }
    }
  }
  return rows;
}

export function buildExpensiveTurnBoundary(modelId: string): ExpensiveTurnBoundaryRow {
  const pick = (
    configId: PaidMemoryConfigId,
    load: LoadLevel,
    turn: HistoryStage = 2000
  ) => {
    const row = assemblePaidMemoryPromptRow({
      modelId,
      config: configById(configId),
      currentTurn: turn,
      load,
    });
    const p = computeUserPointCharge(
      modelId,
      row.localEstimatedTokensTotal,
      AUDIT_OUTPUT_PRESET_CHARS.canonical
    );
    const raw = computeRawProviderCost({
      modelId,
      configId,
      inputTokens: row.localEstimatedTokensTotal,
      outputPresetChars: AUDIT_OUTPUT_PRESET_CHARS.canonical,
      scenario: "NO_CACHE",
    });
    return { inputTokens: row.localEstimatedTokensTotal, pCharge: p, rawKrw: raw.rawKrw, turn };
  };

  let maxObserved = {
    inputTokens: 0,
    pCharge: 0,
    rawKrw: 0,
    turn: 100 as HistoryStage,
    configId: "FREE_CURRENT" as PaidMemoryConfigId,
    load: "NORMAL" as LoadLevel,
  };
  for (const config of PAID_MEMORY_CONFIGS) {
    for (const turn of PAID_MEMORY_HISTORY_STAGES) {
      for (const load of PAID_MEMORY_LOAD_LEVELS) {
        const row = assemblePaidMemoryPromptRow({ modelId, config, currentTurn: turn, load });
        const p = computeUserPointCharge(
          modelId,
          row.localEstimatedTokensTotal,
          AUDIT_OUTPUT_PRESET_CHARS.canonical
        );
        if (row.localEstimatedTokensTotal > maxObserved.inputTokens) {
          maxObserved = {
            inputTokens: row.localEstimatedTokensTotal,
            pCharge: p,
            rawKrw: computeRawProviderCost({
              modelId,
              configId: config.id,
              inputTokens: row.localEstimatedTokensTotal,
              outputPresetChars: AUDIT_OUTPUT_PRESET_CHARS.canonical,
              scenario: "NO_CACHE",
            }).rawKrw,
            turn,
            configId: config.id,
            load,
          };
        }
      }
    }
  }

  return {
    modelId,
    cheapestNormalCurrent: pick("FREE_CURRENT", "NORMAL", 100),
    normalPaidCurrent: pick("PAID_CURRENT", "NORMAL", 1000),
    normalPaidGlobal15: pick("PAID_GLOBAL_15K", "NORMAL", 1000),
    peakPaidCurrent: pick("PAID_CURRENT", "PEAK_MEMORY", 2000),
    peakPaidGlobal15: pick("PAID_GLOBAL_15K", "PEAK_MEMORY", 2000),
    maxObserved,
  };
}

export function buildLongRpPriceDrift(modelId: string): LongRpPriceDriftRow[] {
  const rows: LongRpPriceDriftRow[] = [];
  for (const config of PAID_MEMORY_CONFIGS) {
    for (const output of AUDIT_OUTPUT_PRESETS) {
      const pAt = (turn: HistoryStage) =>
        computeUserPointCharge(
          modelId,
          assemblePaidMemoryPromptRow({
            modelId,
            config,
            currentTurn: turn,
            load: "PEAK_MEMORY",
          }).localEstimatedTokensTotal,
          output
        );
      const t100 = pAt(100);
      const t2000 = pAt(2000);
      rows.push({
        modelId,
        configId: config.id,
        outputPresetChars: output,
        t100P: t100,
        t300P: pAt(300),
        t1000P: pAt(1000),
        t2000P: t2000,
        driftPercentT100ToT2000: t100 > 0 ? ((t2000 - t100) / t100) * 100 : 0,
      });
    }
  }
  return rows;
}

export function buildPointTopUpEconomics(): PointTopUpEconomicsRow[] {
  return POINT_TOPUP_TIERS.map((tier) => {
    const bonus = tier.subscriberP - tier.normalP;
    return {
      krwPaid: tier.krw,
      normalCreditsP: tier.normalP,
      subscriberCreditsP: tier.subscriberP,
      subscriberBonusP: bonus,
      normalEffectiveKrwPerP: tier.krw / tier.normalP,
      subscriberEffectiveKrwPerP: tier.krw / tier.subscriberP,
      discountDifferencePctPoints:
        (1 - tier.krw / tier.subscriberP / (tier.krw / tier.normalP)) * 100,
    };
  });
}

export function summarizeInputBands(matrix: PromptAssemblyRow[]): InputBandSummary[] {
  const counts = new Map<InputPressureBand, number>();
  for (const row of matrix) {
    counts.set(row.inputPressureBand, (counts.get(row.inputPressureBand) ?? 0) + 1);
  }
  const bands: InputPressureBand[] = [
    "UNDER_28K",
    "28K_TO_40K",
    "40K_TO_50K",
    "50K_TO_60K",
    "60K_OR_MORE",
  ];
  return bands.map((band) => ({ band, fixtureCount: counts.get(band) ?? 0 }));
}

export type CacheBoundaryAudit = {
  modelId: string;
  contextProvider: ReturnType<typeof resolveAuditContextProvider>;
  hasOpenRouterSplit: boolean;
  staticCacheEligibleSectionIds: string[];
  dynamicSectionIds: string[];
  globalInStaticCache: boolean;
  globalInDynamic: boolean;
  userLorebookInDynamic: boolean;
};

export function auditCacheBoundary(modelId: string, load: LoadLevel = "PEAK_MEMORY"): CacheBoundaryAudit {
  const config = PAID_MEMORY_CONFIGS.find((c) => c.id === "PAID_CURRENT")!;
  const built = buildContext(
    buildPaidMemoryAuditInput({ modelId, config, currentTurn: 1000, load })
  );
  const sections = built.meta.trackedSections ?? [];
  const split = built.openRouterSystemSplit;
  const staticIds = sections
    .filter((s) => split?.characterSettingsBlock.includes(s.text.slice(0, 40)))
    .map((s) => s.id);
  const dynamicIds = sections
    .filter((s) => split?.dynamicBlock.includes(s.text.slice(0, 40)))
    .map((s) => s.id);

  return {
    modelId,
    contextProvider: resolveAuditContextProvider(modelId),
    hasOpenRouterSplit: Boolean(split),
    staticCacheEligibleSectionIds: staticIds,
    dynamicSectionIds: dynamicIds,
    globalInStaticCache: staticIds.includes("current-memory"),
    globalInDynamic: dynamicIds.includes("current-memory"),
    userLorebookInDynamic: dynamicIds.includes("user-lorebook") || sections.some((s) => s.id === "user-lorebook"),
  };
}

export type RateSource = "LIVE_CATALOG" | "FALLBACK" | "OTHER";

export function resolveAuditRateSource(modelId: string): {
  rates: OpenRouterModelRates;
  source: RateSource;
} {
  const rates = resolveOpenRouterModelRates(modelId);
  const live = resolveOpenRouterModelRates(modelId);
  const fallbackNote = rates.label.includes("fallback") || rates.label.includes("estimate");
  void live;
  const source: RateSource = fallbackNote ? "FALLBACK" : "LIVE_CATALOG";
  return { rates, source };
}

export type RawCostScenario = "NO_CACHE" | "ADDED_GLOBAL_CACHE_READ" | "OBSERVED_TYPICAL";

export type RawProviderCostRow = {
  modelId: string;
  configId: PaidMemoryConfigId;
  outputPresetChars: number;
  outputTokensEst: number;
  scenario: RawCostScenario;
  inputTokens: number;
  addedGlobalTokens: number;
  rawUsd: number;
  rawKrw: number;
  inputCostUsd: number;
  cacheReadCostUsd: number;
  outputCostUsd: number;
  rateSource: RateSource;
};

function outputTokensFromChars(chars: number): number {
  return estimateTokens("x".repeat(Math.max(1, chars)));
}

export function computeRawProviderCost(opts: {
  modelId: string;
  configId: PaidMemoryConfigId;
  inputTokens: number;
  outputPresetChars: number;
  scenario: RawCostScenario;
  addedGlobalTokens?: number;
  observedCacheReadRatio?: number;
}): RawProviderCostRow {
  const outputTokens = outputTokensFromChars(opts.outputPresetChars);
  const { rates, source } = resolveAuditRateSource(opts.modelId);
  const fx = resolveBillingExchangeRateSnapshot();
  const addedGlobal = Math.max(0, opts.addedGlobalTokens ?? 0);

  let cacheRead = 0;
  if (opts.scenario === "ADDED_GLOBAL_CACHE_READ" && addedGlobal > 0) {
    cacheRead = addedGlobal;
  } else if (opts.scenario === "OBSERVED_TYPICAL" && opts.observedCacheReadRatio != null) {
    cacheRead = Math.floor(opts.inputTokens * Math.min(1, Math.max(0, opts.observedCacheReadRatio)));
  }

  const breakdown = openRouterUsdCostFromRates({
    promptTokens: opts.inputTokens,
    outputTokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: 0,
    modelId: opts.modelId,
  });

  const readRate =
    rates.cacheReadUsdPerM ??
    (rates.cacheReadMultiplier != null ? rates.inputUsdPerM * rates.cacheReadMultiplier : rates.inputUsdPerM);
  const inputCostUsd =
    (breakdown.standardInputTokens / 1_000_000) * rates.inputUsdPerM +
    (breakdown.cacheWriteTokens / 1_000_000) *
      (rates.cacheWriteUsdPerM ?? rates.inputUsdPerM * rates.cacheWriteMultiplier);
  const cacheReadCostUsd = (breakdown.cacheReadTokens / 1_000_000) * readRate;
  const outputCostUsd = (outputTokens / 1_000_000) * rates.outputUsdPerM;

  return {
    modelId: opts.modelId,
    configId: opts.configId,
    outputPresetChars: opts.outputPresetChars,
    outputTokensEst: outputTokens,
    scenario: opts.scenario,
    inputTokens: opts.inputTokens,
    addedGlobalTokens: addedGlobal,
    rawUsd: breakdown.usdCost,
    rawKrw: breakdown.usdCost * fx.effectiveKrwPerUsd,
    inputCostUsd: inputCostUsd,
    cacheReadCostUsd,
    outputCostUsd,
    rateSource: source,
  };
}

export type UserPointChargeSensitivity = "YES" | "NO" | "CONDITIONAL";

export function classifyUserPointChargeInputSensitivity(modelId: string): UserPointChargeSensitivity {
  const reasoning = resolveOpenRouterReasoningPointRates(modelId);
  if (reasoning) return "YES";
  const surcharge = openRouterInputTokenSurchargeKrw(15_000, modelId);
  if (surcharge > 0) return "CONDITIONAL";
  return "NO";
}

export function computeUserPointCharge(
  modelId: string,
  inputTokens: number,
  outputPresetChars: number
): number {
  const outputTokens = outputTokensFromChars(outputPresetChars);
  return computeOpenRouterTurnCost(inputTokens, outputTokens, modelId);
}

export type MarginImpactRow = {
  modelId: string;
  configId: PaidMemoryConfigId;
  userPoints: number;
  rawKrw: number;
  grossContributionKrw: number;
  marginPct: number | null;
};

export function computeMarginImpact(opts: {
  modelId: string;
  configId: PaidMemoryConfigId;
  inputTokens: number;
  outputPresetChars: number;
}): MarginImpactRow {
  const raw = computeRawProviderCost({
    modelId: opts.modelId,
    configId: opts.configId,
    inputTokens: opts.inputTokens,
    outputPresetChars: opts.outputPresetChars,
    scenario: "NO_CACHE",
  });
  const userPoints = computeUserPointCharge(opts.modelId, opts.inputTokens, opts.outputPresetChars);
  const fx = resolveBillingExchangeRateSnapshot();
  const userKrw = userPoints;
  const gross = userKrw - raw.rawKrw;
  const marginPct = userKrw > 0 ? (gross / userKrw) * 100 : null;
  void fx;
  return {
    modelId: opts.modelId,
    configId: opts.configId,
    userPoints,
    rawKrw: raw.rawKrw,
    grossContributionKrw: gross,
    marginPct,
  };
}

export type GlobalMaintenanceSimulation = {
  globalCapacity: number;
  currentTurn: HistoryStage;
  sealedBlockCount: number;
  rebuiltSourceChars: number;
  firstOverflowTurn: HistoryStage | null;
  incrementalCompactCalls: number;
  fullRebuildCalls: number;
  cumulativeCompactInputTokens: number;
  cumulativeCompactOutputTokensEst: number;
  cumulativeRawUsd: number;
  cumulativeRawKrw: number;
};

function estimateRebuiltSourceChars(turn: number): number {
  const blockCount = Math.floor((turn - 1) / ROLLING_SUMMARY_INTERVAL);
  return blockCount * ROLLING_SUMMARY_TARGET_CHARS;
}

export function simulateGlobalMaintenanceLifecycle(
  globalCapacity: number,
  stages: readonly HistoryStage[] = PAID_MEMORY_HISTORY_STAGES
): GlobalMaintenanceSimulation[] {
  const maintenanceModel = resolveBackgroundPrimaryModelId(process.env.BACKGROUND_MEMORY_MODEL);
  const outputTarget = Math.floor(globalCapacity * LOREBOOK_COMPACT_FILL_RATIO);
  const results: GlobalMaintenanceSimulation[] = [];

  for (const turn of stages) {
    const rebuiltChars = estimateRebuiltSourceChars(turn);
    const overflow = rebuiltChars > globalCapacity;
    const incrementalCalls = overflow ? Math.max(0, Math.floor(turn / ROLLING_SUMMARY_INTERVAL) - 2) : 0;
    const fullRebuildCalls = overflow && turn >= 300 ? 1 : 0;
    const avgCompactInputChars = overflow
      ? Math.min(rebuiltChars, globalCapacity + ROLLING_SUMMARY_TARGET_CHARS * 3)
      : 0;
    const compactInputTokens = estimateTokens("x".repeat(Math.max(0, avgCompactInputChars)));
    const compactOutputTokens = estimateTokens("x".repeat(outputTarget));
    const totalCalls = incrementalCalls + fullRebuildCalls;
    const cumulativeInput = compactInputTokens * Math.max(1, totalCalls);
    const cumulativeOutput = compactOutputTokens * Math.max(1, totalCalls);
    const cost = openRouterUsdCostFromRates({
      promptTokens: cumulativeInput,
      outputTokens: cumulativeOutput,
      modelId: maintenanceModel,
    });
    const fx = resolveBillingExchangeRateSnapshot();

    results.push({
      globalCapacity,
      currentTurn: turn,
      sealedBlockCount: Math.floor((turn - 1) / ROLLING_SUMMARY_INTERVAL),
      rebuiltSourceChars: rebuiltChars,
      firstOverflowTurn: overflow ? turn : null,
      incrementalCompactCalls: incrementalCalls,
      fullRebuildCalls,
      cumulativeCompactInputTokens: cumulativeInput,
      cumulativeCompactOutputTokensEst: cumulativeOutput,
      cumulativeRawUsd: cost.usdCost,
      cumulativeRawKrw: cost.usdCost * fx.effectiveKrwPerUsd,
    });
  }
  return results;
}

export type FullRebuildExceptionCost = {
  globalCapacity: number;
  fullRebuildInputTokens: number;
  compactOutputTokensEst: number;
  rawUsd: number;
  rawKrw: number;
};

export function simulateHistoricalFullRebuildException(globalCapacity: number): FullRebuildExceptionCost {
  const maintenanceModel = resolveBackgroundPrimaryModelId(process.env.BACKGROUND_MEMORY_MODEL);
  const turn = 1000;
  const rebuiltChars = estimateRebuiltSourceChars(turn);
  const inputTokens = estimateTokens("x".repeat(rebuiltChars));
  const outputTokens = estimateTokens("x".repeat(Math.floor(globalCapacity * LOREBOOK_COMPACT_FILL_RATIO)));
  const cost = openRouterUsdCostFromRates({
    promptTokens: inputTokens,
    outputTokens,
    modelId: maintenanceModel,
  });
  const fx = resolveBillingExchangeRateSnapshot();
  return {
    globalCapacity,
    fullRebuildInputTokens: inputTokens,
    compactOutputTokensEst: outputTokens,
    rawUsd: cost.usdCost,
    rawKrw: cost.usdCost * fx.effectiveKrwPerUsd,
  };
}

export type DecisionTableRow = {
  configId: PaidMemoryConfigId;
  peakInputTokens: number;
  normalInputTokens: number;
  historyTrimPeak: boolean;
  criticalLossPeak: boolean;
  perTurnRawCostDeltaKrwVsFree: number;
  turn100RawDeltaKrw: number;
  turn500RawDeltaKrw: number;
  turn1000RawDeltaKrw: number;
  turn2000RawDeltaKrw: number;
  globalMaintenanceDeltaKrw: number;
  userPointChargeDelta: number;
  marginDeltaPctPoints: number | null;
};

function cumulativeTurnCost(
  modelId: string,
  config: PaidMemoryConfig,
  turns: readonly HistoryStage[],
  load: LoadLevel
): number {
  let sum = 0;
  for (const turn of turns) {
    const row = assemblePaidMemoryPromptRow({ modelId, config, currentTurn: turn, load });
    const cost = computeRawProviderCost({
      modelId,
      configId: config.id,
      inputTokens: row.localEstimatedTokensTotal,
      outputPresetChars: UNIFIED_TIER_AIM_CHARS,
      scenario: "NO_CACHE",
    });
    sum += cost.rawKrw;
  }
  return sum;
}

export function buildDecisionTable(modelId: string): DecisionTableRow[] {
  const free = PAID_MEMORY_CONFIGS.find((c) => c.id === "FREE_CURRENT")!;
  const paid = PAID_MEMORY_CONFIGS.find((c) => c.id === "PAID_CURRENT")!;
  const g15 = PAID_MEMORY_CONFIGS.find((c) => c.id === "PAID_GLOBAL_15K")!;
  const g20 = PAID_MEMORY_CONFIGS.find((c) => c.id === "PAID_GLOBAL_20K_REFERENCE")!;

  const rows: DecisionTableRow[] = [];
  for (const config of [free, paid, g15, g20]) {
    const peak = assemblePaidMemoryPromptRow({
      modelId,
      config,
      currentTurn: 2000,
      load: "PEAK_MEMORY",
    });
    const normal = assemblePaidMemoryPromptRow({
      modelId,
      config,
      currentTurn: 1000,
      load: "NORMAL",
    });
    const freePeak = assemblePaidMemoryPromptRow({
      modelId,
      config: free,
      currentTurn: 2000,
      load: "PEAK_MEMORY",
    });
    const peakCost = computeRawProviderCost({
      modelId,
      configId: config.id,
      inputTokens: peak.localEstimatedTokensTotal,
      outputPresetChars: UNIFIED_TIER_AIM_CHARS,
      scenario: "NO_CACHE",
    }).rawKrw;
    const freePeakCost = computeRawProviderCost({
      modelId,
      configId: free.id,
      inputTokens: freePeak.localEstimatedTokensTotal,
      outputPresetChars: UNIFIED_TIER_AIM_CHARS,
      scenario: "NO_CACHE",
    }).rawKrw;

    const maint10 = simulateGlobalMaintenanceLifecycle(MEMORY_CAPACITY_FIXED).slice(-1)[0]!;
    const maintCfg = simulateGlobalMaintenanceLifecycle(config.simulatedGlobalCapacity).slice(-1)[0]!;
    const maintDelta = maintCfg.cumulativeRawKrw - maint10.cumulativeRawKrw;

    const userPeak = computeUserPointCharge(modelId, peak.localEstimatedTokensTotal, UNIFIED_TIER_AIM_CHARS);
    const freeUserPeak = computeUserPointCharge(
      modelId,
      freePeak.localEstimatedTokensTotal,
      UNIFIED_TIER_AIM_CHARS
    );

    const marginPeak = computeMarginImpact({
      modelId,
      configId: config.id,
      inputTokens: peak.localEstimatedTokensTotal,
      outputPresetChars: UNIFIED_TIER_AIM_CHARS,
    });
    const marginFree = computeMarginImpact({
      modelId,
      configId: free.id,
      inputTokens: freePeak.localEstimatedTokensTotal,
      outputPresetChars: UNIFIED_TIER_AIM_CHARS,
    });

    rows.push({
      configId: config.id,
      peakInputTokens: peak.localEstimatedTokensTotal,
      normalInputTokens: normal.localEstimatedTokensTotal,
      historyTrimPeak: peak.trimmedHistoryMessages > 0,
      criticalLossPeak: peak.criticalSectionOmitted,
      perTurnRawCostDeltaKrwVsFree: peakCost - freePeakCost,
      turn100RawDeltaKrw:
        cumulativeTurnCost(modelId, config, [100], "PEAK_MEMORY") -
        cumulativeTurnCost(modelId, free, [100], "PEAK_MEMORY"),
      turn500RawDeltaKrw:
        cumulativeTurnCost(modelId, config, [100, 300], "PEAK_MEMORY") -
        cumulativeTurnCost(modelId, free, [100, 300], "PEAK_MEMORY"),
      turn1000RawDeltaKrw:
        cumulativeTurnCost(modelId, config, [100, 300, 1000], "PEAK_MEMORY") -
        cumulativeTurnCost(modelId, free, [100, 300, 1000], "PEAK_MEMORY"),
      turn2000RawDeltaKrw:
        cumulativeTurnCost(modelId, config, [100, 300, 1000, 2000], "PEAK_MEMORY") -
        cumulativeTurnCost(modelId, free, [100, 300, 1000, 2000], "PEAK_MEMORY"),
      globalMaintenanceDeltaKrw: maintDelta,
      userPointChargeDelta: userPeak - freeUserPeak,
      marginDeltaPctPoints:
        marginPeak.marginPct != null && marginFree.marginPct != null
          ? marginPeak.marginPct - marginFree.marginPct
          : null,
    });
  }

  return rows;
}

export type PaidMemoryDeltaPair = {
  from: PaidMemoryConfigId;
  to: PaidMemoryConfigId;
  peakInputTokenDelta: number;
  peakRawCostDeltaKrw: number;
  userPointDelta: number;
};

export function computePaidMemoryDeltas(modelId: string): PaidMemoryDeltaPair[] {
  const pairs: Array<[PaidMemoryConfigId, PaidMemoryConfigId]> = [
    ["FREE_CURRENT", "PAID_CURRENT"],
    ["PAID_CURRENT", "PAID_GLOBAL_15K"],
    ["PAID_GLOBAL_15K", "PAID_GLOBAL_20K_REFERENCE"],
  ];
  return pairs.map(([fromId, toId]) => {
    const fromCfg = PAID_MEMORY_CONFIGS.find((c) => c.id === fromId)!;
    const toCfg = PAID_MEMORY_CONFIGS.find((c) => c.id === toId)!;
    const fromRow = assemblePaidMemoryPromptRow({
      modelId,
      config: fromCfg,
      currentTurn: 2000,
      load: "PEAK_MEMORY",
    });
    const toRow = assemblePaidMemoryPromptRow({
      modelId,
      config: toCfg,
      currentTurn: 2000,
      load: "PEAK_MEMORY",
    });
    const fromCost = computeRawProviderCost({
      modelId,
      configId: fromId,
      inputTokens: fromRow.localEstimatedTokensTotal,
      outputPresetChars: UNIFIED_TIER_AIM_CHARS,
      scenario: "NO_CACHE",
    }).rawKrw;
    const toCost = computeRawProviderCost({
      modelId,
      configId: toId,
      inputTokens: toRow.localEstimatedTokensTotal,
      outputPresetChars: UNIFIED_TIER_AIM_CHARS,
      scenario: "NO_CACHE",
    }).rawKrw;
    return {
      from: fromId,
      to: toId,
      peakInputTokenDelta: toRow.localEstimatedTokensTotal - fromRow.localEstimatedTokensTotal,
      peakRawCostDeltaKrw: toCost - fromCost,
      userPointDelta:
        computeUserPointCharge(modelId, toRow.localEstimatedTokensTotal, UNIFIED_TIER_AIM_CHARS) -
        computeUserPointCharge(modelId, fromRow.localEstimatedTokensTotal, UNIFIED_TIER_AIM_CHARS),
    };
  });
}

export type PaidMemoryAuditReport = {
  classification: typeof AUDIT_CODE_CLASSIFICATION;
  productionSha: string;
  originMainSha: string;
  railwayDeployment: string;
  railwayStatus: string;
  productModel: typeof PRODUCT_MODEL;
  assemblySource: "PRODUCTION_BUILD_CONTEXT";
  tokenMode: "REAL_ASSEMBLY_LOCAL_ESTIMATE";
  providerCalibration: "INSUFFICIENT_DATA" | "AVAILABLE";
  competitorBenchmark: "NOT_PERFORMED_IN_THIS_AUDIT";
  mainRpModels: readonly string[];
  fxSnapshot: ReturnType<typeof resolveBillingExchangeRateSnapshot>;
  matrix: PromptAssemblyRow[];
  absoluteMaxTable: AbsoluteMaxInputRow[];
  inputBandSummary: InputBandSummary[];
  sixtyKRootCauses: SixtyKRootCause[];
  duplicationAudits: DuplicationAudit[];
  primaryDecisionTable: PrimaryDecisionRow[];
  turnPriceMatrix: TurnPriceRow[];
  turnPriceAmplification: TurnPriceAmplificationRow[];
  inputAmplification: InputAmplificationRow[];
  expensiveTurnBoundary: ExpensiveTurnBoundaryRow[];
  longRpPriceDrift: LongRpPriceDriftRow[];
  memoryCostPassThrough: MemoryCostPassThroughRow[];
  decisionTables: Record<string, DecisionTableRow[]>;
  deltas: Record<string, PaidMemoryDeltaPair[]>;
  cacheBoundaries: CacheBoundaryAudit[];
  globalMaintenance: GlobalMaintenanceSimulation[];
  fullRebuildExceptions: FullRebuildExceptionCost[];
  pointTopUpEconomics: PointTopUpEconomicsRow[];
  pointChargeSensitivity: Record<string, UserPointChargeSensitivity>;
  summaryByModel: Record<
    string,
    {
      maxFreeInput: number;
      maxPaidCurrentInput: number;
      maxPaidGlobal15Input: number;
      maxPaidGlobal20Input: number;
      paidCurrentInputAmplification: number;
      global15InputAmplification: number;
      paidCurrentTurnPriceAmplification: number;
      global15TurnPriceAmplification: number;
      paidCurrentPeakP: number;
      global15PeakP: number;
      global15PDeltaPercent: number;
      longRpPriceDriftT100ToT2000: number;
      memoryIncrementalCostRecovery: MemoryCostPassThrough;
      global15Gte60k: boolean;
      global20Gte60k: boolean;
    }
  >;
  worstFixture: PromptAssemblyRow | null;
  worstPaidGlobal15: PromptAssemblyRow | null;
  worstPaidCurrent: PromptAssemblyRow | null;
  providerGenerationCalls: 0;
  runtimeChange: "NO";
  pricingChange: "NO";
  billingChange: "NO";
  pointTopupSubscriberBonus: "SIMULATION_ONLY";
};

export function generatePaidMemoryAuditReport(
  productionSha: string,
  opts?: { originMainSha?: string }
): PaidMemoryAuditReport {
  clearPaidMemoryAuditRowCache();
  const env = process.env as Record<string, string | undefined>;
  const prevEnv = env.NODE_ENV;
  env.NODE_ENV = "production";

  try {
    const matrix: PromptAssemblyRow[] = [];
    for (const modelId of MAIN_RP_MODEL_IDS) {
      for (const config of PAID_MEMORY_CONFIGS) {
        for (const currentTurn of PAID_MEMORY_HISTORY_STAGES) {
          for (const load of PAID_MEMORY_LOAD_LEVELS) {
            matrix.push(assemblePaidMemoryPromptRow({ modelId, config, currentTurn, load }));
          }
        }
      }
    }

    const absoluteMaxTable = MAIN_RP_MODEL_IDS.map(buildAbsoluteMaxInputTable);
    const primaryDecisionTable = MAIN_RP_MODEL_IDS.flatMap(buildPrimaryDecisionTable);
    const turnPriceMatrix: TurnPriceRow[] = [];
    const inputAmplification: InputAmplificationRow[] = [];
    const turnPriceAmplification: TurnPriceAmplificationRow[] = [];
    const expensiveTurnBoundary: ExpensiveTurnBoundaryRow[] = [];
    const longRpPriceDrift: LongRpPriceDriftRow[] = [];
    const memoryCostPassThrough: MemoryCostPassThroughRow[] = [];
    const duplicationAudits: DuplicationAudit[] = [];
    const decisionTables: Record<string, DecisionTableRow[]> = {};
    const deltas: Record<string, PaidMemoryDeltaPair[]> = {};
    const summaryByModel: PaidMemoryAuditReport["summaryByModel"] = {};

    for (const modelId of MAIN_RP_MODEL_IDS) {
      decisionTables[modelId] = buildDecisionTable(modelId);
      deltas[modelId] = computePaidMemoryDeltas(modelId);
      turnPriceAmplification.push(...buildTurnPriceAmplificationTable(modelId));
      expensiveTurnBoundary.push(buildExpensiveTurnBoundary(modelId));
      longRpPriceDrift.push(...buildLongRpPriceDrift(modelId));

      for (const turn of PAID_MEMORY_HISTORY_STAGES) {
        for (const load of PAID_MEMORY_LOAD_LEVELS) {
          inputAmplification.push(buildInputAmplificationTable(modelId, turn, load));
          duplicationAudits.push(
            auditDuplicationOverlap({
              modelId,
              config: configById("PAID_CURRENT"),
              currentTurn: turn,
              load,
            })
          );
          for (const config of PAID_MEMORY_CONFIGS) {
            for (const output of AUDIT_OUTPUT_PRESETS) {
              turnPriceMatrix.push(
                buildTurnPriceRow({ modelId, configId: config.id, currentTurn: turn, load, outputPresetChars: output })
              );
            }
          }
          const paidRow = assemblePaidMemoryPromptRow({
            modelId,
            config: configById("PAID_CURRENT"),
            currentTurn: turn,
            load,
          });
          const g15Row = assemblePaidMemoryPromptRow({
            modelId,
            config: configById("PAID_GLOBAL_15K"),
            currentTurn: turn,
            load,
          });
          const rawDelta =
            computeRawProviderCost({
              modelId,
              configId: "PAID_GLOBAL_15K",
              inputTokens: g15Row.localEstimatedTokensTotal,
              outputPresetChars: AUDIT_OUTPUT_PRESET_CHARS.canonical,
              scenario: "NO_CACHE",
            }).rawKrw -
            computeRawProviderCost({
              modelId,
              configId: "PAID_CURRENT",
              inputTokens: paidRow.localEstimatedTokensTotal,
              outputPresetChars: AUDIT_OUTPUT_PRESET_CHARS.canonical,
              scenario: "NO_CACHE",
            }).rawKrw;
          const pDelta =
            computeUserPointCharge(modelId, g15Row.localEstimatedTokensTotal, AUDIT_OUTPUT_PRESET_CHARS.canonical) -
            computeUserPointCharge(modelId, paidRow.localEstimatedTokensTotal, AUDIT_OUTPUT_PRESET_CHARS.canonical);
          memoryCostPassThrough.push({
            modelId,
            currentTurn: turn,
            load,
            outputPresetChars: AUDIT_OUTPUT_PRESET_CHARS.canonical,
            rawKrwDeltaGlobal15: rawDelta,
            pDeltaGlobal15: pDelta,
            recovery: classifyMemoryCostPassThrough({ modelId, rawKrwDelta: rawDelta, pDelta }),
          });
        }
      }

      const abs = absoluteMaxTable.find((r) => r.modelId === modelId)!;
      const amp = buildInputAmplificationTable(modelId, 2000, "PEAK_MEMORY");
      const tpa = turnPriceAmplification.find(
        (r) => r.modelId === modelId && r.currentTurn === 2000 && r.load === "PEAK_MEMORY" && r.outputPresetChars === AUDIT_OUTPUT_PRESET_CHARS.canonical
      )!;
      const drift = longRpPriceDrift.find(
        (r) =>
          r.modelId === modelId &&
          r.configId === "PAID_CURRENT" &&
          r.outputPresetChars === AUDIT_OUTPUT_PRESET_CHARS.canonical
      )!;
      const pass = memoryCostPassThrough.find(
        (r) =>
          r.modelId === modelId &&
          r.currentTurn === 2000 &&
          r.load === "PEAK_MEMORY" &&
          r.outputPresetChars === AUDIT_OUTPUT_PRESET_CHARS.canonical
      )!;
      summaryByModel[modelId] = {
        maxFreeInput: abs.freeMaxInput,
        maxPaidCurrentInput: abs.paidCurrentMaxInput,
        maxPaidGlobal15Input: abs.paidGlobal15MaxInput,
        maxPaidGlobal20Input: abs.paidGlobal20MaxInput,
        paidCurrentInputAmplification: amp.paidCurrentRatio,
        global15InputAmplification: amp.global15Ratio,
        paidCurrentTurnPriceAmplification: tpa.paidCurrentAmplification,
        global15TurnPriceAmplification: tpa.global15Amplification,
        paidCurrentPeakP: tpa.paidCurrentP,
        global15PeakP: tpa.paidGlobal15P,
        global15PDeltaPercent: tpa.global15PDeltaPercent,
        longRpPriceDriftT100ToT2000: drift.driftPercentT100ToT2000,
        memoryIncrementalCostRecovery: pass.recovery,
        global15Gte60k: abs.global15Gte60k,
        global20Gte60k: abs.paidGlobal20MaxInput >= 60_000,
      };
    }

    const sixtyKRootCauses = matrix
      .filter((r) => r.crossed60k)
      .map(analyzeSixtyKRootCause)
      .filter((r): r is SixtyKRootCause => r != null);

    const worstFixture =
      matrix.reduce<PromptAssemblyRow | null>(
        (best, row) =>
          !best || row.localEstimatedTokensTotal > best.localEstimatedTokensTotal ? row : best,
        null
      );
    const worstPaidGlobal15 =
      matrix
        .filter((r) => r.configId === "PAID_GLOBAL_15K")
        .reduce<PromptAssemblyRow | null>(
          (best, row) =>
            !best || row.localEstimatedTokensTotal > best.localEstimatedTokensTotal ? row : best,
          null
        );
    const worstPaidCurrent =
      matrix
        .filter((r) => r.configId === "PAID_CURRENT")
        .reduce<PromptAssemblyRow | null>(
          (best, row) =>
            !best || row.localEstimatedTokensTotal > best.localEstimatedTokensTotal ? row : best,
          null
        );

    return {
      classification: AUDIT_CODE_CLASSIFICATION,
      productionSha,
      originMainSha: opts?.originMainSha ?? productionSha,
      railwayDeployment: "1c3185ff-1434-4c14-a1d3-c6914016d16b",
      railwayStatus: "SUCCESS",
      productModel: PRODUCT_MODEL,
      assemblySource: "PRODUCTION_BUILD_CONTEXT",
      tokenMode: "REAL_ASSEMBLY_LOCAL_ESTIMATE",
      providerCalibration: "INSUFFICIENT_DATA",
      competitorBenchmark: "NOT_PERFORMED_IN_THIS_AUDIT",
      mainRpModels: MAIN_RP_MODEL_IDS,
      fxSnapshot: resolveBillingExchangeRateSnapshot(),
      matrix,
      absoluteMaxTable,
      inputBandSummary: summarizeInputBands(matrix),
      sixtyKRootCauses,
      duplicationAudits,
      primaryDecisionTable,
      turnPriceMatrix,
      turnPriceAmplification,
      inputAmplification,
      expensiveTurnBoundary,
      longRpPriceDrift,
      memoryCostPassThrough,
      decisionTables,
      deltas,
      cacheBoundaries: MAIN_RP_MODEL_IDS.map((id) => auditCacheBoundary(id)),
      globalMaintenance: [
        ...simulateGlobalMaintenanceLifecycle(MEMORY_CAPACITY_FIXED),
        ...simulateGlobalMaintenanceLifecycle(15_000),
        ...simulateGlobalMaintenanceLifecycle(20_000),
      ],
      fullRebuildExceptions: [10_000, 15_000, 20_000].map(simulateHistoricalFullRebuildException),
      pointTopUpEconomics: buildPointTopUpEconomics(),
      pointChargeSensitivity: Object.fromEntries(
        MAIN_RP_MODEL_IDS.map((id) => [id, classifyUserPointChargeInputSensitivity(id)])
      ),
      summaryByModel,
      worstFixture,
      worstPaidGlobal15,
      worstPaidCurrent,
      providerGenerationCalls: 0,
      runtimeChange: "NO",
      pricingChange: "NO",
      billingChange: "NO",
      pointTopupSubscriberBonus: "SIMULATION_ONLY",
    };
  } finally {
    if (prevEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = prevEnv;
  }
}

export function formatPaidMemoryAuditMarkdown(report: PaidMemoryAuditReport): string {
  const lines: string[] = [];
  lines.push("# Peak Input Pressure + Paid-Memory Turn Price Audit");
  lines.push("");
  lines.push("## PRODUCTION DEPLOYMENT");
  lines.push(`- Railway deployment: \`${report.railwayDeployment}\``);
  lines.push(`- Railway status: ${report.railwayStatus}`);
  lines.push(`- Production SHA: \`${report.productionSha}\``);
  lines.push(`- Origin main (latest fetch): \`${report.originMainSha}\``);
  lines.push("");
  lines.push("## PRODUCT MODEL");
  lines.push(`- SUBSCRIPTION_PRODUCT_TYPE = ${report.productModel.subscriptionType}`);
  lines.push(`- NORMAL_USAGE_BILLING = ${report.productModel.normalUsageBilling}`);
  lines.push("- Memory add-on expands Focus/User Lorebook/Global; does NOT unlimit Main RP turns.");
  lines.push("");
  lines.push("## OWNER MAP");
  for (const [k, v] of Object.entries(OWNER_MAP)) {
    lines.push(`- **${k}**: ${v}`);
  }
  lines.push("");
  lines.push("## MAIN RP MODEL REGISTRY");
  for (const profile of listMainRpModelProfiles()) {
    lines.push(`- ${profile.modelId} (${profile.label})`);
  }
  lines.push("");
  lines.push("## ABSOLUTE MAX INPUT TABLE");
  lines.push("| MODEL | FREE | PAID | G15 | G20 | G15≥28K | G15≥40K | G15≥50K | G15≥60K | stage |");
  lines.push("|---|---:|---:|---:|---:|---|---|---|---:|---|");
  for (const row of report.absoluteMaxTable) {
    lines.push(
      `| ${row.modelId} | ${row.freeMaxInput} | ${row.paidCurrentMaxInput} | ${row.paidGlobal15MaxInput} | ${row.paidGlobal20MaxInput} | ${row.global15Gte28k ? "Y" : "N"} | ${row.global15Gte40k ? "Y" : "N"} | ${row.global15Gte50k ? "Y" : "N"} | ${row.global15Gte60k ? "Y" : "N"} | T${row.maxStage}/${row.maxLoad} |`
    );
  }
  lines.push("");
  lines.push("## 28K / 40K / 50K / 60K BANDS");
  for (const band of report.inputBandSummary) {
    lines.push(`- ${band.band}: ${band.fixtureCount} fixtures`);
  }
  if (report.worstFixture) {
    lines.push(
      `- worst overall: ${report.worstFixture.modelId} ${report.worstFixture.configId} T${report.worstFixture.currentTurn} ${report.worstFixture.load} = ${report.worstFixture.localEstimatedTokensTotal} tokens (${report.worstFixture.inputPressureBand})`
    );
  }
  lines.push("");
  lines.push("## SIXTY-K ROOT CAUSE");
  if (report.sixtyKRootCauses.length === 0) {
    lines.push("- No legitimate fixture reached 60K+ LOCAL_ESTIMATED_TOKENS.");
  } else {
    for (const cause of report.sixtyKRootCauses) {
      lines.push(
        `- ${cause.modelId} ${cause.configId} T${cause.currentTurn} ${cause.load}: ${cause.primaryCause} — ${cause.detail}`
      );
    }
  }
  lines.push("");
  lines.push("## INPUT AMPLIFICATION (T2000 PEAK)");
  for (const modelId of report.mainRpModels) {
    const s = report.summaryByModel[modelId];
    if (!s) continue;
    lines.push(
      `- ${modelId}: PAID_CURRENT=${s.paidCurrentInputAmplification.toFixed(3)}x GLOBAL15=${s.global15InputAmplification.toFixed(3)}x`
    );
  }
  lines.push("");
  lines.push("## TURN PRICE AMPLIFICATION (T2000 PEAK, output=3200 canonical)");
  for (const modelId of report.mainRpModels) {
    const s = report.summaryByModel[modelId];
    if (!s) continue;
    lines.push(
      `- ${modelId}: PAID_CURRENT=${s.paidCurrentTurnPriceAmplification.toFixed(3)}x GLOBAL15=${s.global15TurnPriceAmplification.toFixed(3)}x (Δ${s.global15PDeltaPercent.toFixed(1)}%)`
    );
  }
  lines.push("");
  lines.push("## MEMORY COST PASS-THROUGH (GLOBAL15 vs PAID_CURRENT, T2000 PEAK)");
  for (const modelId of report.mainRpModels) {
    const s = report.summaryByModel[modelId];
    if (!s) continue;
    lines.push(`- ${modelId}: ${s.memoryIncrementalCostRecovery}`);
  }
  lines.push("");
  lines.push("## DUPLICATION / OVERLAP (PAID_CURRENT peak samples)");
  const dupYes = report.duplicationAudits.filter((d) => d.duplicatePromptBloat === "YES");
  lines.push(`- DUPLICATE_PROMPT_BLOAT = ${dupYes.length > 0 ? "YES" : "NO"} (${dupYes.length} fixtures flagged)`);
  lines.push("");
  lines.push("## POINT TOP-UP ECONOMICS — SECONDARY (SIMULATION ONLY)");
  lines.push("| KRW | normal P | subscriber P | bonus P |");
  lines.push("|---:|---:|---:|---:|");
  for (const row of report.pointTopUpEconomics) {
    lines.push(`| ${row.krwPaid} | ${row.normalCreditsP} | ${row.subscriberCreditsP} | ${row.subscriberBonusP} |`);
  }
  lines.push("");
  lines.push("## FINAL CLASSIFICATION");
  lines.push(`- PRODUCTION_SHA = ${report.productionSha}`);
  lines.push(`- AUDIT_TOKEN_MODE = ${report.tokenMode}`);
  lines.push(`- PROVIDER_CALIBRATION = ${report.providerCalibration}`);
  lines.push(`- COMPETITOR_BENCHMARK = ${report.competitorBenchmark}`);
  lines.push(`- POINT_TOPUP_SUBSCRIBER_BONUS = ${report.pointTopupSubscriberBonus}`);
  lines.push(`- PROVIDER_GENERATION_CALLS = ${report.providerGenerationCalls}`);
  lines.push(`- RUNTIME_CHANGE = ${report.runtimeChange}`);
  lines.push(`- MERGE = NO`);
  for (const modelId of report.mainRpModels) {
    const s = report.summaryByModel[modelId];
    if (!s) continue;
    lines.push(`- MAX_FREE_INPUT_${modelId} = ${s.maxFreeInput}`);
    lines.push(`- MAX_PAID_CURRENT_INPUT_${modelId} = ${s.maxPaidCurrentInput}`);
    lines.push(`- MAX_PAID_GLOBAL15_INPUT_${modelId} = ${s.maxPaidGlobal15Input}`);
    lines.push(`- MAX_PAID_GLOBAL20_INPUT_${modelId} = ${s.maxPaidGlobal20Input}`);
    lines.push(`- PAID_CURRENT_INPUT_AMPLIFICATION_${modelId} = ${s.paidCurrentInputAmplification.toFixed(4)}`);
    lines.push(`- GLOBAL15_INPUT_AMPLIFICATION_${modelId} = ${s.global15InputAmplification.toFixed(4)}`);
    lines.push(`- PAID_CURRENT_TURN_PRICE_AMPLIFICATION_${modelId} = ${s.paidCurrentTurnPriceAmplification.toFixed(4)}`);
    lines.push(`- GLOBAL15_TURN_PRICE_AMPLIFICATION_${modelId} = ${s.global15TurnPriceAmplification.toFixed(4)}`);
    lines.push(`- PAID_CURRENT_PEAK_TURN_P_${modelId} = ${s.paidCurrentPeakP}`);
    lines.push(`- GLOBAL15_PEAK_TURN_P_${modelId} = ${s.global15PeakP}`);
    lines.push(`- GLOBAL15_P_DELTA_PERCENT_${modelId} = ${s.global15PDeltaPercent.toFixed(2)}`);
    lines.push(`- LONG_RP_PRICE_DRIFT_T100_TO_T2000_${modelId} = ${s.longRpPriceDriftT100ToT2000.toFixed(2)}%`);
    lines.push(`- MEMORY_INCREMENTAL_COST_RECOVERY_${modelId} = ${s.memoryIncrementalCostRecovery}`);
  }
  const anyG15_60k = report.absoluteMaxTable.some((r) => r.global15Gte60k);
  const anyG20_60k = report.absoluteMaxTable.some((r) => r.paidGlobal20MaxInput >= 60_000);
  lines.push(`- ANY_GLOBAL15_60K_PLUS = ${anyG15_60k ? "YES" : "NO"}`);
  lines.push(`- ANY_GLOBAL20_60K_PLUS = ${anyG20_60k ? "YES" : "NO"}`);
  lines.push(
    `- GLOBAL15_CRITICAL_CONTEXT_LOSS = ${report.worstPaidGlobal15?.criticalSectionOmitted ? "YES" : "NO"}`
  );
  lines.push(
    `- DUPLICATE_PROMPT_BLOAT = ${report.duplicationAudits.some((d) => d.duplicatePromptBloat === "YES") ? "YES" : "NO"}`
  );

  return lines.join("\n");
}

export { listMainRpModelProfiles, MAIN_RP_USER_SELECTABLE_OPTIONS, selectedAIProvider };
