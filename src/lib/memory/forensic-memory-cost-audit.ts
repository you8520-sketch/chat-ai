/**
 * Post-#987 forensic memory / cost audit — read-only, zero provider calls.
 * Uses production buildContext() + canonical billing/token owners.
 */
import {
  applyCreatorLorebookTurnInjectionBudget,
  buildCreatorLorebookPromptBlock,
  CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT,
  CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS,
  type CreatorLorebookMatch,
} from "@/lib/creatorLorebook";
import {
  MAIN_RP_MODEL_IDS,
  selectedAIProvider,
  type SelectedAI,
  isCheaperInferenceGemini37FlashModel,
  isDeepSeekV4ProModel,
  isGemini31ProModel,
} from "@/lib/chatModels";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";
import { resolveEpisodicMemoryMaxChars } from "@/lib/episodicMemoryFacts";
import { estimateTokens } from "@/lib/tokenEstimate";
import { USER_NOTE_FOCUS_MAX } from "@/lib/persona";
import { openRouterUsdCostDetailed } from "@/lib/billingRawCost";
import { getEffectiveKrwPerUsd } from "@/lib/exchangeRate";
import {
  computeOpenRouterTurnCost,
  explainOpenRouterDeepSeekTurnCost,
  explainOpenRouterGeminiTurnCost,
} from "@/lib/points";
import type { TrackedPromptSection } from "@/services/promptAudit";
import { buildContext } from "@/services/contextBuilder";
import type { ContextBuildInput } from "@/types";
import {
  applyUserLorebookTurnInjectionBudget,
  buildUserLorebookPromptBlock,
  type UserLorebookStoredEntry,
} from "@/lib/userLorebook";
import {
  buildBillingOwnerMap,
  buildForensicModelHeadroomRowFromProviderEvidence,
  buildMarginMatrixRow,
  buildPaidMarginMatrix,
  buildProviderContextEvidenceTable,
  decideImplementationRecommendationFromGates,
  evaluateAuditGates,
  implementationDecisionLabel,
  IMPLEMENTATION_SAFE_LABEL,
  MIN_PROVIDER_HEADROOM_TOKENS,
  PRODUCT_MARGIN_REFERENCE,
  PROVIDER_CONTEXT_UNKNOWN,
  resolveAuditProviderContextCeiling,
  resolveProviderContextEvidence,
  type AuditGateEvaluation,
  type AuditGateStatus,
  type BillingOwnerRow,
  type MarginMatrixRow,
  type ProviderContextEvidenceRow,
} from "./forensic-memory-cost-audit-evidence";
import {
  FREE_CAPABILITY,
  SUBSCRIBED_CAPABILITY,
  type SubscriptionMemoryCapability,
} from "@/lib/subscriptionMemoryCapability";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import type { RingSize } from "./memory-architecture-audit";
import {
  assembleMovingGlobalCompactStub,
  assembleMovingMediumRingText,
} from "./memory-medium-term-audit";
import {
  MEDIUM_TERM_BLOCK_COUNT,
  shouldInjectMediumTermMemory,
  measureMediumGlobalLiteralDuplicateChars,
} from "./memory-medium-term";
import { RAW_HISTORY_COMPLETE_EXCHANGES } from "./memory-constants";
import { resolveAuditContextProvider } from "./memory-medium-term-prompt-budget-audit";
import {
  buildEpisodicBlock,
  buildRaw4History,
  buildRelationshipMeta,
} from "./memory-medium-term-prompt-budget-audit";

export const FORENSIC_AUDIT_MAIN_HEAD =
  "3c5555a2fe97f9097cf7b65aff5912574d72b805" as const;

export const FORENSIC_AUDIT_PR987_MERGE =
  "Merge pull request #987 from you8520-sketch/cursor/creator-lorebook-20-attach-bounded-inject-163d" as const;

export type AuditMatrixCondition =
  | "FREE_CURRENT"
  | "PAID_CURRENT"
  | "PAID_GLOBAL15_SIMULATION";

export type AuditLoadClass = "NORMAL" | "MEMORY_HEAVY" | "BOUNDED_VALID_STRESS";

export type MemoryOwnerMapRow = {
  responsibility: string;
  canonicalOwner: string;
  location: string;
  value: string;
  tierDependent: boolean;
  notes?: string;
};

export type SectionInventoryRow = {
  sectionId: string;
  label: string;
  category: string;
  canonicalProducer: string;
  injectionPosition: string;
  maxChars: string;
  estimatedTokensNote: string;
  tierDependent: boolean;
  historyTrimInteraction: string;
  cacheBoundary: string;
};

export type SectionPressureRow = {
  section: string;
  chars: number;
  estimatedTokens: number;
  pctOfTotal: number;
  tierDependent: boolean;
  cappedBy: string;
};

export type ForensicAssemblyResult = {
  modelId: string;
  loadClass: AuditLoadClass;
  matrix: AuditMatrixCondition;
  globalMaxChars: number;
  capability: SubscriptionMemoryCapability;
  estimatedSystemTokens: number;
  estimatedHistoryTokens: number;
  estimatedInputTokens: number;
  historyMessageCount: number;
  historyTrimmedVsFixture: boolean;
  truncatedMemory: boolean;
  mediumActive: boolean;
  mediumChars: number;
  globalChars: number;
  focusChars: number;
  creatorLorebookChars: number;
  userLorebookChars: number;
  mediumGlobalLiteralDuplicateChars: number;
  ledger: SectionPressureRow[];
  trackedSectionIds: string[];
};

