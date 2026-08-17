import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { CREATOR_REWARD_RATE_EXCLUSIVE } from "@/lib/creatorShared";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { splitTrpgRoundCost, TRPG_BOT_USAGE_FALLBACK, TRPG_GM_USAGE_FALLBACK } from "./billing";
import {
  canChangeTrpgBillingMode,
  saveTrpgBillingMode,
  trpgInsufficientBalanceMessage,
} from "./billingMode";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, peekTrpgInvite, saveTrpgSheet } from "./engineCreate";
import { startTrpgCampaign, type TrpgEngineDeps } from "./engineAdvance";
import { quoteTrpgRoundEconomics } from "./economics";
import { observeTrpgRoundEconomics, parseProviderUsageCostUsd, resolveTrpgProviderCost } from "./roundEconomics";
import { trpgFail } from "./requireApi";
import { ensureTrpgTables } from "./schema";
import {
  DEFAULT_TRPG_BILLING_MODE,
  TRPG_BILLING_MODE_FORBIDDEN_MESSAGE,
  TRPG_BILLING_MODE_LOCKED_MESSAGE,
  TRPG_HOST_INSUFFICIENT_POINTS_MESSAGE,
  TRPG_PARTY_PREMIUM_PER_EXTRA_HUMAN,
  TRPG_VALUE_CREATOR_CAP_RATE,
} from "./types";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

const skipDeps: TrpgEngineDeps = {
  skipBilling: true,
  gmCall: async () => ({
    text: `<<<NARRATION>>>
문이 열린다.
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"조사","campaign_finished":false}`,
  }),
};

