/**
 * Persistent Memory Gap Radar.
 *
 * Finds deterministic positive RP-memory cases that remain missed across
 * multiple comparable baseline cycles. Research evidence only: it never edits
 * production memory, creates a new scorer, or auto-patches a gap.
 */
import type {
  BaselineSnapshot,
  HistoricalBaselineEntry,
} from "@/lib/memoryResearch/baselineTrend";
import {
  BENCHMARK_CAPABILITY_CASE_IDS,
  type BenchmarkCapabilityGroup,
} from "@/lib/memory/memory-rp-benchmark";
import { EXPANDED_BASELINE_KNOWN_GAPS } from "@/lib/memory/memory-rp-benchmark-suite";

export type PersistentGapStatus =
  | "UNAVAILABLE"
  | "INSUFFICIENT_HISTORY"
  | "CLEAR"
  | "PERSISTENT_GAPS";

export type PersistentGapEvidence = {
  caseId: string;
  consecutiveComparableFailures: number;
  oldestComparableFailureCycleKey: string | null;
  capabilityGroups: readonly BenchmarkCapabilityGroup[];
  documentedKnownGap: boolean;
  ownerHints: readonly string[];
  nextAction: string;
};

export type PersistentMemoryGapReport = {
  status: PersistentGapStatus;
  benchmarkFingerprint: string | null;
  requiredConsecutiveFailures: number;
  comparableCyclesAvailable: number;
  currentFailedPositiveCases: string[];
  persistentGaps: PersistentGapEvidence[];
  transientOrUnconfirmedFailures: string[];
  note: string;
};

const SEMANTIC_KNOWN_GAP_CASE_ID =
  "semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01";

function capabilityGroupsFor(caseId: string): BenchmarkCapabilityGroup[] {
  return (
    Object.keys(BENCHMARK_CAPABILITY_CASE_IDS) as BenchmarkCapabilityGroup[]
  ).filter((group) => BENCHMARK_CAPABILITY_CASE_IDS[group].includes(caseId));
}

function documentedKnownGap(caseId: string): boolean {
  return (
    caseId === SEMANTIC_KNOWN_GAP_CASE_ID ||
    Object.prototype.hasOwnProperty.call(EXPANDED_BASELINE_KNOWN_GAPS, caseId)
  );
}

function ownerHintsFor(caseId: string): string[] {
  if (
    caseId === SEMANTIC_KNOWN_GAP_CASE_ID ||
    caseId === "distinctive-utterance-01"
  ) {
    return ["semantic_retrieval", "embedding_index"];
  }
  if (caseId === "item-ownership-01") {
    return ["relationship_durable"];
  }
  if (caseId === "high-noise-distractors-01") {
    return ["state_reconciliation"];
  }
  return [];
}

function nextActionFor(caseId: string, isDocumentedKnownGap: boolean): string {
  if (caseId === SEMANTIC_KNOWN_GAP_CASE_ID) {
    return (
      "Route to the existing semantic-retrieval/embedding experiment lane. " +
      "Do not add a prompt workaround or raise memory budgets."
    );
  }
  if (isDocumentedKnownGap) {
    return (
      "Keep the documented gap visible and route it to its existing canonical owner before proposing an experiment. " +
      "Do not create a duplicate benchmark case."
    );
  }
  return (
    "Open a BUGFIX investigation against current main: reproduce this exact case, prove the failing execution stage/owner, " +
    "and STOP before patching if the owner cannot be confirmed."
  );
}

function comparableHistory(
  current: BaselineSnapshot,
  history: readonly HistoricalBaselineEntry[]
): HistoricalBaselineEntry[] {
  const rows: HistoricalBaselineEntry[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]!;
    // A failed/unrecorded baseline breaks the "consecutive measured cycles"
    // claim; do not silently bridge across missing evidence.
    if (!entry.baseline) break;
    if (entry.baseline.benchmarkFingerprint !== current.benchmarkFingerprint) {
      break;
    }
    rows.push(entry);
  }
  return rows;
}

