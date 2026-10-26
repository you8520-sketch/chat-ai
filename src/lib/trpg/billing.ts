import { GEMINI_4_ARGON_MODEL, GEMINI_38_FLASH_MODEL } from "@/lib/chatModels";
import { DEFAULT_TRPG_BILLING_MODE, type TrpgBillingMode } from "./types";
import { computeTrpgPublishedMarginChargePoints } from "./trpgPublishedMarginCharge";

export type TrpgShare = { userId: number; points: number };

export type TrpgModelUsage = {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Provider-reported USD cost when usage.cost (or equivalent) is present. */
  upstreamCostUsd?: number;
};

/** Typical GM scene when the provider omits usage — Gemini 4 Argon Flex + published target margin. */
export const TRPG_GM_USAGE_FALLBACK: TrpgModelUsage = {
  modelId: GEMINI_4_ARGON_MODEL,
  inputTokens: 10_000,
  outputTokens: 3_500,
};

/** Typical bot-seat Gemini action when usage is missing. */
export const TRPG_BOT_USAGE_FALLBACK: TrpgModelUsage = {
  modelId: GEMINI_38_FLASH_MODEL,
  inputTokens: 2_500,
  outputTokens: 400,
};

/**
 * Round charge = sum of per-call provider USD cost at each model's published target gross margin.
 */
export function computeTrpgRoundPoints(calls: TrpgModelUsage[]): number {
  let total = 0;
  for (const call of calls) {
    total += computeTrpgPublishedMarginChargePoints(call);
  }
  return total;
}

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
