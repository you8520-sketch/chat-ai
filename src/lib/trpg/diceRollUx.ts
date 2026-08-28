import type { TrpgPublicRoll } from "./snapshot";
import { decideTrpgDiceRenderer } from "./diceRendererDecision";
import {
  TRPG_D20_HOLD_AFTER_SETTLE_MS as VISUAL_HOLD_MS,
  TRPG_DICE_BOX_NOTATION,
  TRPG_DICE_BOX_THREEJS_ASSETS_COPIED as VISUAL_ASSETS_COPIED,
  TRPG_DICE_BOX_THREEJS_REVIEWED as VISUAL_REVIEWED,
  TRPG_DICE_ENGINE as VISUAL_ENGINE,
  TRPG_DICE_IMPLEMENTATION,
} from "./diceVisual";

export const TRPG_DICE_ENGINE = VISUAL_ENGINE;
export const TRPG_DICE_ENGINE_LICENSE = "MIT";
export const TRPG_DICE_BOX_THREEJS_REVIEWED = VISUAL_REVIEWED;
export const TRPG_DICE_BOX_THREEJS_ASSETS_COPIED = VISUAL_ASSETS_COPIED;
export const TRPG_D20_HOLD_AFTER_SETTLE_MS = VISUAL_HOLD_MS;
export const TRPG_DICE_RENDERER = TRPG_DICE_IMPLEMENTATION;

export const TRPG_D20_PER_DIE_MS = { min: 1750, max: 1900 } as const;
export const TRPG_D20_TOTAL_CAP_MS = 2600;

export function trpgPredeterminedD20Notation(d20: number): string {
  return TRPG_DICE_BOX_NOTATION(d20);
}

export function orderTrpgDiceRolls<T extends { participantId: number }>(
  rolls: readonly T[],
  resolutionOrder: readonly { participantId: number }[] | undefined
): T[] {
  if (!resolutionOrder?.length) return [...rolls];
  const rank = new Map(resolutionOrder.map((entry, index) => [entry.participantId, index]));
  return [...rolls].sort(
    (a, b) => (rank.get(a.participantId) ?? 10_000) - (rank.get(b.participantId) ?? 10_000)
  );
}

export function trpgDiceDurationMs(rollCount: number): { perDie: number; total: number } {
  const n = Math.max(0, Math.floor(rollCount));
  if (n === 0) return { perDie: 0, total: 0 };
  const perDie = Math.min(
    TRPG_D20_PER_DIE_MS.max,
    Math.max(TRPG_D20_PER_DIE_MS.min, Math.floor(TRPG_D20_TOTAL_CAP_MS / n))
  );
  return { perDie, total: Math.min(TRPG_D20_TOTAL_CAP_MS, perDie * n) };
}

/**
 * Result confirmation phase timing (after 3D physics settle).
 * The 3D roll is physics-driven (variable time); these constants
 * control only the post-settle RESULT_CONFIRM HUD duration.
 */
export const TRPG_RESULT_ENTER_MS = 180 as const;
export const TRPG_RESULT_HOLD_MS = { 1: 850, 2: 650, 3: 500, 4: 500 } as const;
export const TRPG_RESULT_EXIT_MS = 200 as const;
/** Deterministic static-renderer settle delay (accessibility-friendly, no physics). */
export const TRPG_STATIC_SETTLE_MS = 320 as const;
/** Max 3D physics roll time per die (watchdog budget). */
export const TRPG_ROLL_MAX_MS = 7000 as const;
export const TRPG_EMERALD_WATCHDOG_MARGIN_MS = 2000;
export const TRPG_EMERALD_MULTI_ROLL_CAP_MS = 5000;

export function trpgResultConfirmPerDieMs(rollCount: number): number {
  const n = Math.max(0, Math.floor(rollCount));
  if (n <= 0) return 0;
  const bucket = n === 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 4;
  return TRPG_RESULT_ENTER_MS + TRPG_RESULT_HOLD_MS[bucket] + TRPG_RESULT_EXIT_MS;
}

export function trpgEmeraldDiceTiming(rollCount: number): {
  activeMs: number;
  holdMs: number;
  perDieMs: number;
  totalMs: number;
} {
  const n = Math.max(0, Math.floor(rollCount));
  if (n <= 0) return { activeMs: 0, holdMs: 0, perDieMs: 0, totalMs: 0 };
  const perDieMs = trpgResultConfirmPerDieMs(n);
  return {
    activeMs: perDieMs,
    holdMs: 0,
    perDieMs,
    totalMs: Math.min(TRPG_EMERALD_MULTI_ROLL_CAP_MS, perDieMs * n),
  };
}

/** Watchdog = max physics roll time + result confirm total + margin. */
export function trpgDiceRevealWatchdogMs(rollCount: number): number {
  const result = trpgEmeraldDiceTiming(rollCount);
  return Math.max(result.totalMs + TRPG_ROLL_MAX_MS + TRPG_EMERALD_WATCHDOG_MARGIN_MS, 10000);
}

export function shouldAnimateTrpgDice3d(opts: { webgl: boolean; reducedMotion: boolean }): boolean {
  return decideTrpgDiceRenderer(opts).renderer === "dice-box-threejs";
}

export type TrpgDiceResultPhase = "rolling" | "entering" | "holding" | "exiting";

/** Static / reduced-motion / no-WebGL: schedule a short deterministic settle instead of physics. */
export function shouldScheduleTrpgStaticSettle(opts: {
  visible: boolean;
  renderer: "dice-box-threejs" | "static" | null | undefined;
  resultPhase: TrpgDiceResultPhase;
  settled: boolean;
}): boolean {
  return (
    opts.visible &&
    opts.renderer === "static" &&
    opts.resultPhase === "rolling" &&
    !opts.settled
  );
}

