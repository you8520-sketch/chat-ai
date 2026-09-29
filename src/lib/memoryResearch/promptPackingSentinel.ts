/**
 * Research-only Memory Quality / Token Sentinel.
 *
 * Reuses current production owners to audit prompt packing without provider
 * calls, persistence, deployment mutation, or runtime imports.
 */
import Database from "better-sqlite3";
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import {
  ensureEpisodicMemoryFactsTable,
  getEpisodicMemoryForPrompt,
} from "@/lib/episodicMemoryFacts";
import {
  MEDIUM_TERM_BLOCK_COUNT,
} from "@/lib/memory/memory-medium-term";
import {
  RAW_HISTORY_COMPLETE_EXCHANGES,
  ROLLING_SUMMARY_INTERVAL,
} from "@/lib/memory/memory-constants";
import {
  simulateMovingHorizonCoverage,
  estimateGlobalCompactionInputAtTurn,
} from "@/lib/memory/memory-medium-term-audit";
import {
  auditActualSafetyGates,
  buildFullPromptBudgetMatrix,
} from "@/lib/memory/memory-medium-term-prompt-budget-audit";

export type PromptPackingModelEvidence = {
  modelId: string;
  baselineInputTokens: number;
  n15InputTokens: number;
  n15DeltaInputTokens: number;
  n15TruncatedMemory: boolean;
  criticalSectionOmitted: boolean;
  criticalSectionTrimmed: boolean;
  safeForPolicyConsideration: boolean;
};

export type EpisodicBudgetProbeRow = {
  higherPriorityChars: number;
  injectedFacts: number;
  promptChars: number;
};

export type PromptPackingSentinelFinding =
  | "MEDIUM_GLOBAL_LITERAL_DUPLICATION"
  | "PROMPT_TRUNCATION_OR_CRITICAL_LOSS"
  | "EPISODIC_DYNAMIC_BUDGET_STARVATION";

export type PromptPackingSentinelReport = {
  policy: {
    summaryIntervalTurns: number;
    rawCompleteExchanges: number;
    mediumBlockCount: number;
  };
  modelEvidence: PromptPackingModelEvidence[];
  overlapEvidence: Array<{
    currentTurn: number;
    mediumGlobalLiteralDuplicateChars: number;
    mediumChars: number;
    globalChars: number;
  }>;
  compactionEvidence: Array<{
    currentTurn: number;
    sealedBlockCount: number;
    rebuiltInputChars: number;
    rebuiltInputTokens: number;
  }>;
  episodicBudgetEvidence: EpisodicBudgetProbeRow[];
  findings: PromptPackingSentinelFinding[];
  providerGenerationCalls: 0;
  productionTouched: false;
};

const SENTINEL_TURN = 300;
const SENTINEL_FIXTURE = "near-real" as const;
const EPISODIC_RECALL_ENV = {
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
  DYNAMIC_MEMORY_TOTAL_MAX_CHARS: "2500",
  EPISODIC_MEMORY_MAX_CHARS: "1000",
} as NodeJS.ProcessEnv;

function runEpisodicBudgetProbe(higherPriorityChars: number): EpisodicBudgetProbeRow {
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
        longTermMemoryText: "x".repeat(Math.max(0, higherPriorityChars)),
        relationshipMemoryText: "",
        lorebookText: "",
      },
      EPISODIC_RECALL_ENV
    );

    return {
      higherPriorityChars,
      injectedFacts: recalled.facts.length,
      promptChars: recalled.promptBlock.length,
    };
  } finally {
    db.close();
  }
}

