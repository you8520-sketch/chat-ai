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
  shouldInjectMediumTermMemory,
  type MediumTermTurnRange,
} from "./memory-medium-term";
import { formatMemoryBlock } from "./memory-turn-summary";
import type { RingSize } from "./memory-architecture-audit";

export const MOVING_DETAIL_MARKERS = {
  near: "NEAR_MEDIUM_DETAIL",
  mid: "MID_MEDIUM_DETAIL",
  far: "FAR_MEDIUM_DETAIL",
} as const;

export const MOVING_MAJOR_MARKERS = {
  old: "OLD_MAJOR_EVENT",
  mid: "MID_MAJOR_EVENT",
  recent: "RECENT_MAJOR_EVENT",
} as const;

export type MovingDetailRole = keyof typeof MOVING_DETAIL_MARKERS;

/** Relative ages from currentTurn — T300→280/260/230, T1000→980/960/930. */
export function movingDetailTurns(currentTurn: number): Record<MovingDetailRole, number> {
  return {
    near: currentTurn - 20,
    mid: currentTurn - 40,
    far: currentTurn - 70,
  };
}

function padDetailBody(marker: string, turnStart: number, turnEnd: number, chars = 420): string {
  let body = `${marker} ${turnStart}~${turnEnd} 구간 사건 → 인물 반응 → 관계 변화`;
  while (body.length < chars) body += ` → ${marker}_PAD`;
  return body.slice(0, chars);
}

function markerForRange(
  turnStart: number,
  turnEnd: number,
  currentTurn: number
): string {
  const details = movingDetailTurns(currentTurn);
  for (const [role, turn] of Object.entries(details) as Array<[MovingDetailRole, number]>) {
    if (turn >= turnStart && turn <= turnEnd) {
      return MOVING_DETAIL_MARKERS[role];
    }
  }
  if (turnStart === 16 && turnEnd === 20) return MOVING_MAJOR_MARKERS.old;
  const midAnchor = Math.max(21, Math.floor(currentTurn * 0.5));
  const midBlockStart = Math.floor((midAnchor - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL + 1;
  if (turnStart === midBlockStart) return MOVING_MAJOR_MARKERS.mid;
  const recentAnchor = Math.max(21, currentTurn - 15);
  const recentBlockStart =
    Math.floor((recentAnchor - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL + 1;
  if (turnStart === recentBlockStart) return MOVING_MAJOR_MARKERS.recent;
  return `FILLER_${turnStart}_${turnEnd}`;
}

function blockForRange(turnStart: number, turnEnd: number, currentTurn: number): string {
  const marker = markerForRange(turnStart, turnEnd, currentTurn);
  return formatMemoryBlock(turnStart, turnEnd, padDetailBody(marker, turnStart, turnEnd));
}

/** Full sealed canonical history with moving mid-horizon detail markers. */
export function buildMovingHorizonAuditHistory(currentTurn: number): string {
  const summarizedThrough = Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const ranges = sealedSummaryRangesThrough(summarizedThrough);
  return ranges.map((range) => blockForRange(range.turnStart, range.turnEnd, currentTurn)).join("\n\n");
}

/** Healthy global_compact stub — whole-history majors preserved, granular details compressed away. */
export function assembleMovingGlobalCompactStub(currentTurn: number): string {
  void currentTurn;
  return [
    `${MOVING_MAJOR_MARKERS.old} preserved from early history`,
    `${MOVING_MAJOR_MARKERS.mid} preserved from mid history`,
    `${MOVING_MAJOR_MARKERS.recent} preserved from recent history`,
    "Compressed whole-history fold without granular near/mid/far chronological details",
  ].join(" → ");
}

export function assembleMovingMediumRingText(currentTurn: number, n: RingSize): string {
  const rawStart = rawOwnedTurnStart(currentTurn);
  const summarizedThrough = Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const eligible = sealedSummaryRangesThrough(summarizedThrough).filter((range) => range.turnEnd < rawStart);
  const ring = eligible.slice(-n);
  return ring.map((range) => blockForRange(range.turnStart, range.turnEnd, currentTurn)).join("\n\n");
}

export type MovingHorizonCoverageReport = {
  currentTurn: number;
  ringN: RingSize;
  mediumActive: boolean;
  nearPresent: boolean;
  midPresent: boolean;
  farPresent: boolean;
  globalHasNear: boolean;
  globalHasMid: boolean;
  globalHasFar: boolean;
  mediumChars: number;
  mediumTokens: number;
  globalChars: number;
  globalTokens: number;
  mediumGlobalLiteralDuplicateChars: number;
};

export function simulateMovingHorizonCoverage(
  currentTurn: number,
  ringN: RingSize,
  opts?: { mediumActive?: boolean }
): MovingHorizonCoverageReport {
  const mediumActive = opts?.mediumActive ?? shouldInjectMediumTermMemory("global_compact");
  const global = assembleMovingGlobalCompactStub(currentTurn);
  const medium = mediumActive ? assembleMovingMediumRingText(currentTurn, ringN) : "";
  const markers = MOVING_DETAIL_MARKERS;

  return {
    currentTurn,
    ringN,
    mediumActive,
    nearPresent: medium.includes(markers.near),
    midPresent: medium.includes(markers.mid),
    farPresent: medium.includes(markers.far),
    globalHasNear: global.includes(markers.near),
    globalHasMid: global.includes(markers.mid),
    globalHasFar: global.includes(markers.far),
    mediumChars: medium.length,
    mediumTokens: estimateTokens(medium || " "),
    globalChars: global.length,
    globalTokens: estimateTokens(global || " "),
    mediumGlobalLiteralDuplicateChars: measureMediumGlobalLiteralDuplicateChars(medium, global),
  };
}

export function expectedMovingDetailPresence(
  ringN: RingSize,
  role: MovingDetailRole
): boolean {
  switch (ringN) {
    case 5:
      return role === "near";
    case 10:
      return role === "near" || role === "mid";
    case 15:
      return true;
    default: {
      const _exhaustive: never = ringN;
      return _exhaustive;
    }
  }
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
  const history = buildMovingHorizonAuditHistory(currentTurn);
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
  ringN: RingSize,
  opts?: {
    rawChars?: number;
    episodicChars?: number;
    relationshipChars?: number;
    mediumActive?: boolean;
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
  const sim = simulateMovingHorizonCoverage(currentTurn, ringN, {
    mediumActive: opts?.mediumActive ?? true,
  });
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

export function globalMajorEventCoverage(globalText: string): {
  old: boolean;
  mid: boolean;
  recent: boolean;
} {
  return {
    old: globalText.includes(MOVING_MAJOR_MARKERS.old),
    mid: globalText.includes(MOVING_MAJOR_MARKERS.mid),
    recent: globalText.includes(MOVING_MAJOR_MARKERS.recent),
  };
}

export function countMediumRangesFromRingText(mediumText: string): MediumTermTurnRange[] {
  const ranges: MediumTermTurnRange[] = [];
  for (const block of mediumText.split(/\n\n+/).filter(Boolean)) {
    const match = block.match(/\[(\d+)~(\d+)턴\]/);
    if (!match) continue;
    ranges.push({ turnStart: Number(match[1]), turnEnd: Number(match[2]) });
  }
  return ranges;
}

export { MEMORY_CAPACITY_FIXED, RAW_HISTORY_COMPLETE_EXCHANGES, shouldInjectMediumTermMemory };
