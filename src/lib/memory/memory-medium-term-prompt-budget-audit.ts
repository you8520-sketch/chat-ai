/**
 * Full Main RP prompt budget audit — zero provider calls.
 * Uses production buildContext() with deterministic near-real / high-bound memory inputs.
 */
import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  selectedAIProvider,
  type SelectedAI,
} from "@/lib/chatModels";
import { resolveEpisodicMemoryMaxChars } from "@/lib/episodicMemoryFacts";
import { PERSONA_CONTENT_MAX, USER_NOTE_FOCUS_MAX } from "@/lib/persona";
import { estimateTokens } from "@/lib/tokenEstimate";
import { buildContext } from "@/services/contextBuilder";
import type { CharacterChunk, ContextBuildInput } from "@/types";
import { MODEL_SYSTEM_BUDGETS } from "@/types";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import type { RingSize } from "./memory-architecture-audit";
import {
  assembleMovingGlobalCompactStub,
  assembleMovingMediumRingText,
  MOVING_DETAIL_MARKERS,
  simulateMovingHorizonCoverage,
} from "./memory-medium-term-audit";
import { MEDIUM_TERM_BLOCK_COUNT } from "./memory-medium-term";

export type AuditFixtureKind = "near-real" | "high-bound";

export type MainRpModelProfile = {
  modelId: string;
  label: string;
  provider: ReturnType<typeof selectedAIProvider>;
  /** Production route maps cheaperinference → openrouter for contextTrack/memory paths. */
  contextProvider: "gemini" | "openrouter" | "openai";
  mediumBlockCount: number;
  systemBudgetTelemetryTarget: number;
};

/** Matches chat/route.ts: cheaperinference models use openrouter for context assembly. */
export function resolveAuditContextProvider(
  modelId: string
): "gemini" | "openrouter" | "openai" {
  const provider = selectedAIProvider(modelId as SelectedAI);
  return provider === "cheaperinference" ? "openrouter" : provider;
}

export function listMainRpModelProfiles(): MainRpModelProfile[] {
  return MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => {
    const contextProvider = resolveAuditContextProvider(option.id);
    return {
      modelId: option.id,
      label: option.label,
      provider: option.provider,
      contextProvider,
      mediumBlockCount: MEDIUM_TERM_BLOCK_COUNT,
      systemBudgetTelemetryTarget:
        MODEL_SYSTEM_BUDGETS[option.id] ?? MODEL_SYSTEM_BUDGETS.default ?? 28_000,
    };
  });
}

function padToChars(text: string, chars: number): string {
  let body = text;
  while (body.length < chars) body += " → PAD";
  return body.slice(0, chars);
}

function fixtureSizes(kind: AuditFixtureKind): {
  canonIdentity: number;
  canonPersonality: number;
  canonWorld: number;
  userPersona: number;
  userNote: number;
  globalCompact: number;
  episodic: number;
  relationship: number;
} {
  if (kind === "high-bound") {
    return {
      canonIdentity: 6_000,
      canonPersonality: 2_400,
      canonWorld: 1_800,
      userPersona: PERSONA_CONTENT_MAX,
      userNote: USER_NOTE_FOCUS_MAX,
      globalCompact: MEMORY_CAPACITY_FIXED,
      episodic: resolveEpisodicMemoryMaxChars({} as NodeJS.ProcessEnv),
      relationship: 2_400,
    };
  }
  return {
    canonIdentity: 4_500,
    canonPersonality: 800,
    canonWorld: 600,
    userPersona: 900,
    userNote: 900,
    globalCompact: Math.min(MEMORY_CAPACITY_FIXED, 9_800),
    episodic: 980,
    relationship: 1_800,
  };
}

/** Deterministic global compact stub for full-prompt assembly. */
export function buildGlobalCompactText(currentTurn: number, kind: AuditFixtureKind): string {
  const stub = assembleMovingGlobalCompactStub(currentTurn);
  return padToChars(stub, fixtureSizes(kind).globalCompact);
}

