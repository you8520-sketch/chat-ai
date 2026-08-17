import type { TrpgPublicRoll } from "./snapshot";

/**
 * First-choice prototype was `@3d-dice/dice-box-threejs` (MIT code, 0.0.12).
 * Bundled `public/textures` and `public/sounds` are third-party photographic /
 * hit samples with unverified redistribution rights (Teall-era lineage).
 * Those assets are not copied. Rendering uses Three.js (MIT) + generated canvases.
 */
export const TRPG_DICE_ENGINE = "three-icosahedron-obsidian";
export const TRPG_DICE_ENGINE_LICENSE = "MIT";
export const TRPG_DICE_BOX_THREEJS_REVIEWED = true;
export const TRPG_DICE_BOX_THREEJS_ASSETS_COPIED = false;
export const TRPG_D20_THEME = "obsidian";

export const TRPG_D20_PER_DIE_MS = { min: 800, max: 1400 } as const;
export const TRPG_D20_TOTAL_CAP_MS = 3600;
export const TRPG_D20_HOLD_AFTER_SETTLE_MS = 240;

export function trpgPredeterminedD20Notation(d20: number): string {
  return `1d20@${d20}`;
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

export function trpgDiceOverlayActive(phase: string, rolls: readonly TrpgPublicRoll[]): boolean {
  return (phase === "ROLLING" || phase === "GENERATING_NARRATION") && rolls.length > 0;
}
