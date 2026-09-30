/**
 * Scheduled, research-only snapshot of Main RP memory prompt packing.
 *
 * This module does not mutate production memory state and performs no provider
 * calls. It reuses the canonical prompt-budget audit owners so the weekly
 * memory research cycle can detect architecture drift and token-pressure
 * changes without inventing a parallel memory model.
 */
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { RELATIONSHIP_MEMORY_AUTO_EXTRACT_ALLOWED_FIELDS } from "@/lib/chatMemory";
import {
  MEMORY_POLICY_ID,
  RAW_HISTORY_COMPLETE_EXCHANGES,
  ROLLING_SUMMARY_INTERVAL,
} from "@/lib/memory/memory-constants";
import {
  MEDIUM_TERM_BLOCK_COUNT,
  shouldInjectMediumTermMemory,
} from "@/lib/memory/memory-medium-term";
import { simulateMovingHorizonCoverage } from "@/lib/memory/memory-medium-term-audit";
import {
  auditActualSafetyGates,
  buildFullPromptBudgetMatrix,
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

export type MemoryPromptPolicySourceSnapshot = {
  rollingSummarySource: string;
};

export type MemoryLayerShadowDomain = {
  domain: "promises" | "items";
  narrativeLayers: readonly string[];
  canonicalCurrentStateOwner: "relationship_durable";
  policyEvidence: readonly string[];
  interpretation: string;
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
  layerOverlap: {
    sourcePolicyScan: "PROVIDED" | "NOT_PROVIDED";
    durableAutoFields: readonly string[];
    shadowDomains: MemoryLayerShadowDomain[];
    literalFixture: Array<{
      currentTurn: number;
      mediumGlobalLiteralDuplicateChars: number;
      mediumChars: number;
      globalChars: number;
    }>;
  };
  interpretation: {
    literalDuplicateClaim: "FIXTURE_LITERAL_ONLY";
    semanticDuplicateClaim: "NOT_MEASURED";
    stateShadowClaim: "INTENTIONAL_TRAJECTORY_SHADOW";
    note: string;
  };
};

export function buildMemoryPromptPackingAudit(
  currentTurnFixture = 300,
  now = new Date(),
  policySource?: MemoryPromptPolicySourceSnapshot
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
    const safety = auditActualSafetyGates(matrix);
    return {
      modelId,
      baselineInputTokens: matrix.baseline.estimatedInputTokens,
      n15InputTokens: matrix.n15.estimatedInputTokens,
      n15DeltaInputTokens: matrix.n15.deltaInputTokensVsBaseline,
      n15MediumTokens: matrix.n15.mediumTokens,
      n15MinusN10InputTokens:
        matrix.n15.deltaInputTokensVsBaseline - matrix.n10.deltaInputTokensVsBaseline,
      n15TruncatedMemory: matrix.n15.truncatedMemory,
      n15CriticalSectionOmitted: matrix.n15.criticalSectionOmitted,
      n15CriticalSectionTrimmed: matrix.n15.criticalSectionTrimmed,
      n15SafeForPolicyConsideration: safety.n15.safeForPolicyConsideration,
    };
  });

  const rollingSource = policySource?.rollingSummarySource ?? "";
  const policyScanProvided = rollingSource.trim().length > 0;
  const durableFields = [...RELATIONSHIP_MEMORY_AUTO_EXTRACT_ALLOWED_FIELDS];
  const durablePromiseOwner =
    durableFields.includes("promisesAdd") && durableFields.includes("promisesRemove");
  const durableItemOwner =
    durableFields.includes("items") && durableFields.includes("itemsRemove");
  const rollingPreservesPromises =
    /약속·계약·임무·미해결 목표/.test(rollingSource) &&
    /약속·임무·소유물·현재 상태가 달라지는가/.test(rollingSource);
  const rollingPreservesItems =
    /중요한 물건의 획득·전달·분실과 현재 소유자/.test(rollingSource);
  const globalCompactPreservesPromises =
    /\[보존\]: 관계·호칭·약속/.test(rollingSource);

  const shadowDomains: MemoryLayerShadowDomain[] = [
    {
      domain: "promises",
      narrativeLayers: ["rolling_summary", "medium_term", "global_current_memory"],
      canonicalCurrentStateOwner: "relationship_durable",
      policyEvidence: [
        `rolling-preserves-promises=${rollingPreservesPromises}`,
        `global-compact-preserves-promises=${globalCompactPreservesPromises}`,
        `durable-add-remove-owner=${durablePromiseOwner}`,
      ],
      interpretation:
        "Narrative memory keeps promise history/trajectory, while Relationship Durable owns the current active-promise projection through promisesAdd/promisesRemove.",
    },
    {
      domain: "items",
      narrativeLayers: ["rolling_summary", "medium_term"],
      canonicalCurrentStateOwner: "relationship_durable",
      policyEvidence: [
        `rolling-preserves-current-owner=${rollingPreservesItems}`,
        `durable-add-remove-owner=${durableItemOwner}`,
      ],
      interpretation:
        "Narrative memory keeps acquisition/transfer/loss history, while Relationship Durable owns the current possession projection.",
    },
  ];

  const literalFixture = [300, 1000].map((currentTurn) => {
    const overlap = simulateMovingHorizonCoverage(currentTurn, MEDIUM_TERM_BLOCK_COUNT, {
      mediumActive: true,
    });
    return {
      currentTurn,
      mediumGlobalLiteralDuplicateChars: overlap.mediumGlobalLiteralDuplicateChars,
      mediumChars: overlap.mediumChars,
      globalChars: overlap.globalChars,
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
    {
      id: "durable-shadow-owner-contract",
      ok:
        !policyScanProvided ||
        (rollingPreservesPromises &&
          rollingPreservesItems &&
          globalCompactPreservesPromises &&
          durablePromiseOwner &&
          durableItemOwner),
      detail: policyScanProvided
        ? `rollingPromises=${rollingPreservesPromises} rollingItems=${rollingPreservesItems} globalPromises=${globalCompactPreservesPromises} durablePromises=${durablePromiseOwner} durableItems=${durableItemOwner}`
        : "policy source not provided; scheduled CLI supplies it",
    },
    {
      id: "medium-global-fixture-does-not-literal-copy-whole-blocks",
      ok: literalFixture.every((row) => row.mediumGlobalLiteralDuplicateChars === 0),
      detail:
        literalFixture
          .map(
            (row) =>
              `T${row.currentTurn}:${row.mediumGlobalLiteralDuplicateChars} duplicate chars`
          )
          .join(", "),
    },
  ];

  return {
    generatedAt: now.toISOString(),
    currentTurnFixture,
    architecture,
    invariants,
    models,
    layerOverlap: {
      sourcePolicyScan: policyScanProvided ? "PROVIDED" : "NOT_PROVIDED",
      durableAutoFields: durableFields,
      shadowDomains,
      literalFixture,
    },
    interpretation: {
      literalDuplicateClaim: "FIXTURE_LITERAL_ONLY",
      semanticDuplicateClaim: "NOT_MEASURED",
      stateShadowClaim: "INTENTIONAL_TRAJECTORY_SHADOW",
      note:
        "Rolling/Medium/Global narrative memory and Relationship Durable intentionally overlap on some concepts with different responsibilities: trajectory/history vs current structured state. " +
        "The fixture proves only that whole Medium block bodies are not copied verbatim into the deterministic Global compact stub. " +
        "Semantic redundancy and stale-state harm still require retrieval/quality evidence; absence from the durable ledger is not itself an explicit negation of old narrative history.",
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
    "## Cross-layer state shadow audit",
    "",
    `- policy source scan: **${audit.layerOverlap.sourcePolicyScan}**`,
    `- durable auto fields: ${audit.layerOverlap.durableAutoFields.join(", ")}`,
    "",
    "| domain | narrative layer(s) | current-state owner | interpretation |",
    "|---|---|---|---|",
    ...audit.layerOverlap.shadowDomains.map(
      (row) =>
        `| ${row.domain} | ${row.narrativeLayers.join(", ")} | ${row.canonicalCurrentStateOwner} | ${row.interpretation.replace(/\|/g, "/")} |`
    ),
    "",
    "### Medium ↔ Global literal fixture",
    "",
    "| turn | Medium chars | Global chars | verbatim duplicate chars |",
    "|---:|---:|---:|---:|",
    ...audit.layerOverlap.literalFixture.map(
      (row) =>
        `| ${row.currentTurn} | ${row.mediumChars} | ${row.globalChars} | ${row.mediumGlobalLiteralDuplicateChars} |`
    ),
    "",
    "## Interpretation boundary",
    "",
    `- literal duplication evidence: **${audit.interpretation.literalDuplicateClaim}**`,
    `- semantic duplication verdict: **${audit.interpretation.semanticDuplicateClaim}**`,
    `- cross-layer state-shadow classification: **${audit.interpretation.stateShadowClaim}**`,
    `- ${audit.interpretation.note}`,
    "",
    "providerGenerationCalls: 0",
    "productionTouched: false",
    "",
  ];
  return lines.join("\n");
}
