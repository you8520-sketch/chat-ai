import { roundCreatorAmount } from "@/lib/creatorShared";
import type { TrpgCharacterRoyaltyInput, TrpgCreatorRewardShare } from "./creatorRewards";
import { splitTrpgRoundCost, type TrpgShare } from "./billing";
import {
  TRPG_CHARACTER_ROYALTY_RATE,
  TRPG_MAX_BOTS,
  TRPG_PARTY_PREMIUM_CAP,
  TRPG_PARTY_PREMIUM_PER_EXTRA_HUMAN,
  TRPG_VALUE_CREATOR_CAP_RATE,
  type TrpgBillingMode,
} from "./types";

export function isTrpgValuePricingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TRPG_VALUE_PRICING_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function partyPremiumRate(humanCount: number): number {
  const humans = Math.max(0, Math.floor(humanCount));
  return Math.min(TRPG_PARTY_PREMIUM_CAP, Math.max(0, humans - 1) * TRPG_PARTY_PREMIUM_PER_EXTRA_HUMAN);
}

export function computeTrpgServiceSubtotal(modelSubtotal: number, humanCount: number): {
  modelSubtotal: number;
  partyPremiumRate: number;
  partyPremiumPoints: number;
  serviceSubtotal: number;
} {
  const model = Math.max(0, modelSubtotal);
  const rate = partyPremiumRate(humanCount);
  const partyPremiumPoints = Math.round(model * rate);
  return {
    modelSubtotal: model,
    partyPremiumRate: rate,
    partyPremiumPoints,
    serviceSubtotal: model + partyPremiumPoints,
  };
}

export function eligibleCharacterSeats(
  seats: TrpgCharacterRoyaltyInput[],
  opts: { consumerUserId: number }
): TrpgCharacterRoyaltyInput[] {
  const seen = new Set<number>();
  const out: TrpgCharacterRoyaltyInput[] = [];
  for (const row of seats) {
    if (!row.creatorId || !row.characterId) continue;
    if (row.official === 1) continue;
    if (row.creatorId === opts.consumerUserId) continue;
    if (seen.has(row.characterId)) continue;
    seen.add(row.characterId);
    out.push(row);
    if (out.length >= TRPG_MAX_BOTS) break;
  }
  return out;
}

export function splitTrpgValueCreatorRewards(opts: {
  serviceBase: number;
  consumerUserId: number;
  authorUserId: number | null;
  authorRate: number;
  characterSeats: TrpgCharacterRoyaltyInput[];
}): TrpgCreatorRewardShare[] {
  const base = roundCreatorAmount(Math.max(0, opts.serviceBase));
  if (base <= 0) return [];
  const authorEligible =
    opts.authorUserId != null && opts.authorUserId > 0 && opts.authorUserId !== opts.consumerUserId;
  const authorRate = authorEligible ? Math.min(TRPG_VALUE_CREATOR_CAP_RATE, Math.max(0, opts.authorRate)) : 0;
  const seats = eligibleCharacterSeats(opts.characterSeats, { consumerUserId: opts.consumerUserId });
  const capAmount = roundCreatorAmount(base * TRPG_VALUE_CREATOR_CAP_RATE);
  const authorReward = authorEligible ? roundCreatorAmount(base * authorRate) : 0;
  let remaining = roundCreatorAmount(Math.max(0, capAmount - authorReward));
  const perSeatCap = roundCreatorAmount(base * TRPG_CHARACTER_ROYALTY_RATE);
  const shares: TrpgCreatorRewardShare[] = [];
  if (authorEligible && opts.authorUserId != null && authorReward > 0) {
    shares.push({
      creatorId: opts.authorUserId,
      role: "author",
      characterId: null,
      rate: authorRate,
      reward: authorReward,
    });
  }
  for (const row of seats) {
    const reward = roundCreatorAmount(Math.min(perSeatCap, remaining));
    if (reward <= 0) continue;
    remaining = roundCreatorAmount(remaining - reward);
    shares.push({
      creatorId: row.creatorId,
      role: "character",
      characterId: row.characterId,
      rate: base > 0 ? reward / base : 0,
      reward,
    });
  }
  return shares;
}

export type TrpgPayerQuote = {
  userId: number;
  servicePoints: number;
  creatorAddon: number;
  total: number;
  creatorShares: TrpgCreatorRewardShare[];
};

