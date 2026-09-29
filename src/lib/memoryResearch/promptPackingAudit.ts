/**
 * Scheduled, research-only snapshot of Main RP memory prompt packing.
 *
 * This module does not mutate production memory state and performs no provider
 * calls. It reuses the canonical prompt-budget audit owners so the weekly
 * memory research cycle can detect architecture drift and token-pressure
 * changes without inventing a parallel memory model.
 */
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import {
  MEMORY_POLICY_ID,
  RAW_HISTORY_COMPLETE_EXCHANGES,
  ROLLING_SUMMARY_INTERVAL,
} from "@/lib/memory/memory-constants";
import {
  MEDIUM_TERM_BLOCK_COUNT,
  shouldInjectMediumTermMemory,
} from "@/lib/memory/memory-medium-term";
import {
  auditActualSafetyGates,
  buildFullPromptBudgetMatrix,
  buildN10VsN15Evidence,
} from "@/lib/memory/memory-medium-term-prompt-budget-audit";

export type MemoryPromptPackingModelSnapshot = {
  modelId: string;
  baselineInputTokens: number;
  n15InputTokens: number;
  n15DeltaInputTokens: number;
  n15MediumTokens: number;
  n15MinusN10InputTokens: number;
  n15TruncatedMemory: boolean;
  n15CriticalSectionOmitted: boolean;
  n15CriticalSectionTrimmed: boolean;
  n15SafeForPolicyConsideration: boolean;
};

export type MemoryPromptPackingAudit = {
  generatedAt: string;
  currentTurnFixture: number;
  architecture: {
    policyId: string;
    rawRecentExchanges: number;
    rollingSummaryInterval: number;
    mediumTermBlockCount: number;
    exactProjectionInjectsMedium: boolean;
    compactProjectionInjectsMedium: boolean;
    failureFallbackInjectsMedium: boolean;
    storedFallbackInjectsMedium: boolean;
    manualGlobalInjectsMedium: boolean;
  };
  invariants: Array<{ id: string; ok: boolean; detail: string }>;
  models: MemoryPromptPackingModelSnapshot[];
  interpretation: {
    literalDuplicateClaim: "NOT_MEASURED";
    note: string;
  };
};

export function buildMemoryPromptPackingAudit(
  currentTurnFixture = 300,
  now = new Date()
): MemoryPromptPackingAudit {
  const architecture = {
    policyId: MEMORY_POLICY_ID,
    rawRecentExchanges: RAW_HISTORY_COMPLETE_EXCHANGES,
    rollingSummaryInterval: ROLLING_SUMMARY_INTERVAL,
    mediumTermBlockCount: MEDIUM_TERM_BLOCK_COUNT,
    exactProjectionInjectsMedium: shouldInjectMediumTermMemory("exact"),
    compactProjectionInjectsMedium: shouldInjectMediumTermMemory("global_compact"),
    failureFallbackInjectsMedium: shouldInjectMediumTermMemory("failure_fallback"),
    storedFallbackInjectsMedium: shouldInjectMediumTermMemory("stored_fallback"),
    manualGlobalInjectsMedium: shouldInjectMediumTermMemory("manual_global"),
  };

  const models = MAIN_RP_MODEL_IDS.map((modelId) => {
    const matrix = buildFullPromptBudgetMatrix(currentTurnFixture, modelId, "near-real");
    const evidence = buildN10VsN15Evidence(modelId, currentTurnFixture, "near-real");
    const safety = auditActualSafetyGates(matrix);
    return {
      modelId,
      baselineInputTokens: matrix.baseline.estimatedInputTokens,
      n15InputTokens: matrix.n15.estimatedInputTokens,
      n15DeltaInputTokens: matrix.n15.deltaInputTokensVsBaseline,
      n15MediumTokens: matrix.n15.mediumTokens,
      n15MinusN10InputTokens: evidence.n15MinusN10InputTokens,
      n15TruncatedMemory: matrix.n15.truncatedMemory,
      n15CriticalSectionOmitted: matrix.n15.criticalSectionOmitted,
      n15CriticalSectionTrimmed: matrix.n15.criticalSectionTrimmed,
      n15SafeForPolicyConsideration: safety.n15.safeForPolicyConsideration,
    };
  });

  const invariants = [
    {
      id: "canonical-policy-summary5-raw4",
      ok:
        architecture.policyId === "summary5_raw4" &&
        architecture.rollingSummaryInterval === 5 &&
        architecture.rawRecentExchanges === 4,
      detail: `policy=${architecture.policyId} summary=${architecture.rollingSummaryInterval} raw=${architecture.rawRecentExchanges}`,
    },
    {
      id: "exact-global-does-not-double-inject-medium",
      ok: architecture.exactProjectionInjectsMedium === false,
      detail: `exactProjectionInjectsMedium=${architecture.exactProjectionInjectsMedium}`,
    },
    {
      id: "compact-global-recovers-medium-resolution",
      ok: architecture.compactProjectionInjectsMedium === true,
      detail: `compactProjectionInjectsMedium=${architecture.compactProjectionInjectsMedium}`,
    },
    {
      id: "fallbacks-do-not-grow-medium-owner",
      ok:
        architecture.failureFallbackInjectsMedium === false &&
        architecture.storedFallbackInjectsMedium === false &&
        architecture.manualGlobalInjectsMedium === false,
      detail:
        `failure=${architecture.failureFallbackInjectsMedium} stored=${architecture.storedFallbackInjectsMedium} manual=${architecture.manualGlobalInjectsMedium}`,
    },
    {
      id: "n15-does-not-drop-critical-prompt-sections",
      ok: models.every(
        (m) =>
          !m.n15TruncatedMemory &&
          !m.n15CriticalSectionOmitted &&
          !m.n15CriticalSectionTrimmed
      ),
      detail: models
        .filter(
          (m) =>
            m.n15TruncatedMemory ||
            m.n15CriticalSectionOmitted ||
            m.n15CriticalSectionTrimmed
        )
        .map((m) => m.modelId)
        .join(", ") || "all active Main RP models clean",
    },
  ];

  return {
    generatedAt: now.toISOString(),
    currentTurnFixture,
    architecture,
    invariants,
    models,
    interpretation: {
      literalDuplicateClaim: "NOT_MEASURED",
      note:
        "This sentinel proves owner activation and prompt-token deltas, not semantic equivalence. " +
        "A compact Global Current Memory and Medium-Term ring can overlap semantically by design; " +
        "do not classify that overlap as waste without a retrieval/quality A/B.",
    },
  };
}

