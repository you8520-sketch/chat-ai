/** Pure helpers for ONE serialized TRPG snapshot observer + advance kick. */

import { TRPG_ROUND_PHASES, type TrpgRoundPhase } from "./types";

export const TRPG_SNAPSHOT_POLL_MS = 1500;

export type SnapshotApplyDecision =
  | { apply: true }
  | { apply: false; reason: "cancelled" | "stale_seq" | "regressive" };

/** Fingerprint used only to reject stale regressions — not a second store. */
export type SnapshotCompareState = {
  roundNumber: number;
  phase: string;
  lockedActions: number;
  rolls: number;
  narrationLen: number;
  draftLen: number;
};

/**
 * Authoritative live-round main path (ERROR_RECOVERY is a side path).
 * Order matches TRPG_ROUND_PHASES minus ERROR_RECOVERY.
 */
export const TRPG_SNAPSHOT_MAIN_PHASE_PATH: readonly TrpgRoundPhase[] = TRPG_ROUND_PHASES.filter(
  (phase) => phase !== "ERROR_RECOVERY"
);

function mainPhaseIndex(phase: string): number {
  return TRPG_SNAPSHOT_MAIN_PHASE_PATH.indexOf(phase as TrpgRoundPhase);
}

/**
 * Phase-graph regression predicate.
 * ERROR_RECOVERY and CAMPAIGN_COMPLETE are never rejected as "lower rank".
 */
export function isTrpgSnapshotPhaseRegression(prevPhase: string, nextPhase: string): boolean {
  if (prevPhase === nextPhase) return false;
  if (nextPhase === "ERROR_RECOVERY") return false;
  if (nextPhase === "CAMPAIGN_COMPLETE") return false;
  if (prevPhase === "ERROR_RECOVERY") return false;
  if (prevPhase === "CAMPAIGN_COMPLETE") return nextPhase !== "CAMPAIGN_COMPLETE";

  const prevIdx = mainPhaseIndex(prevPhase);
  const nextIdx = mainPhaseIndex(nextPhase);
  // Unknown / NONE: do not invent a rejection.
  if (prevIdx < 0 || nextIdx < 0) return false;
  return nextIdx < prevIdx;
}

/** Same-phase content regression — weaker locked/rolls/narration (draft may clear when narr arrives). */
export function isTrpgSnapshotContentRegression(
  previous: SnapshotCompareState,
  next: SnapshotCompareState
): boolean {
  if (next.lockedActions < previous.lockedActions) return true;
  if (next.rolls < previous.rolls) return true;
  if (next.narrationLen < previous.narrationLen) return true;
  if (next.narrationLen > previous.narrationLen) return false;
  if (next.draftLen < previous.draftLen) return true;
  return false;
}

export function isTrpgSnapshotRegressive(
  previous: SnapshotCompareState,
  next: SnapshotCompareState
): boolean {
  if (next.roundNumber < previous.roundNumber) return true;
  if (next.roundNumber > previous.roundNumber) return false;
  if (isTrpgSnapshotPhaseRegression(previous.phase, next.phase)) return true;
  if (previous.phase === next.phase) {
    return isTrpgSnapshotContentRegression(previous, next);
  }
  return false;
}

/** Observation apply gate — reject cancelled/stale seq and regressive snapshots. */
export function decideSnapshotApply(opts: {
  cancelled: boolean;
  responseSeq: number;
  appliedSeq: number;
  previous: SnapshotCompareState | null;
  next: SnapshotCompareState;
}): SnapshotApplyDecision {
  if (opts.cancelled) return { apply: false, reason: "cancelled" };
  if (opts.responseSeq <= opts.appliedSeq) return { apply: false, reason: "stale_seq" };
  if (opts.previous && isTrpgSnapshotRegressive(opts.previous, opts.next)) {
    return { apply: false, reason: "regressive" };
  }
  return { apply: true };
}

export function snapshotCompareState(snap: {
  round: { number: number; phase: string };
  currentRolls?: readonly unknown[] | null;
  gmNarrationDraft?: { text?: string } | null;
  log?: readonly {
    roundNumber: number;
    narration?: string | null;
    actions?: readonly { locked?: boolean; revealed?: boolean }[];
  }[];
}): SnapshotCompareState {
  const row = snap.log?.find((entry) => entry.roundNumber === snap.round.number);
  const actions = row?.actions ?? [];
  return {
    roundNumber: snap.round.number,
    phase: snap.round.phase,
    lockedActions: actions.filter((a) => a.locked).length,
    rolls: snap.currentRolls?.length ?? 0,
    narrationLen: row?.narration?.trim().length ?? 0,
    draftLen: snap.gmNarrationDraft?.text?.trim().length ?? 0,
  };
}

/** @deprecated Prefer snapshotCompareState + isTrpgSnapshotRegressive. */
export function trpgSnapshotProgressScore(snap: Parameters<typeof snapshotCompareState>[0]): number {
  const state = snapshotCompareState(snap);
  const phaseIdx = mainPhaseIndex(state.phase);
  return (
    Math.max(phaseIdx, 0) * 1_000_000 +
    state.lockedActions * 1_000 +
    state.rolls * 10 +
    Math.min(state.narrationLen, 50_000) +
    Math.min(state.draftLen, 50_000)
  );
}

/** At most one client advance kick may be in flight. */
export function shouldLaunchAdvanceKick(opts: {
  setup: boolean;
  shouldKickAdvance: boolean;
  advanceKickInFlight: boolean;
}): boolean {
  if (opts.setup) return false;
  if (!opts.shouldKickAdvance) return false;
  if (opts.advanceKickInFlight) return false;
  return true;
}

export type SnapshotObserverTickResult = {
  /** Schedule next observation after this delay. */
  scheduleNextMs: number;
  /** Whether an advance kick should be launched (not awaited). */
  launchAdvanceKick: boolean;
};

/**
 * After a settled observation GET (success or failure), decide scheduling.
 * Advance kick is never awaited by the observer.
 */
export function afterSnapshotObservationSettled(opts: {
  setup: boolean;
  shouldKickAdvance: boolean;
  advanceKickInFlight: boolean;
  pollMs?: number;
}): SnapshotObserverTickResult {
  return {
    scheduleNextMs: opts.pollMs ?? TRPG_SNAPSHOT_POLL_MS,
    launchAdvanceKick: shouldLaunchAdvanceKick({
      setup: opts.setup,
      shouldKickAdvance: opts.shouldKickAdvance,
      advanceKickInFlight: opts.advanceKickInFlight,
    }),
  };
}

/** Deterministic out-of-order apply simulator for regressions. */
export function foldSnapshotObservations(
  events: Array<{
    seq: number;
    state: SnapshotCompareState;
    cancelled?: boolean;
  }>
): { appliedSeq: number; state: SnapshotCompareState } | null {
  let folded: { appliedSeq: number; state: SnapshotCompareState } | null = null;
  for (const event of events) {
    const decision = decideSnapshotApply({
      cancelled: event.cancelled === true,
      responseSeq: event.seq,
      appliedSeq: folded?.appliedSeq ?? 0,
      previous: folded?.state ?? null,
      next: event.state,
    });
    if (!decision.apply) continue;
    // SYNC_COMPARISON_REF — accept immediately in the fold before the next event.
    folded = { appliedSeq: event.seq, state: event.state };
  }
  return folded;
}

export function allocateRequestSeq(current: number): { nextCurrent: number; seq: number } {
  const seq = current + 1;
  return { nextCurrent: seq, seq };
}