export function buildPersistentMemoryGapReport(
  current: BaselineSnapshot | null,
  history: readonly HistoricalBaselineEntry[],
  requiredConsecutiveFailures = 3
): PersistentMemoryGapReport {
  if (!current) {
    return {
      status: "UNAVAILABLE",
      benchmarkFingerprint: null,
      requiredConsecutiveFailures,
      comparableCyclesAvailable: 0,
      currentFailedPositiveCases: [],
      persistentGaps: [],
      transientOrUnconfirmedFailures: [],
      note: "Current deterministic baseline is unavailable; persistence is not inferred.",
    };
  }

  const priorComparable = comparableHistory(current, history);
  const comparableCyclesAvailable = 1 + priorComparable.length;
  const currentFailedPositiveCases = Object.entries(current.finalHitByCase)
    .filter(([, hit]) => hit === false)
    .map(([caseId]) => caseId)
    .sort();

  const persistentGaps: PersistentGapEvidence[] = [];
  const transientOrUnconfirmedFailures: string[] = [];

  for (const caseId of currentFailedPositiveCases) {
    let consecutive = 1;
    let oldestComparableFailureCycleKey: string | null = null;

    for (const entry of priorComparable) {
      const hit = entry.baseline!.finalHitByCase[caseId];
      if (hit !== false) break;
      consecutive += 1;
      oldestComparableFailureCycleKey = entry.cycleKey;
    }

    if (consecutive < requiredConsecutiveFailures) {
      transientOrUnconfirmedFailures.push(caseId);
      continue;
    }

    const isDocumentedKnownGap = documentedKnownGap(caseId);
    persistentGaps.push({
      caseId,
      consecutiveComparableFailures: consecutive,
      oldestComparableFailureCycleKey,
      capabilityGroups: capabilityGroupsFor(caseId),
      documentedKnownGap: isDocumentedKnownGap,
      ownerHints: ownerHintsFor(caseId),
      nextAction: nextActionFor(caseId, isDocumentedKnownGap),
    });
  }

  const status: PersistentGapStatus =
    persistentGaps.length > 0
      ? "PERSISTENT_GAPS"
      : comparableCyclesAvailable < requiredConsecutiveFailures
        ? "INSUFFICIENT_HISTORY"
        : "CLEAR";

  return {
    status,
    benchmarkFingerprint: current.benchmarkFingerprint,
    requiredConsecutiveFailures,
    comparableCyclesAvailable,
    currentFailedPositiveCases,
    persistentGaps,
    transientOrUnconfirmedFailures: transientOrUnconfirmedFailures.sort(),
    note:
      comparableCyclesAvailable < requiredConsecutiveFailures
        ? "Not enough consecutive same-fingerprint baseline cycles exist to promote a current miss into a persistent gap."
        : "Only positive deterministic cases are considered. Fingerprint changes or missing baseline cycles reset persistence evidence.",
  };
}

export function renderPersistentMemoryGapMarkdown(
  report: PersistentMemoryGapReport
): string {
  const lines = [
    "## Persistent Memory Gap Radar",
    "",
    `- status: **${report.status}**`,
    `- comparable cycles: ${report.comparableCyclesAvailable}`,
    `- required consecutive failures: ${report.requiredConsecutiveFailures}`,
    `- benchmark fingerprint: ${report.benchmarkFingerprint ?? "-"}`,
    `- current failed positive cases: ${report.currentFailedPositiveCases.join(", ") || "-"}`,
    `- transient/unconfirmed failures: ${report.transientOrUnconfirmedFailures.join(", ") || "-"}`,
    "",
  ];

  if (report.persistentGaps.length === 0) {
    lines.push("- persistent gaps: -", "", `- ${report.note}`, "");
    return lines.join("\n");
  }

  lines.push(
    "| case | consecutive | groups | known gap | owner hint(s) | next action |",
    "|---|---:|---|---|---|---|"
  );
  for (const gap of report.persistentGaps) {
    lines.push(
      `| ${gap.caseId} | ${gap.consecutiveComparableFailures} | ${gap.capabilityGroups.join(", ") || "-"} | ${gap.documentedKnownGap ? "YES" : "NO"} | ${gap.ownerHints.join(", ") || "OWNER_ROUTING_REQUIRED"} | ${gap.nextAction.replace(/\|/g, "/")} |`
    );
  }
  lines.push("", `- ${report.note}`, "");
  return lines.join("\n");
}