export function buildEpisodicBlock(kind: AuditFixtureKind): string {
  const chars = fixtureSizes(kind).episodic;
  return padToChars(
    "[Episodic memory]\n- T120 setting/abandoned_station: 폭우가 쏟아지는 폐역 안으로 피신했다.",
    chars
  );
}

export function buildRelationshipMeta(kind: AuditFixtureKind): string {
  return padToChars(
    '{"honorifics":{"user_to_char":"너","char_to_user":"오빠"},"promises":["약속_ledger"],"items":["커피잔"]}',
    fixtureSizes(kind).relationship
  );
}

/** RAW4 representative history (~800 chars per message). */
export function buildRaw4History(): Array<{ role: "user" | "assistant"; content: string }> {
  const pad = "가".repeat(750);
  return [
    { role: "user", content: `RAW_T297_USER ${pad}` },
    { role: "assistant", content: `RAW_T297_ASSIST ${pad}` },
    { role: "user", content: `RAW_T298_USER ${pad}` },
    { role: "assistant", content: `RAW_T298_ASSIST ${pad}` },
    { role: "user", content: `RAW_T299_USER ${pad}` },
    { role: "assistant", content: `RAW_T299_ASSIST ${pad}` },
    { role: "user", content: `RAW_T300_USER ${pad}` },
    { role: "assistant", content: `RAW_T300_ASSIST ${pad}` },
  ];
}

export function buildMainRpPromptBudgetInput(opts: {
  modelId: string;
  currentTurn: number;
  mediumRingN: RingSize | 0;
  mediumActive: boolean;
  fixtureKind?: AuditFixtureKind;
}): ContextBuildInput {
  const kind = opts.fixtureKind ?? "near-real";
  const sizes = fixtureSizes(kind);
  const mediumText =
    opts.mediumActive && opts.mediumRingN > 0
      ? assembleMovingMediumRingText(opts.currentTurn, opts.mediumRingN as RingSize)
      : "";

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
          "[Identity] AuditChar — representative Main RP canon body for budget fixture. " +
            "Speech style, world rules, and example dialogue placeholders.",
          sizes.canonIdentity
        )
      ),
      chunk("personality", padToChars("Personality traits for budget fixture.", sizes.canonPersonality)),
      chunk("world", padToChars("World background for budget fixture.", sizes.canonWorld)),
    ],
    userPersona: padToChars("User persona block for budget fixture.", sizes.userPersona),
    userNote: padToChars("User note focus block for budget fixture.", sizes.userNote),
    shortTermHistory: buildRaw4History(),
    currentUserMessage: "continue the scene",
    nsfw: false,
    provider: selectedAIProvider(opts.modelId as SelectedAI),
    modelId: opts.modelId,
    longTermMemory: buildGlobalCompactText(opts.currentTurn, kind),
    mediumTermMemoryBlock: mediumText,
    memoryMeta: buildRelationshipMeta(kind),
    episodicMemoryBlock: buildEpisodicBlock(kind),
    targetResponseChars: 2500,
    completedTurns: opts.currentTurn,
  };
}

export type FullPromptBudgetRow = {
  modelId: string;
  fixtureKind: AuditFixtureKind;
  mediumRingN: RingSize | 0;
  mediumActive: boolean;
  mediumChars: number;
  mediumTokens: number;
  estimatedSystemTokens: number;
  estimatedHistoryTokens: number;
  estimatedInputTokens: number;
  tokenBudget: number;
  systemBudgetHeadroom: number;
  deltaSystemTokensVsBaseline: number;
  deltaHistoryTokensVsBaseline: number;
  deltaInputTokensVsBaseline: number;
  trackedSectionCount: number;
  hasMediumSection: boolean;
  mediumSectionIndex: number | null;
  deepSeekLtmGrouped: boolean;
  truncatedMemory: boolean;
  baselineAlreadyOverTelemetryTarget: boolean;
  causedNewTelemetryTargetCrossing: boolean;
  criticalSectionOmitted: boolean;
  criticalSectionTrimmed: boolean;
};