export function buildPromptPackingSentinelReport(): PromptPackingSentinelReport {
  const modelEvidence = MAIN_RP_MODEL_IDS.map((modelId) => {
    const matrix = buildFullPromptBudgetMatrix(
      SENTINEL_TURN,
      modelId,
      SENTINEL_FIXTURE
    );
    const safety = auditActualSafetyGates(matrix);
    return {
      modelId,
      baselineInputTokens: matrix.baseline.estimatedInputTokens,
      n15InputTokens: matrix.n15.estimatedInputTokens,
      n15DeltaInputTokens: matrix.n15.deltaInputTokensVsBaseline,
      n15TruncatedMemory: matrix.n15.truncatedMemory,
      criticalSectionOmitted: matrix.n15.criticalSectionOmitted,
      criticalSectionTrimmed: matrix.n15.criticalSectionTrimmed,
      safeForPolicyConsideration: safety.n15.safeForPolicyConsideration,
    };
  });

  const overlapEvidence = [300, 1000].map((currentTurn) => {
    const report = simulateMovingHorizonCoverage(
      currentTurn,
      MEDIUM_TERM_BLOCK_COUNT,
      { mediumActive: true }
    );
    return {
      currentTurn,
      mediumGlobalLiteralDuplicateChars:
        report.mediumGlobalLiteralDuplicateChars,
      mediumChars: report.mediumChars,
      globalChars: report.globalChars,
    };
  });

  const compactionEvidence = [100, 300, 1000, 2000].map((currentTurn) => {
    const report = estimateGlobalCompactionInputAtTurn(currentTurn);
    return {
      currentTurn,
      sealedBlockCount: report.sealedBlockCount,
      rebuiltInputChars: report.rebuiltInputChars,
      rebuiltInputTokens: report.rebuiltInputTokens,
    };
  });

  const episodicBudgetEvidence = [0, 2000, 2400, 2500, 3000].map(
    runEpisodicBudgetProbe
  );

  const findings: PromptPackingSentinelFinding[] = [];
  if (
    overlapEvidence.some(
      (row) => row.mediumGlobalLiteralDuplicateChars > 0
    )
  ) {
    findings.push("MEDIUM_GLOBAL_LITERAL_DUPLICATION");
  }
  if (
    modelEvidence.some(
      (row) =>
        row.n15TruncatedMemory ||
        row.criticalSectionOmitted ||
        row.criticalSectionTrimmed ||
        !row.safeForPolicyConsideration
    )
  ) {
    findings.push("PROMPT_TRUNCATION_OR_CRITICAL_LOSS");
  }

  const baselineRecall =
    episodicBudgetEvidence.find((row) => row.higherPriorityChars === 0)
      ?.injectedFacts ?? 0;
  const highPriorityStarved = episodicBudgetEvidence.some(
    (row) => row.higherPriorityChars >= 2500 && row.injectedFacts === 0
  );
  if (baselineRecall > 0 && highPriorityStarved) {
    findings.push("EPISODIC_DYNAMIC_BUDGET_STARVATION");
  }

  return {
    policy: {
      summaryIntervalTurns: ROLLING_SUMMARY_INTERVAL,
      rawCompleteExchanges: RAW_HISTORY_COMPLETE_EXCHANGES,
      mediumBlockCount: MEDIUM_TERM_BLOCK_COUNT,
    },
    modelEvidence,
    overlapEvidence,
    compactionEvidence,
    episodicBudgetEvidence,
    findings,
    providerGenerationCalls: 0,
    productionTouched: false,
  };
}

export function renderPromptPackingSentinelMarkdown(
  report: PromptPackingSentinelReport
): string {
  const lines = [
    "## Memory Quality / Token Sentinel",
    "",
    `- policy: summary every ${report.policy.summaryIntervalTurns} turns / RAW ${report.policy.rawCompleteExchanges} exchanges / Medium N=${report.policy.mediumBlockCount}`,
    `- provider generation calls: ${report.providerGenerationCalls}`,
    `- production touched: ${String(report.productionTouched)}`,
    "",
    "### Main RP prompt packing",
    "",
    "| model | baseline input tok | N15 input tok | N15 delta | truncated | critical loss | safe |",
    "|---|---:|---:|---:|---|---|---|",
    ...report.modelEvidence.map(
      (row) =>
        `| ${row.modelId} | ${row.baselineInputTokens} | ${row.n15InputTokens} | +${row.n15DeltaInputTokens} | ${row.n15TruncatedMemory ? "YES" : "NO"} | ${row.criticalSectionOmitted || row.criticalSectionTrimmed ? "YES" : "NO"} | ${row.safeForPolicyConsideration ? "YES" : "NO"} |`
    ),
    "",
    "### Medium ↔ Global literal overlap",
    "",
    "| turn | medium chars | global chars | literal duplicate chars |",
    "|---:|---:|---:|---:|",
    ...report.overlapEvidence.map(
      (row) =>
        `| ${row.currentTurn} | ${row.mediumChars} | ${row.globalChars} | ${row.mediumGlobalLiteralDuplicateChars} |`
    ),
    "",
    "### Episodic dynamic-budget probe",
    "",
    "This is a deterministic default-policy probe, not a claim about semantic quality. It reuses the canonical retrieval owner and varies only higher-priority dynamic-memory text size.",
    "",
    "| higher-priority chars | episodic facts injected | episodic prompt chars |",
    "|---:|---:|---:|",
    ...report.episodicBudgetEvidence.map(
      (row) =>
        `| ${row.higherPriorityChars} | ${row.injectedFacts} | ${row.promptChars} |`
    ),
    "",
    "### Findings",
    "",
    ...(report.findings.length > 0
      ? report.findings.map((finding) => `- ${finding}`)
      : ["- NONE"]),
    "",
    "The sentinel is evidence-only. It never changes production memory policy, runtime flags, provider routing, billing, or deployment state.",
    "",
  ];
  return lines.join("\n");
}
