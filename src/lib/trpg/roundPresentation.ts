import type { TrpgPublicAction, TrpgPublicRoll } from "./snapshot";
import type { TrpgParticipantAdjudicationOutcome } from "./roundAdjudication";
import {
  TRPG_EMERALD_WATCHDOG_MARGIN_MS,
  TRPG_ROLL_MAX_MS,
  shouldAdvanceActorDiceAfterOverlayDismiss,
  trpgDiceRevealWatchdogMs,
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

export function isLiveRoundPresentationReady(opts: {
  phase: string;
  hasLockedActorSet: boolean;
  resolutionOrder?: readonly number[];
  adjudicatedParticipantIds?: readonly number[];
}): boolean {
  if (!opts.hasLockedActorSet) return false;
  const order = uniqueResolutionOrder(opts.resolutionOrder ?? []);
  const adjudicated = new Set(opts.adjudicatedParticipantIds ?? []);
  if (order.length > 0 && adjudicated.size > 0) {
    const firstId = order[0];
    if (firstId != null && adjudicated.has(firstId)) {
      return true;
    }
  }
  return LIVE_ROUND_PRESENTATION_READY_PHASES.has(opts.phase);
}

/** Whether an actor has server adjudication complete (roll, no-roll, or skipped). */
export function isActorAdjudicationReady(
  actorId: number,
  adjudicatedParticipantIds: ReadonlySet<number>
): boolean {
  return adjudicatedParticipantIds.has(actorId);
}

/** AI actors require declaration reveal consumption before dice/result presentation. */
export function isActorDeclarationReady(opts: {
  actor: PresentationActor;
  declarationConsumedIds: ReadonlySet<number>;
}): boolean {
  if (!opts.actor.action) return false;
  if (opts.actor.action.kind === "human") return true;
  return opts.declarationConsumedIds.has(opts.actor.actorId);
}

export function isActorPresentationReady(opts: {
  actor: PresentationActor | null | undefined;
  adjudicatedParticipantIds: ReadonlySet<number>;
  declarationConsumedIds: ReadonlySet<number>;
}): boolean {
  if (!opts.actor?.action) return false;
  if (!isActorDeclarationReady({ actor: opts.actor, declarationConsumedIds: opts.declarationConsumedIds })) {
    return false;
  }
  return isActorAdjudicationReady(opts.actor.actorId, opts.adjudicatedParticipantIds);
}

/** Next actor index in resolution order, or null if the immediate successor is not yet ready. */
export function nextReadyPresentationIndex(opts: {
  actors: readonly PresentationActor[];
  fromIndex: number;
  adjudicatedParticipantIds: ReadonlySet<number>;
  declarationConsumedIds: ReadonlySet<number>;
}): number | null {
  const next = opts.fromIndex + 1;
  if (next >= opts.actors.length) return null;
  const actor = opts.actors[next];
  if (!isActorPresentationReady({
    actor,
    adjudicatedParticipantIds: opts.adjudicatedParticipantIds,
    declarationConsumedIds: opts.declarationConsumedIds,
  })) {
    return null;
  }
  return next;
}

/** Derived early-visibility ids — human declarations only before cinematic starts. */
export function earlyVisibleHumanActionIds(
  actions: readonly { participantId: number; kind: string; revealed?: boolean; body?: string }[]
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const action of actions) {
    if (action.kind !== "human") continue;
    if (action.revealed === false) continue;
    if (typeof action.body === "string" && !action.body.trim()) continue;
    if (seen.has(action.participantId)) continue;
    seen.add(action.participantId);
    out.push(action.participantId);
  }
  return out;
}

export type LiveActorDeclarationPresentation = {
  visibleActionIds: number[];
  activeDeclarationActorId: number | null;
  currentActorDeclarationComplete: boolean;
};

/**
 * Single live declaration presentation owner.
 * Pre-cinematic: human early visibility only — AI actions stay buffered.
 * Cinematic: only presentationActors[presentationIndex] may progressively reveal.
 */