describe("TRPG host-sponsored rooms", () => {
  it("A. 2H split_even splits between both humans", () => {
    const shares = splitTrpgRoundCost({
      totalPoints: 100,
      humanUserIds: [1, 2],
      hostUserId: 1,
      mode: "split_even",
    });
    assert.deepEqual(shares, [
      { userId: 1, points: 50 },
      { userId: 2, points: 50 },
    ]);
  });

  it("B. 2H host_pays charges host 100% and guest 0", () => {
    const shares = splitTrpgRoundCost({
      totalPoints: 100,
      humanUserIds: [1, 2],
      hostUserId: 1,
      mode: "host_pays",
    });
    assert.deepEqual(shares, [{ userId: 1, points: 100 }]);
    assert.equal(shares.find((row) => row.userId === 2)?.points ?? 0, 0);
  });

  it("C. 4H host_pays charges host 100% and three guests 0", () => {
    const shares = splitTrpgRoundCost({
      totalPoints: 130,
      humanUserIds: [1, 2, 3, 4],
      hostUserId: 1,
      mode: "host_pays",
    });
    assert.deepEqual(shares, [{ userId: 1, points: 130 }]);
    for (const guest of [2, 3, 4]) {
      assert.equal(shares.find((row) => row.userId === guest)?.points ?? 0, 0);
    }
  });

  it("D. 1H host_pays matches solo split_even", () => {
    const solo = splitTrpgRoundCost({
      totalPoints: 80,
      humanUserIds: [9],
      hostUserId: 9,
      mode: "split_even",
    });
    const hosted = splitTrpgRoundCost({
      totalPoints: 80,
      humanUserIds: [9],
      hostUserId: 9,
      mode: "host_pays",
    });
    assert.deepEqual(solo, [{ userId: 9, points: 80 }]);
    assert.deepEqual(hosted, solo);
  });

  it("E. 2H + 2 bots + host_pays puts model, premium, and creator funding on the host", () => {
    const quote = quoteTrpgRoundEconomics({
      modelSubtotal: 100,
      humanUserIds: [1, 2],
      hostUserId: 1,
      billingMode: "host_pays",
      authorUserId: 9,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterSeats: [
        { creatorId: 3, characterId: 10, official: 0 },
        { creatorId: 4, characterId: 11, official: 0 },
      ],
      botCount: 2,
      valuePricingEnabled: true,
    });
    assert.equal(quote.partyPremiumRate, TRPG_PARTY_PREMIUM_PER_EXTRA_HUMAN);
    assert.equal(quote.partyPremiumPoints, 10);
    assert.equal(quote.serviceSubtotal, 110);
    assert.equal(quote.perUserShares.length, 1);
    assert.equal(quote.perUserShares[0]?.userId, 1);
    assert.equal(quote.perUserShares[0]?.servicePoints, 110);
    assert.equal(quote.perUserShares[0]?.total, quote.roundTotal);
    assert.ok(quote.creatorFundingPoints > 0);
    assert.equal(quote.perUserShares[0]?.creatorAddon, quote.creatorFundingPoints);
    assert.equal(quote.roundTotal, 110 + quote.creatorFundingPoints);
    assert.equal(
      quote.perUserShares.find((row) => row.userId === 2)?.total ?? 0,
      0
    );
  });

  it("F. host_pays guests are not payers so a 0-point guest is not blocked", () => {
    const quote = quoteTrpgRoundEconomics({
      modelSubtotal: 80,
      humanUserIds: [1, 2],
      hostUserId: 1,
      billingMode: "host_pays",
      authorUserId: null,
      authorRate: 0,
      characterSeats: [],
      botCount: 0,
      valuePricingEnabled: false,
    });
    const payers = quote.perUserShares.filter((row) => row.total > 0);
    assert.deepEqual(payers.map((row) => row.userId), [1]);
    assert.equal(payers.some((row) => row.userId === 2), false);
  });

  it("G. host_pays insufficient host does not fall back to guests", () => {
    const message = trpgInsufficientBalanceMessage({
      billingMode: "host_pays",
      hostUserId: 1,
      shortUserId: 1,
    });
    assert.equal(message, TRPG_HOST_INSUFFICIENT_POINTS_MESSAGE);
    assert.doesNotMatch(message, /내 포인트가 부족합니다/);
    const guestSplit = trpgInsufficientBalanceMessage({
      billingMode: "split_even",
      hostUserId: 1,
      shortUserId: 2,
    });
    assert.equal(guestSplit, "포인트가 부족합니다.");
    const quote = quoteTrpgRoundEconomics({
      modelSubtotal: 80,
      humanUserIds: [1, 2],
      hostUserId: 1,
      billingMode: "host_pays",
      authorUserId: null,
      authorRate: 0,
      characterSeats: [],
      botCount: 0,
      valuePricingEnabled: true,
    });
    assert.equal(quote.perUserShares.length, 1);
    assert.equal(quote.perUserShares[0]?.userId, 1);
  });

  it("H. self-creator host still gets 0 CP under host_pays", () => {
    const quote = quoteTrpgRoundEconomics({
      modelSubtotal: 100,
      humanUserIds: [1, 2],
      hostUserId: 1,
      billingMode: "host_pays",
      authorUserId: 1,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterSeats: [{ creatorId: 1, characterId: 8, official: 0 }],
      botCount: 1,
      valuePricingEnabled: true,
    });
    assert.equal(quote.creatorFundingPoints, 0);
    assert.deepEqual(quote.perUserShares[0]?.creatorShares, []);
  });

  it("I. official bots stay at 0 royalty under host_pays", () => {
    const quote = quoteTrpgRoundEconomics({
      modelSubtotal: 100,
      humanUserIds: [1, 2],
      hostUserId: 1,
      billingMode: "host_pays",
      authorUserId: null,
      authorRate: 0,
      characterSeats: [{ creatorId: 3, characterId: 10, official: 1 }],
      botCount: 1,
      valuePricingEnabled: true,
    });
    assert.equal(quote.creatorFundingPoints, 0);
  });

  it("J. split_even → host_pays is allowed after start", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
    });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: skipDeps });
    saveTrpgBillingMode(db, { campaignId, userId: 1, billingMode: "host_pays" });
    const row = db.prepare(`SELECT billing_mode FROM trpg_campaigns WHERE id=?`).get(campaignId) as {
      billing_mode: string;
    };
    assert.equal(row.billing_mode, "host_pays");
    db.close();
  });

  it("K. host_pays → split_even is blocked after start", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      billingMode: "host_pays",
    });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: skipDeps });
    assert.throws(
      () => saveTrpgBillingMode(db, { campaignId, userId: 1, billingMode: "split_even" }),
      new RegExp(TRPG_BILLING_MODE_LOCKED_MESSAGE)
    );
    const row = db.prepare(`SELECT billing_mode FROM trpg_campaigns WHERE id=?`).get(campaignId) as {
      billing_mode: string;
    };
    assert.equal(row.billing_mode, "host_pays");
    db.close();
  });

  it("L. non-host billing mutation is forbidden and maps to 403", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
    });
    joinTrpgCampaign(db, { code: peekCode(db, campaignId), userId: 2, nickname: "태현" });
    assert.throws(
      () => saveTrpgBillingMode(db, { campaignId, userId: 2, billingMode: "host_pays" }),
      new RegExp(TRPG_BILLING_MODE_FORBIDDEN_MESSAGE)
    );
    const res = trpgFail(new Error(TRPG_BILLING_MODE_FORBIDDEN_MESSAGE));
    assert.equal(res.status, 403);
    db.close();
  });

  it("keeps the default billing mode and allows both modes before start", () => {
    assert.equal(DEFAULT_TRPG_BILLING_MODE, "split_even");
    assert.equal(canChangeTrpgBillingMode({ current: "split_even", next: "host_pays", started: false }), true);
    assert.equal(canChangeTrpgBillingMode({ current: "host_pays", next: "split_even", started: false }), true);
    assert.equal(canChangeTrpgBillingMode({ current: "host_pays", next: "split_even", started: true }), false);
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
    });
    const created = db.prepare(`SELECT billing_mode FROM trpg_campaigns WHERE id=?`).get(campaignId) as {
      billing_mode: string;
    };
    assert.equal(created.billing_mode, "split_even");
    saveTrpgBillingMode(db, { campaignId, userId: 1, billingMode: "host_pays" });
    saveTrpgBillingMode(db, { campaignId, userId: 1, billingMode: "split_even" });
    const peek = peekTrpgInvite(db, {
      code: peekCode(db, campaignId),
      userId: 2,
    });
    assert.equal(peek?.billingMode, "split_even");
    assert.equal(peek?.canJoin, true);
    db.close();
  });

  it("does not change party premium or creator cap constants", () => {
    assert.equal(TRPG_PARTY_PREMIUM_PER_EXTRA_HUMAN, 0.1);
    assert.equal(TRPG_VALUE_CREATOR_CAP_RATE, 0.3);
  });
});