function auditCriticalSections(
  built: ReturnType<typeof buildContext>,
  input: ContextBuildInput
): { omitted: boolean; trimmed: boolean } {
  const trackedIds = new Set((built.meta.trackedSections ?? []).map((s) => s.id));
  const omitted =
    (Boolean(input.mediumTermMemoryBlock?.trim()) && !trackedIds.has("medium-term-memory")) ||
    (Boolean(input.longTermMemory?.trim()) && !trackedIds.has("current-memory")) ||
    (Boolean(input.chunks?.length) && !trackedIds.has("character-core-identity"));
  return { omitted, trimmed: false };
}

export function assembleFullPromptBudgetRow(
  modelId: string,
  currentTurn: number,
  mediumRingN: RingSize | 0,
  mediumActive: boolean,
  baseline: Pick<
    FullPromptBudgetRow,
    "estimatedSystemTokens" | "estimatedHistoryTokens" | "estimatedInputTokens" | "tokenBudget"
  >,
  fixtureKind: AuditFixtureKind = "near-real"
): FullPromptBudgetRow {
  const input = buildMainRpPromptBudgetInput({
    modelId,
    currentTurn,
    mediumRingN,
    mediumActive,
    fixtureKind,
  });
  const built = buildContext(input);
  const mediumSection = built.meta.trackedSections?.find((s) => s.id === "medium-term-memory");
  const mediumText = mediumRingN > 0 && mediumActive ? input.mediumTermMemoryBlock ?? "" : "";
  const systemTokens = built.meta.estimatedSystemTokens;
  const historyTokens = built.meta.estimatedHistoryTokens;
  const inputTokens =
    built.meta.estimatedInputTokens ?? systemTokens + historyTokens;
  const budget = built.meta.tokenBudget;
  const isDeepSeek = modelId.includes("deepseek");
  const ltmGrouped =
    !mediumText ||
    !isDeepSeek ||
    (built.systemPrompt.includes("<LONG_TERM_MEMORY>") &&
      built.systemPrompt.includes("NEAR_MEDIUM_DETAIL") === mediumText.includes("NEAR_MEDIUM_DETAIL"));
  const critical = auditCriticalSections(built, input);
  const overTelemetry = systemTokens > budget;
  const baselineOver = baseline.estimatedSystemTokens > baseline.tokenBudget;

  return {
    modelId,
    fixtureKind,
    mediumRingN,
    mediumActive,
    mediumChars: mediumText.length,
    mediumTokens: estimateTokens(mediumText || " "),
    estimatedSystemTokens: systemTokens,
    estimatedHistoryTokens: historyTokens,
    estimatedInputTokens: inputTokens,
    tokenBudget: budget,
    systemBudgetHeadroom: budget - systemTokens,
    deltaSystemTokensVsBaseline: systemTokens - baseline.estimatedSystemTokens,
    deltaHistoryTokensVsBaseline: historyTokens - baseline.estimatedHistoryTokens,
    deltaInputTokensVsBaseline: inputTokens - baseline.estimatedInputTokens,
    trackedSectionCount: built.meta.trackedSections?.length ?? 0,
    hasMediumSection: !!mediumSection,
    mediumSectionIndex:
      mediumSection != null
        ? built.meta.trackedSections?.findIndex((s) => s.id === "medium-term-memory") ?? null
        : null,
    deepSeekLtmGrouped: ltmGrouped,
    truncatedMemory: built.meta.truncatedMemory === true,
    baselineAlreadyOverTelemetryTarget: baselineOver,
    causedNewTelemetryTargetCrossing: !baselineOver && overTelemetry,
    criticalSectionOmitted: critical.omitted,
    criticalSectionTrimmed: critical.trimmed,
  };
}

