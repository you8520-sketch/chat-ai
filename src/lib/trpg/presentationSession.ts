import type { TrpgParticipantAdjudicationOutcome } from "./roundAdjudication";
import {
  isLiveRoundPresentationReady,
  resolveLiveRevealedActionIds,
  shouldShowGmNarration,
  type RoundPresentationMode,
  type RoundPresentationState,
} from "./roundPresentation";
import type { TrpgPublicAction, TrpgPublicLog, TrpgPublicRoll } from "./snapshot";

/** Client-owned cinematic session for one round. Survives server round rollover. */
export type LivePresentationSession = {
  roundNumber: number;
  expectedPresentationActorIds: number[];
  resolutionOrder: number[];
};

export type PresentationLogRowLike = Pick<
  TrpgPublicLog,
  "roundNumber" | "actions" | "rolls" | "narration"
>;

export function findPresentationLogRow(
  log: readonly PresentationLogRowLike[],
  roundNumber: number
): PresentationLogRowLike | null {
  return log.find((row) => row.roundNumber === roundNumber) ?? null;
}

/** True when the held cinematic for this round has fully finished (including GM reveal). */
export function isPresentationSessionReleased(opts: {
  roundShow: RoundPresentationState;
  gmRevealComplete: boolean;
}): boolean {
  if (opts.roundShow.mode !== "cinematic") return true;
  if (opts.roundShow.phase === "complete") return true;
  if (opts.roundShow.phase === "gm-narration" && opts.gmRevealComplete) return true;
  return false;
}

/** Monotonic tombstone: released rounds must never be inferred or latched again this mount. */
export function nextReleasedPresentationRoundWatermark(
  currentWatermark: number,
  releasedRound: number
): number {
  return Math.max(currentWatermark, releasedRound);
}

export function isPresentationRoundBlockedByRelease(
  roundNumber: number,
  releasedPresentationRoundWatermark: number
): boolean {
  return roundNumber > 0 && roundNumber <= releasedPresentationRoundWatermark;
}

export function createPresentationSession(opts: {
  roundNumber: number;
  expectedPresentationActorIds: readonly number[];
  resolutionOrder: readonly number[];
}): LivePresentationSession {
  return {
    roundNumber: opts.roundNumber,
    expectedPresentationActorIds: [...opts.expectedPresentationActorIds],
    resolutionOrder: [...opts.resolutionOrder],
  };
}

/** When server advanced mid-cinematic, infer the log row still being presented. */
export function inferHeldPresentationRoundFromLog(opts: {
  serverRoundNumber: number;
  serverPhase: string;
  log: readonly PresentationLogRowLike[];
  roundShow: RoundPresentationState;
  releasedPresentationRoundWatermark?: number;
}): number | null {
  if (opts.roundShow.mode !== "cinematic") return null;
  if (opts.serverRoundNumber <= 1) return null;
  if (opts.roundShow.presentationIndex === 0 && opts.roundShow.phase === "actor-action") {
    return null;
  }
  const previousRound = opts.serverRoundNumber - 1;
  if (
    isPresentationRoundBlockedByRelease(
      previousRound,
      opts.releasedPresentationRoundWatermark ?? 0
    )
  ) {
    return null;
  }
  const prevRow = findPresentationLogRow(opts.log, previousRound);
  if (!prevRow || filterRevealedActions(prevRow.actions).length === 0) return null;
  if (opts.serverPhase === "ACTION_INPUT" || opts.serverPhase === "BOT_ACTION") {
    return previousRound;
  }
  return null;
}

export function deriveExpectedPresentationActorIdsFromLogRow(
  row: PresentationLogRowLike | null,
  resolutionOrder: readonly number[]
): number[] {
  if (!row) return [];
  const actionIds = new Set(filterRevealedActions(row.actions).map((action) => action.participantId));
  if (resolutionOrder.length > 0) {
    const ordered = resolutionOrder.filter((id) => actionIds.has(id));
    if (ordered.length > 0) return ordered;
  }
  return filterRevealedActions(row.actions).map((action) => action.participantId);
}

export function deriveResolutionOrderFromLogRow(row: PresentationLogRowLike | null): number[] {
  if (!row) return [];
  const seen = new Set<number>();
  const order: number[] = [];
  for (const action of filterRevealedActions(row.actions)) {
    if (seen.has(action.participantId)) continue;
    seen.add(action.participantId);
    order.push(action.participantId);
  }
  for (const roll of row.rolls) {
    if (seen.has(roll.participantId)) continue;
    seen.add(roll.participantId);
    order.push(roll.participantId);
  }
  return order;
}

/**
 * Single client owner: which round's cinematic is currently active.
 * When latched or inferred, survives server advancing to the next round.
 */
