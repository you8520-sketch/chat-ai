/**
 * Client-safe progression math. DB writers live in `progression.ts`; sheet
 * presentation must not pull the database store into a client bundle.
 */
export const TRPG_COMPLETION_XP = 100;
export const TRPG_XP_PER_LEVEL = 100;
export const TRPG_STAT_POINTS_PER_LEVEL = 1;

export function trpgLevelForXp(xp: number): number {
  const safe = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  return 1 + Math.floor(safe / TRPG_XP_PER_LEVEL);
}

export function trpgXpIntoLevel(xp: number): number {
  const safe = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  return safe % TRPG_XP_PER_LEVEL;
}

export function trpgXpToNextLevel(xp: number): number {
  return TRPG_XP_PER_LEVEL - trpgXpIntoLevel(xp);
}
