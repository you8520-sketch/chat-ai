import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

export const TRPG_SNAPSHOT_DIAGNOSTICS_ENV = "TRPG_SNAPSHOT_DIAGNOSTICS";
export const TRPG_SNAPSHOT_SLOW_MS = 1000;

export type SnapshotProfileTimings = {
  requestId: string;
  campaignId: number;
  baseMs?: number;
  participantsMs?: number;
  sheetsMs?: number;
  currentRoundMs?: number;
  logMs?: number;
  contextsMs?: number;
  effectsMs?: number;
  safeRestMs?: number;
  totalSnapshotMs?: number;
  roundCount?: number;
};

export type AdvanceDiagState = {
  workTypeBefore?: string;
  phaseBefore?: string;
  botGenerationInFlight?: boolean;
  gmGenerationInFlight?: boolean;
};

export type SnapshotScaleCounts = {
  roundNumber: number;
  roundCount: number;
  participantCount: number;
  logActionCount: number;
  logRollCount: number;
  totalNarrations: number;
  estimatedTextChars: number;
};

type SnapshotLogLine = Record<string, unknown>;
type SnapshotLogFn = (line: SnapshotLogLine) => void;

let activeSnapshotRequests = 0;
let logFn: SnapshotLogFn = defaultSnapshotLog;

const snapshotProfileAls = new AsyncLocalStorage<SnapshotProfileTimings>();
const advanceAls = new AsyncLocalStorage<AdvanceDiagState>();

function defaultSnapshotLog(line: SnapshotLogLine): void {
  console.info(JSON.stringify(line));
}

export function isTrpgSnapshotDiagnosticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TRPG_SNAPSHOT_DIAGNOSTICS === "1";
}

export function newTrpgDiagRequestId(): string {
  return randomBytes(6).toString("hex");
}

export function roundDiagMs(ms: number): number {
  return Math.round(ms * 10) / 10;
}

export function getActiveSnapshotRequests(): number {
  return activeSnapshotRequests;
}

export function beginActiveSnapshotRequest(): number {
  activeSnapshotRequests += 1;
  return activeSnapshotRequests;
}

export function endActiveSnapshotRequest(): number {
  if (activeSnapshotRequests > 0) activeSnapshotRequests -= 1;
  return activeSnapshotRequests;
}

export function resetActiveSnapshotRequestsForTest(): void {
  activeSnapshotRequests = 0;
}

export function withActiveSnapshotRequest<T>(fn: () => T): T {
  beginActiveSnapshotRequest();
  try {
    return fn();
  } finally {
    endActiveSnapshotRequest();
  }
}

export function logTrpgSnapshotDiag(line: SnapshotLogLine): void {
  if (!isTrpgSnapshotDiagnosticsEnabled()) return;
  logFn(line);
}

export function setTrpgSnapshotDiagLogForTest(next: SnapshotLogFn): () => void {
  const prev = logFn;
  logFn = next;
  return () => {
    logFn = prev;
  };
}

export function readProcessMemoryMb(): { rssMb: number; heapUsedMb: number } {
  const mem = process.memoryUsage();
  return {
    rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
    heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
  };
}

export function getSnapshotProfile(): SnapshotProfileTimings | undefined {
  return snapshotProfileAls.getStore();
}

export function runWithSnapshotProfile<T>(profile: SnapshotProfileTimings, fn: () => T): T {
  return snapshotProfileAls.run(profile, fn);
}

export function timedSnapshotDiag<T>(
  key:
    | "baseMs"
    | "participantsMs"
    | "sheetsMs"
    | "currentRoundMs"
    | "logMs"
    | "contextsMs"
    | "effectsMs"
    | "safeRestMs",
  fn: () => T
): T {
  const profile = snapshotProfileAls.getStore();
  if (!profile) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    profile[key] = roundDiagMs(performance.now() - t0);
  }
}

export function createAdvanceDiagState(): AdvanceDiagState {
  return {};
}

export function getAdvanceDiagState(): AdvanceDiagState | undefined {
  return advanceAls.getStore();
}

export function runWithAdvanceDiag<T>(state: AdvanceDiagState | null, fn: () => T): T {
  if (!state) return fn();
  return advanceAls.run(state, fn);
}

export function noteAdvanceDiag(partial: Partial<AdvanceDiagState>): void {
  const state = advanceAls.getStore();
  if (!state) return;
  Object.assign(state, partial);
}

export function collectSnapshotScaleCounts(campaign: {
  round: { number: number };
  participants: unknown[];
  log: Array<{
    narration?: string | null;
    actions: Array<{ body?: string }>;
    rolls: unknown[];
  }>;
}): SnapshotScaleCounts {
  let logActionCount = 0;
  let logRollCount = 0;
  let totalNarrations = 0;
  let estimatedTextChars = 0;
  for (const row of campaign.log) {
    logActionCount += row.actions.length;
    logRollCount += row.rolls.length;
    if (row.narration) {
      totalNarrations += 1;
      estimatedTextChars += row.narration.length;
    }
    for (const action of row.actions) {
      estimatedTextChars += action.body?.length ?? 0;
    }
  }
  return {
    roundNumber: campaign.round.number,
    roundCount: campaign.log.length,
    participantCount: campaign.participants.length,
    logActionCount,
    logRollCount,
    totalNarrations,
    estimatedTextChars,
  };
}
