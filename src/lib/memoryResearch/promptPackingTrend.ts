/**
 * Deterministic trend evidence for scheduled Memory prompt-packing audits.
 *
 * Compares only memory-specific overhead (N15 delta vs baseline and Medium
 * tokens) across identical policy/fixture snapshots. Research-only:
 * no provider calls, no production reads/writes, no automatic policy changes.
 */
import type { MemoryPromptPackingAudit } from "@/lib/memoryResearch/promptPackingAudit";
import type { ResearchLedger } from "@/lib/memoryResearch/ledger";

export type PromptPackingTrendSnapshot = {
  generatedAt: string;
  currentTurnFixture: number;
  policyId: string;
  rawRecentExchanges: number;
  rollingSummaryInterval: number;
  mediumTermBlockCount: number;
  models: Array<{
    modelId: string;
    n15DeltaInputTokens: number;
    n15MediumTokens: number;
  }>;
};

export type PromptPackingTrendStatus =
  | "NO_HISTORY"
  | "ARCHITECTURE_CHANGED"
  | "MODEL_SET_CHANGED"
  | "STABLE"
  | "MEMORY_OVERHEAD_INCREASE"
  | "MEMORY_OVERHEAD_DECREASE"
  | "MIXED";

export type PromptPackingTrendModelDelta = {
  modelId: string;
  previousN15DeltaInputTokens: number;
  currentN15DeltaInputTokens: number;
  n15DeltaInputTokensDelta: number;
  previousMediumTokens: number;
  currentMediumTokens: number;
  mediumTokensDelta: number;
  verdict: "INCREASED" | "DECREASED" | "MIXED" | "UNCHANGED";
};

export type PromptPackingTrendReport = {
  status: PromptPackingTrendStatus;
  previousCycleKey: string | null;
  comparable: boolean;
  modelSetChanged: boolean;
  addedModels: string[];
  removedModels: string[];
  modelDeltas: PromptPackingTrendModelDelta[];
  note: string;
};

export function buildPromptPackingTrendSnapshot(
  audit: MemoryPromptPackingAudit
): PromptPackingTrendSnapshot {
  return {
    generatedAt: audit.generatedAt,
    currentTurnFixture: audit.currentTurnFixture,
    policyId: audit.architecture.policyId,
    rawRecentExchanges: audit.architecture.rawRecentExchanges,
    rollingSummaryInterval: audit.architecture.rollingSummaryInterval,
    mediumTermBlockCount: audit.architecture.mediumTermBlockCount,
    models: audit.models
      .map((model) => ({
        modelId: model.modelId,
        n15DeltaInputTokens: model.n15DeltaInputTokens,
        n15MediumTokens: model.n15MediumTokens,
      }))
      .sort((a, b) => a.modelId.localeCompare(b.modelId)),
  };
}

function sameArchitecture(
  a: PromptPackingTrendSnapshot,
  b: PromptPackingTrendSnapshot
): boolean {
  return (
    a.currentTurnFixture === b.currentTurnFixture &&
    a.policyId === b.policyId &&
    a.rawRecentExchanges === b.rawRecentExchanges &&
    a.rollingSummaryInterval === b.rollingSummaryInterval &&
    a.mediumTermBlockCount === b.mediumTermBlockCount
  );
}