export function resolveLiveActorDeclarationPresentation(opts: {
  mode: RoundPresentationMode;
  phase: RoundPresentationPhase;
  presentationIndex: number;
  presentationActors: readonly PresentationActor[];
  actions: readonly { participantId: number; kind: string; revealed?: boolean; body?: string }[];
  consumedAiIds: ReadonlySet<number>;
}): LiveActorDeclarationPresentation {
  const earlyHumanIds = earlyVisibleHumanActionIds(opts.actions);
  const visibleActionIds: number[] = [];
  const seen = new Set<number>();

  const pushVisible = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    visibleActionIds.push(id);
  };

  for (const id of earlyHumanIds) pushVisible(id);

  if (opts.mode !== "cinematic") {
    for (const action of opts.actions) {
      if (action.kind === "ai_character" && opts.consumedAiIds.has(action.participantId)) {
        pushVisible(action.participantId);
      }
    }
    return {
      visibleActionIds,
      activeDeclarationActorId: null,
      currentActorDeclarationComplete: true,
    };
  }

  for (let i = 0; i < opts.presentationIndex; i++) {
    const actor = opts.presentationActors[i];
    if (actor?.action) pushVisible(actor.actorId);
  }
  for (const id of opts.consumedAiIds) pushVisible(id);

  const currentActor = opts.presentationActors[opts.presentationIndex];
  const currentActorId = currentActor?.actorId ?? null;

  if (opts.phase === "actor-action" && currentActor?.action?.kind === "ai_character") {
    pushVisible(currentActor.actorId);
    if (opts.consumedAiIds.has(currentActor.actorId)) {
      return {
        visibleActionIds,
        activeDeclarationActorId: null,
        currentActorDeclarationComplete: true,
      };
    }
    return {
      visibleActionIds,
      activeDeclarationActorId: currentActor.actorId,
      currentActorDeclarationComplete: false,
    };
  }

  if (currentActor?.action) {
    pushVisible(currentActor.actorId);
  }

  return {
    visibleActionIds,
    activeDeclarationActorId: null,
    currentActorDeclarationComplete: true,
  };
}

/**
 * Single live SceneTurn action-id owner.
 * Historical: undefined = all persisted.
 * Live / not cinematic: early human visibility (+ consumed AI on idle remount).
 * Live / cinematic: declaration-visible ids ∪ actors released by roundShow.
 */
export function resolveLiveRevealedActionIds(opts: {
  isLiveRow: boolean;
  mode: RoundPresentationMode;
  cinematicRevealedIds: readonly number[];
  preCinematicVisibleIds: readonly number[];
}): number[] | undefined {
  if (!opts.isLiveRow) return undefined;
  if (opts.mode === "historical") return undefined;
  const declared = [...opts.preCinematicVisibleIds];
  if (opts.mode !== "cinematic") return declared;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of declared) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of opts.cinematicRevealedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Decorative streaming during cinematic actor-action for the current AI declaration slot. */
export function shouldDecorativeRevealAction(opts: {
  kind: string;
  participantId: number;
  /** Fallback presentation-actor match when declarationRevealActive is unset (tests/legacy). */
  activeRevealActorId: number | null;
  isFresh: boolean;
  skipDecorativeReveal: boolean;
  /** Must be true during cinematic actor-action phase. */
  cinematicActorAction?: boolean;
  /** Current live declaration slot from resolveLiveActorDeclarationPresentation. */
  declarationRevealActive?: boolean;
  /** Declaration already consumed — do not replay decorative streaming. */
  resolutionActionAlreadyConsumed?: boolean;
}): boolean {
  if (opts.kind !== "ai_character") return false;
  if (!opts.isFresh) return false;
  if (opts.skipDecorativeReveal) return false;
  if (opts.declarationRevealActive === true) return true;
  if (opts.resolutionActionAlreadyConsumed === true) return false;
  if (opts.cinematicActorAction === false) return false;
  return opts.activeRevealActorId === opts.participantId;
}

/** Humans and already-consumed AI keys do not block cinematic actor-action advance. */
export function isActorActionRevealBeatSatisfied(opts: {
  actionKind: string | null | undefined;
  isFreshAiAction: boolean;
  alreadyCompleted: boolean;
  effectiveActorRevealComplete: boolean;
  skipDecorativeReveal?: boolean;
  /** AI action prose completed its one declaration reveal before resolution. */
  resolutionActionAlreadyConsumed?: boolean;
}): boolean {
  if (opts.actionKind === "human") return true;
  if (opts.resolutionActionAlreadyConsumed === true) return true;
  if (!opts.isFreshAiAction) return true;
  if (opts.alreadyCompleted) return true;
  if (opts.skipDecorativeReveal) return true;
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
  return opts.actors
    .slice(0, Math.min(opts.actors.length, opts.state.presentationIndex + 1))
    .map((actor) => actor.actorId);
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
  if (!actor?.roll) {
    return (
      opts.state.phase === "gm-narration" ||
      opts.state.phase === "complete"
    );
  }
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
  if (!opts.resultRevealed) return false;
  if (opts.hasIntent) return true;
  if (opts.hasRoll) return true;
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
  if (opts.waitKind === "wait_humans" || opts.waitKind === "reroll") return true;
  return false;
}

