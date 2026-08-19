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
  return actorIds.map((actorId) => ({
    actorId,
    action: opts.actions.find((action) => action.participantId === actorId) ?? null,
    roll: opts.rolls.find((roll) => roll.participantId === actorId) ?? null,
  }));
}

export function decideRoundPresentationMode(opts: {
  consumeOnMount: boolean;
  actorCount: number;
}): RoundPresentationMode {
  if (opts.actorCount <= 0) return "idle";
  if (opts.consumeOnMount) return "historical";
  return "cinematic";
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

export function shouldShowGmNarration(state: RoundPresentationState): boolean {
  if (state.mode === "historical") return true;
  return state.phase === "gm-narration" || state.phase === "complete";
}

/** Hide the live round until the client knows cinematic vs historical. */
export function shouldGateLiveRoundPresentation(opts: {
  mode: RoundPresentationMode;
  previewReady: boolean;
}): boolean {
  return !opts.previewReady || opts.mode === "cinematic";
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
}): string {
  const rollKey = trpgDiceRollSessionKey(opts.roundNumber, opts.rolls);
  if (rollKey) return rollKey;
  const actionIds = [...new Set(opts.actions.map((action) => action.participantId))]
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((a, b) => a - b);
  if (actionIds.length === 0) return "";
  return `${opts.roundNumber}|actions:${actionIds.join(",")}`;
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
    gmVisible: shouldShowGmNarration(state),
    activeRollActorId: activePresentationRoll({ actors, state })?.participantId ?? null,
  };
}
