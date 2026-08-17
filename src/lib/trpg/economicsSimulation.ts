import type Database from "better-sqlite3";
import { CREATOR_REWARD_RATE_EXCLUSIVE } from "@/lib/creatorShared";
import { computeTrpgRoundPoints, type TrpgModelUsage } from "./billing";
import { quoteTrpgRoundEconomics } from "./economics";
import { parseJson } from "./store";
import { TRPG_BOT_USAGE_FALLBACK, TRPG_GM_USAGE_FALLBACK } from "./billing";

export type TrpgEconomicsGroupKey = "1H0B" | "1H1B" | "1H2B" | "2H0B" | "2H1B" | "2H2B" | "3H0B" | "3H1B" | "4H0B";

export type TrpgEconomicsGroupStat = {
  roundCount: number;
  currentP50Total: number;
  proposedP50Total: number;
  proposedPerUser: number;
};

export type TrpgEconomicsSimulationReport = {
  modelSubtotalChanged: false;
  valuePricingEnabled: false;
  roundCount: number;
  currentTotalRevenue: number;
  proposedTotalRevenue: number;
  deltaPercent: number;
  creatorCpCurrent: number;
  creatorCpProposed: number;
  groups: Record<TrpgEconomicsGroupKey, TrpgEconomicsGroupStat>;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function callsFor(botCount: number): TrpgModelUsage[] {
  return [TRPG_GM_USAGE_FALLBACK, ...Array.from({ length: botCount }, () => TRPG_BOT_USAGE_FALLBACK)];
}

function groupKey(humanCount: number, botCount: number): TrpgEconomicsGroupKey | null {
  const key = `${humanCount}H${botCount}B`;
  switch (key) {
    case "1H0B":
    case "1H1B":
    case "1H2B":
    case "2H0B":
    case "2H1B":
    case "2H2B":
    case "3H0B":
    case "3H1B":
    case "4H0B":
      return key;
    default:
      return null;
  }
}

function quoteGroup(humanCount: number, botCount: number, modelSubtotal: number, enabled: boolean) {
  const humans = Array.from({ length: humanCount }, (_, i) => i + 1);
  const seats = Array.from({ length: botCount }, (_, i) => ({
    creatorId: 20 + i,
    characterId: 100 + i,
    official: 0,
  }));
  return quoteTrpgRoundEconomics({
    modelSubtotal,
    humanUserIds: humans,
    hostUserId: 1,
    authorUserId: 9,
    authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
    characterSeats: seats,
    botCount,
    valuePricingEnabled: enabled,
  });
}

export function simulateTrpgEconomics(db?: Database.Database): TrpgEconomicsSimulationReport {
  const samples: Array<{ humanCount: number; botCount: number; modelSubtotal: number }> = [];
  if (db) {
    const rows = db
      .prepare(
        `SELECT c.id AS campaign_id, r.usage_json, r.billed_points
         FROM trpg_rounds r
         JOIN trpg_campaigns c ON c.id = r.campaign_id
         WHERE COALESCE(r.billed,0)=1`
      )
      .all() as Array<{ campaign_id: number; usage_json: string | null; billed_points: number }>;
    for (const row of rows) {
      const humans = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM trpg_participants WHERE campaign_id=? AND kind='human'`)
          .get(row.campaign_id) as { n: number }
      ).n;
      const bots = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM trpg_participants WHERE campaign_id=? AND kind='ai_character'`)
          .get(row.campaign_id) as { n: number }
      ).n;
      const usage = parseJson(row.usage_json, [] as TrpgModelUsage[]);
      const modelSubtotal = usage.length ? computeTrpgRoundPoints(usage) : row.billed_points;
      if (modelSubtotal > 0) samples.push({ humanCount: humans, botCount: bots, modelSubtotal });
    }
  }
  const matrix: Array<{ humanCount: number; botCount: number }> = [
    { humanCount: 1, botCount: 0 },
    { humanCount: 1, botCount: 1 },
    { humanCount: 1, botCount: 2 },
    { humanCount: 2, botCount: 0 },
    { humanCount: 2, botCount: 1 },
    { humanCount: 2, botCount: 2 },
    { humanCount: 3, botCount: 0 },
    { humanCount: 3, botCount: 1 },
    { humanCount: 4, botCount: 0 },
  ];
  if (samples.length === 0) {
    for (const row of matrix) {
      samples.push({
        ...row,
        modelSubtotal: computeTrpgRoundPoints(callsFor(row.botCount)),
      });
    }
  }

  const empty = (): { current: number[]; proposed: number[]; perUser: number[] } => ({
    current: [],
    proposed: [],
    perUser: [],
  });
  const buckets: Record<TrpgEconomicsGroupKey, { current: number[]; proposed: number[]; perUser: number[] }> = {
    "1H0B": empty(),
    "1H1B": empty(),
    "1H2B": empty(),
    "2H0B": empty(),
    "2H1B": empty(),
    "2H2B": empty(),
    "3H0B": empty(),
    "3H1B": empty(),
    "4H0B": empty(),
  };

  let currentTotal = 0;
  let proposedTotal = 0;
  let creatorCurrent = 0;
  let creatorProposed = 0;
  for (const sample of samples) {
    const key = groupKey(sample.humanCount, sample.botCount);
    const current = quoteGroup(sample.humanCount, sample.botCount, sample.modelSubtotal, false);
    const proposed = quoteGroup(sample.humanCount, sample.botCount, sample.modelSubtotal, true);
    currentTotal += current.roundTotal;
    proposedTotal += proposed.roundTotal;
    creatorCurrent += current.creatorFundingPoints;
    creatorProposed += proposed.creatorFundingPoints;
    if (!key) continue;
    buckets[key].current.push(current.roundTotal);
    buckets[key].proposed.push(proposed.roundTotal);
    buckets[key].perUser.push(
      proposed.perUserShares.reduce((sum, row) => sum + row.total, 0) / Math.max(1, proposed.perUserShares.length)
    );
  }

  const groupsOut = {} as Record<TrpgEconomicsGroupKey, TrpgEconomicsGroupStat>;
  for (const [key, bucket] of Object.entries(buckets) as Array<
    [TrpgEconomicsGroupKey, { current: number[]; proposed: number[]; perUser: number[] }]
  >) {
    groupsOut[key] = {
      roundCount: bucket.current.length,
      currentP50Total: percentile(bucket.current, 50),
      proposedP50Total: percentile(bucket.proposed, 50),
      proposedPerUser: percentile(bucket.perUser, 50),
    };
  }

  return {
    modelSubtotalChanged: false,
    valuePricingEnabled: false,
    roundCount: samples.length,
    currentTotalRevenue: currentTotal,
    proposedTotalRevenue: proposedTotal,
    deltaPercent: currentTotal > 0 ? Math.round(((proposedTotal - currentTotal) / currentTotal) * 1000) / 10 : 0,
    creatorCpCurrent: creatorCurrent,
    creatorCpProposed: creatorProposed,
    groups: groupsOut,
  };
}