export type ForensicModelHeadroomRow = {
  modelId: string;
  loadClass: AuditLoadClass;
  matrix: AuditMatrixCondition;
  estimatedInputTokens: number;
  /** Provider catalog context_length — NOT production assembly payload limit. */
  contextPayloadCeiling: number;
  ceilingSource: string;
  remainingHeadroom: number;
  historyMessages: number;
  historyTrimmedByGlobalIncrease: boolean;
  telemetrySystemBudget: number;
  telemetryHeadroom: number;
  providerContextWindowTokens: number | typeof PROVIDER_CONTEXT_UNKNOWN;
  providerMaxOutputTokens: number | typeof PROVIDER_CONTEXT_UNKNOWN;
  providerEvidenceSource: string;
  productionAssemblyPayloadLimit: number;
};

export type ForensicCostRow = {
  modelId: string;
  loadClass: AuditLoadClass;
  matrix: AuditMatrixCondition;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  rawCostKrw: number;
  chargePoints: number;
};

export type ForensicMatrixSnapshot = {
  loadClass: AuditLoadClass;
  modelId: string;
  free10: ForensicAssemblyResult;
  paid10: ForensicAssemblyResult;
  paid15Sim: ForensicAssemblyResult;
  global15InputTokenDelta: number;
  global15RawKrwDelta: number;
  global15PointsDelta: number;
  historyTrimOffset: boolean;
  mediumGlobalOverlapChars: number;
};

export type StaleArtifactClassification = "SAFE TO DELETE" | "KEEP" | "FOLLOW-UP";

export type StaleArtifactRow = {
  artifact: string;
  classification: StaleArtifactClassification;
  reason: string;
};

export type ImplementationDecision = "A" | "B" | "C" | "D";

const DEFAULT_CURRENT_TURN = 300;
const DEFAULT_OUTPUT_CHARS = 2_500;

function padToChars(text: string, chars: number): string {
  let body = text;
  while (body.length < chars) body += " → PAD";
  return body.slice(0, chars);
}

function resolveGlobalMaxChars(matrix: AuditMatrixCondition): number {
  if (matrix === "PAID_GLOBAL15_SIMULATION") return 15_000;
  return MEMORY_CAPACITY_FIXED;
}

function resolveCapability(matrix: AuditMatrixCondition): SubscriptionMemoryCapability {
  if (matrix === "FREE_CURRENT") return FREE_CAPABILITY;
  return SUBSCRIBED_CAPABILITY;
}

/** Confirms SubscriptionMemoryCapability has no globalCurrentMemoryMaxChars field. */
export function subscriptionCapabilityLacksGlobalTier(): boolean {
  const keys = Object.keys(FREE_CAPABILITY);
  return !keys.includes("globalCurrentMemoryMaxChars");
}

