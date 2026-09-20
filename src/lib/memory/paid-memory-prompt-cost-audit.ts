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
import { CHAT_MESSAGE_MAX } from "@/lib/chatModels";
import { AI_LEARNING_LIMIT } from "@/lib/characterFormLimits";
import { resolveEpisodicMemoryMaxChars } from "@/lib/episodicMemoryFacts";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import { resolveMaxPayloadInputTokens } from "@/lib/contextTrack";
import {
  buildLorebookActivationText,
  buildKeywordLorebookPromptBlock,
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_ENTRY_MAX,
  LOREBOOK_KEYWORDS_PER_ENTRY,
  LOREBOOK_ACTIVATION_MAX_CHARS,
  matchKeywordLorebookEntryDetails,
  mergeMatches,
  type KeywordLorebookEntry,
  type KeywordLorebookMatch,
} from "@/lib/keywordLorebooks";
import {
  applyUserLorebookTurnInjectionBudget,
  buildUserLorebookPromptBlock,
  selectEffectiveActiveUserLorebookEntries,
  type UserLorebookStoredEntry,
} from "@/lib/userLorebook";
import {
  computeOpenRouterTurnCost,
  openRouterInputTokenSurchargeKrw,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";
import { PERSONA_CONTENT_MAX, USER_NOTE_FOCUS_MAX } from "@/lib/persona";
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
/** NORMAL = realistic RP; MEMORY_PEAK = subscription memory tiers max + realistic-heavy Creator; ABSOLUTE_VALID_STRESS = all canonical variable owners at server-valid max. */
export type LoadLevel = "NORMAL" | "MEMORY_PEAK" | "ABSOLUTE_VALID_STRESS";

export const PAID_MEMORY_HISTORY_STAGES: readonly HistoryStage[] = [100, 300, 1000, 2000];
export const PAID_MEMORY_LOAD_LEVELS: readonly LoadLevel[] = [
  "NORMAL",
  "MEMORY_PEAK",
  "ABSOLUTE_VALID_STRESS",
];
/**
 * CURRENT production stress: matched entries inside ONE attached keyword_lorebooks container.
 * NOT the target "N lorebooks attached per character" model — see CREATOR_LOREBOOK_PRODUCT_MODEL.
 */
export const CURRENT_CONTAINER_ENTRY_STRESS_COUNTS = [1, 10, 25, 50, 100] as const;
export type CurrentContainerEntryStressCount = (typeof CURRENT_CONTAINER_ENTRY_STRESS_COUNTS)[number];

/** @deprecated Use CURRENT_CONTAINER_ENTRY_STRESS_COUNTS — old name implied target attach count. */
export const CREATOR_STRESS_MATCH_COUNTS = CURRENT_CONTAINER_ENTRY_STRESS_COUNTS;
/** @deprecated Use CurrentContainerEntryStressCount */
export type CreatorStressMatchCount = CurrentContainerEntryStressCount;

/** TARGET product forensic reference: independent lorebook units attached per character (not yet in schema). */
export const TARGET_ATTACHED_LOREBOOK_STRESS_COUNTS = [1, 5, 10, 15, 20] as const;
export type TargetAttachedLorebookStressCount = (typeof TARGET_ATTACHED_LOREBOOK_STRESS_COUNTS)[number];

/** Realistic-heavy Creator fixture for MEMORY_PEAK — ~3 container entries via production matcher. */
export const MEMORY_PEAK_REALISTIC_CREATOR_MATCH_COUNT = 3;

/** Target product limits — design intent; NOT current production owners. */
export const TARGET_CREATOR_LOREBOOK_LIMITS = {
  characterAttachMax: 20,
  lorebookContentMaxChars: LOREBOOK_CONTENT_MAX,
  lorebookKeywordsMax: LOREBOOK_KEYWORDS_PER_ENTRY,
  /** Required future owner: caps total chars/units injected per turn (storage attach ≠ injection). */
  perTurnInjectionBudgetOwner: "REQUIRED_NOT_IMPLEMENTED",
} as const;

/**
 * CURRENT main vs TARGET Creator Lorebook product model.
 * Mismatch: do NOT treat LOREBOOK_ENTRY_MAX (100) as "20 lorebooks per character".
 */
export const CREATOR_LOREBOOK_PRODUCT_MODEL = {
  mismatch: true as const,
  current: {
    characterAttach: "characters.lorebook_id INTEGER — single FK, exactly 0 or 1 keyword_lorebooks row",
    lorebookUnit: "keyword_lorebooks row = named container; entries_json holds up to LOREBOOK_ENTRY_MAX (100) keyword→content entries",
    entryContentMaxChars: LOREBOOK_CONTENT_MAX,
    keywordsPerEntry: LOREBOOK_KEYWORDS_PER_ENTRY,
    perTurnInjectionCap: "NONE — all uniquely matched entries joined without char/token budget",
    activationScanCap: LOREBOOK_ACTIVATION_MAX_CHARS,
    activationOwner: "loadKeywordLorebookPromptBlockFromActivation → matchKeywordLorebookEntryDetails → mergeMatches → buildKeywordLorebookPromptBlock",
    ui: "CreateCharacter: single <select> lorebook_id; CreateKeywordLorebook: multi-entry editor inside one container",
    api: "POST /api/lorebooks with entries[]; character save validates single lorebook_id ownership",
    theoreticalMaxInjectCharsNoCap: LOREBOOK_ENTRY_MAX * LOREBOOK_CONTENT_MAX,
  },
  target: {
    characterAttachMax: TARGET_CREATOR_LOREBOOK_LIMITS.characterAttachMax,
    lorebookUnit: "One lorebook = one 800-char content block + up to 10 keywords (NOT multi-entry container)",
    lorebookContentMaxChars: TARGET_CREATOR_LOREBOOK_LIMITS.lorebookContentMaxChars,
    keywordsPerLorebook: TARGET_CREATOR_LOREBOOK_LIMITS.lorebookKeywordsMax,
    perTurnInjectionCap: "Separate PER-TURN INJECTION BUDGET owner — keyword hit + carryover only; must NOT inject all 20×800 every turn",
    storageVsInjection: "Character may store/attach 20 lorebooks; injection budget is a different responsibility",
    theoreticalMaxStorageChars: TARGET_CREATOR_LOREBOOK_LIMITS.characterAttachMax * LOREBOOK_CONTENT_MAX,
    theoreticalMaxInjectIfAllHitAndNoCap:
      TARGET_CREATOR_LOREBOOK_LIMITS.characterAttachMax * LOREBOOK_CONTENT_MAX,
  },
  requiredDeltas: {
    schema: [
      "Replace characters.lorebook_id single FK with character_lorebook_attachments(character_id, lorebook_id) max 20",
      "Migrate keyword_lorebooks creator scope: one content block + keywords per row (drop multi-entry entries_json OR enforce max 1 entry)",
      "Add creator lorebook per-turn injection budget constant + apply* budget function (mirror userLorebook applyUserLorebookTurnInjectionBudget)",
    ],
    api: [
      "Character save: accept lorebook_ids[] capped at 20 instead of single lorebook_id",
      "Chat activation: load all attached lorebooks, match each unit, merge, then apply per-turn injection budget",
    ],
    ui: [
      "CreateCharacter: multi-select up to 20 lorebooks (not single select)",
      "CreateKeywordLorebook: one content + keywords per lorebook (not entry list inside container)",
    ],
    testDataCleanup: "Test-site seed rows using multi-entry containers can be flattened or re-seeded; no legacy compatibility layer required",
  },
} as const;

export const PRODUCTION_SHA_CORRECTION = "bfb097470df6ae0df03611f716330c9413218484";
export const RAILWAY_DEPLOYMENT_CORRECTION = "2bc05e11-aa66-466d-a5f4-1bf8c549c398";

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
  | "60K_TO_80K"
  | "80K_TO_100K"
  | "100K_OR_MORE";

export function classifyInputPressureBand(tokens: number): InputPressureBand {
  if (tokens >= 100_000) return "100K_OR_MORE";
  if (tokens >= 80_000) return "80K_TO_100K";
  if (tokens >= 60_000) return "60K_TO_80K";
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
  crossed80k: boolean;
  crossed100k: boolean;
} {
  return {
    crossed28k: tokens >= 28_000,
    crossed40k: tokens >= 40_000,
    crossed50k: tokens >= 50_000,
    crossed60k: tokens >= 60_000,
    crossed80k: tokens >= 80_000,
    crossed100k: tokens >= 100_000,
  };
}

export type VariableOwnerLimitKind =
  | "STORAGE_MAX"
  | "ACTIVATION_MAX"
  | "PER_TURN_INJECTION_MAX"
  | "FINAL_ASSEMBLY_MAX"
  | "HARD_TRIM_OWNER"
  | "HISTORY_ONLY"
  | "SOFT_TELEMETRY_ONLY"
  | "UNKNOWN"
  | "NO_LIMIT";

export type VariableSizeOwnerRow = {
  owner: string;
  storageMax: string;
  activationMax: string;
  perTurnInjectionMax: string;
  finalAssemblyMax: string;
  classification: VariableOwnerLimitKind;
  notes: string;
};

/** Code-inspected variable-size prompt owners — storage max ≠ injection max. */
export function buildVariableSizeOwnerMap(): VariableSizeOwnerRow[] {
  return [
    {
      owner: "Creator Keyword Lorebook (CURRENT main)",
      storageMax: `1 attached container × up to ${LOREBOOK_ENTRY_MAX} entries × ${LOREBOOK_CONTENT_MAX} chars (NOT target 20 lorebooks/character)`,
      activationMax: `${LOREBOOK_ACTIVATION_MAX_CHARS} chars (source scan, not injection)`,
      perTurnInjectionMax: "NONE — all uniquely matched container entries joined",
      finalAssemblyMax: "NO_LIMIT on current main",
      classification: "NO_LIMIT",
      notes:
        "CURRENT: characters.lorebook_id → single keyword_lorebooks.entries_json[] → match → inject. TARGET: 20 independent lorebook units + PER-TURN INJECTION BUDGET (not implemented).",
    },
    {
      owner: "Creator Keyword Lorebook (TARGET product)",
      storageMax: `${TARGET_CREATOR_LOREBOOK_LIMITS.characterAttachMax} lorebooks × ${LOREBOOK_CONTENT_MAX} chars`,
      activationMax: "keyword hit + carryover per lorebook unit",
      perTurnInjectionMax: "REQUIRED — separate budget owner (storage attach ≠ injection)",
      finalAssemblyMax: "HARD_TRIM_OWNER (future)",
      classification: "UNKNOWN",
      notes: "Target model not in schema; #985 audits current path + target forensic reference only",
    },
    {
      owner: "User Lorebook",
      storageMax: `${LOREBOOK_ENTRY_MAX} entries × ${LOREBOOK_CONTENT_MAX} chars stored`,
      activationMax: `active entry/content caps via subscriptionMemoryCapability`,
      perTurnInjectionMax: `userLorebookTurnInjectMaxChars (FREE 2500 / PAID 4000)`,
      finalAssemblyMax: "HARD_TRIM_OWNER via applyUserLorebookTurnInjectionBudget",
      classification: "HARD_TRIM_OWNER",
      notes: "Real matcher: selectEffectiveActive → match → mergeMatches → turn inject budget",
    },
    {
      owner: "Focus (userNote)",
      storageMax: `${USER_NOTE_FOCUS_MAX} chars stored (USER_NOTE_FOCUS_MAX)`,
      activationMax: "N/A — always injected when present",
      perTurnInjectionMax: "focusMaxChars (FREE 1000 / PAID 2000)",
      finalAssemblyMax: "splitUserNotePromptZones truncates focus zone",
      classification: "HARD_TRIM_OWNER",
      notes: "",
    },
    {
      owner: "Global long-term memory",
      storageMax: `MEMORY_CAPACITY_FIXED ${MEMORY_CAPACITY_FIXED} (prod); audit sim 15K/20K`,
      activationMax: "trimLorebookToBudgetSync at capacity",
      perTurnInjectionMax: "same as stored compact capacity",
      finalAssemblyMax: "HARD_TRIM_OWNER",
      classification: "HARD_TRIM_OWNER",
      notes: "",
    },
    {
      owner: "Medium-term memory",
      storageMax: `N${MEDIUM_TERM_BLOCK_COUNT} ring blocks`,
      activationMax: "assembled ring text",
      perTurnInjectionMax: "full ring inject",
      finalAssemblyMax: "UNKNOWN",
      classification: "UNKNOWN",
      notes: "",
    },
    {
      owner: "Episodic memory",
      storageMax: "resolveEpisodicMemoryMaxChars(env)",
      activationMax: "retrieval budget",
      perTurnInjectionMax: "retrieved block chars",
      finalAssemblyMax: "UNKNOWN",
      classification: "UNKNOWN",
      notes: "",
    },
    {
      owner: "Relationship memory",
      storageMax: "JSON meta block",
      activationMax: "bundled or separate section",
      perTurnInjectionMax: "fixture-dependent",
      finalAssemblyMax: "UNKNOWN",
      classification: "UNKNOWN",
      notes: "",
    },
    {
      owner: "Character identity/personality/world",
      storageMax: `AI_LEARNING_LIMIT ${AI_LEARNING_LIMIT} substantive chars (world+systemPrompt+speech)`,
      activationMax: "canon plan ACTIVE selection budget",
      perTurnInjectionMax: "chunk assembly",
      finalAssemblyMax: "UNKNOWN",
      classification: "UNKNOWN",
      notes: "ABSOLUTE_VALID_STRESS distributes AI_LEARNING_LIMIT across identity/personality/world chunks",
    },
    {
      owner: "Persona",
      storageMax: `${PERSONA_CONTENT_MAX} chars`,
      activationMax: "always injected",
      perTurnInjectionMax: `${PERSONA_CONTENT_MAX} chars`,
      finalAssemblyMax: "HARD_TRIM_OWNER at storage max",
      classification: "HARD_TRIM_OWNER",
      notes: "",
    },
    {
      owner: "Current user message",
      storageMax: `${CHAT_MESSAGE_MAX} chars (CHAT_MESSAGE_MAX)`,
      activationMax: "always current turn",
      perTurnInjectionMax: `${CHAT_MESSAGE_MAX} chars`,
      finalAssemblyMax: "HARD_TRIM_OWNER",
      classification: "HARD_TRIM_OWNER",
      notes: "",
    },
    {
      owner: "RAW/history",
      storageMax: "unbounded stored messages",
      activationMax: "resolveHistoryTokenBudget",
      perTurnInjectionMax: "history trim budget",
      finalAssemblyMax: "HISTORY_ONLY",
      classification: "HISTORY_ONLY",
      notes: "OpenRouter Creator/User lore prefix prepended to user turn — not history-trimmed",
    },
    {
      owner: "Final payload",
      storageMax: "N/A",
      activationMax: "N/A",
      perTurnInjectionMax: "resolveMaxPayloadInputTokens → Number.MAX_SAFE_INTEGER",
      finalAssemblyMax: "NO_LIMIT",
      classification: "NO_LIMIT",
      notes: "",
    },
    {
      owner: "MODEL_SYSTEM_BUDGETS telemetry",
      storageMax: "N/A",
      activationMax: "28K default telemetry target",
      perTurnInjectionMax: "SOFT — meta.tokenBudget, not hard reject",
      finalAssemblyMax: "SOFT_TELEMETRY_ONLY",
      classification: "SOFT_TELEMETRY_ONLY",
      notes: "Not a hard context limit",
    },
  ];
}

export const CREATOR_LOREBOOK_PRODUCTION_CONTRACT = {
  path: [
    "entries_json",
    "parseStoredLorebookEntries",
    "matchKeywordLorebookEntryDetails",
    "mergeMatches",
    "buildKeywordLorebookPromptBlock",
    "route loadKeywordLorebookPromptBlockFromActivation",
    "buildContext keywordLorebookBlock",
  ],
  turnInjectCap: "NONE" as const,
  activationScanCap: LOREBOOK_ACTIVATION_MAX_CHARS,
  storageEntryMax: LOREBOOK_ENTRY_MAX,
  storageContentMax: LOREBOOK_CONTENT_MAX,
};

const CREATOR_ACTIVATION_KEYWORD = "AUDITLORE";

function buildUniqueCreatorEntryContent(index: number, targetLen = LOREBOOK_CONTENT_MAX): string {
  const prefix = `CREATOR_LB_${String(index).padStart(3, "0")}_`;
  return padToChars(`${prefix}크리에이터 로어북 항목 ${index}`, targetLen);
}

/** CURRENT production path: N entries inside one attached keyword_lorebooks container. */
export function buildCreatorContainerStressEntries(
  entryCount: number,
  keyword = CREATOR_ACTIVATION_KEYWORD
): KeywordLorebookEntry[] {
  const count = Math.max(0, Math.min(entryCount, LOREBOOK_ENTRY_MAX));
  const entries: KeywordLorebookEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      keywords: [keyword, `aux_${i}`],
      content: buildUniqueCreatorEntryContent(i),
    });
  }
  return entries;
}

