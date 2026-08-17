import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { CREATOR_REWARD_RATE_EXCLUSIVE } from "@/lib/creatorShared";
import { creditTrpgRoundCreatorRewards, splitTrpgCreatorRewards } from "./creatorRewards";
import { ensureTrpgTables } from "./schema";
import {
  computeTrpgServiceSubtotal,
  isTrpgValuePricingEnabled,
  partyPremiumRate,
  quoteTrpgRoundEconomics,
  scaleCreatorShares,
  splitTrpgValueCreatorRewards,
} from "./economics";
import { simulateTrpgEconomics } from "./economicsSimulation";
import { TRPG_MAX_SLOTS, TRPG_PARTY_PREMIUM_CAP, TRPG_VALUE_CREATOR_CAP_RATE } from "./types";

describe("TRPG value economics", () => {
  it("keeps party premium at 0/10/20/30 and caps 5 humans at 30%", () => {
    assert.equal(partyPremiumRate(1), 0);
    assert.equal(partyPremiumRate(2), 0.1);
    assert.equal(partyPremiumRate(3), 0.2);
    assert.equal(partyPremiumRate(4), 0.3);
    assert.equal(partyPremiumRate(5), TRPG_PARTY_PREMIUM_CAP);
    assert.ok(TRPG_MAX_SLOTS < 5);
    assert.deepEqual(computeTrpgServiceSubtotal(100, 1), {
      modelSubtotal: 100,
      partyPremiumRate: 0,
      partyPremiumPoints: 0,
      serviceSubtotal: 100,
    });
    assert.equal(computeTrpgServiceSubtotal(100, 4).serviceSubtotal, 130);
  });

  it("does not change model subtotal and stays off by default", () => {
    assert.equal(isTrpgValuePricingEnabled({}), false);
    assert.equal(isTrpgValuePricingEnabled({ TRPG_VALUE_PRICING_ENABLED: "0" }), false);
    assert.equal(isTrpgValuePricingEnabled({ TRPG_VALUE_PRICING_ENABLED: "1" }), true);
    const off = quoteTrpgRoundEconomics({
      modelSubtotal: 100,
      humanUserIds: [1, 2],
      hostUserId: 1,
      authorUserId: 9,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterSeats: [{ creatorId: 3, characterId: 10, official: 0 }],
      botCount: 1,
      valuePricingEnabled: false,
    });
    assert.equal(off.partyPremiumPoints, 0);
    assert.equal(off.roundTotal, 100);
    assert.equal(off.creatorFundingPoints, 0);
  });

  it("pays 5% per distinct character seat and 10% for two seats of the same creator", () => {
    const two = splitTrpgValueCreatorRewards({
      serviceBase: 100,
      consumerUserId: 1,
      authorUserId: null,
      authorRate: 0,
      characterSeats: [
        { creatorId: 10, characterId: 1, official: 0 },
        { creatorId: 10, characterId: 2, official: 0 },
      ],
    });
    assert.equal(two.length, 2);
    assert.ok(two.every((row) => row.reward === 5));
    const dup = splitTrpgValueCreatorRewards({
      serviceBase: 100,
      consumerUserId: 1,
      authorUserId: null,
      authorRate: 0,
      characterSeats: [
        { creatorId: 10, characterId: 1, official: 0 },
        { creatorId: 10, characterId: 1, official: 0 },
      ],
    });
    assert.equal(dup.length, 1);
    assert.equal(dup[0]?.reward, 5);
  });

  it("blocks official, self-reward, and stacks author + characters up to 30%", () => {
    const stacked = splitTrpgValueCreatorRewards({
      serviceBase: 100,
      consumerUserId: 1,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterSeats: [
        { creatorId: 2, characterId: 8, official: 0 },
        { creatorId: 3, characterId: 9, official: 0 },
        { creatorId: 4, characterId: 10, official: 0 },
        { creatorId: 5, characterId: 11, official: 1 },
        { creatorId: 1, characterId: 12, official: 0 },
      ],
    });
    assert.equal(stacked.find((row) => row.role === "author")?.reward, 20);
    const chars = stacked.filter((row) => row.role === "character");
    assert.equal(chars.length, 2);
    assert.ok(chars.every((row) => row.reward === 5));
    assert.equal(
      stacked.reduce((sum, row) => sum + row.reward, 0),
      30
    );
    assert.equal(TRPG_VALUE_CREATOR_CAP_RATE, 0.3);
    const selfAuthor = splitTrpgValueCreatorRewards({
      serviceBase: 100,
      consumerUserId: 2,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterSeats: [{ creatorId: 2, characterId: 8, official: 0 }],
    });
    assert.equal(selfAuthor.length, 0);
  });

  it("prorates creator CP by PAID ratio and keeps legacy 25% split untouched", () => {
    const full = splitTrpgValueCreatorRewards({
      serviceBase: 100,
      consumerUserId: 1,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterSeats: [],
    });
    const scaled = scaleCreatorShares(full, 0.6);
    assert.equal(scaled[0]?.reward, 12);
    assert.deepEqual(scaleCreatorShares(full, 0), []);
    const legacy = splitTrpgCreatorRewards({
      paidSpend: 100,
      consumerUserId: 1,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterCreators: [
        { creatorId: 3, characterId: 10, official: 0 },
        { creatorId: 4, characterId: 11, official: 0 },
      ],
    });
    assert.equal(
      legacy.reduce((sum, row) => sum + row.reward, 0),
      25
    );
  });

  it("quotes 4 humans at 130 service plus per-payer creator addons", () => {
    const quote = quoteTrpgRoundEconomics({
      modelSubtotal: 100,
      humanUserIds: [1, 2, 3, 4],
      hostUserId: 1,
      authorUserId: 9,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterSeats: [
        { creatorId: 3, characterId: 10, official: 0 },
        { creatorId: 4, characterId: 11, official: 0 },
      ],
      botCount: 2,
      valuePricingEnabled: true,
    });
    assert.equal(quote.serviceSubtotal, 130);
    assert.equal(quote.humanCount, 4);
    assert.ok(quote.perUserShares.every((row) => row.servicePoints === 32 || row.servicePoints === 34 || row.servicePoints === 33));
    assert.ok(quote.roundTotal > quote.serviceSubtotal);
  });

  it("does not double-credit the same consumer/creator/character on retry", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title) VALUES (1, '경제')`).run();
    const campaignId = Number((db.prepare(`SELECT id FROM trpg_campaigns`).get() as { id: number }).id);
    const round = db.prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?,0,'ROUND_COMPLETE')`).run(campaignId);
    const roundId = Number(round.lastInsertRowid);
    const shares = splitTrpgValueCreatorRewards({
      serviceBase: 100,
      consumerUserId: 1,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterSeats: [
        { creatorId: 3, characterId: 10, official: 0 },
        { creatorId: 3, characterId: 11, official: 0 },
      ],
    });
    const first = creditTrpgRoundCreatorRewards(db, {
      campaignId,
      roundId,
      consumerUserId: 1,
      paidSpend: 100,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterCreators: [],
      shares,
    });
    creditTrpgRoundCreatorRewards(db, {
      campaignId,
      roundId,
      consumerUserId: 1,
      paidSpend: 100,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterCreators: [],
      shares,
    });
    const rows = db.prepare(`SELECT COUNT(*) AS n, SUM(reward_amount) AS s FROM trpg_creator_earnings WHERE round_id=?`).get(roundId) as {
      n: number;
      s: number;
    };
    assert.equal(first.length, 3);
    assert.equal(rows.n, 3);
    assert.equal(rows.s, 30);
    db.close();
  });

  it("runs an offline economics simulation without model calls", () => {
    const report = simulateTrpgEconomics();
    assert.equal(report.modelSubtotalChanged, false);
    assert.equal(report.valuePricingEnabled, false);
    assert.ok(report.groups["1H0B"].proposedP50Total >= report.groups["1H0B"].currentP50Total);
    assert.ok(report.groups["4H0B"].proposedPerUser < report.groups["1H0B"].proposedP50Total);
    assert.ok(report.deltaPercent >= 0);
  });
});