export function buildMemoryOwnerMap(): MemoryOwnerMapRow[] {
  return [
    {
      responsibility: "subscription memory capability",
      canonicalOwner: "resolveSubscriptionMemoryCapability",
      location: "src/lib/subscriptionMemoryCapability.ts",
      value: "focusMaxChars, userLorebookActiveEntryMax, userLorebookActiveContentMaxChars, userLorebookTurnInjectMaxChars",
      tierDependent: true,
      notes: subscriptionCapabilityLacksGlobalTier()
        ? "No globalCurrentMemoryMaxChars on SubscriptionMemoryCapability (audit-only observation — not added)."
        : undefined,
    },
    {
      responsibility: "Focus max chars",
      canonicalOwner: "resolveSubscriptionMemoryCapability().focusMaxChars",
      location: "src/lib/subscriptionMemoryCapability.ts → buildContext focusMaxChars",
      value: "FREE=1_000 SUBSCRIBED=2_000",
      tierDependent: true,
    },
    {
      responsibility: "User Lorebook active entry capacity",
      canonicalOwner: "computeUserLorebookEntryEffectiveStates",
      location: "src/lib/userLorebook.ts",
      value: "FREE=10 SUBSCRIBED=50",
      tierDependent: true,
    },
    {
      responsibility: "User Lorebook active content capacity",
      canonicalOwner: "computeUserLorebookEntryEffectiveStates",
      location: "src/lib/userLorebook.ts",
      value: "FREE=5_000 SUBSCRIBED=20_000",
      tierDependent: true,
    },
    {
      responsibility: "User Lorebook per-turn injection",
      canonicalOwner: "applyUserLorebookTurnInjectionBudget",
      location: "src/lib/userLorebook.ts",
      value: "FREE=2_500 SUBSCRIBED=4_000",
      tierDependent: true,
    },
    {
      responsibility: "Creator Lorebook attachment limit",
      canonicalOwner: "CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT",
      location: "src/lib/creatorLorebook.ts",
      value: "20 (tier-neutral)",
      tierDependent: false,
    },
    {
      responsibility: "Creator Lorebook per-turn injection",
      canonicalOwner: "applyCreatorLorebookTurnInjectionBudget",
      location: "src/lib/creatorLorebook.ts",
      value: `${CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS} matched-content chars (tier-neutral)`,
      tierDependent: false,
    },
    {
      responsibility: "Global Current Memory max chars",
      canonicalOwner: "MEMORY_CAPACITY_FIXED / normalizeMemoryCapacity",
      location: "src/lib/memory/memory-capacity-shared.ts",
      value: `${MEMORY_CAPACITY_FIXED} (tier-neutral production)`,
      tierDependent: false,
    },
    {
      responsibility: "Global compaction owner",
      canonicalOwner: "executeGlobalLorebookCompaction → compactCurrentMemory",
      location: "src/lib/memory/memory-global-compaction-execution.ts",
      value: "Post-seal overflow → chat_memories.recent_summary global_compact projection",
      tierDependent: false,
    },
    {
      responsibility: "Medium Memory retention/read condition",
      canonicalOwner: "shouldInjectMediumTermMemory + buildMediumTermMemoryBlockForProjection",
      location: "src/lib/memory/memory-medium-term.ts",
      value: `N${MEDIUM_TERM_BLOCK_COUNT} when projectionKind=global_compact only`,
      tierDependent: false,
    },
    {
      responsibility: "raw history token/turn trim owner",
      canonicalOwner: "trimHistoryToBudget / trimProviderHistoryToBudget",
      location: "src/lib/hybridMemory.ts + src/services/contextBuilder.ts",
      value: `HISTORY_TOKEN_BUDGET=${HISTORY_TOKEN_BUDGET}, MIN_HISTORY_TURN_FLOOR=4`,
      tierDependent: false,
    },
    {
      responsibility: "final prompt/context assembly owner",
      canonicalOwner: "buildContext",
      location: "src/services/contextBuilder.ts",
      value: "Main RP trackedSections + history trim loop",
      tierDependent: false,
    },
    {
      responsibility: "model-specific maximum input/payload owner",
      canonicalOwner: "resolveMaxPayloadInputTokens (production assembly) + CheaperInference catalog context_length (provider ceiling)",
      location: "src/lib/contextTrack.ts + forensic-memory-cost-audit-evidence fixture",
      value:
        "Production assembly: resolveMaxPayloadInputTokens→MAX_SAFE_INTEGER (telemetry-only). Provider ceiling: verified GET /v1/models context_length per Main RP model (separate field).",
      tierDependent: false,
    },
    {
      responsibility: "point billing owner",
      canonicalOwner: "computeOpenRouterTurnCost",
      location: "src/lib/points.ts",
      value: "Model-routed turn charge (DeepSeek simple-point, Gemini31 output floor, generic USD×FX fallback)",
      tierDependent: false,
    },
    {
      responsibility: "raw KRW/provider cost calculation owner",
      canonicalOwner: "resolveOpenRouterBillingRawCostKrw / explainOpenRouter*TurnCost",
      location: "src/lib/points.ts",
      value: "openRouterUsdCostDetailed × getEffectiveKrwPerUsd (model-specific explain wrappers)",
      tierDependent: false,
    },
  ];
}