export function renderMemoryPromptPackingAuditMarkdown(
  audit: MemoryPromptPackingAudit
): string {
  const lines = [
    "# Memory prompt-packing sentinel",
    "",
    `- generated: ${audit.generatedAt}`,
    `- fixture turn: T${audit.currentTurnFixture}`,
    `- policy: \`${audit.architecture.policyId}\``,
    `- raw recent exchanges: ${audit.architecture.rawRecentExchanges}`,
    `- rolling summary interval: ${audit.architecture.rollingSummaryInterval}`,
    `- Medium-Term blocks: ${audit.architecture.mediumTermBlockCount}`,
    "",
    "## Projection owner activation",
    "",
    `- exact → Medium: **${audit.architecture.exactProjectionInjectsMedium ? "ON" : "OFF"}**`,
    `- global_compact → Medium: **${audit.architecture.compactProjectionInjectsMedium ? "ON" : "OFF"}**`,
    `- failure_fallback → Medium: **${audit.architecture.failureFallbackInjectsMedium ? "ON" : "OFF"}**`,
    `- stored_fallback → Medium: **${audit.architecture.storedFallbackInjectsMedium ? "ON" : "OFF"}**`,
    `- manual_global → Medium: **${audit.architecture.manualGlobalInjectsMedium ? "ON" : "OFF"}**`,
    "",
    "## Invariants",
    "",
    "| invariant | result | detail |",
    "|---|---|---|",
    ...audit.invariants.map(
      (i) => `| ${i.id} | ${i.ok ? "PASS" : "FAIL"} | ${i.detail.replace(/\|/g, "/")} |`
    ),
    "",
    "## Active Main RP token footprint",
    "",
    "| model | baseline input | N15 input | N15 Δ input | Medium tokens | N15−N10 input | safe |",
    "|---|---:|---:|---:|---:|---:|---|",
    ...audit.models.map(
      (m) =>
        `| ${m.modelId} | ${m.baselineInputTokens} | ${m.n15InputTokens} | +${m.n15DeltaInputTokens} | ${m.n15MediumTokens} | +${m.n15MinusN10InputTokens} | ${m.n15SafeForPolicyConsideration ? "YES" : "NO"} |`
    ),
    "",
    "## Interpretation boundary",
    "",
    `- literal/semantic duplication verdict: **${audit.interpretation.literalDuplicateClaim}**`,
    `- ${audit.interpretation.note}`,
    "",
    "providerGenerationCalls: 0",
    "productionTouched: false",
    "",
  ];
  return lines.join("\n");
}