export function liveRoundCanonicalVisibleCount(opts: {
  gated: boolean;
  mode: RoundPresentationMode;
  actions: readonly { participantId: number; kind?: string; revealed?: boolean; body?: string }[];
  revealedActorIds: readonly number[];
  preCinematicVisibleIds?: readonly number[];
}): number {
  if (!opts.gated) return opts.actions.length;
  if (opts.mode === "cinematic") {
    const ids = [...(opts.preCinematicVisibleIds ?? []), ...opts.revealedActorIds];
    return selectVisibleActions(opts.actions, ids).length;
  }
  if (opts.preCinematicVisibleIds) return opts.preCinematicVisibleIds.length;
  return earlyVisibleHumanActionIds(
    opts.actions.map((action) => ({
      participantId: action.participantId,
      kind: action.kind ?? "human",
      revealed: action.revealed,
      body: action.body,
    }))
  ).length;
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

export type ActivePresentationRollProgress = {
  rollOrdinal: number;
  rollTotal: number;
};

/**
 * Roll progress follows the round presentation actor order (resolutionOrder),
 * counting only actors with authoritative rolls.
 */
export function activePresentationRollProgress(opts: {
  actors: readonly PresentationActor[];
  state: RoundPresentationState;
}): ActivePresentationRollProgress | null {
  if (opts.state.mode !== "cinematic" || opts.state.phase !== "actor-dice") return null;
  const active = opts.actors[opts.state.presentationIndex];
  if (!active?.roll) return null;
  const rollActors = opts.actors.filter((actor) => actor.roll != null);
  const rollIndex = rollActors.findIndex((actor) => actor.actorId === active.actorId);
  if (rollIndex < 0) return null;
  return {
    rollOrdinal: rollIndex + 1,
    rollTotal: rollActors.length,
  };
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

export function actorExpectsPresentationRoll(
  actorId: number,
  rolls: readonly { participantId: number }[]
): boolean {
  return rolls.some((roll) => roll.participantId === actorId);
}

export function resolveParticipantAdjudicationOutcome(
  actorId: number,
  outcomes?: ReadonlyMap<number, TrpgParticipantAdjudicationOutcome> | Readonly<Record<number, TrpgParticipantAdjudicationOutcome>>
): TrpgParticipantAdjudicationOutcome | undefined {
  if (!outcomes) return undefined;
  if (outcomes instanceof Map) return outcomes.get(actorId);
  return Object.prototype.hasOwnProperty.call(outcomes, actorId)
    ? outcomes[actorId as keyof typeof outcomes]
    : undefined;
}

function actorAwaitingAuthoritativeRoll(
  actorId: number,
  actorRoll: TrpgPublicRoll | null,
  rolls: readonly { participantId: number }[],
  outcomes?: ReadonlyMap<number, TrpgParticipantAdjudicationOutcome>
): boolean {
  const outcome = resolveParticipantAdjudicationOutcome(actorId, outcomes);
  if (outcome === "roll") return actorRoll == null;
  if (outcome === "no_roll" || outcome === "skipped") return false;
  if (outcomes) return true;
  return actorRoll == null && actorExpectsPresentationRoll(actorId, rolls);
}

function actorPresentationRequiresDice(
  actorId: number,
  actorRoll: TrpgPublicRoll | null,
  outcomes?: ReadonlyMap<number, TrpgParticipantAdjudicationOutcome>
): boolean {
  const outcome = resolveParticipantAdjudicationOutcome(actorId, outcomes);
  if (outcome === "roll") return actorRoll != null;
  if (outcome === "no_roll" || outcome === "skipped") return false;
  if (outcomes) return false;
  return actorRoll != null;
}

function actorConfirmedWithoutDice(
  actorId: number,
  outcomes?: ReadonlyMap<number, TrpgParticipantAdjudicationOutcome>
): boolean {
  const outcome = resolveParticipantAdjudicationOutcome(actorId, outcomes);
  return outcome === "no_roll" || outcome === "skipped";
}

export function advanceAfterActorAction(opts: {
  actors: readonly PresentationActor[];
  presentationIndex: number;
  rolls?: readonly { participantId: number }[];
  adjudicatedParticipantIds?: ReadonlySet<number>;
  declarationConsumedIds?: ReadonlySet<number>;
  participantAdjudicationOutcomes?: ReadonlyMap<number, TrpgParticipantAdjudicationOutcome>;
  awaitingMoreActors?: boolean;
}): Pick<RoundPresentationState, "phase" | "presentationIndex"> {
  const actor = opts.actors[opts.presentationIndex];
  const rolls = opts.rolls ?? [];
  const outcomes = opts.participantAdjudicationOutcomes;
  const gatesProvided =
    opts.adjudicatedParticipantIds != null && opts.declarationConsumedIds != null;
  if (gatesProvided) {
    if (!actor?.action) {
      return { phase: "actor-action", presentationIndex: opts.presentationIndex };
    }
    if (
      !isActorPresentationReady({
        actor,
        adjudicatedParticipantIds: opts.adjudicatedParticipantIds!,
        declarationConsumedIds: opts.declarationConsumedIds!,
      })
    ) {
      return { phase: "actor-action", presentationIndex: opts.presentationIndex };
    }
    if (actorConfirmedWithoutDice(actor.actorId, outcomes)) {
      return advanceToNextActor(opts.actors, opts.presentationIndex, {
        adjudicatedParticipantIds: opts.adjudicatedParticipantIds,
        declarationConsumedIds: opts.declarationConsumedIds,
        awaitingMoreActors: opts.awaitingMoreActors,
        participantAdjudicationOutcomes: outcomes,
      });
    }
    if (actorPresentationRequiresDice(actor.actorId, actor.roll, outcomes)) {
      return { phase: "actor-dice", presentationIndex: opts.presentationIndex };
    }
    if (actorAwaitingAuthoritativeRoll(actor.actorId, actor.roll, rolls, outcomes)) {
      return { phase: "actor-action", presentationIndex: opts.presentationIndex };
    }
    if (outcomes) {
      return { phase: "actor-action", presentationIndex: opts.presentationIndex };
    }
    if (actorExpectsPresentationRoll(actor.actorId, rolls)) {
      return { phase: "actor-action", presentationIndex: opts.presentationIndex };
    }
    return advanceToNextActor(opts.actors, opts.presentationIndex, {
      adjudicatedParticipantIds: opts.adjudicatedParticipantIds,
      declarationConsumedIds: opts.declarationConsumedIds,
      awaitingMoreActors: opts.awaitingMoreActors,
      participantAdjudicationOutcomes: outcomes,
    });
  }
  if (actor?.roll) {
    return { phase: "actor-dice", presentationIndex: opts.presentationIndex };
  }
  if (actor && actorExpectsPresentationRoll(actor.actorId, rolls)) {
    return { phase: "actor-action", presentationIndex: opts.presentationIndex };
  }
  return advanceToNextActor(opts.actors, opts.presentationIndex, {
    awaitingMoreActors: opts.awaitingMoreActors,
    participantAdjudicationOutcomes: outcomes,
  });
}

export function advanceAfterActorResult(opts: {
  actors: readonly PresentationActor[];
  presentationIndex: number;
  adjudicatedParticipantIds?: ReadonlySet<number>;
  declarationConsumedIds?: ReadonlySet<number>;
  awaitingMoreActors?: boolean;
}): Pick<RoundPresentationState, "phase" | "presentationIndex"> {
  return advanceToNextActor(opts.actors, opts.presentationIndex, {
    adjudicatedParticipantIds: opts.adjudicatedParticipantIds,
    declarationConsumedIds: opts.declarationConsumedIds,
    awaitingMoreActors: opts.awaitingMoreActors,
  });
}

export function advanceAfterDiceDismiss(opts: {
  actors: readonly PresentationActor[];
  presentationIndex: number;
  rolls?: readonly { participantId: number }[];
  adjudicatedParticipantIds?: ReadonlySet<number>;
  declarationConsumedIds?: ReadonlySet<number>;
  participantAdjudicationOutcomes?: ReadonlyMap<number, TrpgParticipantAdjudicationOutcome>;
  awaitingMoreActors?: boolean;
}): Pick<RoundPresentationState, "phase" | "presentationIndex"> {
  const actor = opts.actors[opts.presentationIndex];
  const rolls = opts.rolls ?? [];
  const outcomes = opts.participantAdjudicationOutcomes;
  if (actor?.roll) {
    return { phase: "actor-result", presentationIndex: opts.presentationIndex };
  }
  if (actorAwaitingAuthoritativeRoll(actor?.actorId ?? -1, actor?.roll ?? null, rolls, outcomes)) {
    return { phase: "actor-dice", presentationIndex: opts.presentationIndex };
  }
  return advanceToNextActor(opts.actors, opts.presentationIndex, {
    adjudicatedParticipantIds: opts.adjudicatedParticipantIds,
    declarationConsumedIds: opts.declarationConsumedIds,
    awaitingMoreActors: opts.awaitingMoreActors,
    participantAdjudicationOutcomes: outcomes,
  });
}

export type LiveActorPresentationTransition =
  | { kind: "hold" }
  | { kind: "transition"; next: Pick<RoundPresentationState, "phase" | "presentationIndex"> };

function normalizeLiveActorPresentationTransition(
  current: Pick<RoundPresentationState, "phase" | "presentationIndex">,
  next: Pick<RoundPresentationState, "phase" | "presentationIndex">
): LiveActorPresentationTransition {
  if (next.phase === current.phase && next.presentationIndex === current.presentationIndex) {
    return { kind: "hold" };
  }
  return { kind: "transition", next };
}

/** Single production owner for live actor-action / actor-dice phase transitions. */
export function resolveLiveActorPresentationTransition(opts: {
  mode: RoundPresentationMode;
  phase: RoundPresentationPhase;
  presentationIndex: number;
  actors: readonly PresentationActor[];
  rolls?: readonly { participantId: number }[];
  adjudicatedParticipantIds?: ReadonlySet<number>;
  declarationConsumedIds?: ReadonlySet<number>;
  participantAdjudicationOutcomes?: ReadonlyMap<number, TrpgParticipantAdjudicationOutcome>;
  awaitingMoreActors?: boolean;
  actionRevealComplete?: boolean;
  overlayDismissed?: boolean;
  overlaySessionKey?: string;
  activeRollSessionKey?: string;
}): LiveActorPresentationTransition {
  if (opts.mode !== "cinematic") return { kind: "hold" };

  if (opts.phase === "actor-action") {
    const current = opts.actors[opts.presentationIndex];
    if (!current?.action) return { kind: "hold" };
    if (opts.actionRevealComplete === false) return { kind: "hold" };
    if (
      opts.adjudicatedParticipantIds != null &&
      opts.declarationConsumedIds != null &&
      !isActorPresentationReady({
        actor: current,
        adjudicatedParticipantIds: opts.adjudicatedParticipantIds,
        declarationConsumedIds: opts.declarationConsumedIds,
      })
    ) {
      return { kind: "hold" };
    }
    return normalizeLiveActorPresentationTransition(
      { phase: opts.phase, presentationIndex: opts.presentationIndex },
      advanceAfterActorAction({
        actors: opts.actors,
        presentationIndex: opts.presentationIndex,
        rolls: opts.rolls,
        adjudicatedParticipantIds: opts.adjudicatedParticipantIds,
        declarationConsumedIds: opts.declarationConsumedIds,
        participantAdjudicationOutcomes: opts.participantAdjudicationOutcomes,
        awaitingMoreActors: opts.awaitingMoreActors,
      })
    );
  }

  if (opts.phase === "actor-dice") {
    const current = opts.actors[opts.presentationIndex];
    if (!current?.roll) {
      const outcome = resolveParticipantAdjudicationOutcome(
        current?.actorId ?? -1,
        opts.participantAdjudicationOutcomes
      );
      if (outcome === "roll") return { kind: "hold" };
      return normalizeLiveActorPresentationTransition(
        { phase: opts.phase, presentationIndex: opts.presentationIndex },
        advanceAfterDiceDismiss({
          actors: opts.actors,
          presentationIndex: opts.presentationIndex,
          rolls: opts.rolls,
          adjudicatedParticipantIds: opts.adjudicatedParticipantIds,
          declarationConsumedIds: opts.declarationConsumedIds,
          participantAdjudicationOutcomes: opts.participantAdjudicationOutcomes,
          awaitingMoreActors: opts.awaitingMoreActors,
        })
      );
    }
    if (
      !shouldAdvanceActorDiceAfterOverlayDismiss({
        mode: opts.mode,
        phase: opts.phase,
        overlayDismissed: opts.overlayDismissed === true,
        overlaySessionKey: opts.overlaySessionKey ?? "",
        activeRollSessionKey: opts.activeRollSessionKey ?? "",
      })
    ) {
      return { kind: "hold" };
    }
    return normalizeLiveActorPresentationTransition(
      { phase: opts.phase, presentationIndex: opts.presentationIndex },
      advanceAfterDiceDismiss({
        actors: opts.actors,
        presentationIndex: opts.presentationIndex,
        rolls: opts.rolls,
        adjudicatedParticipantIds: opts.adjudicatedParticipantIds,
        declarationConsumedIds: opts.declarationConsumedIds,
        participantAdjudicationOutcomes: opts.participantAdjudicationOutcomes,
        awaitingMoreActors: opts.awaitingMoreActors,
      })
    );
  }

  return { kind: "hold" };
}

/** Work types where new canonical locked submissions may still arrive this round. */
const AWAITING_MORE_CANONICAL_ACTION_WORK = new Set<string>([
  "generate_bots",
  "bot_retry_required",
  "wait_humans",
]);

/**
 * True while new canonical actions for this round may still arrive.
 * Uses authoritative server work/phase signals only — never resolutionOrder gaps
 * (resolutionOrder includes all campaign participants; round locking uses canAct).
 */
export function isRoundPresentationAwaitingMoreActors(opts: {
  phase: string;
  workType: string;
  botGenerationInFlight?: boolean;
}): boolean {
  if (opts.botGenerationInFlight) return true;
  return AWAITING_MORE_CANONICAL_ACTION_WORK.has(opts.workType);
}

function advanceToNextActor(
  actors: readonly PresentationActor[],
  presentationIndex: number,
  opts?: {
    adjudicatedParticipantIds?: ReadonlySet<number>;
    declarationConsumedIds?: ReadonlySet<number>;
    participantAdjudicationOutcomes?: ReadonlyMap<number, TrpgParticipantAdjudicationOutcome>;
    awaitingMoreActors?: boolean;
  }
): Pick<RoundPresentationState, "phase" | "presentationIndex"> {
  const candidate = presentationIndex + 1;
  if (candidate >= actors.length) {
    if (opts?.awaitingMoreActors) {
      return { phase: "actor-action", presentationIndex: candidate };
    }
    return { phase: "gm-narration", presentationIndex: Math.max(0, actors.length - 1) };
  }
  const gatesProvided =
    opts?.adjudicatedParticipantIds != null && opts?.declarationConsumedIds != null;
  if (gatesProvided) {
    const actor = actors[candidate];
    if (
      !isActorPresentationReady({
        actor,
        adjudicatedParticipantIds: opts!.adjudicatedParticipantIds!,
        declarationConsumedIds: opts!.declarationConsumedIds!,
      })
    ) {
      return { phase: "actor-action", presentationIndex: candidate };
    }
  }
  return { phase: "actor-action", presentationIndex: candidate };
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
  rolls?: readonly { participantId: number; d20: number; dc: number; tier: string }[];
  actions?: readonly { participantId: number }[];
  ready?: boolean;
}): string {
  if (opts.ready === false) return "";
  if (opts.roundNumber <= 0) return "";
  return `${opts.roundNumber}|live-cinematic`;
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
  adjudicatedParticipantIds?: readonly number[];
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
    resolutionOrder: input.resolutionOrder,
    adjudicatedParticipantIds: input.adjudicatedParticipantIds,
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
    const incrementalVisibleActionIds = !decided.ready ? earlyVisibleHumanActionIds(actions) : [];
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

export function simulateCinematicQueueSession(opts: {
  snaps: readonly LiveRoundSnapshotInput[];
}): {
  sessionKeys: string[];
  restartCount: number;
  finalPresentationIndex: number;
} {
  let queueKey = "";
  let state: RoundPresentationState = idlePresentation();
  let restartCount = 0;
  let frozen: PresentationActor[] | null = null;
  let frozenRound: number | null = null;
  const sessionKeys: string[] = [];

  for (const snap of opts.snaps) {
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
    sessionKeys.push(decided.sessionKey);

    if (decided.sessionKey && queueKey !== decided.sessionKey) {
      if (queueKey !== "" && state.mode === "cinematic") restartCount += 1;
      queueKey = decided.sessionKey;
      const mode = decideRoundPresentationMode({
        consumeOnMount: snap.consumeOnMount === true,
        actorCount: decided.actorCount,
      });
      if (mode === "cinematic") {
        state = { mode: "cinematic", ...startCinematicPresentation() };
      } else if (mode === "historical") {
        state = historicalPresentation();
      } else {
        state = idlePresentation();
      }
    }
  }
  return { sessionKeys, restartCount, finalPresentationIndex: state.presentationIndex };
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
