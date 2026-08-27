/** Pure helpers for ONE serialized TRPG snapshot observer + advance kick. */

export const TRPG_SNAPSHOT_POLL_MS = 1500;

export type SnapshotApplyDecision =
  | { apply: true }
  | { apply: false; reason: "cancelled" | "stale_seq" | "regressive" };

/** Observation apply gate — reject cancelled/stale seq and regressive snapshots. */
export function decideSnapshotApply(opts: {
  cancelled: boolean;
  responseSeq: number;
  appliedSeq: number;
  previous: { roundNumber: number; progress: number } | null;
  next: { roundNumber: number; progress: number };
}): SnapshotApplyDecision {
  if (opts.cancelled) return { apply: false, reason: "cancelled" };
  if (opts.responseSeq <= opts.appliedSeq) return { apply: false, reason: "stale_seq" };
  if (
    opts.previous &&
    opts.next.roundNumber === opts.previous.roundNumber &&
    opts.next.progress < opts.previous.progress
  ) {
    return { apply: false, reason: "regressive" };
  }
  if (opts.previous && opts.next.roundNumber < opts.previous.roundNumber) {
    return { apply: false, reason: "regressive" };
  }
  return { apply: true };
}

/**
 * Monotonic-ish progress within a round. Higher means more advanced live state.
 * Used only to reject stale command/observation regressions — not a second store.
 */
export function trpgSnapshotProgressScore(snap: {
  round: { number: number; phase: string };
  workType?: string | null;
  shouldKickAdvance?: boolean;
  currentRolls?: readonly unknown[] | null;
  gmNarrationDraft?: { text?: string } | null;
  log?: readonly {
    roundNumber: number;
    narration?: string | null;
    actions?: readonly { locked?: boolean; revealed?: boolean }[];
  }[];
}): number {
  const row = snap.log?.find((entry) => entry.roundNumber === snap.round.number);
  const actions = row?.actions ?? [];
  const locked = actions.filter((a) => a.locked).length;
  const revealed = actions.filter((a) => a.revealed).length;
  const rolls = snap.currentRolls?.length ?? 0;
  const draftLen = snap.gmNarrationDraft?.text?.trim().length ?? 0;
  const narrLen = row?.narration?.trim().length ?? 0;
  const phaseRank = phaseProgressRank(snap.round.phase);
  const workRank = workTypeProgressRank(snap.workType);
  return (
    phaseRank * 1_000_000 +
    workRank * 100_000 +
    locked * 1_000 +
    revealed * 100 +
    rolls * 10 +
    Math.min(draftLen, 50_000) +
    Math.min(narrLen, 50_000)
  );
}

function phaseProgressRank(phase: string): number {
  switch (phase) {
    case "NONE":
      return 0;
    case "ACTION_INPUT":
      return 1;
    case "BOT_ACTION":
      return 2;
    case "ROLLING":
      return 3;
    case "GENERATING_NARRATION":
      return 4;
    case "ROUND_COMPLETE":
      return 5;
    case "ERROR_RECOVERY":
      return 2;
    default:
      return 0;
  }
}

function workTypeProgressRank(workType: string | null | undefined): number {
  switch (workType) {
    case "wait_humans":
      return 1;
    case "generate_bots":
      return 2;
    case "acquire_gm_lock":
      return 3;
    case "generate_gm":
      return 4;
    case "idle":
      return 5;
    default:
      return 0;
  }
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
    roundNumber: number;
    progress: number;
    cancelled?: boolean;
  }>
): { appliedSeq: number; roundNumber: number; progress: number } | null {
  let state: { appliedSeq: number; roundNumber: number; progress: number } | null = null;
  for (const event of events) {
    const decision = decideSnapshotApply({
      cancelled: event.cancelled === true,
      responseSeq: event.seq,
      appliedSeq: state?.appliedSeq ?? 0,
      previous: state,
      next: { roundNumber: event.roundNumber, progress: event.progress },
    });
    if (!decision.apply) continue;
    state = {
      appliedSeq: event.seq,
      roundNumber: event.roundNumber,
      progress: event.progress,
    };
  }
  return state;
}