export function resolvePresentationRoundNumber(opts: {
  serverRoundNumber: number;
  session: LivePresentationSession | null;
  roundShow: RoundPresentationState;
  inferredHeldRound?: number | null;
  releasedPresentationRoundWatermark?: number;
}): number {
  const watermark = opts.releasedPresentationRoundWatermark ?? 0;
  if (opts.session != null && opts.roundShow.mode === "cinematic") {
    if (isPresentationRoundBlockedByRelease(opts.session.roundNumber, watermark)) {
      return opts.serverRoundNumber;
    }
    return opts.session.roundNumber;
  }
  if (
    opts.roundShow.mode === "cinematic" &&
    opts.inferredHeldRound != null &&
    !isPresentationRoundBlockedByRelease(opts.inferredHeldRound, watermark)
  ) {
    return opts.inferredHeldRound;
  }
  return opts.serverRoundNumber;
}

/** True when a cinematic queue session may latch for the given round. */
export function shouldLatchPresentationRound(opts: {
  latchRound: number;
  releasedPresentationRoundWatermark: number;
  roundShow: RoundPresentationState;
  queueSessionKey: string;
  latchedPresentationSessionKey: string | null;
}): boolean {
  if (opts.roundShow.mode !== "cinematic" || !opts.queueSessionKey) return false;
  if (opts.latchedPresentationSessionKey === opts.queueSessionKey) return false;
  if (isPresentationRoundBlockedByRelease(opts.latchRound, opts.releasedPresentationRoundWatermark)) {
    return false;
  }
  return true;
}

export function filterRevealedActions(actions: readonly TrpgPublicAction[]): TrpgPublicAction[] {
  return actions.filter((action) => action.revealed && action.body.trim());
}

export function resolvePresentationSourceRolls(opts: {
  presentationRoundNumber: number;
  serverRoundNumber: number;
  presentationLogRow: PresentationLogRowLike | null;
  serverCurrentRolls: readonly TrpgPublicRoll[];
  dicePreviewRolls: readonly TrpgPublicRoll[];
}): TrpgPublicRoll[] {
  if (opts.presentationRoundNumber !== opts.serverRoundNumber) {
    return [...(opts.presentationLogRow?.rolls ?? [])];
  }
  if (opts.dicePreviewRolls.length > 0) return [...opts.dicePreviewRolls];
  if (opts.serverCurrentRolls.length > 0) return [...opts.serverCurrentRolls];
  return [...(opts.presentationLogRow?.rolls ?? [])];
}

export function deriveAdjudicatedParticipantIdsFromLogRow(
  row: PresentationLogRowLike | null
): number[] {
  if (!row) return [];
  return row.actions.filter((action) => action.revealed && action.body.trim()).map((action) => action.participantId);
}

export function deriveParticipantAdjudicationOutcomesFromLogRow(
  row: PresentationLogRowLike | null
): Map<number, TrpgParticipantAdjudicationOutcome> {
  const outcomes = new Map<number, TrpgParticipantAdjudicationOutcome>();
  if (!row) return outcomes;
  const rollIds = new Set(row.rolls.map((roll) => roll.participantId));
  for (const action of row.actions) {
    if (!action.revealed || !action.body.trim()) continue;
    // Public log rows expose rolls only; skipped and no_roll both appear roll-less.
    // Presentation treats both as non-dice paths — HELD_SKIPPED_COLLAPSE_SAFE.
    outcomes.set(action.participantId, rollIds.has(action.participantId) ? "roll" : "no_roll");
  }
  return outcomes;
}

export function resolvePresentationLiveReady(opts: {
  presentationRoundNumber: number;
  serverRoundNumber: number;
  serverPhase: string;
  sourceActions: readonly TrpgPublicAction[];
  sourceRolls: readonly TrpgPublicRoll[];
  resolutionOrder: readonly number[];
  adjudicatedParticipantIds: readonly number[];
}): boolean {
  const held = opts.presentationRoundNumber !== opts.serverRoundNumber;
  const phase = held ? "GENERATING_NARRATION" : opts.serverPhase;
  return isLiveRoundPresentationReady({
    phase,
    hasLockedActorSet: opts.sourceActions.length > 0 || opts.sourceRolls.length > 0,
    resolutionOrder: opts.resolutionOrder,
    adjudicatedParticipantIds: opts.adjudicatedParticipantIds,
  });
}

/** Presentation row is live cinematic — NOT merely the server's newest round. */
export function isPresentationLiveRow(opts: {
  rowRoundNumber: number;
  presentationRoundNumber: number;
  gateLiveRound: boolean;
}): boolean {
  return opts.rowRoundNumber === opts.presentationRoundNumber && opts.gateLiveRound;
}

export type PresentationSceneTurnLiveProps = {
  isLiveRow: boolean;
  revealedActorIds: number[] | undefined;
  resultLaneActorIds: number[] | undefined;
  showGmNarration: boolean | undefined;
  gmStreamDraft: string;
};