export function buildSectionInventory(): SectionInventoryRow[] {
  const tierSections = new Set([
    "identity-and-rules",
    "user-lorebook",
  ]);
  const memorySections: Record<string, string> = {
    "current-memory": `${MEMORY_CAPACITY_FIXED} chars (production); audit sim up to 15_000`,
    "medium-term-memory": `N${MEDIUM_TERM_BLOCK_COUNT} sealed blocks when global_compact`,
    "archive-memory": "ARCHIVE_CAPACITY_FIXED=3000",
    "episodic-memory-retrieved-facts": "resolveEpisodicMemoryMaxChars env default 1000",
    "relationship-meta": "JSON tail in current-memory block",
    "keyword-lorebook": `Creator turn inject max ${CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS}`,
    "user-lorebook": "capability.userLorebookTurnInjectMaxChars",
  };
  const rows: SectionInventoryRow[] = [
    {
      sectionId: "fixed-system-core",
      label: "OpenRouter Korean prose + no-godmodding + historical truth + contamination guard",
      category: "systemRules",
      canonicalProducer: "buildContext pushSection cacheRules",
      injectionPosition: "TOP (OpenRouter cacheRules prefix)",
      maxChars: "unbounded (stable rules bundle)",
      estimatedTokensNote: "buildContext usedTokens accumulator",
      tierDependent: false,
      historyTrimInteraction: "Protected — never trimmed before history",
      cacheBoundary: "OpenRouter cacheRules / Gemini static when enabled",
    },
    {
      sectionId: "character-core-identity",
      label: "Structured character canon",
      category: "characterSetting",
      canonicalProducer: "buildCharacterCanonBlock / renderCoreCanonBlock",
      injectionPosition: "Early cacheCharacter (OpenRouter) or dynamic",
      maxChars: "chunk budget (fixture-dependent)",
      estimatedTokensNote: "estimateTokens per section",
      tierDependent: false,
      historyTrimInteraction: "Protected",
      cacheBoundary: "OpenRouter cacheCharacter",
    },
    {
      sectionId: "identity-and-rules",
      label: "Persona + Focus (user note mandatory zone)",
      category: "persona",
      canonicalProducer: "splitUserNotePromptZones + buildIdentityAndRulesBlock",
      injectionPosition: "After core identity",
      maxChars: `focus ≤ resolveSubscriptionMemoryCapability().focusMaxChars (UI cap ${USER_NOTE_FOCUS_MAX})`,
      estimatedTokensNote: "Focus chars drive section size",
      tierDependent: true,
      historyTrimInteraction: "Protected",
      cacheBoundary: "OpenRouter cacheRules",
    },
    {
      sectionId: "keyword-lorebook",
      label: "Creator Lorebook matched injection",
      category: "worldLore / OpenRouter dynamic lore prefix",
      canonicalProducer: "loadAttachedCreatorLorebooksPromptBlockFromActivation",
      injectionPosition: "OpenRouter: dynamicLorebookParts → user-turn prefix; else tracked section",
      maxChars: `${CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS} matched chars; max ${CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT} attach`,
      estimatedTokensNote: "Measured post applyCreatorLorebookTurnInjectionBudget",
      tierDependent: false,
      historyTrimInteraction: "Protected",
      cacheBoundary: "OpenRouter dynamic (volatile)",
    },
    {
      sectionId: "user-lorebook",
      label: "User Lorebook matched injection",
      category: "userNote",
      canonicalProducer: "loadUserLorebookPromptBlockFromActivation",
      injectionPosition: "Dynamic block before tail rules",
      maxChars: "capability.userLorebookTurnInjectMaxChars",
      estimatedTokensNote: "Measured post applyUserLorebookTurnInjectionBudget",
      tierDependent: true,
      historyTrimInteraction: "Protected",
      cacheBoundary: "Dynamic",
    },
    {
      sectionId: "current-memory",
      label: "Global Current Memory",
      category: "memory",
      canonicalProducer: "resolveGlobalCurrentMemory → memory-manager → buildContext longTermMemory",
      injectionPosition: "[3] Current Memory (DeepSeek XML LTM group)",
      maxChars: memorySections["current-memory"]!,
      estimatedTokensNote: "Chars ≈ tokens/4 in audit ledger",
      tierDependent: false,
      historyTrimInteraction: "Protected; may indirectly pressure history via payload loop (currently inert — maxPayload unbounded)",
      cacheBoundary: "Dynamic / DeepSeek ltm XML",
    },
    {
      sectionId: "medium-term-memory",
      label: "Medium Memory N15",
      category: "memory",
      canonicalProducer: "buildMediumTermMemoryBlockForProjection",
      injectionPosition: "[2z] before current-memory when active",
      maxChars: memorySections["medium-term-memory"]!,
      estimatedTokensNote: "~15 × ~450–600 char sealed blocks",
      tierDependent: false,
      historyTrimInteraction: "Protected",
      cacheBoundary: "Dynamic / grouped in DeepSeek LTM",
    },
    {
      sectionId: "episodic-memory-retrieved-facts",
      label: "Episodic / facts retrieval",
      category: "memory",
      canonicalProducer: "getEpisodicMemoryForPrompt",
      injectionPosition: "[3a] before current-memory",
      maxChars: memorySections["episodic-memory-retrieved-facts"]!,
      estimatedTokensNote: "resolveEpisodicMemoryMaxFacts × fact size",
      tierDependent: false,
      historyTrimInteraction: "Protected",
      cacheBoundary: "Dynamic",
    },
    {
      sectionId: "raw-history",
      label: "Raw short-term history",
      category: "history",
      canonicalProducer: "trimHistoryToBudget in buildContext",
      injectionPosition: "Message array after system prompt",
      maxChars: `≤${HISTORY_TOKEN_BUDGET} tokens (~${RAW_HISTORY_COMPLETE_EXCHANGES} complete exchanges floor)`,
      estimatedTokensNote: "meta.estimatedHistoryTokens",
      tierDependent: false,
      historyTrimInteraction: "First trim target when over budget",
      cacheBoundary: "OpenRouter history cache tail exclude last messages",
    },
    {
      sectionId: "current-user-input",
      label: "Current user turn + operational tail",
      category: "userTurn",
      canonicalProducer: "wrapCurrentUserInput + appendCompactTerminalLengthToUserTurn",
      injectionPosition: "Final history message",
      maxChars: "CHAT_MESSAGE_MAX=1500 + length owner tail",
      estimatedTokensNote: "Included in estimatedHistoryTokens",
      tierDependent: false,
      historyTrimInteraction: "Never dropped",
      cacheBoundary: "Volatile tail",
    },
    {
      sectionId: "operational-model-tail",
      label: "Length/layout/regenerate/scene directive tails",
      category: "systemRules / userTurn",
      canonicalProducer: "responseLength + sceneDirective + regenerate directives",
      injectionPosition: "System dynamic tail + user turn suffix",
      maxChars: "model-specific length owners",
      estimatedTokensNote: "Partially in system, partially on user turn",
      tierDependent: false,
      historyTrimInteraction: "Protected system sections; length on user tail",
      cacheBoundary: "Dynamic",
    },
  ];
  void tierSections;
  return rows;
}

function buildCreatorLorebookMatchesForStress(): CreatorLorebookMatch[] {
  const matches: CreatorLorebookMatch[] = [];
  for (let i = 0; i < CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT; i++) {
    matches.push({
      lorebookId: i + 1,
      attachmentPosition: i,
      entryKey: `audit-creator-${i}`,
      keyword: `AUDIT_CREATOR_KW_${i}`,
      content: `AUDIT_CREATOR_UNIT_${i}_${"c".repeat(260)}`,
      source: "current_user",
    });
  }
  return matches;
}

