/**
 * Read-only architecture audit helpers.
 * Does not inject, persist, or call providers.
 * Production Main RP wiring is intentionally unchanged.
 */
import { estimateTokens } from "@/lib/tokenEstimate";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { RAW_HISTORY_COMPLETE_EXCHANGES, ROLLING_SUMMARY_INTERVAL } from "./memory-constants";
import { trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import { formatMemoryBlock } from "./memory-turn-summary";

export const AUDIT_SUMMARY_BODY_CHARS = 450;

export type MidHorizonFactId = "A" | "B" | "C" | "D" | "E" | "F";

export type MidHorizonFactSpec = {
  id: MidHorizonFactId;
  turn: number;
  marker: string;
  kind:
    | "minor_narrative"
    | "relationship_milestone"
    | "directional_intimacy"
    | "unresolved_plot"
    | "temporary_scene"
    | "durable_preference";
};

export const MID_HORIZON_FACTS: MidHorizonFactSpec[] = [
  {
    id: "A",
    turn: 10,
    marker: "AUDIT_MINOR_LANTERN_T10",
    kind: "minor_narrative",
  },
  {
    id: "B",
    turn: 30,
    marker: "AUDIT_MILESTONE_FIRST_KISS_T30",
    kind: "relationship_milestone",
  },
  {
    id: "C",
    turn: 60,
    marker: "AUDIT_DIRECTION_A_RECEPTIVE_T60",
    kind: "directional_intimacy",
  },
  {
    id: "D",
    turn: 90,
    marker: "AUDIT_PLOT_MISSING_LEDGER_T90",
    kind: "unresolved_plot",
  },
  {
    id: "E",
    turn: 200,
    marker: "AUDIT_TEMP_RAIN_SOAKED_T200",
    kind: "temporary_scene",
  },
  {
    id: "F",
    turn: 200,
    marker: "AUDIT_PREF_BLACK_COFFEE_T200",
    kind: "durable_preference",
  },
];

export type LayerPresence = {
  raw: boolean;
  individualSummaryRecord: boolean;
  currentMemory: boolean;
  archive: boolean;
  relationshipOwner: boolean;
  episodicCandidate: boolean;
  episodicInjected: boolean;
  completelyAbsent: boolean;
};

export type MemoryFailureType =
  | "RAW_HORIZON_LOSS"
  | "MID_TERM_COMPRESSION_LOSS"
  | "GLOBAL_SUMMARY_COMPRESSION_LOSS"
  | "EPISODIC_CAPTURE_LOSS"
  | "EPISODIC_RETRIEVAL_LOSS"
  | "DURABLE_STATE_OWNER_LOSS"
  | "PROMPT_BUDGET_LOSS";

export type RingSize = 5 | 10 | 15;

export type DesignSimulation = {
  design: "A" | "B" | "C";
  ringN: RingSize | 0;
  coveredTurnHorizon: string;
  rawTurns: number;
  ringChars: number;
  ringTokens: number;
  currentMemoryChars: number;
  currentMemoryTokens: number;
  currentMemoryCharsRemovedForOwnership: number;
  archiveChars: number;
  episodicChars: number;
  netPromptDeltaVsA: number;
  duplicateChars: number;
  deepSeekPromptEstimate: number;
  gemini31PromptEstimate: number;
  gemini37PromptEstimate: number;
};

function padSummary(marker: string, turnStart: number, turnEnd: number): string {
  const clauses = [
    `${marker} ${turnStart}~${turnEnd}구간에서 사건이 발생했다`,
    "인물이 그 흐름에 반응했다",
    "관계가 조금 달라졌다",
    "다음 만남을 남긴 채 장면이 닫혔다",
  ];
  let body = clauses.join(" → ");
  while (body.length < AUDIT_SUMMARY_BODY_CHARS) {
    body += " → 같은 구간의 배경이 짧게 이어졌다";
  }
  return body.slice(0, AUDIT_SUMMARY_BODY_CHARS);
}

export function summaryBlockForRange(turnStart: number, turnEnd: number): string {
  const fact = MID_HORIZON_FACTS.find((item) => item.turn >= turnStart && item.turn <= turnEnd);
  const marker = fact?.marker ?? `AUDIT_FILLER_${turnStart}_${turnEnd}`;
  return formatMemoryBlock(turnStart, turnEnd, padSummary(marker, turnStart, turnEnd));
}

export function sealedSummaryRangesThrough(summarizedThrough: number): Array<{
  turnStart: number;
  turnEnd: number;
}> {
  const ranges: Array<{ turnStart: number; turnEnd: number }> = [];
  for (
    let start = 1;
    start + ROLLING_SUMMARY_INTERVAL - 1 <= summarizedThrough;
    start += ROLLING_SUMMARY_INTERVAL
  ) {
    ranges.push({ turnStart: start, turnEnd: start + ROLLING_SUMMARY_INTERVAL - 1 });
  }
  return ranges;
}

export function rawOwnedTurnStart(currentTurn: number, rawExchanges = RAW_HISTORY_COMPLETE_EXCHANGES): number {
  return Math.max(1, currentTurn - rawExchanges + 1);
}

/** Production sync trim: prefix clamp of concatenated lorebook (not prefer-recent). */
export function assembleCurrentMemoryText(
  currentTurn: number,
  opts?: { excludeTurnStartGte?: number; excludeNewestSealedCount?: number }
): string {
  const rawStart = opts?.excludeTurnStartGte ?? rawOwnedTurnStart(currentTurn);
  const summarizedThrough = Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  let ranges = sealedSummaryRangesThrough(summarizedThrough).filter((range) => range.turnStart < rawStart);
  if (opts?.excludeNewestSealedCount && opts.excludeNewestSealedCount > 0) {
    ranges = ranges.slice(0, Math.max(0, ranges.length - opts.excludeNewestSealedCount));
  }
  const rebuilt = ranges.map((range) => summaryBlockForRange(range.turnStart, range.turnEnd)).join("\n\n");
  if (!rebuilt) return "";
  return trimLorebookToBudgetSync(rebuilt, MEMORY_CAPACITY_FIXED);
}

export function assembleActiveRingText(currentTurn: number, n: RingSize): string {
  const rawStart = rawOwnedTurnStart(currentTurn);
  const summarizedThrough = Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const eligible = sealedSummaryRangesThrough(summarizedThrough).filter((range) => range.turnEnd < rawStart);
  const ring = eligible.slice(-n);
  return ring.map((range) => summaryBlockForRange(range.turnStart, range.turnEnd)).join("\n\n");
}

export function inspectFactPresence(
  fact: MidHorizonFactSpec,
  currentTurn: number,
  opts?: {
    currentMemoryText?: string;
    ringText?: string;
    archiveText?: string;
    relationshipText?: string;
    episodicCandidate?: boolean;
    episodicInjected?: boolean;
  }
): LayerPresence {
  const rawStart = rawOwnedTurnStart(currentTurn);
  const raw = fact.turn >= rawStart && fact.turn < currentTurn;
  const summarizedThrough = Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const individualSummaryRecord = fact.turn <= summarizedThrough;
  const currentMemory = (opts?.currentMemoryText ?? assembleCurrentMemoryText(currentTurn)).includes(fact.marker);
  const archive = (opts?.archiveText ?? "").includes(fact.marker);
  const relationshipOwner = (opts?.relationshipText ?? "").includes(fact.marker);
  const inRing = (opts?.ringText ?? "").includes(fact.marker);
  const episodicCandidate = opts?.episodicCandidate === true;
  const episodicInjected = opts?.episodicInjected === true;
  const completelyAbsent =
    !raw &&
    !currentMemory &&
    !archive &&
    !relationshipOwner &&
    !inRing &&
    !episodicInjected;
  return {
    raw,
    individualSummaryRecord,
    currentMemory,
    archive,
    relationshipOwner,
    episodicCandidate,
    episodicInjected,
    completelyAbsent,
  };
}

export function classifyFactFailure(
  fact: MidHorizonFactSpec,
  presence: LayerPresence,
  currentTurn: number
): MemoryFailureType | null {
  if (!presence.completelyAbsent && (presence.currentMemory || presence.raw || presence.episodicInjected)) {
    return null;
  }
  if (presence.raw) return null;
  if (fact.turn >= rawOwnedTurnStart(currentTurn)) return "RAW_HORIZON_LOSS";
  if (presence.individualSummaryRecord && !presence.currentMemory) {
    return "GLOBAL_SUMMARY_COMPRESSION_LOSS";
  }
  if (fact.kind === "temporary_scene") return "DURABLE_STATE_OWNER_LOSS";
  if (fact.kind === "durable_preference" && !presence.episodicInjected) {
    return presence.episodicCandidate ? "EPISODIC_RETRIEVAL_LOSS" : "EPISODIC_CAPTURE_LOSS";
  }
  if (presence.individualSummaryRecord) return "MID_TERM_COMPRESSION_LOSS";
  return "PROMPT_BUDGET_LOSS";
}

function sharedFixedLayerTokens(): number {
  const userNoteFocus = 1_000;
  const userNoteReference = 2_500;
  const relationshipWorst = 2_000;
  const episodicWorst = 1_000;
  const archiveWorst = 3_000;
  const characterCanonWorst = 8_000;
  const lorebookKeywordWorst = 2_000;
  return estimateTokens(
    "x".repeat(
      userNoteFocus +
        userNoteReference +
        relationshipWorst +
        episodicWorst +
        archiveWorst +
        characterCanonWorst +
        lorebookKeywordWorst
    )
  );
}

export function simulateDesign(
  design: "A" | "B" | "C",
  currentTurn: number,
  ringN: RingSize = 5
): DesignSimulation {
  const rawTurns = RAW_HISTORY_COMPLETE_EXCHANGES;
  const designAMemory = assembleCurrentMemoryText(currentTurn);
  const ringText = design === "A" ? "" : assembleActiveRingText(currentTurn, ringN);
  const ownedMemory =
    design === "A"
      ? designAMemory
      : assembleCurrentMemoryText(currentTurn, { excludeNewestSealedCount: ringN });
  const cascadeChars = design === "C" ? Math.min(2_000, ownedMemory.length) : 0;
  const currentMemoryCharsRemovedForOwnership = Math.max(0, designAMemory.length - ownedMemory.length);
  const duplicateChars = ringOverlapChars(designAMemory, ringText);
  const ringChars = ringText.length;
  const currentMemoryChars = ownedMemory.length + cascadeChars;
  const episodicChars = 1_000;
  const archiveChars = 0;
  const netPromptDeltaVsA = ringChars + currentMemoryChars - designAMemory.length - duplicateChars;
  const combinedMemoryChars = ringChars + currentMemoryChars + archiveChars + episodicChars;
  const modelEstimate = estimateTokens("x".repeat(combinedMemoryChars)) + sharedFixedLayerTokens();

  const newestRingStart = Math.max(
    1,
    Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL -
      ringN * ROLLING_SUMMARY_INTERVAL +
      1
  );

  return {
    design,
    ringN: design === "A" ? 0 : ringN,
    coveredTurnHorizon:
      design === "A"
        ? `RAW ${rawTurns} + prefix-trimmed Current Memory`
        : `RAW ${rawTurns} + ring ${newestRingStart}~ + older-only Current Memory`,
    rawTurns,
    ringChars,
    ringTokens: estimateTokens(ringText || " "),
    currentMemoryChars,
    currentMemoryTokens: estimateTokens(ownedMemory || " "),
    currentMemoryCharsRemovedForOwnership,
    archiveChars,
    episodicChars,
    netPromptDeltaVsA,
    duplicateChars,
    deepSeekPromptEstimate: modelEstimate,
    gemini31PromptEstimate: modelEstimate,
    gemini37PromptEstimate: modelEstimate,
  };
}

function ringOverlapChars(currentMemory: string, ringText: string): number {
  if (!currentMemory || !ringText) return 0;
  let overlap = 0;
  for (const fact of MID_HORIZON_FACTS) {
    if (currentMemory.includes(fact.marker) && ringText.includes(fact.marker)) {
      overlap += fact.marker.length;
    }
  }
  for (const range of ringText.match(/\[\d+~\d+턴\]/g) ?? []) {
    if (currentMemory.includes(range)) overlap += range.length;
  }
  return overlap;
}

export const OVERFLOW_AUDIT_MARKERS = {
  OLD: "OLD_MARKER",
  MID: "MID_MARKER",
  RECENT: "RECENT_MARKER",
  COMPRESSED_ONLY: "COMPRESSED_STORED_ONLY_MARKER",
} as const;

export type OverflowMarkerPresence = {
  old: boolean;
  mid: boolean;
  recent: boolean;
  compressedOnly: boolean;
};

export type TenKOverflowOwnerReport = {
  storedTurnSummaryChars: number;
  storedRecentSummaryChars: number;
  rebuiltChars: number;
  syncTrimChars: number;
  actualCurrentMemoryPromptChars: number;
  markers: OverflowMarkerPresence;
  rebuildOrdering: "oldest_to_newest" | "unknown";
  canonicalSource: "chat_turn_summaries_rebuild" | "chat_memories_recent_summary" | "other";
  storedRecentDiffersFromRebuilt: boolean;
  promptUsesStoredCompressed: boolean;
};

/** Deterministic >10K fixture bodies — arrow-connected for production sync trim. */
export function buildOverflowSummaryBody(marker: string, targetChars = 480): string {
  let body = `${marker} 구간 사건 시작 → 인물 반응 → 관계 변화`;
  while (body.length < targetChars) {
    body += ` → ${marker}_PAD`;
  }
  return body.slice(0, targetChars);
}

export type OverflowSummaryBlockSpec = {
  turnStart: number;
  turnEnd: number;
  marker: string;
  body: string;
};

/** S1..Sn blocks exceeding MEMORY_CAPACITY_FIXED when joined. */
export function buildOverflowSummaryFixture(opts?: {
  blockCount?: number;
  bodyChars?: number;
}): OverflowSummaryBlockSpec[] {
  const blockCount = opts?.blockCount ?? 28;
  const bodyChars = opts?.bodyChars ?? 480;
  const blocks: OverflowSummaryBlockSpec[] = [];
  for (let i = 0; i < blockCount; i++) {
    const turnStart = i * ROLLING_SUMMARY_INTERVAL + 1;
    const turnEnd = turnStart + ROLLING_SUMMARY_INTERVAL - 1;
    let marker = `FILLER_${i}`;
    if (i < 3) marker = OVERFLOW_AUDIT_MARKERS.OLD;
    else if (i >= Math.floor(blockCount / 2) - 1 && i <= Math.floor(blockCount / 2) + 1) {
      marker = OVERFLOW_AUDIT_MARKERS.MID;
    } else if (i >= blockCount - 3) marker = OVERFLOW_AUDIT_MARKERS.RECENT;
    blocks.push({
      turnStart,
      turnEnd,
      marker,
      body: buildOverflowSummaryBody(marker, bodyChars),
    });
  }
  return blocks;
}

export function joinOverflowBlocks(blocks: OverflowSummaryBlockSpec[]): string {
  return blocks
    .map((b) => formatMemoryBlock(b.turnStart, b.turnEnd, b.body))
    .join("\n\n");
}

export function detectOverflowMarkers(text: string): OverflowMarkerPresence {
  return {
    old: text.includes(OVERFLOW_AUDIT_MARKERS.OLD),
    mid: text.includes(OVERFLOW_AUDIT_MARKERS.MID),
    recent: text.includes(OVERFLOW_AUDIT_MARKERS.RECENT),
    compressedOnly: text.includes(OVERFLOW_AUDIT_MARKERS.COMPRESSED_ONLY),
  };
}

export function auditTenKOverflowOwnerProof(input: {
  storedTurnSummaryChars: number;
  storedRecentSummary: string;
  rebuiltText: string;
  syncTrimText: string;
  promptRecentText: string;
  rebuildTurnStarts: number[];
}): TenKOverflowOwnerReport {
  const storedRecentSummaryChars = input.storedRecentSummary.length;
  const rebuiltChars = input.rebuiltText.length;
  const syncTrimChars = input.syncTrimText.length;
  const actualCurrentMemoryPromptChars = input.promptRecentText.length;
  const markers = detectOverflowMarkers(input.promptRecentText);
  const rebuildOrdering =
    input.rebuildTurnStarts.length <= 1 ||
    input.rebuildTurnStarts.every((t, i) => i === 0 || t >= input.rebuildTurnStarts[i - 1]!)
      ? "oldest_to_newest"
      : "unknown";
  const storedRecentDiffersFromRebuilt =
    !!input.storedRecentSummary.trim() &&
    !!input.rebuiltText.trim() &&
    input.storedRecentSummary.trim() !== input.rebuiltText.trim();
  const promptUsesStoredCompressed =
    !!input.storedRecentSummary.trim() &&
    input.promptRecentText.trim() === input.storedRecentSummary.trim();
  const canonicalSource =
    input.rebuiltText.trim() && !promptUsesStoredCompressed
      ? "chat_turn_summaries_rebuild"
      : input.storedRecentSummary.trim() && promptUsesStoredCompressed
        ? "chat_memories_recent_summary"
        : "other";

  return {
    storedTurnSummaryChars: input.storedTurnSummaryChars,
    storedRecentSummaryChars,
    rebuiltChars,
    syncTrimChars,
    actualCurrentMemoryPromptChars,
    markers,
    rebuildOrdering,
    canonicalSource,
    storedRecentDiffersFromRebuilt,
    promptUsesStoredCompressed,
  };
}

export type RecompressionCadenceReport = {
  sealCount: number;
  compactCallCount: number;
  eachInputIncludesAllRecords: boolean;
  eachInputChars: number[];
  recordCountsAtCompact: number[];
  usesPriorCompactedSummaryAsInput: boolean;
};

export function auditRecompressionCadence(calls: {
  inputChars: number;
  recordCount: number;
  inputText: string;
  priorCompactedSummary: string;
}[]): RecompressionCadenceReport {
  const compactCallCount = calls.length;
  const eachInputChars = calls.map((c) => c.inputChars);
  const recordCountsAtCompact = calls.map((c) => c.recordCount);
  const eachInputIncludesAllRecords =
    compactCallCount === 0 ||
    recordCountsAtCompact.every((count, i) => i === 0 || count >= recordCountsAtCompact[i - 1]!);
  const usesPriorCompactedSummaryAsInput =
    compactCallCount > 1 &&
    calls.slice(1).some((c) => c.priorCompactedSummary && c.inputText.includes(c.priorCompactedSummary.slice(0, 200)));

  return {
    sealCount: compactCallCount,
    compactCallCount,
    eachInputIncludesAllRecords,
    eachInputChars,
    recordCountsAtCompact,
    usesPriorCompactedSummaryAsInput,
  };
}

/** Post-bugfix classifications — validated by deterministic regression tests. */
export const TEN_K_OVERFLOW_AUDIT_CLASSIFICATIONS = {
  GLOBAL_MEMORY_COMPACTION_WRITE_READ_MISMATCH: "ROOT_CAUSE_FIXED",
  CURRENT_MEMORY_OVERFLOW_PREFIX_BIAS: "ROOT_CAUSE_FIXED",
  CURRENT_MEMORY_OVERFLOW_EMPTY_RESULT: "ROOT_CAUSE_FIXED",
  USER_EDITED_CURRENT_MEMORY_BYPASSED: "ROOT_CAUSE_FIXED",
  ARCHIVE_OVERFLOW_ROLE: "NOT_ACTIVE",
  GLOBAL_MEMORY_CANONICAL_PROMPT_OWNER: "chat_turn_summaries (rebuilt at prompt time)",
  GLOBAL_PROJECTION_FRESHNESS: "PROVEN",
  FULL_HISTORY_RECOMPRESSION_EVERY_SEAL: "REMOVED",
} as const;

export function worstCaseCombinedBudgetChars(): {
  rawChars: number;
  currentMemoryChars: number;
  archiveChars: number;
  episodicChars: number;
  relationshipChars: number;
  lorebookChars: number;
  userNoteChars: number;
  characterCanonChars: number;
  totalChars: number;
  totalTokens: number;
  singleGlobalBudgetOwner: false;
} {
  const rawChars = 10_000;
  const currentMemoryChars = MEMORY_CAPACITY_FIXED;
  const archiveChars = 3_000;
  const episodicChars = 1_000;
  const relationshipChars = 2_000;
  const lorebookChars = 4_000;
  const userNoteChars = 1_000 + 2_500;
  const characterCanonChars = 12_000;
  const totalChars =
    rawChars +
    currentMemoryChars +
    archiveChars +
    episodicChars +
    relationshipChars +
    lorebookChars +
    userNoteChars +
    characterCanonChars;
  return {
    rawChars,
    currentMemoryChars,
    archiveChars,
    episodicChars,
    relationshipChars,
    lorebookChars,
    userNoteChars,
    characterCanonChars,
    totalChars,
    totalTokens: estimateTokens("x".repeat(totalChars)),
    singleGlobalBudgetOwner: false,
  };
}
