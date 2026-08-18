import type { TrpgPublicRoll } from "./snapshot";
import {
  TRPG_D20_HOLD_AFTER_SETTLE_MS as VISUAL_HOLD_MS,
  TRPG_D20_THEME as VISUAL_THEME,
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
export const TRPG_D20_THEME = VISUAL_THEME;
export const TRPG_D20_HOLD_AFTER_SETTLE_MS = VISUAL_HOLD_MS;
export const TRPG_DICE_RENDERER = TRPG_DICE_IMPLEMENTATION;
export type TrpgDiceLabRenderer = "custom" | "dice-box-threejs";

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

export function shouldAnimateTrpgDice3d(opts: { webgl: boolean; reducedMotion: boolean }): boolean {
  return opts.webgl === true && opts.reducedMotion !== true;
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

export function trpgDiceOverlayActive(_phase: string, rolls: readonly TrpgPublicRoll[]): boolean {
  return rolls.length > 0;
}