/** @deprecated Use buildCreatorContainerStressEntries */
export function buildCreatorStressEntries(
  matchCount: number,
  keyword = CREATOR_ACTIVATION_KEYWORD
): KeywordLorebookEntry[] {
  return buildCreatorContainerStressEntries(matchCount, keyword);
}

/**
 * TARGET product forensic: N independent lorebook units (each = 1×800 chars + keywords).
 * Uses same matcher/join path as current main; differs only in product semantics and attach cap (20).
 */
export function buildTargetAttachedLorebookUnits(
  lorebookCount: number,
  keyword = CREATOR_ACTIVATION_KEYWORD
): KeywordLorebookEntry[] {
  const count = Math.max(
    0,
    Math.min(lorebookCount, TARGET_CREATOR_LOREBOOK_LIMITS.characterAttachMax)
  );
  return buildCreatorContainerStressEntries(count, keyword);
}

export function buildTargetAttachedLorebookStressBlock(opts: {
  lorebookCount: number;
  currentUserMessage?: string;
  recentMessages?: Array<{ role: "user" | "assistant"; content: string }>;
}): { block: string; matchedUnitCount: number; injectedChars: number } {
  const result = buildCreatorLorebookBlockThroughProductionPath({
    matchCount: opts.lorebookCount,
    currentUserMessage: opts.currentUserMessage,
    recentMessages: opts.recentMessages,
  });
  return {
    block: result.block,
    matchedUnitCount: result.matchedCount,
    injectedChars: result.injectedChars,
  };
}

export function buildCreatorLorebookBlockThroughProductionPath(opts: {
  matchCount: number;
  currentUserMessage?: string;
  recentMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  carryover?: KeywordLorebookMatch[];
}): { block: string; matchedCount: number; injectedChars: number; matches: KeywordLorebookMatch[] } {
  const entries = buildCreatorContainerStressEntries(opts.matchCount);
  const activation = buildLorebookActivationText({
    currentUserMessage:
      opts.currentUserMessage ?? `${CREATOR_ACTIVATION_KEYWORD} continue the scene — audit fixture user turn`,
    recentMessages: opts.recentMessages,
  });
  const direct = matchKeywordLorebookEntryDetails(entries, {
    currentUserText: activation.currentUserText,
    recentRawText: activation.recentRawText,
  });
  const merged = mergeMatches(direct, opts.carryover ?? []);
  const block = buildKeywordLorebookPromptBlock(merged.map((m) => m.content));
  const bodyChars = merged.reduce((sum, m) => sum + m.content.length, 0);
  return {
    block,
    matchedCount: merged.length,
    injectedChars: bodyChars,
    matches: merged,
  };
}