export type TrpgRoundEconomicsQuote = {
  modelSubtotal: number;
  partyPremiumRate: number;
  partyPremiumPoints: number;
  serviceSubtotal: number;
  creatorFundingPoints: number;
  roundTotal: number;
  humanCount: number;
  botCount: number;
  valuePricingEnabled: boolean;
  perUserShares: TrpgPayerQuote[];
};

export function quoteTrpgRoundEconomics(opts: {
  modelSubtotal: number;
  humanUserIds: number[];
  hostUserId: number;
  billingMode?: TrpgBillingMode;
  authorUserId: number | null;
  authorRate: number;
  characterSeats: TrpgCharacterRoyaltyInput[];
  botCount: number;
  valuePricingEnabled: boolean;
}): TrpgRoundEconomicsQuote {
  const humanCount = new Set(opts.humanUserIds.filter((id) => id > 0)).size;
  const service = opts.valuePricingEnabled
    ? computeTrpgServiceSubtotal(opts.modelSubtotal, humanCount)
    : {
        modelSubtotal: Math.max(0, opts.modelSubtotal),
        partyPremiumRate: 0,
        partyPremiumPoints: 0,
        serviceSubtotal: Math.max(0, opts.modelSubtotal),
      };
  const serviceShares: TrpgShare[] = splitTrpgRoundCost({
    totalPoints: service.serviceSubtotal,
    humanUserIds: opts.humanUserIds,
    hostUserId: opts.hostUserId,
    mode: opts.billingMode,
  });
  const perUserShares: TrpgPayerQuote[] = serviceShares.map((share) => {
    const creatorShares = opts.valuePricingEnabled
      ? splitTrpgValueCreatorRewards({
          serviceBase: share.points,
          consumerUserId: share.userId,
          authorUserId: opts.authorUserId,
          authorRate: opts.authorRate,
          characterSeats: opts.characterSeats,
        })
      : [];
    const creatorAddon = opts.valuePricingEnabled
      ? Math.ceil(Math.max(0, creatorShares.reduce((sum, row) => sum + row.reward, 0)) - 1e-9)
      : 0;
    return {
      userId: share.userId,
      servicePoints: share.points,
      creatorAddon,
      total: share.points + creatorAddon,
      creatorShares,
    };
  });
  const creatorFundingPoints = perUserShares.reduce((sum, row) => sum + row.creatorAddon, 0);
  const roundTotal = perUserShares.reduce((sum, row) => sum + row.total, 0);
  return {
    ...service,
    creatorFundingPoints,
    roundTotal,
    humanCount,
    botCount: Math.max(0, opts.botCount),
    valuePricingEnabled: opts.valuePricingEnabled,
    perUserShares,
  };
}

export function scaleCreatorShares(shares: TrpgCreatorRewardShare[], paidRatio: number): TrpgCreatorRewardShare[] {
  const ratio = Math.min(1, Math.max(0, paidRatio));
  if (ratio <= 0) return [];
  return shares
    .map((share) => ({
      ...share,
      reward: roundCreatorAmount(share.reward * ratio),
    }))
    .filter((share) => share.reward > 0);
}

export type TrpgBillingBreakdown = {
  modelSubtotal: number;
  partyPremiumRate: number;
  partyPremiumPoints: number;
  serviceSubtotal: number;
  creatorFundingPoints: number;
  roundTotal: number;
  humanCount: number;
  botCount: number;
  valuePricingEnabled: boolean;
  perUserShares: Array<{
    userId: number;
    servicePoints: number;
    creatorAddon: number;
    total: number;
  }>;
};

export function toBillingBreakdown(quote: TrpgRoundEconomicsQuote): TrpgBillingBreakdown {
  return {
    modelSubtotal: quote.modelSubtotal,
    partyPremiumRate: quote.partyPremiumRate,
    partyPremiumPoints: quote.partyPremiumPoints,
    serviceSubtotal: quote.serviceSubtotal,
    creatorFundingPoints: quote.creatorFundingPoints,
    roundTotal: quote.roundTotal,
    humanCount: quote.humanCount,
    botCount: quote.botCount,
    valuePricingEnabled: quote.valuePricingEnabled,
    perUserShares: quote.perUserShares.map((row) => ({
      userId: row.userId,
      servicePoints: row.servicePoints,
      creatorAddon: row.creatorAddon,
      total: row.total,
    })),
  };
}

export function parseBillingBreakdown(raw: string | null | undefined): TrpgBillingBreakdown | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TrpgBillingBreakdown;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.roundTotal !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}