describe("TRPG round economics observability", () => {
  it("reads provider usage.cost and never estimates 0", () => {
    assert.equal(parseProviderUsageCostUsd({ cost: 0.0123 }), 0.0123);
    assert.equal(parseProviderUsageCostUsd({ cost_details: { upstream_inference_cost: 0.02 } }), 0.02);
    assert.equal(parseProviderUsageCostUsd({ cost: 0 }), undefined);
    const actual = resolveTrpgProviderCost([
      {
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        inputTokens: 1000,
        outputTokens: 200,
        upstreamCostUsd: 0.05,
      },
    ]);
    assert.equal(actual.costSource, "actual");
    assert.equal(actual.providerCostUsd, 0.05);
    assert.ok(actual.providerCostKrw > 0);
    const estimated = resolveTrpgProviderCost([TRPG_GM_USAGE_FALLBACK, TRPG_BOT_USAGE_FALLBACK]);
    assert.equal(estimated.costSource, "estimated");
    assert.ok(estimated.providerCostUsd > 0);
    assert.ok(estimated.providerCostKrw > 0);
  });

  it("computes point-face and paid-coverage separately and keeps billingMode", () => {
    const observation = observeTrpgRoundEconomics({
      breakdown: {
        modelSubtotal: 100,
        partyPremiumPoints: 10,
        serviceSubtotal: 110,
        creatorFundingPoints: 20,
        roundTotal: 130,
        humanCount: 2,
        botCount: 2,
        billingMode: "host_pays",
      },
      billingMode: "host_pays",
      paidPointsSpent: 80,
      freePointsSpent: 50,
      actualCreatorCpCredited: 12,
      calls: [
        {
          modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
          inputTokens: 1000,
          outputTokens: 200,
          upstreamCostUsd: 0.01,
        },
      ],
    });
    assert.equal(observation.billingMode, "host_pays");
    assert.equal(observation.modelSubtotalPoints, 100);
    assert.equal(observation.roundTotalPoints, 130);
    assert.equal(observation.paidPointsSpent, 80);
    assert.equal(observation.freePointsSpent, 50);
    assert.equal(observation.actualCreatorCpCredited, 12);
    assert.equal(observation.costSource, "actual");
    assert.equal(
      observation.netContributionPoints,
      130 - 12 - observation.providerCostKrw
    );
    assert.equal(observation.pointContributionMargin, observation.netContributionPoints / 130);
    assert.equal(observation.paidCoverageRate, 80 / 130);
    assert.equal(
      observation.paidContribution,
      80 - 12 - observation.providerCostKrw
    );
  });
});

function peekCode(db: Database.Database, campaignId: number): string {
  return (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as {
    invite_code: string;
  }).invite_code;
}