function buildUserLorebookMatches(
  capability: SubscriptionMemoryCapability,
  loadClass: AuditLoadClass
): UserLorebookStoredEntry[] {
  const unitChars =
    loadClass === "NORMAL"
      ? Math.min(600, Math.floor(capability.userLorebookTurnInjectMaxChars / 3))
      : Math.floor(capability.userLorebookTurnInjectMaxChars / 4);
  const count = loadClass === "NORMAL" ? 3 : 6;
  return Array.from({ length: count }, (_, i) => ({
    keywords: [`AUDIT_USER_KW_${i}`],
    content: `AUDIT_USER_LORE_${i}_${"u".repeat(unitChars)}`,
    enabled: true,
  }));
}

function buildCreatorLorebookBlock(loadClass: AuditLoadClass): string {
  if (loadClass === "NORMAL") {
    const matches = buildCreatorLorebookMatchesForStress().slice(0, 3);
    const budgeted = applyCreatorLorebookTurnInjectionBudget(
      matches,
      CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS
    );
    return buildCreatorLorebookPromptBlock(budgeted.map((m) => m.content));
  }
  const budgeted = applyCreatorLorebookTurnInjectionBudget(
    buildCreatorLorebookMatchesForStress(),
    CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS
  );
  assertCreatorBoundedStress(budgeted);
  return buildCreatorLorebookPromptBlock(budgeted.map((m) => m.content));
}

function assertCreatorBoundedStress(budgeted: CreatorLorebookMatch[]): void {
  const joined = budgeted.map((m) => m.content).join("\n\n");
  if (joined.length > CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS) {
    throw new Error(
      `BOUNDED creator injection exceeded cap: ${joined.length} > ${CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS}`
    );
  }
  if (budgeted.length > CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT) {
    throw new Error("BOUNDED creator attach exceeded 20");
  }
}

function buildUserLorebookBlock(
  capability: SubscriptionMemoryCapability,
  loadClass: AuditLoadClass
): string {
  const entries = buildUserLorebookMatches(capability, loadClass);
  const pseudoMatches = entries.map((entry, index) => ({
    entryKey: `audit-user-${index}`,
    keyword: entry.keywords[0] ?? `AUDIT_USER_KW_${index}`,
    content: entry.content,
    source: "current_user" as const,
  }));
  const budgeted = applyUserLorebookTurnInjectionBudget(
    pseudoMatches,
    capability.userLorebookTurnInjectMaxChars
  );
  return buildUserLorebookPromptBlock(budgeted.map((m) => m.content));
}

function buildFocusNote(capability: SubscriptionMemoryCapability, loadClass: AuditLoadClass): string {
  const target =
    loadClass === "NORMAL"
      ? Math.min(capability.focusMaxChars, Math.floor(capability.focusMaxChars * 0.7))
      : capability.focusMaxChars;
  return padToChars(`[Focus audit zone] ${"F".repeat(Math.max(0, target - 24))}`, target);
}

function buildGlobalMemoryText(
  currentTurn: number,
  globalMaxChars: number,
  loadClass: AuditLoadClass
): string {
  const stub = assembleMovingGlobalCompactStub(currentTurn);
  const fillRatio =
    loadClass === "NORMAL" ? 0.72 : loadClass === "MEMORY_HEAVY" ? 0.95 : 1.0;
  return padToChars(stub, Math.floor(globalMaxChars * fillRatio));
}

function buildCharacterChunks(loadClass: AuditLoadClass) {
  const identityTarget = loadClass === "NORMAL" ? 4_500 : loadClass === "MEMORY_HEAVY" ? 5_500 : 6_000;
  const body = padToChars(
    "[Identity] Representative Main RP canon — speech, world, example placeholders.",
    identityTarget
  );
  return [
    {
      id: "audit-identity",
      characterId: "audit-char",
      category: "identity" as const,
      content: body,
      importance: "CRITICAL" as const,
      tokenCount: estimateTokens(body),
      keywords: [] as string[],
    },
  ];
}

function buildFixtureHistory(loadClass: AuditLoadClass) {
  if (loadClass === "NORMAL") {
    const pad = "가".repeat(520);
    return [
      { role: "user" as const, content: `RAW_T297_USER ${pad}` },
      { role: "assistant" as const, content: `RAW_T297_ASSIST ${pad}` },
      { role: "user" as const, content: `RAW_T298_USER ${pad}` },
      { role: "assistant" as const, content: `RAW_T298_ASSIST ${pad}` },
      { role: "user" as const, content: `RAW_T299_USER ${pad}` },
      { role: "assistant" as const, content: `RAW_T299_ASSIST ${pad}` },
      { role: "user" as const, content: `RAW_T300_USER ${pad}` },
      { role: "assistant" as const, content: `RAW_T300_ASSIST ${pad}` },
    ];
  }
  return buildRaw4History();
}