/**
 * Derive SceneTurn live visibility props.
 * Held presentation rows MUST receive explicit cinematic arrays — never undefined.
 */
export function derivePresentationSceneTurnLiveProps(opts: {
  rowRoundNumber: number;
  presentationRoundNumber: number;
  gateLiveRound: boolean;
  roundShow: RoundPresentationState;
  cinematicRevealedIds: readonly number[];
  cinematicLaneIds: readonly number[];
  cinematicShowGm: boolean;
  preCinematicVisibleIds: readonly number[];
  serverGmStreamDraft: string;
  presentationLogNarration: string | null;
}): PresentationSceneTurnLiveProps {
  const isLiveRow = isPresentationLiveRow({
    rowRoundNumber: opts.rowRoundNumber,
    presentationRoundNumber: opts.presentationRoundNumber,
    gateLiveRound: opts.gateLiveRound,
  });
  if (!isLiveRow) {
    return {
      isLiveRow: false,
      revealedActorIds: undefined,
      resultLaneActorIds: undefined,
      showGmNarration: undefined,
      gmStreamDraft: "",
    };
  }

  const revealedActorIds = resolveLiveRevealedActionIds({
    isLiveRow: true,
    mode: opts.roundShow.mode,
    cinematicRevealedIds: opts.cinematicRevealedIds,
    preCinematicVisibleIds: opts.preCinematicVisibleIds,
  });
  const resultLaneActorIds =
    opts.roundShow.mode === "cinematic" ? [...opts.cinematicLaneIds] : ([] as number[]);
  const showGmNarration =
    opts.roundShow.mode === "cinematic" ? opts.cinematicShowGm : false;

  const gmStreamDraft =
    opts.serverGmStreamDraft.trim().length > 0
      ? opts.serverGmStreamDraft
      : opts.presentationLogNarration?.trim() ?? "";

  return {
    isLiveRow: true,
    revealedActorIds,
    resultLaneActorIds,
    showGmNarration,
    gmStreamDraft,
  };
}

export function shouldShowNextActionInput(opts: {
  serverPhase: string;
  hasUnlockedDraft: boolean;
  session: LivePresentationSession | null;
  roundShow: RoundPresentationState;
  gmRevealComplete: boolean;
}): boolean {
  if (opts.serverPhase !== "ACTION_INPUT" || !opts.hasUnlockedDraft) return false;
  if (opts.session == null) return true;
  return isPresentationSessionReleased({
    roundShow: opts.roundShow,
    gmRevealComplete: opts.gmRevealComplete,
  });
}

/** Fresh mount while server already advanced: consume historical, do not bridge replay. */
export function shouldStartHistoricalOnMount(opts: {
  consumeOnMount: boolean;
  actorCount: number;
}): boolean {
  return opts.consumeOnMount && opts.actorCount > 0;
}

export function presentationSessionMetadata(opts: {
  session: LivePresentationSession | null;
  presentationRoundNumber: number;
  serverRoundNumber: number;
  serverExpectedPresentationActorIds: readonly number[];
  serverResolutionOrder: readonly number[];
}): {
  expectedPresentationActorIds: number[];
  resolutionOrder: number[];
} {
  const held = opts.session != null && opts.presentationRoundNumber !== opts.serverRoundNumber;
  if (held && opts.session) {
    return {
      expectedPresentationActorIds: opts.session.expectedPresentationActorIds,
      resolutionOrder: opts.session.resolutionOrder,
    };
  }
  return {
    expectedPresentationActorIds: [...opts.serverExpectedPresentationActorIds],
    resolutionOrder: [...opts.serverResolutionOrder],
  };
}

export function isActorProgressiveAtIndex(opts: {
  actorIndex: number;
  presentationIndex: number;
  phase: RoundPresentationState["phase"];
  mode: RoundPresentationMode;
  revealedActorIds: readonly number[];
  actorId: number;
}): {
  progressive: boolean;
  fullProseVisible: boolean;
  resultVisible: boolean;
} {
  const cinematic = opts.mode === "cinematic";
  const atSlot = opts.actorIndex === opts.presentationIndex;
  const revealed = opts.revealedActorIds.includes(opts.actorId);
  const fullProseVisible = cinematic && revealed && opts.phase !== "idle";
  const resultVisible =
    cinematic &&
    revealed &&
    (opts.phase === "actor-result" || opts.phase === "gm-narration" || opts.phase === "complete") &&
    atSlot === false
      ? revealed
      : cinematic && atSlot && opts.phase === "actor-result";
  const progressive = cinematic && atSlot && opts.phase === "actor-action" && !fullProseVisible;
  return { progressive, fullProseVisible, resultVisible };
}

export function gmVisibleFromRoundShow(roundShow: RoundPresentationState): boolean {
  return shouldShowGmNarration(roundShow);
}