export function buildFullPromptBudgetMatrix(
  currentTurn: number,
  modelId: string,
  fixtureKind: AuditFixtureKind = "near-real"
): {
  baseline: FullPromptBudgetRow;
  n5: FullPromptBudgetRow;
  n10: FullPromptBudgetRow;
  n15: FullPromptBudgetRow;
} {
  const baseline = assembleFullPromptBudgetRow(modelId, currentTurn, 0, false, {
    estimatedSystemTokens: 0,
    estimatedHistoryTokens: 0,
    estimatedInputTokens: 0,
    tokenBudget: MODEL_SYSTEM_BUDGETS[modelId] ?? MODEL_SYSTEM_BUDGETS.default ?? 28_000,
  }, fixtureKind);
  const baselineRef = {
    estimatedSystemTokens: baseline.estimatedSystemTokens,
    estimatedHistoryTokens: baseline.estimatedHistoryTokens,
    estimatedInputTokens: baseline.estimatedInputTokens,
    tokenBudget: baseline.tokenBudget,
  };
  return {
    baseline,
    n5: assembleFullPromptBudgetRow(modelId, currentTurn, 5, true, baselineRef, fixtureKind),
    n10: assembleFullPromptBudgetRow(modelId, currentTurn, 10, true, baselineRef, fixtureKind),
    n15: assembleFullPromptBudgetRow(modelId, currentTurn, 15, true, baselineRef, fixtureKind),
  };
}

export type ModelSwitchHorizonReport = {
  modelId: string;
  currentTurn: number;
  mediumBlockCount: number;
  turnRanges: Array<{ turnStart: number; turnEnd: number }>;
  markersPresent: string[];
  mediumChars: number;
  mediumTokens: number;
  mediumBody: string;
};

function parseMediumTurnRanges(mediumText: string): Array<{ turnStart: number; turnEnd: number }> {
  const turnRanges: Array<{ turnStart: number; turnEnd: number }> = [];
  for (const block of mediumText.split(/\n\n+/).filter(Boolean)) {
    const match = block.match(/\[(\d+)~(\d+)턴\]/);
    if (match) turnRanges.push({ turnStart: Number(match[1]), turnEnd: Number(match[2]) });
  }
  return turnRanges;
}

function markersInMediumText(mediumText: string): string[] {
  const markers: string[] = [];
  for (const marker of Object.values(MOVING_DETAIL_MARKERS)) {
    if (mediumText.includes(marker)) markers.push(marker);
  }
  return markers;
}

/** Runtime Medium horizon — canonical N15 for all Main RP models. */
export function reportModelSwitchMediumHorizon(
  modelId: string,
  currentTurn: number
): ModelSwitchHorizonReport {
  const blockCount = MEDIUM_TERM_BLOCK_COUNT as RingSize;
  const coverage = simulateMovingHorizonCoverage(currentTurn, blockCount, { mediumActive: true });
  const mediumText = assembleMovingMediumRingText(currentTurn, blockCount);
  return {
    modelId,
    currentTurn,
    mediumBlockCount: blockCount,
    turnRanges: parseMediumTurnRanges(mediumText),
    markersPresent: markersInMediumText(mediumText),
    mediumChars: coverage.mediumChars,
    mediumTokens: coverage.mediumTokens,
    mediumBody: mediumText,
  };
}

/** Fixed-N horizon — model-neutral memory knowledge (GPT/user policy candidate). */
export function reportFixedNMediumHorizon(
  modelId: string,
  currentTurn: number,
  fixedN: RingSize
): ModelSwitchHorizonReport {
  const coverage = simulateMovingHorizonCoverage(currentTurn, fixedN, { mediumActive: true });
  const mediumText = assembleMovingMediumRingText(currentTurn, fixedN);
  return {
    modelId,
    currentTurn,
    mediumBlockCount: fixedN,
    turnRanges: parseMediumTurnRanges(mediumText),
    markersPresent: markersInMediumText(mediumText),
    mediumChars: coverage.mediumChars,
    mediumTokens: coverage.mediumTokens,
    mediumBody: mediumText,
  };
}

