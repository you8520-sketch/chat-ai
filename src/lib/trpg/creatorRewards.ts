import type Database from "better-sqlite3";
import { roundCreatorAmount } from "@/lib/creatorShared";
import { TRPG_CHARACTER_ROYALTY_RATE, TRPG_CREATOR_REWARD_CAP_RATE } from "./types";

export type TrpgCharacterRoyaltyInput = {
  creatorId: number;
  characterId: number;
  official: number;
};

export type TrpgCreatorRewardRole = "author" | "character";

export type TrpgCreatorRewardShare = {
  creatorId: number;
  role: TrpgCreatorRewardRole;
  characterId: number | null;
  rate: number;
  reward: number;
};

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}

function uniqueCharacterCreators(
  inputs: TrpgCharacterRoyaltyInput[],
  opts: { consumerUserId: number; authorUserId: number | null }
): TrpgCharacterRoyaltyInput[] {
  const seen = new Set<number>();
  const out: TrpgCharacterRoyaltyInput[] = [];
  for (const row of inputs) {
    if (!row.creatorId) continue;
    if (row.official === 1) continue;
    if (row.creatorId === opts.consumerUserId) continue;
    if (opts.authorUserId != null && row.creatorId === opts.authorUserId) continue;
    if (seen.has(row.creatorId)) continue;
    seen.add(row.creatorId);
    out.push(row);
  }
  return out;
}

/**
 * Scenario/world author keeps the existing 1:1 CP tier on PAID spend.
 * Unique imported-character creators get up to 5% each.
 * Total CP is capped at 25%; character royalties shrink first so the author rate never drops.
 */
export function splitTrpgCreatorRewards(opts: {
  paidSpend: number;
  consumerUserId: number;
  authorUserId: number | null;
  authorRate: number;
  characterCreators: TrpgCharacterRoyaltyInput[];
}): TrpgCreatorRewardShare[] {
  const paid = roundCreatorAmount(opts.paidSpend);
  if (paid <= 0) return [];

  const authorEligible =
    opts.authorUserId != null && opts.authorUserId > 0 && opts.authorUserId !== opts.consumerUserId;
  const authorRate = authorEligible
    ? Math.min(TRPG_CREATOR_REWARD_CAP_RATE, Math.max(0, opts.authorRate))
    : 0;
  const chars = uniqueCharacterCreators(opts.characterCreators, {
    consumerUserId: opts.consumerUserId,
    authorUserId: authorEligible ? opts.authorUserId : null,
  });

  const capAmount = roundCreatorAmount(paid * TRPG_CREATOR_REWARD_CAP_RATE);
  const authorReward = authorEligible ? roundCreatorAmount(paid * authorRate) : 0;
  let remaining = roundCreatorAmount(Math.max(0, capAmount - authorReward));
  const perCharCap = roundCreatorAmount(paid * TRPG_CHARACTER_ROYALTY_RATE);
  const n = chars.length;
  const evenSplit = n > 0 ? remaining / n : 0;

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

  for (const row of chars) {
    const reward = roundCreatorAmount(Math.min(perCharCap, evenSplit, remaining));
    if (reward <= 0) continue;
    remaining = roundCreatorAmount(remaining - reward);
    shares.push({
      creatorId: row.creatorId,
      role: "character",
      characterId: row.characterId,
      rate: paid > 0 ? reward / paid : 0,
      reward,
    });
  }
  return shares;
}

export function loadTrpgCharacterRoyaltyTargets(
  db: Database.Database,
  campaignId: number
): TrpgCharacterRoyaltyInput[] {
  if (!tableExists(db, "characters")) return [];
  return (
    db
      .prepare(
        `SELECT c.id AS characterId, c.creator_id AS creatorId, COALESCE(c.official, 0) AS official
         FROM trpg_participants p
         JOIN characters c ON c.id = p.character_id
         WHERE p.campaign_id=? AND p.character_id IS NOT NULL`
      )
      .all(campaignId) as Array<{ characterId: number; creatorId: number | null; official: number }>
  )
    .filter((row) => row.creatorId != null && row.creatorId > 0)
    .map((row) => ({
      characterId: row.characterId,
      creatorId: row.creatorId as number,
      official: row.official,
    }));
}

export function creditTrpgRoundCreatorRewards(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId: number;
    consumerUserId: number;
    paidSpend: number;
    authorUserId: number | null;
    authorRate: number;
    characterCreators: TrpgCharacterRoyaltyInput[];
    shares?: TrpgCreatorRewardShare[];
  }
): TrpgCreatorRewardShare[] {
  const shares = opts.shares ?? splitTrpgCreatorRewards(opts);
  if (shares.length === 0) return [];
  const paid = roundCreatorAmount(opts.paidSpend);
  const hasUsers = tableExists(db, "users");
  const hasLogs = tableExists(db, "creator_point_logs");

  const insert = db.prepare(
    `INSERT OR IGNORE INTO trpg_creator_earnings
      (round_id, campaign_id, consumer_user_id, creator_id, role, character_id, points_spent, reward_amount)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const bumpPoints = hasUsers
    ? db.prepare("UPDATE users SET creator_points = ROUND(creator_points + ?, 1) WHERE id=?")
    : null;
  const log = hasLogs
    ? db.prepare("INSERT INTO creator_point_logs (user_id, delta, reason) VALUES (?,?,?)")
    : null;

  for (const share of shares) {
    const info = insert.run(
      opts.roundId,
      opts.campaignId,
      opts.consumerUserId,
      share.creatorId,
      share.role,
      share.characterId ?? 0,
      paid,
      share.reward
    );
    if (info.changes === 0) continue;
    bumpPoints?.run(share.reward, share.creatorId);
    const pct = Math.round(share.rate * 1000) / 10;
    let label: string;
    switch (share.role) {
      case "author":
        label = `TRPG 시나리오 수익 ${pct}% (라운드 #${opts.roundId})`;
        break;
      case "character":
        label = `TRPG 캐릭터 수익 ${pct}% (라운드 #${opts.roundId})`;
        break;
      default: {
        const _exhaustive: never = share.role;
        throw new Error(`unhandled TRPG creator role: ${_exhaustive}`);
      }
    }
    log?.run(share.creatorId, share.reward, label);
  }

  return shares;
}
