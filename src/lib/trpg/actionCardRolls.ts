import type { TrpgPublicRoll } from "./snapshot";

/** Row rolls win; live current-round rolls fill gaps so pending dice stay on the same action card. */
export function mergeTrpgActionRolls(opts: {
  rowRolls: readonly TrpgPublicRoll[];
  liveRolls: readonly TrpgPublicRoll[];
}): Map<number, TrpgPublicRoll> {
  const map = new Map<number, TrpgPublicRoll>();
  for (const roll of opts.liveRolls) map.set(roll.participantId, roll);
  for (const roll of opts.rowRolls) map.set(roll.participantId, roll);
  return map;
}

/** Fallback DiceStrip only when a current roll has no revealed action card. */
export function orphanTrpgRolls(opts: {
  currentRolls: readonly TrpgPublicRoll[];
  revealedActionParticipantIds: readonly number[];
}): TrpgPublicRoll[] {
  const attached = new Set(opts.revealedActionParticipantIds);
  return opts.currentRolls.filter((roll) => !attached.has(roll.participantId));
}
