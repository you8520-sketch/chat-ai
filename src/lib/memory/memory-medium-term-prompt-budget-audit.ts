/**
 * Full Main RP prompt budget audit — zero provider calls.
 * Uses production buildContext() with deterministic near-real memory inputs.
 */
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { estimateTokens } from "@/lib/tokenEstimate";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { buildContext } from "@/services/contextBuilder";
import type { CharacterChunk, ContextBuildInput } from "@/types";
import { MODEL_SYSTEM_BUDGETS } from "@/types";
import {
  assembleMovingGlobalCompactStub,
  assembleMovingMediumRingText,
  MOVING_DETAIL_MARKERS,
  type MovingHorizonCoverageReport,
  simulateMovingHorizonCoverage,
} from "./memory-medium-term-audit";
import { resolveMediumTermBlockCount } from "./memory-medium-term";
import type { RingSize } from "./memory-architecture-audit";

export type MainRpModelProfile = {
  modelId: string;
  label: string;
  provider: "openrouter";
  mediumBlockCount: number;
};

export function listMainRpModelProfiles(): MainRpModelProfile[] {
  return MAIN_RP_MODEL_IDS.map((modelId) => ({
    modelId,
    label: modelId,
    provider: "openrouter" as const,
    mediumBlockCount: resolveMediumTermBlockCount(modelId, "openrouter"),
  }));
}

function padToChars(text: string, chars: number): string {
  let body = text;
  while (body.length < chars) body += " → PAD";
  return body.slice(0, chars);
}

/** Deterministic near-10K global compact stub for full-prompt assembly. */
export function buildNearRealGlobalCompactText(currentTurn: number): string {
  const stub = assembleMovingGlobalCompactStub(currentTurn);
  return padToChars(stub, Math.min(MEMORY_CAPACITY_FIXED, 9_800));
}

/** Representative episodic block near current 1000-char fact cap. */
export function buildNearRealEpisodicBlock(): string {
  return padToChars(
    "[Episodic memory]\n- T120 setting/abandoned_station: 폭우가 쏟아지는 폐역 안으로 피신했다.",
    980
  );
}

/** Representative relationship memory bound. */
export function buildNearRealRelationshipMeta(): string {
  return padToChars(
    '{"honorifics":{"user_to_char":"너","char_to_user":"오빠"},"promises":["약속_ledger"],"items":["커피잔"]}',
    1_800
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

function representativeCharacterSetting(): string {
  return padToChars(
    "[Identity] AuditChar — representative Main RP canon body for budget fixture. " +
      "Speech style, world rules, and example dialogue placeholders.",
    4_500
  );
}

export function buildMainRpPromptBudgetInput(opts: {
  modelId: string;
  currentTurn: number;
  mediumRingN: RingSize | 0;
  mediumActive: boolean;
}): ContextBuildInput {
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
      chunk("identity", representativeCharacterSetting()),
      chunk("personality", padToChars("Personality traits for budget fixture.", 800)),
      chunk("world", padToChars("World background for budget fixture.", 600)),
    ],
    userPersona: padToChars("User persona block for budget fixture.", 900),
    userNote: padToChars("User note block for budget fixture.", 900),
    shortTermHistory: buildRaw4History(),
    currentUserMessage: "continue the scene",
    nsfw: false,
    provider: "openrouter",
    modelId: opts.modelId,
    longTermMemory: buildNearRealGlobalCompactText(opts.currentTurn),
    mediumTermMemoryBlock: mediumText,
    memoryMeta: buildNearRealRelationshipMeta(),
    episodicMemoryBlock: buildNearRealEpisodicBlock(),
    targetResponseChars: 2500,
    completedTurns: opts.currentTurn,
  };
}

export type FullPromptBudgetRow = {
  modelId: string;
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
  trackedSectionCount: number;
  hasMediumSection: boolean;
  mediumSectionIndex: number | null;
  deepSeekLtmGrouped: boolean;
};

