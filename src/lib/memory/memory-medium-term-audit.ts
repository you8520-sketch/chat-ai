/**
 * Read-only Medium-Term / Cascaded Memory audit helpers.
 * No provider calls, no persistence, no Main RP mutation.
 */
import { estimateTokens } from "@/lib/tokenEstimate";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { RAW_HISTORY_COMPLETE_EXCHANGES, ROLLING_SUMMARY_INTERVAL } from "./memory-constants";
import {
  countMediumGlobalRangeOverlap,
  measureMediumGlobalLiteralDuplicateChars,
  rawOwnedTurnStart,
  sealedSummaryRangesThrough,
  type MediumTermTurnRange,
} from "./memory-medium-term";
import { trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import { formatMemoryBlock } from "./memory-turn-summary";
import type { RingSize } from "./memory-architecture-audit";

export const CHRONO_MINI_ARC_FACTS = [
  { turn: 45, marker: "ARC_T45_SMALL_EVENT", role: "small_event" as const },
  { turn: 50, marker: "ARC_T50_ATTITUDE_SHIFT", role: "attitude" as const },
  { turn: 55, marker: "ARC_T55_REASON_REVEALED", role: "causality" as const },
  { turn: 60, marker: "ARC_T60_PARTIAL_RECONCILE", role: "reconciliation" as const },
  { turn: 65, marker: "ARC_T65_NEW_COMPLICATION", role: "complication" as const },
  { turn: 70, marker: "ARC_T70_DIRECTION_CHANGE", role: "direction" as const },
] as const;

export const CHRONO_ANCHOR_FACTS = [
  { turn: 20, marker: "OLD_MAJOR_MILESTONE", role: "old_major" as const },
  { turn: 120, marker: "DURABLE_PREF_COFFEE", role: "preference" as const },
  { turn: 150, marker: "ONGOING_PLOT_LEDGER", role: "plot_goal" as const },
  { turn: 200, marker: "TEMP_SCENE_RAIN", role: "temporary_scene" as const },
] as const;

export type MemoryLayerClass =
  | "RAW"
  | "MEDIUM"
  | "GLOBAL"
  | "EPISODIC"
  | "RELATIONSHIP"
  | "ABSENT";

export type FactLayerReport = {
  marker: string;
  turn: number;
  layer: MemoryLayerClass;
};

function padArcBody(marker: string, turnStart: number, turnEnd: number, chars = 420): string {
  let body = `${marker} ${turnStart}~${turnEnd} 구간 사건 → 인물 반응 → 관계 변화`;
  while (body.length < chars) body += ` → ${marker}_PAD`;
  return body.slice(0, chars);
}

function chronologyBlockForRange(turnStart: number, turnEnd: number): string {
  const mini = CHRONO_MINI_ARC_FACTS.find(
    (fact) => fact.turn >= turnStart && fact.turn <= turnEnd
  );
  const anchor = CHRONO_ANCHOR_FACTS.find(
    (fact) => fact.turn >= turnStart && fact.turn <= turnEnd
  );
  const marker = mini?.marker ?? anchor?.marker ?? `FILLER_${turnStart}_${turnEnd}`;
  return formatMemoryBlock(turnStart, turnEnd, padArcBody(marker, turnStart, turnEnd));
}

export function buildChronologyAuditHistory(currentTurn: number): string {
  const summarizedThrough = Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const ranges = sealedSummaryRangesThrough(summarizedThrough);
  return ranges.map((range) => chronologyBlockForRange(range.turnStart, range.turnEnd)).join("\n\n");
}

/** Audit-only medium ring using chronological fixtures (not MID_HORIZON audit facts). */
export function assembleChronoMediumRingText(currentTurn: number, n: RingSize): string {
  const rawStart = rawOwnedTurnStart(currentTurn);
  const summarizedThrough = Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const eligible = sealedSummaryRangesThrough(summarizedThrough).filter((range) => range.turnEnd < rawStart);
  const ring = eligible.slice(-n);
  return ring.map((range) => chronologyBlockForRange(range.turnStart, range.turnEnd)).join("\n\n");
}

/** Audit-only Global projection using chronological fixtures + emergency trim. */
export function assembleChronoGlobalMemoryText(currentTurn: number): string {
  const rawStart = rawOwnedTurnStart(currentTurn);
  const summarizedThrough = Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const ranges = sealedSummaryRangesThrough(summarizedThrough).filter((range) => range.turnStart < rawStart);
  const rebuilt = ranges.map((range) => chronologyBlockForRange(range.turnStart, range.turnEnd)).join("\n\n");
  if (!rebuilt) return "";
  return trimLorebookToBudgetSync(rebuilt, MEMORY_CAPACITY_FIXED);
}

export function classifyFactLayer(
  marker: string,
  turn: number,
  currentTurn: number,
  opts: {
    mediumText: string;
    globalText: string;
    episodicInjected?: boolean;
    relationshipText?: string;
  }
): MemoryLayerClass {
  const rawStart = rawOwnedTurnStart(currentTurn);
  if (turn >= rawStart && turn < currentTurn) return "RAW";
  if (opts.relationshipText?.includes(marker)) return "RELATIONSHIP";
  if (opts.episodicInjected) return "EPISODIC";
  if (opts.mediumText.includes(marker)) return "MEDIUM";
  if (opts.globalText.includes(marker)) return "GLOBAL";
  return "ABSENT";
}

export function simulateMediumDesignComparison(
  currentTurn: number,
  ringN: 5 | 10 | 15
): {
  ringN: number;
  mediumChars: number;
  mediumTokens: number;
  globalChars: number;
  globalTokens: number;
  mediumGlobalLiteralDuplicateChars: number;
  mediumGlobalRangeOverlaps: number;
  arcMarkersInMedium: string[];
  arcMarkersInGlobal: string[];
  arcMarkersAbsent: string[];
} {
  const medium = assembleChronoMediumRingText(currentTurn, ringN);
  const global = assembleChronoGlobalMemoryText(currentTurn);
  const mediumRanges: MediumTermTurnRange[] = [];
  for (const block of medium.split(/\n\n+/).filter(Boolean)) {
    const match = block.match(/\[(\d+)~(\d+)턴\]/);
    if (!match) continue;
    mediumRanges.push({ turnStart: Number(match[1]), turnEnd: Number(match[2]) });
  }
  const rawStart = rawOwnedTurnStart(currentTurn);
  const summarizedThrough = Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const globalRanges = sealedSummaryRangesThrough(summarizedThrough).filter(
    (range) => range.turnStart < rawStart
  );

  const arcMarkers = [...CHRONO_MINI_ARC_FACTS, ...CHRONO_ANCHOR_FACTS].map((fact) => fact.marker);
  const arcMarkersInMedium = arcMarkers.filter((marker) => medium.includes(marker));
  const arcMarkersInGlobal = arcMarkers.filter((marker) => global.includes(marker));
  const arcMarkersAbsent = arcMarkers.filter(
    (marker) => !medium.includes(marker) && !global.includes(marker)
  );

  return {
    ringN,
    mediumChars: medium.length,
    mediumTokens: estimateTokens(medium || " "),
    globalChars: global.length,
    globalTokens: estimateTokens(global || " "),
    mediumGlobalLiteralDuplicateChars: measureMediumGlobalLiteralDuplicateChars(medium, global),
    mediumGlobalRangeOverlaps: countMediumGlobalRangeOverlap(mediumRanges, globalRanges),
    arcMarkersInMedium,
    arcMarkersInGlobal,
    arcMarkersAbsent,
  };
}

export function estimateGlobalCompactionInputAtTurn(currentTurn: number): {
  turnCount: number;
  sealedBlockCount: number;
  rebuiltInputChars: number;
  rebuiltInputTokens: number;
  sealCadenceTurns: number;
} {
  const summarizedThrough = Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const sealedBlockCount = summarizedThrough / ROLLING_SUMMARY_INTERVAL;
  const history = buildChronologyAuditHistory(currentTurn);
  return {
    turnCount: currentTurn,
    sealedBlockCount,
    rebuiltInputChars: history.length,
    rebuiltInputTokens: estimateTokens(history || " "),
    sealCadenceTurns: ROLLING_SUMMARY_INTERVAL,
  };
}

export function estimatePromptBudgetAtTurn(
  currentTurn: number,
  ringN: 5 | 10 | 15,
  opts?: {
    rawChars?: number;
    episodicChars?: number;
    relationshipChars?: number;
  }
): {
  mediumChars: number;
  mediumTokens: number;
  globalChars: number;
  globalTokens: number;
  rawChars: number;
  rawTokens: number;
  episodicChars: number;
  episodicTokens: number;
  relationshipChars: number;
  relationshipTokens: number;
  totalChars: number;
  totalTokens: number;
} {
  const sim = simulateMediumDesignComparison(currentTurn, ringN);
  const rawChars = opts?.rawChars ?? RAW_HISTORY_COMPLETE_EXCHANGES * 800;
  const episodicChars = opts?.episodicChars ?? 1000;
  const relationshipChars = opts?.relationshipChars ?? 2000;
  const totalChars = sim.mediumChars + sim.globalChars + rawChars + episodicChars + relationshipChars;
  return {
    mediumChars: sim.mediumChars,
    mediumTokens: sim.mediumTokens,
    globalChars: sim.globalChars,
    globalTokens: sim.globalTokens,
    rawChars,
    rawTokens: estimateTokens("x".repeat(rawChars)),
    episodicChars,
    episodicTokens: estimateTokens("x".repeat(episodicChars)),
    relationshipChars,
    relationshipTokens: estimateTokens("x".repeat(relationshipChars)),
    totalChars,
    totalTokens: estimateTokens("x".repeat(totalChars)),
  };
}

/** Design A — Global whole-history + Medium ring (audit simulation). */
export function designAMediumGlobalDuplicateChars(currentTurn: number, ringN: 5 | 10 | 15): number {
  return simulateMediumDesignComparison(currentTurn, ringN).mediumGlobalLiteralDuplicateChars;
}

/** Global fixture coverage for OLD/MID/RECENT under whole-history semantics. */
export function globalMajorEventCoverage(globalText: string): {
  old: boolean;
  mid: boolean;
  recent: boolean;
} {
  return {
    old: globalText.includes("OLD_MAJOR_MILESTONE") || globalText.includes("OLD_MAJOR_EVENT"),
    mid: globalText.includes("ONGOING_PLOT_LEDGER") || globalText.includes("MID_MAJOR_EVENT"),
    recent:
      globalText.includes("ARC_T70_DIRECTION_CHANGE") || globalText.includes("RECENT_MAJOR_EVENT"),
  };
}

export { MEMORY_CAPACITY_FIXED, RAW_HISTORY_COMPLETE_EXCHANGES };