export function compareModelSwitchHorizonReports(
  reports: ModelSwitchHorizonReport[]
): {
  horizonDelta: boolean;
  detail: string;
} {
  if (reports.length < 2) return { horizonDelta: false, detail: "single model" };
  const first = reports[0]!;
  const deltas = reports.slice(1).filter(
    (r) =>
      r.mediumBlockCount !== first.mediumBlockCount ||
      r.markersPresent.join(",") !== first.markersPresent.join(",") ||
      r.mediumBody !== first.mediumBody
  );
  return {
    horizonDelta: deltas.length > 0,
    detail: deltas.length > 0 ? "block count or marker set differs by model" : "identical horizon",
  };
}

export function compareFixedNHorizonReports(reports: ModelSwitchHorizonReport[]): {
  parity: boolean;
  detail: string;
} {
  if (reports.length < 2) return { parity: true, detail: "single model" };
  const first = reports[0]!;
  const mismatches = reports.slice(1).filter(
    (r) =>
      r.turnRanges.length !== first.turnRanges.length ||
      r.markersPresent.join(",") !== first.markersPresent.join(",") ||
      r.mediumBody !== first.mediumBody
  );
  return {
    parity: mismatches.length === 0,
    detail: mismatches.length === 0 ? "identical fixed-N horizon" : "fixed-N horizon differs by model",
  };
}

/** MODEL_SYSTEM_BUDGETS are telemetry targets — not hard model limits or trim owners. */
export function auditSystemBudgetBehavior(): {
  enforcement: "soft_telemetry";
  description: string;
  terraUsesDefaultBudget: boolean;
} {
  const terraId = MAIN_RP_MODEL_IDS.find((id) => id.includes("terra")) ?? "";
  return {
    enforcement: "soft_telemetry",
    description:
      "buildContext resolves MODEL_SYSTEM_BUDGETS into meta.tokenBudget and accumulates usedTokens per section, " +
      "but does not hard-trim the assembled system prompt when over budget. History may truncate (truncatedMemory).",
    terraUsesDefaultBudget: terraId ? !(terraId in MODEL_SYSTEM_BUDGETS) : false,
  };
}

/** Soft telemetry crossing — NOT a hard failure gate. */
export function reportsTelemetryTargetCrossing(
  matrix: ReturnType<typeof buildFullPromptBudgetMatrix>
): boolean {
  const budget = matrix.baseline.tokenBudget;
  return [matrix.n5, matrix.n10, matrix.n15].some((row) => row.estimatedSystemTokens > budget);
}

export type ActualSafetyAudit = {
  n10: {
    truncatedMemoryVsBaseline: boolean;
    criticalSectionOmitted: boolean;
    criticalSectionTrimmed: boolean;
    safeForPolicyConsideration: boolean;
  };
  n15: {
    truncatedMemoryVsBaseline: boolean;
    criticalSectionOmitted: boolean;
    criticalSectionTrimmed: boolean;
    safeForPolicyConsideration: boolean;
  };
  baselineAlreadyOverTelemetryTarget: boolean;
  mediumN10CausedNewTelemetryCrossing: boolean;
  mediumN15CausedNewTelemetryCrossing: boolean;
};