export function assembleFullPromptBudgetRow(
  modelId: string,
  currentTurn: number,
  mediumRingN: RingSize | 0,
  mediumActive: boolean,
  baselineSystemTokens: number
): FullPromptBudgetRow {
  const input = buildMainRpPromptBudgetInput({
    modelId,
    currentTurn,
    mediumRingN,
    mediumActive,
  });
  const built = buildContext(input);
  const mediumSection = built.meta.trackedSections?.find((s) => s.id === "medium-term-memory");
  const mediumText = mediumRingN > 0 && mediumActive ? input.mediumTermMemoryBlock ?? "" : "";
  const systemTokens = built.meta.estimatedSystemTokens;
  const budget = built.meta.tokenBudget;
  const isDeepSeek = modelId.includes("deepseek");
  const ltmGrouped =
    !mediumText ||
    !isDeepSeek ||
    (built.systemPrompt.includes("<LONG_TERM_MEMORY>") &&
      built.systemPrompt.includes("NEAR_MEDIUM_DETAIL") === mediumText.includes("NEAR_MEDIUM_DETAIL"));

  return {
    modelId,
    mediumRingN,
    mediumActive,
    mediumChars: mediumText.length,
    mediumTokens: estimateTokens(mediumText || " "),
    estimatedSystemTokens: systemTokens,
    estimatedHistoryTokens: built.meta.estimatedHistoryTokens,
    estimatedInputTokens: built.meta.estimatedInputTokens ?? systemTokens + built.meta.estimatedHistoryTokens,
    tokenBudget: budget,
    systemBudgetHeadroom: budget - systemTokens,
    deltaSystemTokensVsBaseline: systemTokens - baselineSystemTokens,
    trackedSectionCount: built.meta.trackedSections?.length ?? 0,
    hasMediumSection: !!mediumSection,
    mediumSectionIndex:
      mediumSection != null
        ? built.meta.trackedSections?.findIndex((s) => s.id === "medium-term-memory") ?? null
        : null,
    deepSeekLtmGrouped: ltmGrouped,
  };
}

export function buildFullPromptBudgetMatrix(
  currentTurn: number,
  modelId: string
): {
  baseline: FullPromptBudgetRow;
  n5: FullPromptBudgetRow;
  n10: FullPromptBudgetRow;
  n15: FullPromptBudgetRow;
} {
  const baseline = assembleFullPromptBudgetRow(modelId, currentTurn, 0, false, 0);
  return {
    baseline,
    n5: assembleFullPromptBudgetRow(modelId, currentTurn, 5, true, baseline.estimatedSystemTokens),
    n10: assembleFullPromptBudgetRow(modelId, currentTurn, 10, true, baseline.estimatedSystemTokens),
    n15: assembleFullPromptBudgetRow(modelId, currentTurn, 15, true, baseline.estimatedSystemTokens),
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
};

export function reportModelSwitchMediumHorizon(
  modelId: string,
  currentTurn: number
): ModelSwitchHorizonReport {
  const blockCount = resolveMediumTermBlockCount(modelId, "openrouter") as RingSize;
  const coverage = simulateMovingHorizonCoverage(currentTurn, blockCount, { mediumActive: true });
  const mediumText = assembleMovingMediumRingText(currentTurn, blockCount);
  const markers: string[] = [];
  for (const marker of Object.values(MOVING_DETAIL_MARKERS)) {
    if (mediumText.includes(marker)) markers.push(marker);
  }
  const turnRanges: Array<{ turnStart: number; turnEnd: number }> = [];
  for (const block of mediumText.split(/\n\n+/).filter(Boolean)) {
    const match = block.match(/T(\d+)–(\d+)/);
    if (match) turnRanges.push({ turnStart: Number(match[1]), turnEnd: Number(match[2]) });
  }
  return {
    modelId,
    currentTurn,
    mediumBlockCount: blockCount,
    turnRanges,
    markersPresent: markers,
    mediumChars: coverage.mediumChars,
    mediumTokens: coverage.mediumTokens,
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
      r.markersPresent.join(",") !== first.markersPresent.join(",")
  );
  return {
    horizonDelta: deltas.length > 0,
    detail: deltas.length > 0 ? "block count or marker set differs by model" : "identical horizon",
  };
}

/** MODEL_SYSTEM_BUDGETS are telemetry targets — buildContext tracks usedTokens but does not hard-trim system sections. */
export function auditSystemBudgetBehavior(): {
  enforcement: "soft_telemetry";
  description: string;
} {
  return {
    enforcement: "soft_telemetry",
    description:
      "buildContext resolves MODEL_SYSTEM_BUDGETS into meta.tokenBudget and accumulates usedTokens per section, " +
      "but does not hard-trim the assembled system prompt when over budget. History may truncate (truncatedMemory).",
  };
}

export function detectSystemBudgetMediumOverflowRisk(
  matrix: ReturnType<typeof buildFullPromptBudgetMatrix>
): boolean {
  const budget = matrix.baseline.tokenBudget;
  return [matrix.n5, matrix.n10, matrix.n15].some((row) => row.estimatedSystemTokens > budget);
}
