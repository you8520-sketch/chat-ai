import { DEFAULT_TRPG_BILLING_MODE, type TrpgBillingMode } from "./types";

export type TrpgShare = { userId: number; points: number };

/**
 * Human participants only. AI character bots never pay.
 * Default mode is equal split; leftover points go to the host.
 */
export function splitTrpgRoundCost(opts: {
  totalPoints: number;
  humanUserIds: number[];
  hostUserId: number;
  mode?: TrpgBillingMode;
}): TrpgShare[] {
  const total = Math.max(0, Math.floor(opts.totalPoints));
  const humans = [...new Set(opts.humanUserIds.filter((id) => Number.isInteger(id) && id > 0))];
  const mode = opts.mode ?? DEFAULT_TRPG_BILLING_MODE;
  if (total === 0 || humans.length === 0) return [];

  if (mode === "host_pays") {
    return [{ userId: opts.hostUserId, points: total }];
  }
  if (mode === "split_even") {
    const n = humans.length;
    const base = Math.floor(total / n);
    let remainder = total - base * n;
    const hostFirst = [
      opts.hostUserId,
      ...humans.filter((id) => id !== opts.hostUserId),
    ].filter((id, i, arr) => arr.indexOf(id) === i && humans.includes(id));
    const ordered = hostFirst.length === n ? hostFirst : humans;
    return ordered.map((userId) => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      return { userId, points: base + extra };
    });
  }
  const _exhaustive: never = mode;
  return _exhaustive;
}