export function auditActualSafetyGates(
  matrix: ReturnType<typeof buildFullPromptBudgetMatrix>
): ActualSafetyAudit {
  const n10Unsafe =
    (matrix.n10.truncatedMemory && !matrix.baseline.truncatedMemory) ||
    matrix.n10.criticalSectionOmitted ||
    matrix.n10.criticalSectionTrimmed;
  const n15Unsafe =
    (matrix.n15.truncatedMemory && !matrix.baseline.truncatedMemory) ||
    matrix.n15.criticalSectionOmitted ||
    matrix.n15.criticalSectionTrimmed;

  return {
    n10: {
      truncatedMemoryVsBaseline: matrix.n10.truncatedMemory && !matrix.baseline.truncatedMemory,
      criticalSectionOmitted: matrix.n10.criticalSectionOmitted,
      criticalSectionTrimmed: matrix.n10.criticalSectionTrimmed,
      safeForPolicyConsideration: !n10Unsafe,
    },
    n15: {
      truncatedMemoryVsBaseline: matrix.n15.truncatedMemory && !matrix.baseline.truncatedMemory,
      criticalSectionOmitted: matrix.n15.criticalSectionOmitted,
      criticalSectionTrimmed: matrix.n15.criticalSectionTrimmed,
      safeForPolicyConsideration: !n15Unsafe,
    },
    baselineAlreadyOverTelemetryTarget: matrix.baseline.baselineAlreadyOverTelemetryTarget,
    mediumN10CausedNewTelemetryCrossing: matrix.n10.causedNewTelemetryTargetCrossing,
    mediumN15CausedNewTelemetryCrossing: matrix.n15.causedNewTelemetryTargetCrossing,
  };
}

export function computeN15MinusN10InputTokenDelta(
  matrix: ReturnType<typeof buildFullPromptBudgetMatrix>
): number {
  return matrix.n15.deltaInputTokensVsBaseline - matrix.n10.deltaInputTokensVsBaseline;
}

/** @deprecated use reportsTelemetryTargetCrossing — kept for backward test imports */
export function detectSystemBudgetMediumOverflowRisk(
  matrix: ReturnType<typeof buildFullPromptBudgetMatrix>
): boolean {
  return reportsTelemetryTargetCrossing(matrix);
}

export type N10VsN15Evidence = {
  modelId: string;
  fixtureKind: AuditFixtureKind;
  n10: {
    markers: string[];
    mediumChars: number;
    mediumTokens: number;
    deltaSystemTokens: number;
    deltaInputTokens: number;
    systemHeadroom: number;
    truncatedMemory: boolean;
  };
  n15: {
    markers: string[];
    mediumChars: number;
    mediumTokens: number;
    deltaSystemTokens: number;
    deltaInputTokens: number;
    systemHeadroom: number;
    truncatedMemory: boolean;
  };
  n15MinusN10InputTokens: number;
  safety: ActualSafetyAudit;
};

export function buildN10VsN15Evidence(
  modelId: string,
  currentTurn: number,
  fixtureKind: AuditFixtureKind = "near-real"
): N10VsN15Evidence {
  const matrix = buildFullPromptBudgetMatrix(currentTurn, modelId, fixtureKind);
  const n10Text = assembleMovingMediumRingText(currentTurn, 10);
  const n15Text = assembleMovingMediumRingText(currentTurn, 15);
  return {
    modelId,
    fixtureKind,
    n10: {
      markers: markersInMediumText(n10Text),
      mediumChars: matrix.n10.mediumChars,
      mediumTokens: matrix.n10.mediumTokens,
      deltaSystemTokens: matrix.n10.deltaSystemTokensVsBaseline,
      deltaInputTokens: matrix.n10.deltaInputTokensVsBaseline,
      systemHeadroom: matrix.n10.systemBudgetHeadroom,
      truncatedMemory: matrix.n10.truncatedMemory,
    },
    n15: {
      markers: markersInMediumText(n15Text),
      mediumChars: matrix.n15.mediumChars,
      mediumTokens: matrix.n15.mediumTokens,
      deltaSystemTokens: matrix.n15.deltaSystemTokensVsBaseline,
      deltaInputTokens: matrix.n15.deltaInputTokensVsBaseline,
      systemHeadroom: matrix.n15.systemBudgetHeadroom,
      truncatedMemory: matrix.n15.truncatedMemory,
    },
    n15MinusN10InputTokens: computeN15MinusN10InputTokenDelta(matrix),
    safety: auditActualSafetyGates(matrix),
  };
}
