import type { TrpgPublicAction, TrpgPublicRoll } from "./snapshot";
import {
  TRPG_EMERALD_WATCHDOG_MARGIN_MS,
  TRPG_ROLL_MAX_MS,
  trpgDiceRevealWatchdogMs,
  trpgDiceRollSessionKey,
  trpgResultConfirmPerDieMs,
} from "./diceRollUx";

export type RoundPresentationPhase =
  | "idle"
  | "actor-action"
  | "actor-dice"
  | "actor-result"
  | "gm-narration"
  | "complete";

export type RoundPresentationMode = "idle" | "historical" | "cinematic";

export type PresentationActor = {
  actorId: number;
  action: TrpgPublicAction | null;
  roll: TrpgPublicRoll | null;
};

export type RoundPresentationState = {
  mode: RoundPresentationMode;
  phase: RoundPresentationPhase;
  presentationIndex: number;
};

export const ROUND_ACTION_REVEAL_MS = 700;
export const ROUND_RESULT_HOLD_MS = 420;

export function uniqueResolutionOrder(order: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of order) {
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function buildRoundPresentationActors(opts: {
  resolutionOrder: readonly number[];
  actions: readonly TrpgPublicAction[];
  rolls: readonly TrpgPublicRoll[];
}): PresentationActor[] {
  const order = uniqueResolutionOrder(opts.resolutionOrder);
  const leftoverActorIds = new Set<number>();
  for (const action of opts.actions) leftoverActorIds.add(action.participantId);
  for (const roll of opts.rolls) leftoverActorIds.add(roll.participantId);
  for (const id of order) leftoverActorIds.delete(id);

  const actorIds = [...order, ...[...leftoverActorIds].sort((a, b) => a - b)];
  return actorIds
    .map((actorId) => ({
      actorId,
      action: opts.actions.find((action) => action.participantId === actorId) ?? null,
      roll: opts.rolls.find((roll) => roll.participantId === actorId) ?? null,
    }))
    .filter((actor) => actor.action != null || actor.roll != null);
}

export function decideRoundPresentationMode(opts: {
  consumeOnMount: boolean;
  actorCount: number;
}): RoundPresentationMode {
  if (opts.actorCount <= 0) return "idle";
  if (opts.consumeOnMount) return "historical";
  return "cinematic";
}

/**
 * Live cinematic may start only after persistRolls has committed.
 * That owner is the current-round phase, not incremental action count.
 * ACTION_INPUT / BOT_ACTION / LOCKING_ACTIONS still have a moving actor set
 * or an unfinished roll/no-roll pass.
 */
export const LIVE_ROUND_PRESENTATION_READY_PHASES = new Set<string>([
  "ROLLING",
  "GENERATING_NARRATION",
  "APPLYING_STATE",
  "ROUND_COMPLETE",
  "CAMPAIGN_COMPLETE",
  "ERROR_RECOVERY",
]);

/** Phases where persisted actions may display incrementally before roll-final cinematic. */
export const LIVE_ROUND_INCREMENTAL_ACTION_PHASES = new Set<string>([
  "BOT_ACTION",
  "LOCKING_ACTIONS",
  "ADJUDICATING",
]);

export function isIncrementalCanonicalActionPhase(phase: string): boolean {
  return LIVE_ROUND_INCREMENTAL_ACTION_PHASES.has(phase);
}

export function isLiveRoundPresentationReady(opts: {
  phase: string;
  hasLockedActorSet: boolean;
}): boolean {
  if (!opts.hasLockedActorSet) return false;
  return LIVE_ROUND_PRESENTATION_READY_PHASES.has(opts.phase);
}

export function incrementalCanonicalActionIds(
  actions: readonly { participantId: number }[],
  resolutionOrder: readonly number[]
): number[] {
  const persisted = new Set(actions.map((action) => action.participantId));
  return uniqueResolutionOrder(resolutionOrder).filter((id) => persisted.has(id));
}

/** SceneTurn reveal owner for the live row (undefined = all persisted actions). */
export function resolveLiveRevealedActionIds(opts: {
  isLiveRow: boolean;
  mode: RoundPresentationMode;
  cinematicRevealedIds: readonly number[];
  incrementalCanonicalVisible: boolean;
  pinnedVisibleActorIds: readonly number[];
}): number[] | undefined {
  if (!opts.isLiveRow) return undefined;
  if (opts.mode === "cinematic") return [...opts.cinematicRevealedIds];
  if (opts.incrementalCanonicalVisible) return undefined;
  if (opts.pinnedVisibleActorIds.length > 0) return [...opts.pinnedVisibleActorIds];
  return [];
}

export type SequentialActionRevealQueue = {
  /** Exactly one AI actor may own decorative action reveal, or null when idle/complete. */
  activeRevealActorId: number | null;
  /** Persisted AI actors waiting for prior reveal completion (resolution order). */
  queuedRevealActorIds: readonly number[];
};

type SequentialActionRevealInput = {
  resolutionOrder: readonly number[];
  actions: readonly TrpgPublicAction[];
  completedRevealActorIds: readonly number[];
  isFreshAiAction: (participantId: number) => boolean;
  skipDecorativeReveal: boolean;
};

function persistedRevealedActions(
  actions: readonly TrpgPublicAction[]
): Map<number, TrpgPublicAction> {
  const persisted = new Map<number, TrpgPublicAction>();
  for (const action of actions) {
    if (action.revealed && action.body.trim()) persisted.set(action.participantId, action);
  }
  return persisted;
}

/** #628 reveal owner extended across incremental BOT_ACTION — one progressive AI at a time. */
export function resolveSequentialActionRevealQueue(
  opts: SequentialActionRevealInput
): SequentialActionRevealQueue {
  const persisted = persistedRevealedActions(opts.actions);
  const completed = new Set(opts.completedRevealActorIds);
  const queued: number[] = [];
  let active: number | null = null;

  for (const id of uniqueResolutionOrder(opts.resolutionOrder)) {
    const action = persisted.get(id);
    if (!action || action.kind !== "ai_character") continue;
    if (!opts.isFreshAiAction(id)) continue;
    if (opts.skipDecorativeReveal) continue;
    if (completed.has(id)) continue;
    if (active == null) active = id;
    else queued.push(id);
  }

  return { activeRevealActorId: active, queuedRevealActorIds: queued };
}

export function isSequentialActionRevealPending(opts: SequentialActionRevealInput): boolean {
  return resolveSequentialActionRevealQueue(opts).activeRevealActorId != null;
}

/** Decorative streaming eligibility — separate from incremental canonical card visibility. */
export function shouldDecorativeRevealAction(opts: {
  kind: string;
  participantId: number;
  activeRevealActorId: number | null;
  isFresh: boolean;
  skipDecorativeReveal: boolean;
}): boolean {
  if (opts.kind !== "ai_character") return false;
  if (!opts.isFresh) return false;
  if (opts.skipDecorativeReveal) return false;
  return opts.activeRevealActorId === opts.participantId;
}

/** Fresh AI action mounted canonically but queued behind an earlier progressive reveal. */
export function shouldHoldDecorativeRevealAction(opts: {
  kind: string;
  participantId: number;
  activeRevealActorId: number | null;
  isFresh: boolean;
  skipDecorativeReveal: boolean;
}): boolean {
  if (opts.kind !== "ai_character") return false;
  if (!opts.isFresh) return false;
  if (opts.skipDecorativeReveal) return false;
  if (opts.activeRevealActorId == null) return false;
  return opts.participantId !== opts.activeRevealActorId;
}

/** Humans and already-consumed AI keys do not block cinematic actor-action advance. */
export function isActorActionRevealBeatSatisfied(opts: {
  actionKind: string | null | undefined;
  isFreshAiAction: boolean;
  alreadyCompleted: boolean;
  effectiveActorRevealComplete: boolean;
}): boolean {
  if (opts.actionKind === "human") return true;
  if (!opts.isFreshAiAction) return true;
  if (opts.alreadyCompleted) return true;
  return opts.effectiveActorRevealComplete;
}

export type LiveRoundWaitKind = "none" | "wait_humans" | "bots" | "rolls" | "gm" | "reroll";

export function liveRoundWaitKind(opts: {
  phase: string;
  workType: string;
  viewerLocked: boolean;
  narrationRerolling?: boolean;
  waitingOpening?: boolean;
}): LiveRoundWaitKind {
  if (opts.waitingOpening) return "none";
  if (opts.narrationRerolling) return "reroll";
  if (opts.workType === "wait_humans" && opts.viewerLocked) return "wait_humans";
  if (opts.workType === "generate_bots" || opts.phase === "BOT_ACTION") return "bots";
  if (
    opts.workType === "acquire_gm_lock" ||
    opts.phase === "LOCKING_ACTIONS" ||
    opts.phase === "ADJUDICATING" ||
    opts.phase === "ROLLING"
  ) {
    return "rolls";
  }
  if (opts.phase === "GENERATING_NARRATION") return "gm";
  return "none";
}

export function liveRoundWaitCopy(kind: LiveRoundWaitKind): string | null {
  switch (kind) {
    case "wait_humans":
      return "제출했습니다. 다른 플레이어를 기다립니다.";
    case "bots":
      return "행동 제출됨 · 동료 행동 결정 중…";
    case "rolls":
      return "라운드 판정 준비 중…";
    case "gm":
      return "GM이 장면을 쓰고 있습니다…";
    case "reroll":
      return "장면을 리롤하고 있습니다…";
    default:
      return null;
  }
}

export function startCinematicPresentation(): Pick<
  RoundPresentationState,
  "phase" | "presentationIndex"
> {
  return { phase: "actor-action", presentationIndex: 0 };
}

export function historicalPresentation(): RoundPresentationState {
  return { mode: "historical", phase: "complete", presentationIndex: 0 };
}

export function idlePresentation(): RoundPresentationState {
  return { mode: "idle", phase: "idle", presentationIndex: 0 };
}

export function revealedActorIds(opts: {
  actors: readonly PresentationActor[];
  state: RoundPresentationState;
  pinnedVisibleActorIds?: readonly number[];
}): number[] {
  if (opts.state.mode === "historical" || opts.state.phase === "gm-narration" || opts.state.phase === "complete") {
    return opts.actors.map((actor) => actor.actorId);
  }
  if (opts.state.mode !== "cinematic") return [];
  if (
    opts.state.phase !== "actor-action" &&
    opts.state.phase !== "actor-dice" &&
    opts.state.phase !== "actor-result"
  ) {
    return [];
  }
  const cinematicIds = opts.actors
    .slice(0, Math.min(opts.actors.length, opts.state.presentationIndex + 1))
    .map((actor) => actor.actorId);
  if (!opts.pinnedVisibleActorIds?.length) return cinematicIds;
  const allowed = new Set([...opts.pinnedVisibleActorIds, ...cinematicIds]);
  return opts.actors.filter((actor) => allowed.has(actor.actorId)).map((actor) => actor.actorId);
}

export function shouldShowActorResultLane(opts: {
  actorId: number;
  actors: readonly PresentationActor[];
  state: RoundPresentationState;
}): boolean {
  if (opts.state.mode === "historical") return true;
  const index = opts.actors.findIndex((actor) => actor.actorId === opts.actorId);
  if (index < 0) return false;
  if (index < opts.state.presentationIndex) return true;
  if (index > opts.state.presentationIndex) return false;
  const actor = opts.actors[index];
  if (!actor?.roll) return true;
  return (
    opts.state.phase === "actor-result" ||
    opts.state.phase === "gm-narration" ||
    opts.state.phase === "complete"
  );
}

export function resultLaneActorIds(opts: {
  actors: readonly PresentationActor[];
  state: RoundPresentationState;
}): number[] {
  return opts.actors
    .filter((actor) =>
      shouldShowActorResultLane({
        actorId: actor.actorId,
        actors: opts.actors,
        state: opts.state,
      })
    )
    .map((actor) => actor.actorId);
}

/** Compact d20/DC/outcome text uses the same reveal owner as the result lane. */
export function shouldShowCompactRoll(opts: {
  actorId: number;
  actors: readonly PresentationActor[];
  state: RoundPresentationState;
}): boolean {
  const actor = opts.actors.find((row) => row.actorId === opts.actorId);
  if (!actor?.roll) return false;
  return shouldShowActorResultLane(opts);
}

export function compactRollActorIds(opts: {
  actors: readonly PresentationActor[];
  state: RoundPresentationState;
}): number[] {
  return opts.actors
    .filter((actor) =>
      shouldShowCompactRoll({
        actorId: actor.actorId,
        actors: opts.actors,
        state: opts.state,
      })
    )
    .map((actor) => actor.actorId);
}

export function shouldShowActionJudgeBlock(opts: {
  kind: string;
  hasIntent: boolean;
  hasRoll: boolean;
  resultRevealed: boolean;
}): boolean {
  if (opts.hasIntent) return true;
  if (opts.hasRoll && opts.resultRevealed) return true;
  if (opts.kind === "ai_character" && !opts.hasRoll) return true;
  return false;
}

export function shouldShowGmNarration(state: RoundPresentationState): boolean {
  if (state.mode === "historical") return true;
  return state.phase === "gm-narration" || state.phase === "complete";
}

/**
 * First ready render is still mode=idle until the effect bootstraps cinematic.
 * Visibility must stay gated synchronously; do not wait for that effect.
 */
export function isLiveRoundPresentationStarting(opts: {
  liveReady: boolean;
  mode: RoundPresentationMode;
  queueSessionKey: string;
}): boolean {
  return opts.liveReady && opts.mode === "idle" && opts.queueSessionKey !== "";
}

/** Hide the live round until the client knows cinematic vs historical. */
export function shouldGateLiveRoundPresentation(opts: {
  mode: RoundPresentationMode;
  previewReady: boolean;
  livePending?: boolean;
  presentationStarting?: boolean;
}): boolean {
  if (opts.mode === "historical") return false;
  if (!opts.previewReady) return true;
  if (opts.mode === "cinematic") return true;
  if (opts.livePending === true) return true;
  return opts.presentationStarting === true;
}

export function shouldShowLiveRoundWaitCopy(opts: {
  waitKind: LiveRoundWaitKind;
  mode: RoundPresentationMode;
  presentationStarting: boolean;
}): boolean {
  if (opts.waitKind === "none") return false;
  if (opts.waitKind === "reroll") return true;
  if (opts.mode === "cinematic") return false;
  if (opts.presentationStarting) return false;
  return true;
}

export function liveRoundCanonicalVisibleCount(opts: {
  gated: boolean;
  mode: RoundPresentationMode;
  actions: readonly { participantId: number }[];
  revealedActorIds: readonly number[];
  incrementalCanonical?: boolean;
}): number {
  if (opts.incrementalCanonical) return opts.actions.length;
  if (!opts.gated) return opts.actions.length;
  if (opts.mode !== "cinematic") return 0;
  return selectVisibleActions(opts.actions, opts.revealedActorIds).length;
}

export function isRoundPresentationComplete(state: RoundPresentationState): boolean {
  return shouldShowGmNarration(state);
}

export function activePresentationRoll(opts: {
  actors: readonly PresentationActor[];
  state: RoundPresentationState;
}): TrpgPublicRoll | null {
  if (opts.state.mode !== "cinematic" || opts.state.phase !== "actor-dice") return null;
  return opts.actors[opts.state.presentationIndex]?.roll ?? null;
}

export function selectVisibleActions<T extends { participantId: number }>(
  actions: readonly T[],
  revealedIds: readonly number[]
): T[] {
  const allowed = new Set(revealedIds);
  const byId = new Map<number, T>();
  for (const action of actions) {
    if (!allowed.has(action.participantId) || byId.has(action.participantId)) continue;
    byId.set(action.participantId, action);
  }
  const ordered: T[] = [];
  for (const id of revealedIds) {
    const action = byId.get(id);
    if (action) ordered.push(action);
  }
  return ordered;
}

export function advanceAfterActorAction(opts: {
  actors: readonly PresentationActor[];
  presentationIndex: number;
}): Pick<RoundPresentationState, "phase" | "presentationIndex"> {
  const actor = opts.actors[opts.presentationIndex];
  if (actor?.roll) {
    return { phase: "actor-dice", presentationIndex: opts.presentationIndex };
  }
  return advanceToNextActor(opts.actors, opts.presentationIndex);
}

export function advanceAfterActorResult(opts: {
  actors: readonly PresentationActor[];
  presentationIndex: number;
}): Pick<RoundPresentationState, "phase" | "presentationIndex"> {
  return advanceToNextActor(opts.actors, opts.presentationIndex);
}

export function advanceAfterDiceDismiss(opts: {
  actors: readonly PresentationActor[];
  presentationIndex: number;
}): Pick<RoundPresentationState, "phase" | "presentationIndex"> {
  const actor = opts.actors[opts.presentationIndex];
  if (actor?.roll) {
    return { phase: "actor-result", presentationIndex: opts.presentationIndex };
  }
  return advanceToNextActor(opts.actors, opts.presentationIndex);
}

function advanceToNextActor(
  actors: readonly PresentationActor[],
  presentationIndex: number
): Pick<RoundPresentationState, "phase" | "presentationIndex"> {
  const next = presentationIndex + 1;
  if (next >= actors.length) {
    return { phase: "gm-narration", presentationIndex: Math.max(0, actors.length - 1) };
  }
  return { phase: "actor-action", presentationIndex: next };
}

export function actorOrderEqualsResolutionOrder(
  actors: readonly PresentationActor[],
  resolutionOrder: readonly number[]
): boolean {
  const expected = uniqueResolutionOrder(resolutionOrder);
  return actors.slice(0, expected.length).every((actor, index) => actor.actorId === expected[index]);
}

export function trpgRoundPresentationSessionKey(opts: {
  roundNumber: number;
  rolls: readonly { participantId: number; d20: number; dc: number; tier: string }[];
  actions: readonly { participantId: number }[];
  ready?: boolean;
}): string {
  if (opts.ready === false) return "";
  const rollKey = trpgDiceRollSessionKey(opts.roundNumber, opts.rolls);
  if (rollKey) return rollKey;
  const actionIds = [...new Set(opts.actions.map((action) => action.participantId))]
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((a, b) => a - b);
  if (actionIds.length === 0) return "";
  return `${opts.roundNumber}|actions:${actionIds.join(",")}`;
}

export function freezeLivePresentationActors(opts: {
  previous: readonly PresentationActor[] | null;
  next: readonly PresentationActor[];
  ready: boolean;
  roundNumber: number;
  frozenRound: number | null;
}): { actors: PresentationActor[]; frozenRound: number | null } {
  if (!opts.ready) return { actors: [...opts.next], frozenRound: null };
  if (opts.previous && opts.frozenRound === opts.roundNumber && opts.previous.length > 0) {
    const merged = opts.previous.map((actor) => {
      const fresh = opts.next.find((item) => item.actorId === actor.actorId);
      return fresh
        ? {
            actorId: actor.actorId,
            action: fresh.action ?? actor.action,
            roll: fresh.roll ?? actor.roll,
          }
        : actor;
    });
    for (const actor of opts.next) {
      if (!merged.some((item) => item.actorId === actor.actorId)) {
        merged.push(actor);
      }
    }
    return {
      actors: merged,
      frozenRound: opts.roundNumber,
    };
  }
  return { actors: [...opts.next], frozenRound: opts.roundNumber };
}

export type LiveRoundSnapshotInput = {
  phase: string;
  roundNumber: number;
  actions: readonly TrpgPublicAction[];
  rolls: readonly TrpgPublicRoll[];
  resolutionOrder: readonly number[];
  consumeOnMount?: boolean;
};

export type LiveRoundPresentationStep = {
  ready: boolean;
  sessionKey: string;
  mode: RoundPresentationMode;
  visibleCanonicalActionIds: number[];
  incrementalVisibleActionIds: number[];
  started: boolean;
  restarted: boolean;
  actors: PresentationActor[];
};

export function decideLiveRoundPresentation(input: LiveRoundSnapshotInput): {
  ready: boolean;
  sessionKey: string;
  actorCount: number;
  actors: PresentationActor[];
} {
  const actions = input.actions.filter((action) => action.revealed && action.body.trim());
  const actors = buildRoundPresentationActors({
    resolutionOrder: input.resolutionOrder,
    actions,
    rolls: input.rolls,
  });
  const ready = isLiveRoundPresentationReady({
    phase: input.phase,
    hasLockedActorSet: actions.length > 0 || input.rolls.length > 0,
  });
  return {
    ready,
    sessionKey: trpgRoundPresentationSessionKey({
      roundNumber: input.roundNumber,
      rolls: input.rolls,
      actions,
      ready,
    }),
    actorCount: ready ? actors.length : 0,
    actors,
  };
}

export function walkLiveRoundSnapshots(snaps: readonly LiveRoundSnapshotInput[]): {
  steps: LiveRoundPresentationStep[];
  startCount: number;
  restartCount: number;
} {
  let prevKey = "";
  let prevMode: RoundPresentationMode = "idle";
  let frozen: PresentationActor[] | null = null;
  let frozenRound: number | null = null;
  let startCount = 0;
  let restartCount = 0;
  const steps = snaps.map((snap) => {
    const decided = decideLiveRoundPresentation(snap);
    const frozenNext = freezeLivePresentationActors({
      previous: frozen,
      next: decided.actors,
      ready: decided.ready,
      roundNumber: snap.roundNumber,
      frozenRound,
    });
    frozen = frozenNext.actors;
    frozenRound = frozenNext.frozenRound;
    const mode = decideRoundPresentationMode({
      consumeOnMount: snap.consumeOnMount === true,
      actorCount: decided.actorCount,
    });
    const started = mode === "cinematic" && prevMode !== "cinematic";
    const restarted =
      mode === "cinematic" &&
      prevMode === "cinematic" &&
      decided.sessionKey !== "" &&
      decided.sessionKey !== prevKey;
    if (started) startCount += 1;
    if (restarted) restartCount += 1;
    const state: RoundPresentationState =
      mode === "cinematic"
        ? { mode, ...startCinematicPresentation() }
        : mode === "historical"
          ? historicalPresentation()
          : idlePresentation();
    const visibleCanonicalActionIds =
      mode === "idle"
        ? []
        : revealedActorIds({ actors: frozenNext.actors, state });
    const actions = snap.actions.filter((action) => action.revealed && action.body.trim());
    const incrementalVisibleActionIds =
      !decided.ready && isIncrementalCanonicalActionPhase(snap.phase)
        ? incrementalCanonicalActionIds(actions, snap.resolutionOrder)
        : [];
    prevKey = decided.sessionKey;
    prevMode = mode;
    return {
      ready: decided.ready,
      sessionKey: decided.sessionKey,
      mode,
      visibleCanonicalActionIds,
      incrementalVisibleActionIds,
      started,
      restarted,
      actors: frozenNext.actors,
    };
  });
  return { steps, startCount, restartCount };
}

export function trpgRoundPresentationWatchdogMs(opts: {
  actorCount: number;
  rollCount: number;
}): number {
  const actors = Math.max(0, Math.floor(opts.actorCount));
  const rolls = Math.max(0, Math.floor(opts.rollCount));
  const sequential =
    actors * ROUND_ACTION_REVEAL_MS +
    rolls * (TRPG_ROLL_MAX_MS + trpgResultConfirmPerDieMs(1) + ROUND_RESULT_HOLD_MS) +
    TRPG_EMERALD_WATCHDOG_MARGIN_MS;
  return Math.max(trpgDiceRevealWatchdogMs(rolls), sequential, 10_000);
}

export type RoundPresentationFrame = {
  phase: RoundPresentationPhase;
  presentationIndex: number;
  revealedActorIds: number[];
  resultLaneActorIds: number[];
  compactRollActorIds: number[];
  gmVisible: boolean;
  activeRollActorId: number | null;
};

export function walkCinematicPresentation(actors: readonly PresentationActor[]): RoundPresentationFrame[] {
  let state: RoundPresentationState = {
    mode: "cinematic",
    ...startCinematicPresentation(),
  };
  const frames: RoundPresentationFrame[] = [snapshotFrame(actors, state)];
  let guard = 0;
  while (state.phase !== "gm-narration" && state.phase !== "complete" && guard < 64) {
    if (state.phase === "actor-action") {
      state = { ...state, ...advanceAfterActorAction({ actors, presentationIndex: state.presentationIndex }) };
    } else if (state.phase === "actor-dice") {
      state = { ...state, ...advanceAfterDiceDismiss({ actors, presentationIndex: state.presentationIndex }) };
    } else if (state.phase === "actor-result") {
      state = { ...state, ...advanceAfterActorResult({ actors, presentationIndex: state.presentationIndex }) };
    } else {
      break;
    }
    frames.push(snapshotFrame(actors, state));
    guard += 1;
  }
  return frames;
}

function snapshotFrame(
  actors: readonly PresentationActor[],
  state: RoundPresentationState
): RoundPresentationFrame {
  return {
    phase: state.phase,
    presentationIndex: state.presentationIndex,
    revealedActorIds: revealedActorIds({ actors, state }),
    resultLaneActorIds: resultLaneActorIds({ actors, state }),
    compactRollActorIds: compactRollActorIds({ actors, state }),
    gmVisible: shouldShowGmNarration(state),
    activeRollActorId: activePresentationRoll({ actors, state })?.participantId ?? null,
  };
}