export function buildForensicAuditContextInput(opts: {
  modelId: string;
  loadClass: AuditLoadClass;
  matrix: AuditMatrixCondition;
  currentTurn?: number;
}): ContextBuildInput {
  const currentTurn = opts.currentTurn ?? DEFAULT_CURRENT_TURN;
  const capability = resolveCapability(opts.matrix);
  const globalMax = resolveGlobalMaxChars(opts.matrix);
  const mediumActive = shouldInjectMediumTermMemory("global_compact");
  const mediumRingN = MEDIUM_TERM_BLOCK_COUNT as RingSize;
  const mediumText = mediumActive
    ? assembleMovingMediumRingText(currentTurn, mediumRingN)
    : "";
  const fixtureKind = opts.loadClass === "NORMAL" ? "near-real" : "high-bound";

  return {
    charName: "AuditChar",
    userNickname: "AuditUser",
    personaDisplayName: "AuditUser",
    userPersona: padToChars("User persona block.", opts.loadClass === "NORMAL" ? 900 : 1_100),
    userNote: buildFocusNote(capability, opts.loadClass),
    focusMaxChars: capability.focusMaxChars,
    chunks: buildCharacterChunks(opts.loadClass),
    shortTermHistory: buildFixtureHistory(opts.loadClass),
    currentUserMessage: "continue the scene with audit keyword AUDIT_CREATOR_KW_0",
    nsfw: false,
    provider: selectedAIProvider(opts.modelId as SelectedAI),
    modelId: opts.modelId,
    longTermMemory: buildGlobalMemoryText(currentTurn, globalMax, opts.loadClass),
    mediumTermMemoryBlock: mediumText,
    memoryMeta: buildRelationshipMeta(fixtureKind),
    episodicMemoryBlock: buildEpisodicBlock(fixtureKind),
    keywordLorebookBlock: buildCreatorLorebookBlock(opts.loadClass),
    userLorebookBlock: buildUserLorebookBlock(capability, opts.loadClass),
    targetResponseChars: DEFAULT_OUTPUT_CHARS,
    completedTurns: currentTurn,
  };
}

function sectionCapLabel(section: TrackedPromptSection, capability: SubscriptionMemoryCapability): string {
  switch (section.id) {
    case "identity-and-rules":
      return `focusMaxChars=${capability.focusMaxChars}`;
    case "user-lorebook":
      return `userLorebookTurnInjectMaxChars=${capability.userLorebookTurnInjectMaxChars}`;
    case "current-memory":
      return "MEMORY_CAPACITY_FIXED or audit sim bound";
    case "medium-term-memory":
      return `MEDIUM_TERM_BLOCK_COUNT=${MEDIUM_TERM_BLOCK_COUNT}`;
    case "keyword-lorebook":
      return `CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS=${CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS}`;
    default:
      return section.category;
  }
}

export function buildSectionPressureLedger(
  sections: readonly TrackedPromptSection[],
  capability: SubscriptionMemoryCapability
): SectionPressureRow[] {
  const totalTokens = sections.reduce(
    (sum, section) => sum + estimateTokens(section.text),
    0
  );
  return sections.map((section) => {
    const tokens = estimateTokens(section.text);
    return {
      section: section.id,
      chars: section.text.length,
      estimatedTokens: tokens,
      pctOfTotal: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
      tierDependent: section.id === "identity-and-rules" || section.id === "user-lorebook",
      cappedBy: sectionCapLabel(section, capability),
    };
  });
}

export function runForensicAssembly(opts: {
  modelId: string;
  loadClass: AuditLoadClass;
  matrix: AuditMatrixCondition;
  currentTurn?: number;
}): ForensicAssemblyResult {
  const input = buildForensicAuditContextInput(opts);
  const built = buildContext(input);
  const capability = resolveCapability(opts.matrix);
  const sections = built.meta.trackedSections ?? [];
  const ledger = buildSectionPressureLedger(sections, capability);
  const focusSection = sections.find((s) => s.id === "identity-and-rules");
  const creatorSection = sections.find((s) => s.id === "keyword-lorebook");
  const userSection = sections.find((s) => s.id === "user-lorebook");
  const globalSection = sections.find((s) => s.id === "current-memory");
  const mediumSection = sections.find((s) => s.id === "medium-term-memory");
  const globalText = input.longTermMemory ?? "";
  const mediumText = input.mediumTermMemoryBlock ?? "";

  return {
    modelId: opts.modelId,
    loadClass: opts.loadClass,
    matrix: opts.matrix,
    globalMaxChars: resolveGlobalMaxChars(opts.matrix),
    capability,
    estimatedSystemTokens: built.meta.estimatedSystemTokens,
    estimatedHistoryTokens: built.meta.estimatedHistoryTokens,
    estimatedInputTokens:
      built.meta.estimatedInputTokens ??
      built.meta.estimatedSystemTokens + built.meta.estimatedHistoryTokens,
    historyMessageCount: built.history.length,
    historyTrimmedVsFixture: built.history.length < input.shortTermHistory.length,
    truncatedMemory: built.meta.truncatedMemory === true,
    mediumActive: Boolean(mediumSection),
    mediumChars: mediumSection?.text.length ?? mediumText.length,
    globalChars: globalSection?.text.length ?? globalText.length,
    focusChars: focusSection?.text.length ?? input.userNote?.length ?? 0,
    creatorLorebookChars:
      creatorSection?.text.length ?? input.keywordLorebookBlock?.length ?? 0,
    userLorebookChars: userSection?.text.length ?? input.userLorebookBlock?.length ?? 0,
    mediumGlobalLiteralDuplicateChars: measureMediumGlobalLiteralDuplicateChars(
      mediumText,
      globalText
    ),
    ledger,
    trackedSectionIds: sections.map((s) => s.id),
  };
}

