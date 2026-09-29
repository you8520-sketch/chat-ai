/**
 * Scheduled, research-only snapshot of Main RP memory prompt packing.
 *
 * This module does not mutate production memory state and performs no provider
 * calls. It reuses the canonical prompt-budget audit owners so the weekly
 * memory research cycle can detect architecture drift and token-pressure
 * changes without inventing a parallel memory model.
 */
import Database from "better-sqlite3";
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import {
  ensureEpisodicMemoryFactsTable,
  getEpisodicMemoryForPrompt,
  resolveDynamicMemoryTotalMaxChars,
} from "@/lib/episodicMemoryFacts";
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

export type EpisodicDynamicBudgetProbe = {
  dynamicMemoryTotalMaxChars: number;
  rows: Array<{
    higherPriorityChars: number;
    injectedFacts: number;
    promptChars: number;
  }>;
  starvationDetected: boolean;
  note: string;
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
  episodicDynamicBudget: EpisodicDynamicBudgetProbe;
  interpretation: {
    literalDuplicateClaim: "NOT_MEASURED";
    note: string;
  };
};

function buildEpisodicDynamicBudgetProbe(): EpisodicDynamicBudgetProbe {
  const dynamicMemoryTotalMaxChars = resolveDynamicMemoryTotalMaxChars(
    {} as unknown as NodeJS.ProcessEnv
  );
  const env = {
    MEMORY_FEATURE_ENABLED: "1",
    EPISODIC_MEMORY_RECALL_ENABLED: "1",
  } as unknown as NodeJS.ProcessEnv;
  const probePoints = [
    0,
    Math.max(0, dynamicMemoryTotalMaxChars - 500),
    Math.max(0, dynamicMemoryTotalMaxChars - 100),
    dynamicMemoryTotalMaxChars,
    dynamicMemoryTotalMaxChars + 500,
  ];

  const rows = probePoints.map((higherPriorityChars) => {
    const db = new Database(":memory:");
    try {
      ensureEpisodicMemoryFactsTable(db);
      db.exec(
        "CREATE TABLE chat_memories (chat_id INTEGER PRIMARY KEY, memory_reset_after_message_id INTEGER, memory_epoch INTEGER NOT NULL DEFAULT 0)"
      );
      db.prepare("INSERT INTO chat_memories (chat_id) VALUES (1)").run();
      db.prepare(
        `INSERT INTO episodic_memory_facts
          (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
         VALUES
          (1, 1, 'setting', 'storm_shelter', 'scene_event', 'cave', 'important',
           '폭풍우가 몰아치던 밤 두 사람은 동굴에 피신했다.',
           '{"memory_evidence_type":"explicit_scene_event"}')`
      ).run();

      const recalled = getEpisodicMemoryForPrompt(
        db,
        {
          chatId: 1,
          currentTurn: 20,
          currentUserMessage: "폭풍우 치던 밤 동굴에 피신한 일을 기억해?",
          longTermMemoryText: "x".repeat(higherPriorityChars),
          relationshipMemoryText: "",
          lorebookText: "",
        },
        env
      );

      return {
        higherPriorityChars,
        injectedFacts: recalled.facts.length,
        promptChars: recalled.promptBlock.length,
      };
    } finally {
      db.close();
    }
  });

  const baseline = rows.find((row) => row.higherPriorityChars === 0)?.injectedFacts ?? 0;
  const atOrAboveCap = rows.filter(
    (row) => row.higherPriorityChars >= dynamicMemoryTotalMaxChars
  );
  const starvationDetected =
    baseline > 0 &&
    atOrAboveCap.length > 0 &&
    atOrAboveCap.every((row) => row.injectedFacts === 0);

  return {
    dynamicMemoryTotalMaxChars,
    rows,
    starvationDetected,
    note:
      "Research-only deterministic probe. It varies only longTermMemoryText length while using the canonical episodic retrieval owner. " +
      "A detected starvation condition is evidence for follow-up, not a production policy change.",
  };
}

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

  const episodicDynamicBudget = buildEpisodicDynamicBudgetProbe();

  return {
    generatedAt: now.toISOString(),
    currentTurnFixture,
    architecture,
    invariants,
    models,
    episodicDynamicBudget,
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
    "## Episodic dynamic-memory budget probe",
    "",
    `- dynamic-memory total cap: ${audit.episodicDynamicBudget.dynamicMemoryTotalMaxChars} chars`,
    `- starvation detected at/above cap: **${audit.episodicDynamicBudget.starvationDetected ? "YES" : "NO"}**`,
    "",
    "| higher-priority chars | episodic facts injected | episodic prompt chars |",
    "|---:|---:|---:|",
    ...audit.episodicDynamicBudget.rows.map(
      (row) =>
        `| ${row.higherPriorityChars} | ${row.injectedFacts} | ${row.promptChars} |`
    ),
    "",
    `- ${audit.episodicDynamicBudget.note}`,
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
