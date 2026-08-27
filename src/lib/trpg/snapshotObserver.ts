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
  processStage: string | null;
  narrationRerolling: boolean;
  /** Revealed non-empty action participant IDs (public TrpgPublicAction shape). */
  revealedActionIds: number[];
  rolls: number;
  draftLen: number;
  narrationLen: number;
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

/** Authoritative server reroll signal (tryBeginNarrationReroll sets process_stage='reroll'). */
export function isLegitNarrationRerollSignal(state: {
  processStage: string | null;
  narrationRerolling: boolean;
}): boolean {
  return state.processStage === "reroll" || state.narrationRerolling === true;
}

/**
 * Phase-graph regression predicate.
 * ERROR_RECOVERY / CAMPAIGN_COMPLETE are never rejected as "lower rank".
 * ROUND_COMPLETE → GENERATING_NARRATION is accepted only with legitimate reroll signal.
 */
export function isTrpgSnapshotPhaseRegression(
  previous: SnapshotCompareState,
  next: SnapshotCompareState
): boolean {
  if (previous.phase === next.phase) return false;
  if (next.phase === "ERROR_RECOVERY") return false;
  if (next.phase === "CAMPAIGN_COMPLETE") return false;
  if (previous.phase === "ERROR_RECOVERY") return false;
  if (previous.phase === "CAMPAIGN_COMPLETE") return next.phase !== "CAMPAIGN_COMPLETE";

  if (
    previous.phase === "ROUND_COMPLETE" &&
    next.phase === "GENERATING_NARRATION" &&
    isLegitNarrationRerollSignal(next)
  ) {
    return false;
  }

  const prevIdx = mainPhaseIndex(previous.phase);
  const nextIdx = mainPhaseIndex(next.phase);
  if (prevIdx < 0 || nextIdx < 0) return false;
  return nextIdx < prevIdx;
}

/** Revealed action set inclusion — missing prior participant IDs is regression. */
export function isTrpgRevealedActionSetRegression(
  previousIds: readonly number[],
  nextIds: readonly number[]
): boolean {
  if (previousIds.length === 0) return false;
  const nextSet = new Set(nextIds);
  return previousIds.some((id) => !nextSet.has(id));
}

export function revealedActionIdsFromPublicActions(
  actions: readonly { participantId: number; revealed?: boolean; body?: string }[] | undefined
): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const action of actions ?? []) {
    if (!action.revealed) continue;
    if (!action.body?.trim()) continue;
    if (seen.has(action.participantId)) continue;
    seen.add(action.participantId);
    ids.push(action.participantId);
  }
  ids.sort((a, b) => a - b);
  return ids;
}

/**
 * Same-phase content regression — phase-aware.
 * ROUND_COMPLETE canonical narration length is NOT a generation/version owner.
 */
export function isTrpgSnapshotContentRegression(
  previous: SnapshotCompareState,
  next: SnapshotCompareState
): boolean {
  if (isTrpgRevealedActionSetRegression(previous.revealedActionIds, next.revealedActionIds)) {
    return true;
  }
  if (next.rolls < previous.rolls) return true;

  // Append-only draft growth only while staying in GENERATING_NARRATION.
  if (
    previous.phase === "GENERATING_NARRATION" &&
    next.phase === "GENERATING_NARRATION" &&
    next.draftLen < previous.draftLen
  ) {
    return true;
  }

  // Narration length is replaceable under reroll — never a version owner at ROUND_COMPLETE.
  return false;
}

export function isTrpgSnapshotRegressive(
  previous: SnapshotCompareState,
  next: SnapshotCompareState
): boolean {
  if (next.roundNumber < previous.roundNumber) return true;
  if (next.roundNumber > previous.roundNumber) return false;
  if (isTrpgSnapshotPhaseRegression(previous, next)) return true;
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
  processStage?: string | null;
  narrationRerolling?: boolean;
  currentRolls?: readonly unknown[] | null;
  gmNarrationDraft?: { text?: string } | null;
  log?: readonly {
    roundNumber: number;
    narration?: string | null;
    actions?: readonly {
      participantId: number;
      name?: string;
      body?: string;
      revealed?: boolean;
      kind?: string;
      actionType?: string | null;
    }[];
  }[];
}): SnapshotCompareState {
  const row = snap.log?.find((entry) => entry.roundNumber === snap.round.number);
  return {
    roundNumber: snap.round.number,
    phase: snap.round.phase,
    processStage: snap.processStage ?? null,
    narrationRerolling: snap.narrationRerolling === true,
    revealedActionIds: revealedActionIdsFromPublicActions(row?.actions),
    rolls: snap.currentRolls?.length ?? 0,
    draftLen: snap.gmNarrationDraft?.text?.trim().length ?? 0,
    narrationLen: row?.narration?.trim().length ?? 0,
  };
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