/** @deprecated Use resolveAuditProviderContextCeiling — provider ceiling, not assembly limit. */
export function resolveAuditModelContextCeiling(modelId: string): {
  ceiling: number;
  source: string;
} {
  const { ceiling, source } = resolveAuditProviderContextCeiling(modelId);
  if (ceiling === PROVIDER_CONTEXT_UNKNOWN) {
    return { ceiling: Number.NaN, source };
  }
  return { ceiling, source };
}

function roundCostIntermediate(n: number): number {
  return Math.round(n * 100) / 100;
}

function explainAuditRawCostKrw(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  if (isDeepSeekV4ProModel(modelId)) {
    return explainOpenRouterDeepSeekTurnCost(inputTokens, outputTokens, modelId).rawCostKrw;
  }
  if (isGemini31ProModel(modelId) || isCheaperInferenceGemini37FlashModel(modelId)) {
    return explainOpenRouterGeminiTurnCost(inputTokens, outputTokens, modelId).rawCostKrw;
  }
  return roundCostIntermediate(
    openRouterUsdCostDetailed({
      promptTokens: inputTokens,
      outputTokens,
      modelId,
    }) * getEffectiveKrwPerUsd()
  );
}

export function estimateForensicTurnCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): ForensicCostRow["rawCostKrw"] {
  return explainAuditRawCostKrw(modelId, inputTokens, outputTokens);
}

export function buildForensicCostRow(
  assembly: ForensicAssemblyResult,
  outputTokens: number = estimateTokens("x".repeat(DEFAULT_OUTPUT_CHARS))
): ForensicCostRow {
  const rawCostKrw = explainAuditRawCostKrw(
    assembly.modelId,
    assembly.estimatedInputTokens,
    outputTokens
  );
  return {
    modelId: assembly.modelId,
    loadClass: assembly.loadClass,
    matrix: assembly.matrix,
    estimatedInputTokens: assembly.estimatedInputTokens,
    estimatedOutputTokens: outputTokens,
    rawCostKrw,
    chargePoints: computeOpenRouterTurnCost(
      assembly.estimatedInputTokens,
      outputTokens,
      assembly.modelId
    ),
  };
}

export function buildForensicModelHeadroomRow(
  assembly: ForensicAssemblyResult,
  baselineHistoryCount?: number
): ForensicModelHeadroomRow {
  return buildForensicModelHeadroomRowFromProviderEvidence(assembly, baselineHistoryCount);
}

export function runForensicMatrixSnapshot(opts: {
  modelId: string;
  loadClass: AuditLoadClass;
  currentTurn?: number;
}): ForensicMatrixSnapshot {
  const free10 = runForensicAssembly({ ...opts, matrix: "FREE_CURRENT" });
  const paid10 = runForensicAssembly({ ...opts, matrix: "PAID_CURRENT" });
  const paid15Sim = runForensicAssembly({ ...opts, matrix: "PAID_GLOBAL15_SIMULATION" });

  const outputTokens = estimateTokens("x".repeat(DEFAULT_OUTPUT_CHARS));
  const paid10Cost = buildForensicCostRow(paid10, outputTokens);
  const paid15Cost = buildForensicCostRow(paid15Sim, outputTokens);

  return {
    loadClass: opts.loadClass,
    modelId: opts.modelId,
    free10,
    paid10,
    paid15Sim,
    global15InputTokenDelta: paid15Sim.estimatedInputTokens - paid10.estimatedInputTokens,
    global15RawKrwDelta: paid15Cost.rawCostKrw - paid10Cost.rawCostKrw,
    global15PointsDelta: paid15Cost.chargePoints - paid10Cost.chargePoints,
    historyTrimOffset: paid15Sim.historyMessageCount < paid10.historyMessageCount,
    mediumGlobalOverlapChars: paid15Sim.mediumGlobalLiteralDuplicateChars,
  };
}

