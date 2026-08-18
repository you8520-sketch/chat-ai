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

export const TRPG_D20_PER_DIE_MS = { min: 1100, max: 1300 } as const;
export const TRPG_D20_TOTAL_CAP_MS = 1600;

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

/** Overlay may begin only while the server is actually rolling. */
export function trpgDiceOverlayShouldStart(phase: string, rollCount: number): boolean {
  return phase === "ROLLING" && rollCount > 0;
}

/** In-flight tumble may finish after the phase flips to narration. */
export function trpgDiceOverlayMayContinue(phase: string): boolean {
  return phase === "ROLLING" || phase === "GENERATING_NARRATION";
}

export function trpgDiceOverlaySessionAction(opts: {
  phase: string;
  prevPhase: string;
  rollCount: number;
  prevRollCount: number;
}): TrpgDiceOverlaySessionAction {
  if (trpgDiceOverlayShouldStart(opts.phase, opts.rollCount)) {
    if (opts.prevPhase !== "ROLLING" || opts.prevRollCount === 0) return "start";
    return "keep";
  }
  if (trpgDiceOverlayMayContinue(opts.phase) && opts.rollCount > 0) {
    // Poll can skip ROLLING and land on narration with new authoritative rolls.
    if (opts.prevRollCount === 0) return "start";
    return "keep";
  }
  return "clear";
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

export function trpgDiceOverlayActive(phase: string, rolls: readonly TrpgPublicRoll[]): boolean {
  return trpgDiceOverlayShouldStart(phase, rolls.length);
}