/** Guard against a stale static timer settling a later roll session or index. */
export function isTrpgStaticSettleTimerStale(opts: {
  scheduledSessionKey: string;
  scheduledPlayIndex: number;
  currentSessionKey: string;
  currentPlayIndex: number;
}): boolean {
  return (
    opts.scheduledSessionKey !== opts.currentSessionKey ||
    opts.scheduledPlayIndex !== opts.currentPlayIndex
  );
}

export type TrpgDiceOverlaySessionAction = "start" | "keep" | "clear";

export type TrpgDiceRollSessionFields = {
  participantId: number;
  d20: number;
  dc: number;
  tier: string;
};

/** Deterministic session id for one authoritative roll set. Phase is not part of the key. */
export function trpgDiceRollSessionKey(
  roundNumber: number,
  rolls: readonly TrpgDiceRollSessionFields[]
): string {
  if (rolls.length === 0) return "";
  const parts = rolls
    .map((roll) => `${roll.participantId}:${roll.d20}:${roll.dc}:${roll.tier}`)
    .sort();
  return `${roundNumber}|${parts.join(",")}`;
}

/** Historical rolls already in the snapshot on first mount must not autoplay. Fixture inject may. */
export function shouldConsumeMountRollSession(opts: {
  rollSessionKey: string;
  replayOnMount: boolean;
  isFirstObservation: boolean;
}): boolean {
  return opts.isFirstObservation && opts.rollSessionKey !== "" && opts.replayOnMount !== true;
}

/**
 * Overlay start is owned by a new roll session key, not a transient server phase.
 * ROLLING / GENERATING_NARRATION / ROUND_COMPLETE / ACTION_INPUT are display-only.
 */
export function trpgDiceOverlaySessionAction(opts: {
  rollSessionKey: string;
  prevRollSessionKey: string;
  consumed: boolean;
  started: boolean;
  dismissed: boolean;
}): TrpgDiceOverlaySessionAction {
  if (opts.consumed) {
    return opts.started && !opts.dismissed ? "keep" : "clear";
  }
  if (!opts.rollSessionKey) {
    return opts.started && !opts.dismissed ? "keep" : "clear";
  }
  if (opts.rollSessionKey !== opts.prevRollSessionKey) return "start";
  return "keep";
}

export function trpgDiceOverlayAfterSettle(
  currentIndex: number,
  rollCount: number
): { index: number; dismissed: boolean } {
  const n = Math.max(0, Math.floor(rollCount));
  if (n <= 0) return { index: 0, dismissed: true };
  if (currentIndex + 1 >= n) return { index: currentIndex, dismissed: true };
  return { index: currentIndex + 1, dismissed: false };
}

export function trpgDiceOverlayVisible(started: boolean, dismissed: boolean, rollCount: number): boolean {
  return started === true && dismissed !== true && rollCount > 0;
}

export type TrpgDiceOverlayPlay = {
  started: boolean;
  dismissed: boolean;
  index: number;
};

export function applyTrpgDiceOverlaySession(
  play: TrpgDiceOverlayPlay,
  action: TrpgDiceOverlaySessionAction
): TrpgDiceOverlayPlay {
  switch (action) {
    case "start":
      return { started: true, dismissed: false, index: 0 };
    case "keep":
      return play;
    case "clear":
      return { started: false, dismissed: false, index: 0 };
    default: {
      const _never: never = action;
      return _never;
    }
  }
}

/** Which roll session owns the current overlay play lifecycle state. */
export function trpgDiceOverlayPlayOwnerSessionKey(
  action: TrpgDiceOverlaySessionAction,
  incomingSessionKey: string
): string {
  switch (action) {
    case "start":
    case "keep":
      return incomingSessionKey;
    case "clear":
      return "";
    default: {
      const _never: never = action;
      return _never;
    }
  }
}

export type TrpgDiceOverlayPlaybackReport = {
  sessionKey: string;
  visible: boolean;
  settled: boolean;
  dismissed: boolean;
};

/**
 * Authoritative overlay playback report for the parent actor-dice owner.
 * Play dismissed/settled/visible apply only when play state belongs to incomingSessionKey.
 */
export function trpgDiceOverlayPlaybackReport(opts: {
  incomingSessionKey: string;
  playOwnerSessionKey: string;
  play: TrpgDiceOverlayPlay;
  settled: boolean;
  rollCount: number;
}): TrpgDiceOverlayPlaybackReport {
  const aligned =
    opts.incomingSessionKey !== "" &&
    opts.playOwnerSessionKey !== "" &&
    opts.incomingSessionKey === opts.playOwnerSessionKey;

  if (!aligned) {
    return {
      sessionKey: opts.incomingSessionKey,
      visible: false,
      settled: false,
      dismissed: false,
    };
  }

  return {
    sessionKey: opts.incomingSessionKey,
    visible: trpgDiceOverlayVisible(opts.play.started, opts.play.dismissed, opts.rollCount),
    settled: opts.settled,
    dismissed: opts.play.dismissed,
  };
}

/** Parent actor-dice owner: advance only after authoritative dismissal of the active roll key. */
export function shouldAdvanceActorDiceAfterOverlayDismiss(opts: {
  phase: string;
  mode: string;
  overlayDismissed: boolean;
  overlaySessionKey: string;
  activeRollSessionKey: string;
}): boolean {
  if (opts.mode !== "cinematic" || opts.phase !== "actor-dice") return false;
  if (!opts.activeRollSessionKey) return false;
  return opts.overlayDismissed && opts.overlaySessionKey === opts.activeRollSessionKey;
}

export function trpgDiceOverlayActive(_phase: string, rolls: readonly TrpgPublicRoll[]): boolean {
  return rolls.length > 0;
}