export function proveCreatorCarryoverCannotExceedStoredUnique(): {
  directMaxUniqueContents: number;
  mergedWithCarryoverCount: number;
  carryoverCannotExceedDirectUnique: boolean;
  detail: string;
} {
  const entries = buildCreatorContainerStressEntries(LOREBOOK_ENTRY_MAX);
  const activation = buildLorebookActivationText({
    currentUserMessage: `${CREATOR_ACTIVATION_KEYWORD} carryover stress`,
  });
  const direct = matchKeywordLorebookEntryDetails(entries, {
    currentUserText: activation.currentUserText,
    recentRawText: activation.recentRawText,
  });
  const carryover = direct.map((m) => ({
    ...m,
    source: "carryover" as const,
    carryoverTurnsRemaining: 2,
  }));
  const merged = mergeMatches(direct, carryover);
  return {
    directMaxUniqueContents: direct.length,
    mergedWithCarryoverCount: merged.length,
    carryoverCannotExceedDirectUnique: merged.length === direct.length,
    detail:
      "mergeMatches dedupes by content; carryover TTL rows cannot introduce content absent from stored entries; max unique injected contents ≤ LOREBOOK_ENTRY_MAX matched entries",
  };
}

function buildUserLorebookBlockThroughMatcher(opts: {
  capability: SubscriptionMemoryCapability;
  load: LoadLevel;
  activation: { currentUserText: string; recentRawText?: string };
}): { block: string; injectedChars: number; matchedCount: number } {
  const maxEntries =
    opts.load === "ABSOLUTE_VALID_STRESS"
      ? opts.capability.userLorebookActiveEntryMax
      : opts.load === "MEMORY_PEAK"
        ? Math.min(opts.capability.userLorebookActiveEntryMax, 25)
        : 5;
  const keyword = "ULOREKEY";
  const stored: UserLorebookStoredEntry[] = [];
  for (let i = 0; i < maxEntries; i++) {
    stored.push({
      keywords: [keyword, `uk_${i}`],
      content: buildUniqueCreatorEntryContent(i + 1000, LOREBOOK_CONTENT_MAX),
      enabled: true,
    });
  }
  const active = selectEffectiveActiveUserLorebookEntries(stored, opts.capability);
  const direct = matchKeywordLorebookEntryDetails(active, opts.activation);
  const budgeted = applyUserLorebookTurnInjectionBudget(
    direct,
    opts.capability.userLorebookTurnInjectMaxChars
  );
  const block = buildUserLorebookPromptBlock(budgeted.map((m) => m.content));
  return {
    block,
    injectedChars: budgeted.reduce((s, m) => s + m.content.length, 0),
    matchedCount: budgeted.length,
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

function buildEpisodicFixture(load: LoadLevel): string {
  const max = resolveEpisodicMemoryMaxChars({} as NodeJS.ProcessEnv);
  const target =
    load === "ABSOLUTE_VALID_STRESS" || load === "MEMORY_PEAK" ? max : Math.floor(max * 0.6);
  return padToChars(
    "[Episodic memory]\n- T120 setting/abandoned_station: 폭우가 쏟아지는 폐역 안으로 피신했다.",
    target
  );
}

function buildRelationshipFixture(load: LoadLevel): string {
  const target = load === "NORMAL" ? 1_200 : 2_400;
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
  if (load === "ABSOLUTE_VALID_STRESS") {
    const identity = Math.floor(AI_LEARNING_LIMIT * 0.55);
    const personality = Math.floor(AI_LEARNING_LIMIT * 0.25);
    const world = Math.max(0, AI_LEARNING_LIMIT - identity - personality);
    return {
      canonIdentity: identity,
      canonPersonality: personality,
      canonWorld: world,
      userPersona: PERSONA_CONTENT_MAX,
      focus: capability.focusMaxChars,
    };
  }
  if (load === "MEMORY_PEAK") {
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

function resolveCreatorMatchCount(load: LoadLevel, creatorMatchCount?: number): number {
  if (creatorMatchCount != null) return Math.max(1, Math.min(creatorMatchCount, LOREBOOK_ENTRY_MAX));
  if (load === "ABSOLUTE_VALID_STRESS") return LOREBOOK_ENTRY_MAX;
  if (load === "MEMORY_PEAK") return MEMORY_PEAK_REALISTIC_CREATOR_MATCH_COUNT;
  return 1;
}

function buildCurrentUserMessage(load: LoadLevel): string {
  const base = `${CREATOR_ACTIVATION_KEYWORD} continue the scene — audit fixture user turn`;
  if (load === "ABSOLUTE_VALID_STRESS") {
    return padToChars(base, CHAT_MESSAGE_MAX);
  }
  return base;
}

export function buildPaidMemoryAuditInput(opts: {
  modelId: string;
  config: PaidMemoryConfig;
  currentTurn: HistoryStage;
  load: LoadLevel;
  creatorMatchCount?: number;
}): ContextBuildInput {
  const { capability } = opts.config;
  const sizes = fixtureSizes(opts.load, capability);
  const mediumRingN = MEDIUM_TERM_BLOCK_COUNT as RingSize;
  const mediumText = assembleMovingMediumRingText(opts.currentTurn, mediumRingN);
  const currentUserMessage = buildCurrentUserMessage(opts.load);
  const activation = buildLorebookActivationText({
    currentUserMessage,
    recentMessages: buildRaw4History(),
  });
  const creatorCount = resolveCreatorMatchCount(opts.load, opts.creatorMatchCount);
  const creator = buildCreatorLorebookBlockThroughProductionPath({
    matchCount: creatorCount,
    currentUserMessage,
    recentMessages: buildRaw4History(),
  });
  const userLore = buildUserLorebookBlockThroughMatcher({
    capability,
    load: opts.load,
    activation: {
      currentUserText: activation.currentUserText,
      recentRawText: activation.recentRawText,
    },
  });

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
    userLorebookBlock: userLore.block,
    keywordLorebookBlock: creator.block,
    shortTermHistory: buildRaw4History(),
    currentUserMessage,
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
  crossed80k: boolean;
  crossed100k: boolean;
  creatorMatchCount?: number;
  creatorInjectedChars?: number;
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
  /** Narrow: Medium↔Global literal overlap only — NOT whole-prompt duplicate audit. */
  noDetectedMediumGlobalLiteralBloat: "YES" | "NO";
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
    | "CREATOR_LOREBOOK_UNBOUNDED"
    | "EXPECTED_CAPACITY_SUM"
    | "DUPLICATE_INJECTION"
    | "HISTORY_NOT_TRIMMED"
    | "MODEL_ADAPTER_OVERHEAD"
    | "SYSTEM_PROMPT_OVERHEAD"
    | "MEMORY_LAYER_OVERLAP"
    | "SUBSCRIPTION_MEMORY_CAPACITY"
    | "CHARACTER_CANON"
    | "RAW_HISTORY"
    | "OTHER";
  detail: string;
};

export type MemoryPeakMaxInputRow = {
  modelId: string;
  freeMaxInput: number;
  paidCurrentMaxInput: number;
  paidGlobal15MaxInput: number;
  paidGlobal20MaxInput: number;
  memoryPeakGlobal15Gte60k: boolean;
  maxStage: HistoryStage;
  maxLoad: LoadLevel;
};

/** @deprecated Use memoryPeakMaxInputTable — retained for JSON compat. */
export type AbsoluteMaxInputRow = MemoryPeakMaxInputRow & {
  global15Gte28k: boolean;
  global15Gte40k: boolean;
  global15Gte50k: boolean;
  global15Gte60k: boolean;
};

export type AbsoluteValidMaxInputRow = {
  modelId: string;
  freeMaxInput: number;
  paidCurrentMaxInput: number;
  paidGlobal15MaxInput: number;
  absoluteValidGlobal15Gte60k: boolean;
  absoluteValidGlobal15Gte80k: boolean;
  absoluteValidGlobal15Gte100k: boolean;
  firstCreatorMatchCrossing60k: CreatorStressMatchCount | null;
  firstCreatorMatchCrossing100k: CreatorStressMatchCount | null;
};

export type CreatorStressRow = {
  modelId: string;
  configId: PaidMemoryConfigId;
  /** CURRENT main: matched entries inside one attached container — NOT target lorebook attach count. */
  stressModel: "CURRENT_CONTAINER_ENTRY";
  containerEntryMatchCount: CurrentContainerEntryStressCount;
  /** @deprecated Use containerEntryMatchCount */
  creatorMatchCount: CurrentContainerEntryStressCount;
  inputTokens: number;
  pCharge: number;
  rawKrwNoCache: number;
  pAmplificationVsCreator1: number;
  creatorInjectedChars: number;
  global15InputDeltaVsPaidCurrent: number;
  global15PDeltaVsPaidCurrent: number;
};

/** TARGET product forensic — N independent lorebook units (1×800 chars each); schema not yet implemented. */
export type TargetAttachedLorebookStressRow = {
  modelId: string;
  configId: PaidMemoryConfigId;
  stressModel: "TARGET_ATTACHED_LOREBOOK_UNIT";
  attachedLorebookCount: TargetAttachedLorebookStressCount;
  inputTokens: number;
  pCharge: number;
  injectedChars: number;
  pAmplificationVs1Unit: number;
  perTurnInjectionCapApplied: false;
};

export type AbsoluteValidStressRow = {
  modelId: string;
  configId: PaidMemoryConfigId;
  creatorMatchCount: CreatorStressMatchCount;
  localSystemTokens: number;
  localHistoryTokens: number;
  localUserTurnTokens: number;
  totalInputTokens: number;
  serializedRequestChars: number;
  serializedRequestTokensEst: number;
  crossed60k: boolean;
  crossed80k: boolean;
  crossed100k: boolean;
  historyTrimmedMessages: number;
  criticalSectionLoss: boolean;
  pCharge: number;
  primaryRootCause:
    | "CREATOR_LOREBOOK_UNBOUNDED"
    | "SUBSCRIPTION_MEMORY_CAPACITY"
    | "SYSTEM_PROMPT"
    | "CHARACTER_CANON"
    | "RAW_HISTORY"
    | "MEMORY_LAYER_DUPLICATION"
    | "OTHER";
};

export type MemoryProductTableRow = {
  modelId: string;
  freeRealisticInput: number;
  paidCurrentRealisticInput: number;
  paidGlobal15RealisticInput: number;
  deltaInputPaidVsFree: number;
  deltaInputGlobal15VsPaid: number;
  deltaPPaidVsFree: number;
  deltaPGlobal15VsPaid: number;
};

export type OpenRouterPrefixAudit = {
  modelId: string;
  creatorInDynamicLorePrefix: boolean;
  creatorRemovedByHistoryTrim: boolean;
  dynamicLorePrefixChars: number;
  detail: string;
};

export type PayloadCapAudit = {
  resolveMaxPayloadInputTokens: number;
  modelSystemBudgetTelemetry: string;
  historyTokenBudget: "HISTORY_ONLY";
  finalPayloadClassification: "NO_LIMIT";
  telemetry28kClassification: "SOFT_TELEMETRY";
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
  | "NOMINAL_POINT_DELTA_COVERS_RAW_KRW_DELTA"
  | "PARTIALLY_COVERS_RAW_KRW_DELTA"
  | "NOMINAL_POINT_DELTA_BELOW_RAW_KRW_DELTA";

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
  creatorMatchCount?: number;
}): string {
  return `${opts.modelId}|${opts.config.id}|${opts.currentTurn}|${opts.load}|${opts.creatorMatchCount ?? "default"}`;
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
  creatorMatchCount?: number;
}): PromptAssemblyRow {
  const cached = rowCache.get(rowCacheKey(opts));
  if (cached) return cached;

  const input = buildPaidMemoryAuditInput(opts);
  const creatorCount = resolveCreatorMatchCount(opts.load, opts.creatorMatchCount);
  const creatorInject = buildCreatorLorebookBlockThroughProductionPath({
    matchCount: creatorCount,
    currentUserMessage: input.currentUserMessage,
    recentMessages: input.shortTermHistory,
  });
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
    creatorMatchCount: creatorCount,
    creatorInjectedChars: creatorInject.injectedChars,
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

  const bloatDetected = mediumGlobalDup > 500 || relationshipBundled;

  return {
    modelId: opts.modelId,
    configId: opts.config.id,
    currentTurn: opts.currentTurn,
    load: opts.load,
    noDetectedMediumGlobalLiteralBloat: bloatDetected ? "NO" : "YES",
    mediumGlobalLiteralDuplicateChars: mediumGlobalDup,
    relationshipBundledInGlobal: relationshipBundled,
    classification: classification.length > 0 ? classification : ["EXPECTED_CAPACITY_SUM"],
    detail:
      bloatDetected
        ? `medium↔global literal dup=${mediumGlobalDup} chars; relationshipBundled=${relationshipBundled}`
        : "Medium↔Global literal overlap audit only — Creator/User/Focus/RAW/Global/Episodic not fully audited for duplicate bloat",
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

export function buildMemoryPeakMaxInputTable(modelId: string): MemoryPeakMaxInputRow {
  let freeMax = 0;
  let paidMax = 0;
  let g15Max = 0;
  let g20Max = 0;
  let maxStage: HistoryStage = 100;
  let maxLoad: LoadLevel = "NORMAL";
  const memoryLoads: LoadLevel[] = ["NORMAL", "MEMORY_PEAK"];

  for (const config of PAID_MEMORY_CONFIGS) {
    for (const turn of PAID_MEMORY_HISTORY_STAGES) {
      for (const load of memoryLoads) {
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
    memoryPeakGlobal15Gte60k: g15Max >= 60_000,
    maxStage,
    maxLoad,
  };
}

/** @deprecated alias */
export function buildAbsoluteMaxInputTable(modelId: string): AbsoluteMaxInputRow {
  const peak = buildMemoryPeakMaxInputTable(modelId);
  return {
    ...peak,
    global15Gte28k: peak.paidGlobal15MaxInput >= 28_000,
    global15Gte40k: peak.paidGlobal15MaxInput >= 40_000,
    global15Gte50k: peak.paidGlobal15MaxInput >= 50_000,
    global15Gte60k: peak.memoryPeakGlobal15Gte60k,
  };
}

export function buildAbsoluteValidMaxInputTable(modelId: string): AbsoluteValidMaxInputRow {
  let freeMax = 0;
  let paidMax = 0;
  let g15Max = 0;
  let first60: CreatorStressMatchCount | null = null;
  let first100: CreatorStressMatchCount | null = null;
  let g15Gte80 = false;
  let g15Gte100 = false;

  for (const config of PAID_MEMORY_CONFIGS) {
    for (const creatorCount of CREATOR_STRESS_MATCH_COUNTS) {
      const row = assemblePaidMemoryPromptRow({
        modelId,
        config,
        currentTurn: 2000,
        load: "ABSOLUTE_VALID_STRESS",
        creatorMatchCount: creatorCount,
      });
      if (config.id === "FREE_CURRENT") freeMax = Math.max(freeMax, row.localEstimatedTokensTotal);
      if (config.id === "PAID_CURRENT") paidMax = Math.max(paidMax, row.localEstimatedTokensTotal);
      if (config.id === "PAID_GLOBAL_15K") {
        g15Max = Math.max(g15Max, row.localEstimatedTokensTotal);
        g15Gte80 = g15Gte80 || row.crossed80k;
        g15Gte100 = g15Gte100 || row.crossed100k;
        if (first60 == null && row.crossed60k) first60 = creatorCount;
        if (first100 == null && row.crossed100k) first100 = creatorCount;
      }
    }
  }

  return {
    modelId,
    freeMaxInput: freeMax,
    paidCurrentMaxInput: paidMax,
    paidGlobal15MaxInput: g15Max,
    absoluteValidGlobal15Gte60k: g15Max >= 60_000,
    absoluteValidGlobal15Gte80k: g15Gte80,
    absoluteValidGlobal15Gte100k: g15Gte100,
    firstCreatorMatchCrossing60k: first60,
    firstCreatorMatchCrossing100k: first100,
  };
}

export function buildMemoryProductTable(modelId: string): MemoryProductTableRow {
  const free = assemblePaidMemoryPromptRow({
    modelId,
    config: configById("FREE_CURRENT"),
    currentTurn: 2000,
    load: "MEMORY_PEAK",
  });
  const paid = assemblePaidMemoryPromptRow({
    modelId,
    config: configById("PAID_CURRENT"),
    currentTurn: 2000,
    load: "MEMORY_PEAK",
  });
  const g15 = assemblePaidMemoryPromptRow({
    modelId,
    config: configById("PAID_GLOBAL_15K"),
    currentTurn: 2000,
    load: "MEMORY_PEAK",
  });
  const freeP = computeUserPointCharge(modelId, free.localEstimatedTokensTotal, UNIFIED_TIER_AIM_CHARS);
  const paidP = computeUserPointCharge(modelId, paid.localEstimatedTokensTotal, UNIFIED_TIER_AIM_CHARS);
  const g15P = computeUserPointCharge(modelId, g15.localEstimatedTokensTotal, UNIFIED_TIER_AIM_CHARS);
  return {
    modelId,
    freeRealisticInput: free.localEstimatedTokensTotal,
    paidCurrentRealisticInput: paid.localEstimatedTokensTotal,
    paidGlobal15RealisticInput: g15.localEstimatedTokensTotal,
    deltaInputPaidVsFree: paid.localEstimatedTokensTotal - free.localEstimatedTokensTotal,
    deltaInputGlobal15VsPaid: g15.localEstimatedTokensTotal - paid.localEstimatedTokensTotal,
    deltaPPaidVsFree: paidP - freeP,
    deltaPGlobal15VsPaid: g15P - paidP,
  };
}

export function buildCreatorStressTable(modelId: string): CreatorStressRow[] {
  const rows: CreatorStressRow[] = [];
  const baseline = new Map<PaidMemoryConfigId, number>();
  const baselineP = new Map<PaidMemoryConfigId, number>();

  for (const config of PAID_MEMORY_CONFIGS) {
    const row = assemblePaidMemoryPromptRow({
      modelId,
      config,
      currentTurn: 2000,
      load: "MEMORY_PEAK",
      creatorMatchCount: 1,
    });
    baseline.set(config.id, row.localEstimatedTokensTotal);
    baselineP.set(config.id, computeUserPointCharge(modelId, row.localEstimatedTokensTotal, UNIFIED_TIER_AIM_CHARS));
  }

  for (const config of PAID_MEMORY_CONFIGS) {
    for (const entryCount of CURRENT_CONTAINER_ENTRY_STRESS_COUNTS) {
      const row = assemblePaidMemoryPromptRow({
        modelId,
        config,
        currentTurn: 2000,
        load: "MEMORY_PEAK",
        creatorMatchCount: entryCount,
      });
      const pCharge = computeUserPointCharge(modelId, row.localEstimatedTokensTotal, UNIFIED_TIER_AIM_CHARS);
      const raw = computeRawProviderCost({
        modelId,
        configId: config.id,
        inputTokens: row.localEstimatedTokensTotal,
        outputPresetChars: UNIFIED_TIER_AIM_CHARS,
        scenario: "NO_CACHE",
      }).rawKrw;
      const baseP = baselineP.get(config.id) ?? pCharge;
      const paidCurrentInput =
        config.id === "PAID_CURRENT"
          ? row.localEstimatedTokensTotal
          : assemblePaidMemoryPromptRow({
              modelId,
              config: configById("PAID_CURRENT"),
              currentTurn: 2000,
              load: "MEMORY_PEAK",
              creatorMatchCount: entryCount,
            }).localEstimatedTokensTotal;
      const g15Input =
        config.id === "PAID_GLOBAL_15K"
          ? row.localEstimatedTokensTotal
          : assemblePaidMemoryPromptRow({
              modelId,
              config: configById("PAID_GLOBAL_15K"),
              currentTurn: 2000,
              load: "MEMORY_PEAK",
              creatorMatchCount: entryCount,
            }).localEstimatedTokensTotal;
      const g15P =
        config.id === "PAID_GLOBAL_15K"
          ? pCharge
          : computeUserPointCharge(modelId, g15Input, UNIFIED_TIER_AIM_CHARS);
      const paidP =
        config.id === "PAID_CURRENT"
          ? pCharge
          : computeUserPointCharge(modelId, paidCurrentInput, UNIFIED_TIER_AIM_CHARS);
      rows.push({
        modelId,
        configId: config.id,
        stressModel: "CURRENT_CONTAINER_ENTRY",
        containerEntryMatchCount: entryCount,
        creatorMatchCount: entryCount,
        inputTokens: row.localEstimatedTokensTotal,
        pCharge,
        rawKrwNoCache: raw,
        pAmplificationVsCreator1: baseP > 0 ? pCharge / baseP : 1,
        creatorInjectedChars: row.creatorInjectedChars ?? 0,
        global15InputDeltaVsPaidCurrent: g15Input - paidCurrentInput,
        global15PDeltaVsPaidCurrent: g15P - paidP,
      });
    }
  }
  return rows;
}

/** TARGET product forensic — independent lorebook units (max 20); no per-turn injection cap applied. */
export function buildTargetAttachedLorebookStressTable(modelId: string): TargetAttachedLorebookStressRow[] {
  const rows: TargetAttachedLorebookStressRow[] = [];
  const config = configById("PAID_CURRENT");
  const baseline = assemblePaidMemoryPromptRow({
    modelId,
    config,
    currentTurn: 2000,
    load: "MEMORY_PEAK",
    creatorMatchCount: 1,
  });
  const baselineP = computeUserPointCharge(modelId, baseline.localEstimatedTokensTotal, UNIFIED_TIER_AIM_CHARS);

  for (const unitCount of TARGET_ATTACHED_LOREBOOK_STRESS_COUNTS) {
    const row = assemblePaidMemoryPromptRow({
      modelId,
      config,
      currentTurn: 2000,
      load: "MEMORY_PEAK",
      creatorMatchCount: unitCount,
    });
    const pCharge = computeUserPointCharge(modelId, row.localEstimatedTokensTotal, UNIFIED_TIER_AIM_CHARS);
    rows.push({
      modelId,
      configId: config.id,
      stressModel: "TARGET_ATTACHED_LOREBOOK_UNIT",
      attachedLorebookCount: unitCount,
      inputTokens: row.localEstimatedTokensTotal,
      pCharge,
      injectedChars: row.creatorInjectedChars ?? 0,
      pAmplificationVs1Unit: baselineP > 0 ? pCharge / baselineP : 1,
      perTurnInjectionCapApplied: false,
    });
  }
  return rows;
}

function classifyAbsoluteStressRootCause(row: PromptAssemblyRow): AbsoluteValidStressRow["primaryRootCause"] {
  const creatorSection = row.sectionInventory.find((s) => s.id === "keyword-lorebook");
  const creatorShare = creatorSection?.pctOfTotalInput ?? 0;
  const globalSection = row.sectionInventory.find((s) => s.id === "current-memory");
  const globalShare = globalSection?.pctOfTotalInput ?? 0;
  if (creatorShare >= 35) return "CREATOR_LOREBOOK_UNBOUNDED";
  if (globalShare >= 25) return "SUBSCRIPTION_MEMORY_CAPACITY";
  if (row.rawHistoryTokens > row.localEstimatedTokensTotal * 0.25) return "RAW_HISTORY";
  const systemShare = row.sectionInventory
    .filter((s) => s.category === "systemRules")
    .reduce((s, r) => s + r.pctOfTotalInput, 0);
  if (systemShare >= 40) return "SYSTEM_PROMPT";
  const canonShare = row.sectionInventory
    .filter((s) => s.id.includes("character") || s.id.includes("identity"))
    .reduce((s, r) => s + r.pctOfTotalInput, 0);
  if (canonShare >= 30) return "CHARACTER_CANON";
  return "OTHER";
}

export function buildAbsoluteValidStressTable(modelId: string): AbsoluteValidStressRow[] {
  const rows: AbsoluteValidStressRow[] = [];
  for (const config of PAID_MEMORY_CONFIGS) {
    for (const creatorCount of CREATOR_STRESS_MATCH_COUNTS) {
      const row = assemblePaidMemoryPromptRow({
        modelId,
        config,
        currentTurn: 2000,
        load: "ABSOLUTE_VALID_STRESS",
        creatorMatchCount: creatorCount,
      });
      rows.push({
        modelId,
        configId: config.id,
        creatorMatchCount: creatorCount,
        localSystemTokens: row.localSystemTokens,
        localHistoryTokens: row.localHistoryTokens,
        localUserTurnTokens: row.localUserTurnTokens,
        totalInputTokens: row.localEstimatedTokensTotal,
        serializedRequestChars: row.serializedRequestChars,
        serializedRequestTokensEst: row.serializedRequestTokensEst,
        crossed60k: row.crossed60k,
        crossed80k: row.crossed80k,
        crossed100k: row.crossed100k,
        historyTrimmedMessages: row.trimmedHistoryMessages,
        criticalSectionLoss: row.criticalSectionOmitted,
        pCharge: computeUserPointCharge(modelId, row.localEstimatedTokensTotal, UNIFIED_TIER_AIM_CHARS),
        primaryRootCause: classifyAbsoluteStressRootCause(row),
      });
    }
  }
  return rows;
}

export function auditOpenRouterCreatorPrefix(modelId: string): OpenRouterPrefixAudit {
  const input = buildPaidMemoryAuditInput({
    modelId,
    config: configById("PAID_CURRENT"),
    currentTurn: 1000,
    load: "ABSOLUTE_VALID_STRESS",
    creatorMatchCount: 10,
  });
  const built = buildContext(input);
  const prefix = built.openRouterDynamicLorePrefix ?? "";
  const creatorSnippet = input.keywordLorebookBlock?.slice(0, 40) ?? "";
  const inPrefix = creatorSnippet.length > 0 && prefix.includes(creatorSnippet.slice(0, 20));
  const userTurn = built.history[built.history.length - 1]?.content ?? "";
  const creatorInUserTurn = creatorSnippet.length > 0 && userTurn.includes(creatorSnippet.slice(0, 20));
  const isOpenRouter = resolveAuditContextProvider(modelId) === "openrouter";
  return {
    modelId,
    creatorInDynamicLorePrefix: isOpenRouter ? creatorInUserTurn || inPrefix : false,
    creatorRemovedByHistoryTrim: false,
    dynamicLorePrefixChars: prefix.length,
    detail: isOpenRouter
      ? "OpenRouter: keywordLorebookBlock → dynamicLorebookParts → openRouterDynamicLorePrefix prepended to user turn; history trim does not remove user-turn prefix"
      : "Non-OpenRouter: keyword lorebook injected as system section keyword-lorebook",
  };
}

export function auditPayloadCaps(modelId: string): PayloadCapAudit {
  return {
    resolveMaxPayloadInputTokens: resolveMaxPayloadInputTokens(modelId),
    modelSystemBudgetTelemetry: String(MODEL_SYSTEM_BUDGETS[modelId] ?? MODEL_SYSTEM_BUDGETS.default ?? 28_000),
    historyTokenBudget: "HISTORY_ONLY",
    finalPayloadClassification: "NO_LIMIT",
    telemetry28kClassification: "SOFT_TELEMETRY",
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
  if (opts.pDelta <= 0 && opts.rawKrwDelta > 0) return "NOMINAL_POINT_DELTA_BELOW_RAW_KRW_DELTA";
  if (opts.rawKrwDelta <= 0) return "NOMINAL_POINT_DELTA_COVERS_RAW_KRW_DELTA";
  const ratio = opts.pDelta / opts.rawKrwDelta;
  if (ratio >= 0.85) return "NOMINAL_POINT_DELTA_COVERS_RAW_KRW_DELTA";
  if (ratio >= 0.35) return "PARTIALLY_COVERS_RAW_KRW_DELTA";
  return "NOMINAL_POINT_DELTA_BELOW_RAW_KRW_DELTA";
}

export function buildPrimaryDecisionTable(modelId: string): PrimaryDecisionRow[] {
  const rows: PrimaryDecisionRow[] = [];
  const loads: LoadLevel[] = ["NORMAL", "MEMORY_PEAK"];
  for (const config of PAID_MEMORY_CONFIGS) {
    for (const turn of PAID_MEMORY_HISTORY_STAGES) {
      for (const load of loads) {
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
  const loads: LoadLevel[] = ["NORMAL", "MEMORY_PEAK"];
  for (const turn of PAID_MEMORY_HISTORY_STAGES) {
    for (const load of loads) {
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
    peakPaidCurrent: pick("PAID_CURRENT", "MEMORY_PEAK", 2000),
    peakPaidGlobal15: pick("PAID_GLOBAL_15K", "MEMORY_PEAK", 2000),
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
            load: "MEMORY_PEAK",
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
    "60K_TO_80K",
    "80K_TO_100K",
    "100K_OR_MORE",
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

export function auditCacheBoundary(modelId: string, load: LoadLevel = "MEMORY_PEAK"): CacheBoundaryAudit {
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
      load: "MEMORY_PEAK",
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
      load: "MEMORY_PEAK",
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
        cumulativeTurnCost(modelId, config, [100], "MEMORY_PEAK") -
        cumulativeTurnCost(modelId, free, [100], "MEMORY_PEAK"),
      turn500RawDeltaKrw:
        cumulativeTurnCost(modelId, config, [100, 300], "MEMORY_PEAK") -
        cumulativeTurnCost(modelId, free, [100, 300], "MEMORY_PEAK"),
      turn1000RawDeltaKrw:
        cumulativeTurnCost(modelId, config, [100, 300, 1000], "MEMORY_PEAK") -
        cumulativeTurnCost(modelId, free, [100, 300, 1000], "MEMORY_PEAK"),
      turn2000RawDeltaKrw:
        cumulativeTurnCost(modelId, config, [100, 300, 1000, 2000], "MEMORY_PEAK") -
        cumulativeTurnCost(modelId, free, [100, 300, 1000, 2000], "MEMORY_PEAK"),
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
      load: "MEMORY_PEAK",
    });
    const toRow = assemblePaidMemoryPromptRow({
      modelId,
      config: toCfg,
      currentTurn: 2000,
      load: "MEMORY_PEAK",
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
  auditPass: "AUDIT_CORRECTION";
  productionSha: string;
  originMainSha: string;
  prBehindMain: number;
  railwayDeployment: string;
  railwayStatus: string;
  productModel: typeof PRODUCT_MODEL;
  assemblySource: "PRODUCTION_BUILD_CONTEXT";
  tokenMode: "REAL_ASSEMBLY_LOCAL_ESTIMATE";
  providerCalibration: "INSUFFICIENT_DATA" | "AVAILABLE";
  competitorBenchmark: "NOT_PERFORMED_IN_THIS_AUDIT";
  mainRpModels: readonly string[];
  fxSnapshot: ReturnType<typeof resolveBillingExchangeRateSnapshot>;
  variableSizeOwnerMap: VariableSizeOwnerRow[];
  creatorLorebookContract: typeof CREATOR_LOREBOOK_PRODUCTION_CONTRACT;
  creatorLorebookProductModel: typeof CREATOR_LOREBOOK_PRODUCT_MODEL;
  creatorCarryoverProof: ReturnType<typeof proveCreatorCarryoverCannotExceedStoredUnique>;
  payloadCapAudit: Record<string, PayloadCapAudit>;
  openRouterPrefixAudits: OpenRouterPrefixAudit[];
  matrix: PromptAssemblyRow[];
  memoryPeakMaxInputTable: MemoryPeakMaxInputRow[];
  absoluteValidMaxInputTable: AbsoluteValidMaxInputRow[];
  /** @deprecated alias of memoryPeakMaxInputTable */
  absoluteMaxTable: AbsoluteMaxInputRow[];
  tableAMemoryProduct: MemoryProductTableRow[];
  tableBCreatorStress: CreatorStressRow[];
  tableBTargetAttachedLorebookStress: TargetAttachedLorebookStressRow[];
  tableCAbsoluteValidStress: AbsoluteValidStressRow[];
  inputBandSummary: InputBandSummary[];
  absoluteValidInputBandSummary: InputBandSummary[];
  sixtyKRootCauses: SixtyKRootCause[];
  hundredKRootCauses: SixtyKRootCause[];
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
  globalMaintenanceClassification: "APPROXIMATE_FORENSIC_ONLY";
  globalMaintenance: GlobalMaintenanceSimulation[];
  fullRebuildExceptions: FullRebuildExceptionCost[];
  pointTopUpEconomics: PointTopUpEconomicsRow[];
  pointChargeSensitivity: Record<string, UserPointChargeSensitivity>;
  summaryByModel: Record<
    string,
    {
      memoryPeakFreeMaxInput: number;
      memoryPeakPaidCurrentMaxInput: number;
      memoryPeakPaidGlobal15MaxInput: number;
      memoryPeakPaidGlobal20MaxInput: number;
      memoryPeakGlobal15Gte60k: boolean;
      absoluteValidFreeMaxInput: number;
      absoluteValidPaidCurrentMaxInput: number;
      absoluteValidPaidGlobal15MaxInput: number;
      absoluteValidGlobal15Gte60k: boolean;
      absoluteValidGlobal15Gte80k: boolean;
      absoluteValidGlobal15Gte100k: boolean;
      firstCreatorMatchCrossing60k: CreatorStressMatchCount | null;
      firstCreatorMatchCrossing100k: CreatorStressMatchCount | null;
      paidCurrentInputAmplification: number;
      global15InputAmplification: number;
      paidCurrentTurnPriceAmplification: number;
      global15TurnPriceAmplification: number;
      paidCurrentPeakP: number;
      global15PeakP: number;
      global15PDeltaPercent: number;
      global15AttributableInputDelta: number;
      global15AttributablePDelta: number;
      creator1EntryP: number;
      creator10EntryP: number;
      creator25EntryP: number;
      creator50EntryP: number;
      creator100EntryP: number;
      longRpPriceDriftT100ToT2000: number;
      memoryCostRecoveryClaim: MemoryCostPassThrough;
      noDetectedMediumGlobalLiteralBloat: "YES" | "NO";
    }
  >;
  worstMemoryPeakFixture: PromptAssemblyRow | null;
  worstAbsoluteValidFixture: PromptAssemblyRow | null;
  worstPaidGlobal15: PromptAssemblyRow | null;
  worstPaidCurrent: PromptAssemblyRow | null;
  rootClassification: "AUDIT_CORRECTED" | "ABSOLUTE_MAX_UNBOUNDED";
  providerGenerationCalls: 0;
  runtimeChange: "NO";
  pricingChange: "NO";
  billingChange: "NO";
  pointTopupSubscriberBonus: "SIMULATION_ONLY";
  currentUserTurnMax: number | "UNBOUNDED / NO_CANONICAL_LIMIT";
};

export function generatePaidMemoryAuditReport(
  productionSha: string,
  opts?: { originMainSha?: string; prBehindMain?: number }
): PaidMemoryAuditReport {
  clearPaidMemoryAuditRowCache();
  const env = process.env as Record<string, string | undefined>;
  const prevEnv = env.NODE_ENV;
  env.NODE_ENV = "production";

  const memoryProductLoads: LoadLevel[] = ["NORMAL", "MEMORY_PEAK"];

  try {
    const matrix: PromptAssemblyRow[] = [];
    for (const modelId of MAIN_RP_MODEL_IDS) {
      for (const config of PAID_MEMORY_CONFIGS) {
        for (const currentTurn of PAID_MEMORY_HISTORY_STAGES) {
          for (const load of memoryProductLoads) {
            matrix.push(assemblePaidMemoryPromptRow({ modelId, config, currentTurn, load }));
          }
        }
      }
    }

    const memoryPeakMaxInputTable = MAIN_RP_MODEL_IDS.map(buildMemoryPeakMaxInputTable);
    const absoluteMaxTable = memoryPeakMaxInputTable.map((peak) => ({
      ...peak,
      global15Gte28k: peak.paidGlobal15MaxInput >= 28_000,
      global15Gte40k: peak.paidGlobal15MaxInput >= 40_000,
      global15Gte50k: peak.paidGlobal15MaxInput >= 50_000,
      global15Gte60k: peak.memoryPeakGlobal15Gte60k,
    }));
    const absoluteValidMaxInputTable = MAIN_RP_MODEL_IDS.map(buildAbsoluteValidMaxInputTable);
    const tableAMemoryProduct = MAIN_RP_MODEL_IDS.map(buildMemoryProductTable);
    const tableBCreatorStress = MAIN_RP_MODEL_IDS.flatMap(buildCreatorStressTable);
    const tableBTargetAttachedLorebookStress = MAIN_RP_MODEL_IDS.flatMap(
      buildTargetAttachedLorebookStressTable
    );
    const tableCAbsoluteValidStress = MAIN_RP_MODEL_IDS.flatMap(buildAbsoluteValidStressTable);
    const absoluteValidMatrix = tableCAbsoluteValidStress.map((r) =>
      assemblePaidMemoryPromptRow({
        modelId: r.modelId,
        config: configById(r.configId),
        currentTurn: 2000,
        load: "ABSOLUTE_VALID_STRESS",
        creatorMatchCount: r.creatorMatchCount,
      })
    );
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
        for (const load of memoryProductLoads) {
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

      const peak = memoryPeakMaxInputTable.find((r) => r.modelId === modelId)!;
      const absValid = absoluteValidMaxInputTable.find((r) => r.modelId === modelId)!;
      const tableA = tableAMemoryProduct.find((r) => r.modelId === modelId)!;
      const amp = buildInputAmplificationTable(modelId, 2000, "MEMORY_PEAK");
      const tpa = turnPriceAmplification.find(
        (r) => r.modelId === modelId && r.currentTurn === 2000 && r.load === "MEMORY_PEAK" && r.outputPresetChars === AUDIT_OUTPUT_PRESET_CHARS.canonical
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
          r.load === "MEMORY_PEAK" &&
          r.outputPresetChars === AUDIT_OUTPUT_PRESET_CHARS.canonical
      )!;
      const creatorP = (count: CreatorStressMatchCount) =>
        tableBCreatorStress.find(
          (r) => r.modelId === modelId && r.configId === "PAID_CURRENT" && r.creatorMatchCount === count
        )?.pCharge ?? 0;
      const dupNo = duplicationAudits.some(
        (d) =>
          d.modelId === modelId &&
          d.currentTurn === 2000 &&
          d.load === "MEMORY_PEAK" &&
          d.noDetectedMediumGlobalLiteralBloat === "NO"
      );
      summaryByModel[modelId] = {
        memoryPeakFreeMaxInput: peak.freeMaxInput,
        memoryPeakPaidCurrentMaxInput: peak.paidCurrentMaxInput,
        memoryPeakPaidGlobal15MaxInput: peak.paidGlobal15MaxInput,
        memoryPeakPaidGlobal20MaxInput: peak.paidGlobal20MaxInput,
        memoryPeakGlobal15Gte60k: peak.memoryPeakGlobal15Gte60k,
        absoluteValidFreeMaxInput: absValid.freeMaxInput,
        absoluteValidPaidCurrentMaxInput: absValid.paidCurrentMaxInput,
        absoluteValidPaidGlobal15MaxInput: absValid.paidGlobal15MaxInput,
        absoluteValidGlobal15Gte60k: absValid.absoluteValidGlobal15Gte60k,
        absoluteValidGlobal15Gte80k: absValid.absoluteValidGlobal15Gte80k,
        absoluteValidGlobal15Gte100k: absValid.absoluteValidGlobal15Gte100k,
        firstCreatorMatchCrossing60k: absValid.firstCreatorMatchCrossing60k,
        firstCreatorMatchCrossing100k: absValid.firstCreatorMatchCrossing100k,
        paidCurrentInputAmplification: amp.paidCurrentRatio,
        global15InputAmplification: amp.global15Ratio,
        paidCurrentTurnPriceAmplification: tpa.paidCurrentAmplification,
        global15TurnPriceAmplification: tpa.global15Amplification,
        paidCurrentPeakP: tpa.paidCurrentP,
        global15PeakP: tpa.paidGlobal15P,
        global15PDeltaPercent: tpa.global15PDeltaPercent,
        global15AttributableInputDelta: tableA.deltaInputGlobal15VsPaid,
        global15AttributablePDelta: tableA.deltaPGlobal15VsPaid,
        creator1EntryP: creatorP(1),
        creator10EntryP: creatorP(10),
        creator25EntryP: creatorP(25),
        creator50EntryP: creatorP(50),
        creator100EntryP: creatorP(100),
        longRpPriceDriftT100ToT2000: drift.driftPercentT100ToT2000,
        memoryCostRecoveryClaim: pass.recovery,
        noDetectedMediumGlobalLiteralBloat: dupNo ? "NO" : "YES",
      };
    }

    const sixtyKRootCauses = absoluteValidMatrix
      .filter((r) => r.crossed60k)
      .map(analyzeSixtyKRootCause)
      .filter((r): r is SixtyKRootCause => r != null);

    const hundredKRootCauses = absoluteValidMatrix
      .filter((r) => r.crossed100k)
      .map(analyzeSixtyKRootCause)
      .filter((r): r is SixtyKRootCause => r != null);

    const worstMemoryPeakFixture =
      matrix.reduce<PromptAssemblyRow | null>(
        (best, row) =>
          !best || row.localEstimatedTokensTotal > best.localEstimatedTokensTotal ? row : best,
        null
      );
    const worstAbsoluteValidFixture =
      absoluteValidMatrix.reduce<PromptAssemblyRow | null>(
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

    const anyAbsolute100k = absoluteValidMaxInputTable.some((r) => r.absoluteValidGlobal15Gte100k);
    const rootClassification: PaidMemoryAuditReport["rootClassification"] =
      anyAbsolute100k || CREATOR_LOREBOOK_PRODUCTION_CONTRACT.turnInjectCap === "NONE"
        ? "ABSOLUTE_MAX_UNBOUNDED"
        : "AUDIT_CORRECTED";

    return {
      classification: AUDIT_CODE_CLASSIFICATION,
      auditPass: "AUDIT_CORRECTION",
      productionSha,
      originMainSha: opts?.originMainSha ?? productionSha,
      prBehindMain: opts?.prBehindMain ?? 0,
      railwayDeployment: RAILWAY_DEPLOYMENT_CORRECTION,
      railwayStatus: "SUCCESS",
      productModel: PRODUCT_MODEL,
      assemblySource: "PRODUCTION_BUILD_CONTEXT",
      tokenMode: "REAL_ASSEMBLY_LOCAL_ESTIMATE",
      providerCalibration: "INSUFFICIENT_DATA",
      competitorBenchmark: "NOT_PERFORMED_IN_THIS_AUDIT",
      mainRpModels: MAIN_RP_MODEL_IDS,
      fxSnapshot: resolveBillingExchangeRateSnapshot(),
      variableSizeOwnerMap: buildVariableSizeOwnerMap(),
      creatorLorebookContract: CREATOR_LOREBOOK_PRODUCTION_CONTRACT,
      creatorLorebookProductModel: CREATOR_LOREBOOK_PRODUCT_MODEL,
      creatorCarryoverProof: proveCreatorCarryoverCannotExceedStoredUnique(),
      payloadCapAudit: Object.fromEntries(MAIN_RP_MODEL_IDS.map((id) => [id, auditPayloadCaps(id)])),
      openRouterPrefixAudits: MAIN_RP_MODEL_IDS.map((id) => auditOpenRouterCreatorPrefix(id)),
      matrix,
      memoryPeakMaxInputTable,
      absoluteValidMaxInputTable,
      absoluteMaxTable,
      tableAMemoryProduct,
      tableBCreatorStress,
      tableBTargetAttachedLorebookStress,
      tableCAbsoluteValidStress,
      inputBandSummary: summarizeInputBands(matrix),
      absoluteValidInputBandSummary: summarizeInputBands(absoluteValidMatrix),
      sixtyKRootCauses,
      hundredKRootCauses,
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
      globalMaintenanceClassification: "APPROXIMATE_FORENSIC_ONLY",
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
      worstMemoryPeakFixture,
      worstAbsoluteValidFixture,
      worstPaidGlobal15,
      worstPaidCurrent,
      rootClassification,
      providerGenerationCalls: 0,
      runtimeChange: "NO",
      pricingChange: "NO",
      billingChange: "NO",
      pointTopupSubscriberBonus: "SIMULATION_ONLY",
      currentUserTurnMax: CHAT_MESSAGE_MAX,
    };
  } finally {
    if (prevEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = prevEnv;
  }
}

export function formatPaidMemoryAuditMarkdown(report: PaidMemoryAuditReport): string {
  const lines: string[] = [];
  lines.push("# Peak Input Pressure + Paid-Memory Turn Price Audit (CORRECTION PASS)");
  lines.push("");
  lines.push("## PRODUCTION DEPLOYMENT");
  lines.push(`- Railway deployment: \`${report.railwayDeployment}\``);
  lines.push(`- Railway status: ${report.railwayStatus}`);
  lines.push(`- Production SHA: \`${report.productionSha}\``);
  lines.push(`- Origin main (latest fetch): \`${report.originMainSha}\``);
  lines.push(`- PR_BEHIND_MAIN = ${report.prBehindMain}`);
  lines.push("");
  lines.push("## LOAD CLASSES");
  lines.push("- **NORMAL** — realistic ordinary RP");
  lines.push("- **MEMORY_PEAK** — subscription memory tiers max + realistic-heavy Creator (~3 entries via production matcher)");
  lines.push("- **ABSOLUTE_VALID_STRESS** — every server-valid variable-size owner stressed through production paths");
  lines.push("");
  lines.push("## CREATOR LOREBOOK — PRODUCT MODEL (CURRENT vs TARGET)");
  lines.push(`- MODEL_MISMATCH = ${report.creatorLorebookProductModel.mismatch ? "YES" : "NO"}`);
  lines.push(`- CURRENT attach: ${report.creatorLorebookProductModel.current.characterAttach}`);
  lines.push(`- CURRENT unit: ${report.creatorLorebookProductModel.current.lorebookUnit}`);
  lines.push(`- CURRENT per-turn inject cap: ${report.creatorLorebookProductModel.current.perTurnInjectionCap}`);
  lines.push(`- CURRENT theoretical max inject (no cap): ${report.creatorLorebookProductModel.current.theoreticalMaxInjectCharsNoCap} chars`);
  lines.push(`- TARGET attach max: ${report.creatorLorebookProductModel.target.characterAttachMax} lorebooks/character`);
  lines.push(`- TARGET unit: ${report.creatorLorebookProductModel.target.lorebookUnit}`);
  lines.push(`- TARGET per-turn inject: ${report.creatorLorebookProductModel.target.perTurnInjectionCap}`);
  lines.push(`- TARGET theoretical max if all hit (no cap): ${report.creatorLorebookProductModel.target.theoreticalMaxInjectIfAllHitAndNoCap} chars`);
  lines.push("- Required schema deltas:");
  for (const d of report.creatorLorebookProductModel.requiredDeltas.schema) {
    lines.push(`  - ${d}`);
  }
  lines.push("");
  lines.push(`## CREATOR LOREBOOK CONTRACT (current main path)`);
  lines.push(`- CREATOR_LOREBOOK_TURN_INJECT_CAP = ${report.creatorLorebookContract.turnInjectCap}`);
  lines.push(`- Path: ${report.creatorLorebookContract.path.join(" → ")}`);
  lines.push(`- Carryover: ${report.creatorCarryoverProof.detail}`);
  lines.push("");
  lines.push("## TABLE A — MEMORY PRODUCT (T2000 MEMORY_PEAK, realistic Creator)");
  lines.push("| Model | Free | Paid | Global15 | Δ input Paid | Δ input G15 | Δ P Paid | Δ P G15 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of report.tableAMemoryProduct) {
    lines.push(
      `| ${row.modelId} | ${row.freeRealisticInput} | ${row.paidCurrentRealisticInput} | ${row.paidGlobal15RealisticInput} | ${row.deltaInputPaidVsFree} | ${row.deltaInputGlobal15VsPaid} | ${row.deltaPPaidVsFree} | ${row.deltaPGlobal15VsPaid} |`
    );
  }
  lines.push("");
  lines.push("## TABLE B — CURRENT CONTAINER ENTRY STRESS (1 attached lorebook, N entries — NOT target 20 lorebooks)");
  lines.push("| Model | 1-entry P | 10 | 25 | 50 | 100 entries P |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const modelId of report.mainRpModels) {
    const s = report.summaryByModel[modelId];
    if (!s) continue;
    lines.push(
      `| ${modelId} | ${s.creator1EntryP} | ${s.creator10EntryP} | ${s.creator25EntryP} | ${s.creator50EntryP} | ${s.creator100EntryP} |`
    );
  }
  lines.push("");
  lines.push("## TABLE B′ — TARGET ATTACHED LOREBOOK UNITS (forensic ref, max 20 units, no injection cap)");
  lines.push("| Model | 1 unit P | 5 | 10 | 15 | 20 units P |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const modelId of report.mainRpModels) {
    const pick = (n: TargetAttachedLorebookStressCount) =>
      report.tableBTargetAttachedLorebookStress.find(
        (r) => r.modelId === modelId && r.attachedLorebookCount === n
      )?.pCharge ?? 0;
    lines.push(`| ${modelId} | ${pick(1)} | ${pick(5)} | ${pick(10)} | ${pick(15)} | ${pick(20)} |`);
  }
  lines.push("");
  lines.push("## TABLE C — ABSOLUTE VALID STRESS (T2000, PAID_GLOBAL15, 100 container entries on current main)");
  lines.push("| Model | Total input | 60K+ | 80K+ | 100K+ | P charge | Root cause |");
  lines.push("|---|---:|---|---|---|---:|---|");
  for (const modelId of report.mainRpModels) {
    const row = report.tableCAbsoluteValidStress.find(
      (r) => r.modelId === modelId && r.configId === "PAID_GLOBAL_15K" && r.creatorMatchCount === 100
    );
    if (!row) continue;
    lines.push(
      `| ${modelId} | ${row.totalInputTokens} | ${row.crossed60k ? "Y" : "N"} | ${row.crossed80k ? "Y" : "N"} | ${row.crossed100k ? "Y" : "N"} | ${row.pCharge} | ${row.primaryRootCause} |`
    );
  }
  lines.push("");
  lines.push("## MEMORY_PEAK MAX INPUT (realistic Creator — NOT absolute max)");
  lines.push("| MODEL | FREE | PAID | G15 | G20 | G15≥60K | stage |");
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const row of report.memoryPeakMaxInputTable) {
    lines.push(
      `| ${row.modelId} | ${row.freeMaxInput} | ${row.paidCurrentMaxInput} | ${row.paidGlobal15MaxInput} | ${row.paidGlobal20MaxInput} | ${row.memoryPeakGlobal15Gte60k ? "Y" : "N"} | T${row.maxStage}/${row.maxLoad} |`
    );
  }
  lines.push("");
  lines.push("## ABSOLUTE VALID MAX INPUT");
  for (const row of report.absoluteValidMaxInputTable) {
    lines.push(
      `- ${row.modelId}: FREE=${row.freeMaxInput} PAID=${row.paidCurrentMaxInput} G15=${row.paidGlobal15MaxInput} first60K@creator${row.firstCreatorMatchCrossing60k ?? "none"} first100K@creator${row.firstCreatorMatchCrossing100k ?? "none"}`
    );
  }
  lines.push("");
  lines.push("## INPUT BANDS — MEMORY_PEAK matrix");
  for (const band of report.inputBandSummary) {
    lines.push(`- ${band.band}: ${band.fixtureCount} fixtures`);
  }
  lines.push("## INPUT BANDS — ABSOLUTE_VALID_STRESS matrix");
  for (const band of report.absoluteValidInputBandSummary) {
    lines.push(`- ${band.band}: ${band.fixtureCount} fixtures`);
  }
  lines.push("");
  lines.push("## GLOBAL15 ATTRIBUTION (stable vs Creator size — sample Creator100 MEMORY_PEAK)");
  for (const modelId of report.mainRpModels) {
    const row = report.tableBCreatorStress.find(
      (r) => r.modelId === modelId && r.configId === "PAID_GLOBAL_15K" && r.creatorMatchCount === 100
    );
    if (!row) continue;
    lines.push(
      `- ${modelId}: GLOBAL15_INPUT_DELTA_VS_PAID=${row.global15InputDeltaVsPaidCurrent} GLOBAL15_P_DELTA=${row.global15PDeltaVsPaidCurrent}`
    );
  }
  lines.push("");
  lines.push("## GLOBAL MAINTENANCE");
  lines.push(`- GLOBAL_MAINTENANCE_COST = ${report.globalMaintenanceClassification}`);
  lines.push("");
  lines.push("## FINAL CLASSIFICATION");
  lines.push(`- PRODUCTION_SHA = ${report.productionSha}`);
  lines.push(`- PR_BEHIND_MAIN = ${report.prBehindMain}`);
  lines.push(`- ROOT_CLASSIFICATION = ${report.rootClassification}`);
  lines.push(`- CREATOR_LOREBOOK_TURN_INJECT_CAP = ${report.creatorLorebookContract.turnInjectCap}`);
  lines.push(`- CURRENT_USER_TURN_MAX = ${report.currentUserTurnMax}`);
  lines.push(`- GLOBAL_MAINTENANCE_COST = ${report.globalMaintenanceClassification}`);
  lines.push(`- PROVIDER_GENERATION_CALLS = ${report.providerGenerationCalls}`);
  lines.push(`- RUNTIME_CHANGE = ${report.runtimeChange}`);
  lines.push(`- MERGE = NO`);
  for (const modelId of report.mainRpModels) {
    const s = report.summaryByModel[modelId];
    if (!s) continue;
    lines.push(`- MEMORY_PEAK_FREE_MAX_INPUT_${modelId} = ${s.memoryPeakFreeMaxInput}`);
    lines.push(`- MEMORY_PEAK_PAID_CURRENT_MAX_INPUT_${modelId} = ${s.memoryPeakPaidCurrentMaxInput}`);
    lines.push(`- MEMORY_PEAK_PAID_GLOBAL15_MAX_INPUT_${modelId} = ${s.memoryPeakPaidGlobal15MaxInput}`);
    lines.push(`- MEMORY_PEAK_GLOBAL15_60K_PLUS_${modelId} = ${s.memoryPeakGlobal15Gte60k ? "YES" : "NO"}`);
    lines.push(`- ABSOLUTE_VALID_FREE_MAX_INPUT_${modelId} = ${s.absoluteValidFreeMaxInput}`);
    lines.push(`- ABSOLUTE_VALID_PAID_CURRENT_MAX_INPUT_${modelId} = ${s.absoluteValidPaidCurrentMaxInput}`);
    lines.push(`- ABSOLUTE_VALID_PAID_GLOBAL15_MAX_INPUT_${modelId} = ${s.absoluteValidPaidGlobal15MaxInput}`);
    lines.push(`- ABSOLUTE_VALID_GLOBAL15_60K_PLUS_${modelId} = ${s.absoluteValidGlobal15Gte60k ? "YES" : "NO"}`);
    lines.push(`- ABSOLUTE_VALID_GLOBAL15_80K_PLUS_${modelId} = ${s.absoluteValidGlobal15Gte80k ? "YES" : "NO"}`);
    lines.push(`- ABSOLUTE_VALID_GLOBAL15_100K_PLUS_${modelId} = ${s.absoluteValidGlobal15Gte100k ? "YES" : "NO"}`);
    lines.push(`- CREATOR_MATCHES_FIRST_60K_${modelId} = ${s.firstCreatorMatchCrossing60k ?? "none"}`);
    lines.push(`- CREATOR_MATCHES_FIRST_100K_${modelId} = ${s.firstCreatorMatchCrossing100k ?? "none"}`);
    lines.push(`- CREATOR_1_ENTRY_P_${modelId} = ${s.creator1EntryP}`);
    lines.push(`- CREATOR_10_ENTRY_P_${modelId} = ${s.creator10EntryP}`);
    lines.push(`- CREATOR_25_ENTRY_P_${modelId} = ${s.creator25EntryP}`);
    lines.push(`- CREATOR_50_ENTRY_P_${modelId} = ${s.creator50EntryP}`);
    lines.push(`- CREATOR_100_ENTRY_P_${modelId} = ${s.creator100EntryP}`);
    lines.push(`- GLOBAL15_ATTRIBUTABLE_INPUT_DELTA_${modelId} = ${s.global15AttributableInputDelta}`);
    lines.push(`- GLOBAL15_ATTRIBUTABLE_P_DELTA_${modelId} = ${s.global15AttributablePDelta}`);
    lines.push(`- NO_DETECTED_MEDIUM_GLOBAL_LITERAL_BLOAT_${modelId} = ${s.noDetectedMediumGlobalLiteralBloat}`);
    lines.push(`- MEMORY_COST_RECOVERY_CLAIM_${modelId} = ${s.memoryCostRecoveryClaim}`);
  }

  return lines.join("\n");
}

export { listMainRpModelProfiles, MAIN_RP_USER_SELECTABLE_OPTIONS, selectedAIProvider };