export function comparePromptPackingTrend(
  current: PromptPackingTrendSnapshot,
  history: readonly {
    cycleKey: string;
    promptPackingSnapshot?: PromptPackingTrendSnapshot | null;
  }[]
): PromptPackingTrendReport {
  const previousEntry = [...history]
    .reverse()
    .find((entry) => entry.promptPackingSnapshot != null);
  const previous = previousEntry?.promptPackingSnapshot ?? null;

  if (!previous || !previousEntry) {
    return {
      status: "NO_HISTORY",
      previousCycleKey: null,
      comparable: false,
      modelSetChanged: false,
      addedModels: [],
      removedModels: [],
      modelDeltas: [],
      note: "No prior durable prompt-packing snapshot is available yet.",
    };
  }

  if (!sameArchitecture(previous, current)) {
    return {
      status: "ARCHITECTURE_CHANGED",
      previousCycleKey: previousEntry.cycleKey,
      comparable: false,
      modelSetChanged: false,
      addedModels: [],
      removedModels: [],
      modelDeltas: [],
      note:
        "Prompt-packing policy/fixture changed; token overhead is intentionally not compared across different memory architectures.",
    };
  }

  const previousByModel = new Map(previous.models.map((row) => [row.modelId, row]));
  const currentByModel = new Map(current.models.map((row) => [row.modelId, row]));
  const addedModels = current.models
    .map((row) => row.modelId)
    .filter((id) => !previousByModel.has(id))
    .sort();
  const removedModels = previous.models
    .map((row) => row.modelId)
    .filter((id) => !currentByModel.has(id))
    .sort();

  const commonIds = current.models
    .map((row) => row.modelId)
    .filter((id) => previousByModel.has(id))
    .sort();

  if (commonIds.length === 0) {
    return {
      status: "MODEL_SET_CHANGED",
      previousCycleKey: previousEntry.cycleKey,
      comparable: false,
      modelSetChanged: true,
      addedModels,
      removedModels,
      modelDeltas: [],
      note:
        "No active model is shared with the prior snapshot; memory overhead is not compared across a fully replaced model set.",
    };
  }

  const modelDeltas: PromptPackingTrendModelDelta[] = commonIds.map((modelId) => {
    const before = previousByModel.get(modelId)!;
    const after = currentByModel.get(modelId)!;
    const n15DeltaInputTokensDelta =
      after.n15DeltaInputTokens - before.n15DeltaInputTokens;
    const mediumTokensDelta = after.n15MediumTokens - before.n15MediumTokens;
    const increased = n15DeltaInputTokensDelta > 0 || mediumTokensDelta > 0;
    const decreased = n15DeltaInputTokensDelta < 0 || mediumTokensDelta < 0;
    return {
      modelId,
      previousN15DeltaInputTokens: before.n15DeltaInputTokens,
      currentN15DeltaInputTokens: after.n15DeltaInputTokens,
      n15DeltaInputTokensDelta,
      previousMediumTokens: before.n15MediumTokens,
      currentMediumTokens: after.n15MediumTokens,
      mediumTokensDelta,
      verdict:
        increased && !decreased
          ? "INCREASED"
          : decreased && !increased
            ? "DECREASED"
            : increased && decreased
              ? "MIXED"
              : "UNCHANGED",
    };
  });

  const hasIncrease = modelDeltas.some(
    (row) =>
      row.n15DeltaInputTokensDelta > 0 || row.mediumTokensDelta > 0
  );
  const hasDecrease = modelDeltas.some(
    (row) =>
      row.n15DeltaInputTokensDelta < 0 || row.mediumTokensDelta < 0
  );

  const status: PromptPackingTrendStatus =
    hasIncrease && hasDecrease
      ? "MIXED"
      : hasIncrease
        ? "MEMORY_OVERHEAD_INCREASE"
        : hasDecrease
          ? "MEMORY_OVERHEAD_DECREASE"
          : "STABLE";

  return {
    status,
    previousCycleKey: previousEntry.cycleKey,
    comparable: true,
    modelSetChanged: addedModels.length > 0 || removedModels.length > 0,
    addedModels,
    removedModels,
    modelDeltas,
    note:
      status === "MEMORY_OVERHEAD_INCREASE" || status === "MIXED"
        ? "Memory-specific prompt overhead increased for at least one comparable active model. This is review evidence, not an automatic quality regression or policy change."
        : "Comparison uses only N15 memory overhead vs baseline and Medium tokens, so unrelated static prompt growth does not create a memory-overhead alert.",
  };
}

export function attachPromptPackingTrendToCycleJson(
  rawCycleJson: string,
  trend: PromptPackingTrendReport
): string {
  const parsed = JSON.parse(rawCycleJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("memory research cycle report must be a JSON object");
  }
  return `${JSON.stringify(
    {
      ...(parsed as Record<string, unknown>),
      promptPackingTrend: trend,
    },
    null,
    2
  )}\n`;
}

export function attachPromptPackingSnapshotToLedger(
  ledger: ResearchLedger,
  cycleKey: string,
  snapshot: PromptPackingTrendSnapshot
): ResearchLedger {
  let index = -1;
  for (let i = ledger.cycles.length - 1; i >= 0; i -= 1) {
    if (ledger.cycles[i]?.cycleKey === cycleKey) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    throw new Error(
      `prompt-packing trend cannot find current ledger cycle ${cycleKey}`
    );
  }
  const cycles = ledger.cycles.map((entry, i) =>
    i === index ? { ...entry, promptPackingSnapshot: snapshot } : entry
  );
  return { ...ledger, cycles };
}

export function renderPromptPackingTrendMarkdown(
  trend: PromptPackingTrendReport
): string {
  const lines = [
    "## Memory prompt-packing trend",
    "",
    `- status: **${trend.status}**`,
    `- previous comparable cycle: ${trend.previousCycleKey ?? "-"}`,
    `- model set changed: ${trend.modelSetChanged ? "YES" : "NO"}`,
    `- added models: ${trend.addedModels.join(", ") || "-"}`,
    `- removed models: ${trend.removedModels.join(", ") || "-"}`,
    "",
  ];
  if (trend.modelDeltas.length > 0) {
    lines.push(
      "| model | N15 Δ before | N15 Δ now | change | Medium before | Medium now | change |",
      "|---|---:|---:|---:|---:|---:|---:|",
      ...trend.modelDeltas.map(
        (row) =>
          `| ${row.modelId} | ${row.previousN15DeltaInputTokens} | ${row.currentN15DeltaInputTokens} | ${row.n15DeltaInputTokensDelta >= 0 ? "+" : ""}${row.n15DeltaInputTokensDelta} | ${row.previousMediumTokens} | ${row.currentMediumTokens} | ${row.mediumTokensDelta >= 0 ? "+" : ""}${row.mediumTokensDelta} |`
      ),
      ""
    );
  }
  lines.push(`- ${trend.note}`, "");
  return lines.join("\n");
}