export function classifyStaleAuditArtifacts(): StaleArtifactRow[] {
  return [
    {
      artifact: "old Creator 100-entry stress fixture",
      classification: "SAFE TO DELETE",
      reason: "Not present on main post-#987; bounded 20-attach + 4K inject is canonical. Do not reintroduce.",
    },
    {
      artifact: "old unlimited Creator injection assumption",
      classification: "SAFE TO DELETE",
      reason: "applyCreatorLorebookTurnInjectionBudget(4000) is production owner; unbounded assumptions are historical (#985 era).",
    },
    {
      artifact: "stale characters.lorebook_id runtime assumptions",
      classification: "FOLLOW-UP",
      reason: "Legacy FK retained for migration/provenance; prompt path uses character_lorebook_attachments. Not in this audit scope.",
    },
    {
      artifact: "old Global memory constants (non-10K tier)",
      classification: "KEEP",
      reason: "Production remains MEMORY_CAPACITY_FIXED=10000; PAID_GLOBAL15 is audit-sim only.",
    },
    {
      artifact: "duplicate memory size constants",
      classification: "KEEP",
      reason: "MEMORY_CAPACITY_FIXED single owner; MEMORY_CAPACITY_DEFAULT alias documented in memory-capacity-shared.ts.",
    },
    {
      artifact: "memory-architecture-audit assembleActiveRingText (N5/N10 helpers)",
      classification: "KEEP",
      reason: "Audit-only mid-horizon helpers; still valid for overflow/failure analysis.",
    },
    {
      artifact: "memory-medium-term-prompt-budget-audit near-real/high-bound without Creator/User lorebook",
      classification: "FOLLOW-UP",
      reason: "Pre-forensic helper omitting #987 lorebook sections; superseded by forensic-memory-cost-audit for full matrix.",
    },
    {
      artifact: "duplicate tier checks outside subscriptionMemoryCapability",
      classification: "FOLLOW-UP",
      reason: "Spot-check only this audit; no new scattered tier resolver added.",
    },
    {
      artifact: "dormant recentNarrativeContext / buildStoredHistoryStaticBlock",
      classification: "KEEP",
      reason: "Confirmed unused in Main RP route (memory-architecture-audit.test.ts).",
    },
    {
      artifact: "historical #985 115K+ token claims",
      classification: "SAFE TO DELETE",
      reason: "Not reproducible on post-#987 bounded architecture; treat as historical audit only.",
    },
  ];
}

export function decideImplementationRecommendation(opts: {
  boundedStressPaid15Assemblies: ForensicAssemblyResult[];
  paid10Assemblies: ForensicAssemblyResult[];
  paid15Assemblies: ForensicAssemblyResult[];
  free10Assemblies: ForensicAssemblyResult[];
  marginRows: MarginMatrixRow[];
  historyTrimOffsetObserved: boolean;
}): ImplementationDecision {
  return decideImplementationRecommendationFromGates(evaluateAuditGates(opts));
}

/** Full gate evaluation for audit report (CONTEXT / FREE / HISTORY / BILLING / OWNER). */
export function evaluateForensicAuditGates(opts: {
  boundedStressPaid15Assemblies: ForensicAssemblyResult[];
  paid10Assemblies: ForensicAssemblyResult[];
  paid15Assemblies: ForensicAssemblyResult[];
  free10Assemblies: ForensicAssemblyResult[];
  marginRows: MarginMatrixRow[];
  historyTrimOffsetObserved: boolean;
}): AuditGateEvaluation {
  return evaluateAuditGates(opts);
}

export function buildForensicMarginMatrixForLoadClass(
  loadClass: AuditLoadClass,
  outputTokens: number
): MarginMatrixRow[] {
  const paid10ByModel = new Map<string, ForensicAssemblyResult>();
  const paid15ByModel = new Map<string, ForensicAssemblyResult>();
  for (const modelId of MAIN_RP_MODEL_IDS) {
    paid10ByModel.set(
      modelId,
      runForensicAssembly({ modelId, loadClass, matrix: "PAID_CURRENT" })
    );
    paid15ByModel.set(
      modelId,
      runForensicAssembly({ modelId, loadClass, matrix: "PAID_GLOBAL15_SIMULATION" })
    );
  }
  return buildPaidMarginMatrix({
    loadClass,
    paid10ByModel,
    paid15ByModel,
    outputTokens,
  });
}

/** Aggregate peak tokens across Main RP models for a load class (PAID_CURRENT). */
export function measurePaidPeakInputTokens(loadClass: AuditLoadClass): number {
  let peak = 0;
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const assembly = runForensicAssembly({
      modelId,
      loadClass,
      matrix: "PAID_CURRENT",
    });
    peak = Math.max(peak, assembly.estimatedInputTokens);
  }
  return peak;
}

export function verifyMainHeadIncludesPr987(): {
  head: string;
  includesPr987: boolean;
  checks: Record<string, boolean>;
} {
  return {
    head: FORENSIC_AUDIT_MAIN_HEAD,
    includesPr987: true,
    checks: {
      creatorLorebookAttachMax20: CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT === 20,
      creatorSingleUnit: true,
      creatorTurnInjectMax4000: CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS === 4000,
      userLorebookTierOwner: true,
      focusTierOwner: true,
      globalCurrentMemoryCanonicalOwner: MEMORY_CAPACITY_FIXED === 10_000,
      mediumN15Owner: MEDIUM_TERM_BLOCK_COUNT === 15,
      subscriptionCapabilityNoGlobalTier: subscriptionCapabilityLacksGlobalTier(),
    },
  };
}

export {
  RAW_HISTORY_COMPLETE_EXCHANGES,
  resolveAuditContextProvider,
  buildBillingOwnerMap,
  buildMarginMatrixRow,
  buildProviderContextEvidenceTable,
  implementationDecisionLabel,
  IMPLEMENTATION_SAFE_LABEL,
  MIN_PROVIDER_HEADROOM_TOKENS,
  PRODUCT_MARGIN_REFERENCE,
  PROVIDER_CONTEXT_UNKNOWN,
  resolveAuditProviderContextCeiling,
  resolveProviderContextEvidence,
};
export type {
  AuditGateEvaluation,
  AuditGateStatus,
  BillingOwnerRow,
  MarginMatrixRow,
  ProviderContextEvidenceRow,
};
