import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CREATOR_REWARD_RATE_EXCLUSIVE, CREATOR_REWARD_RATE_SPROUT } from "@/lib/creatorShared";
import { splitTrpgCreatorRewards } from "./creatorRewards";
import { TRPG_CHARACTER_ROYALTY_RATE, TRPG_CREATOR_REWARD_CAP_RATE } from "./types";

describe("TRPG creator point split", () => {
  it("pays nothing on free-point spend", () => {
    const shares = splitTrpgCreatorRewards({
      paidSpend: 0,
      consumerUserId: 1,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterCreators: [{ creatorId: 3, characterId: 10, official: 0 }],
    });
    assert.deepEqual(shares, []);
  });

  it("gives the author their existing tier and a character creator 5% when under the cap", () => {
    const shares = splitTrpgCreatorRewards({
      paidSpend: 100,
      consumerUserId: 1,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterCreators: [{ creatorId: 3, characterId: 10, official: 0 }],
    });
    assert.equal(shares.length, 2);
    assert.equal(shares[0]?.role, "author");
    assert.equal(shares[0]?.reward, 20);
    assert.equal(shares[1]?.role, "character");
    assert.equal(shares[1]?.reward, 5);
    const total = shares.reduce((sum, row) => sum + row.reward, 0);
    assert.equal(total, 25);
    assert.ok(total / 100 <= TRPG_CREATOR_REWARD_CAP_RATE);
  });

  it("shrinks character royalties first when exclusive 20% plus two 5% would exceed 25%", () => {
    const shares = splitTrpgCreatorRewards({
      paidSpend: 100,
      consumerUserId: 1,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterCreators: [
        { creatorId: 3, characterId: 10, official: 0 },
        { creatorId: 4, characterId: 11, official: 0 },
      ],
    });
    const author = shares.find((s) => s.role === "author");
    const chars = shares.filter((s) => s.role === "character");
    assert.equal(author?.reward, 20);
    assert.equal(chars.length, 2);
    assert.equal(chars[0]?.reward, 2.5);
    assert.equal(chars[1]?.reward, 2.5);
    assert.equal(
      shares.reduce((sum, row) => sum + row.reward, 0),
      25
    );
  });

  it("keeps sprout 5% plus three character 5% without hitting the cap", () => {
    const shares = splitTrpgCreatorRewards({
      paidSpend: 100,
      consumerUserId: 1,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_SPROUT,
      characterCreators: [
        { creatorId: 3, characterId: 10, official: 0 },
        { creatorId: 4, characterId: 11, official: 0 },
        { creatorId: 5, characterId: 12, official: 0 },
      ],
    });
    assert.equal(shares.find((s) => s.role === "author")?.reward, 5);
    const chars = shares.filter((s) => s.role === "character");
    assert.equal(chars.length, 3);
    assert.ok(chars.every((row) => row.reward === 5));
    assert.equal(TRPG_CHARACTER_ROYALTY_RATE, 0.05);
  });

  it("skips official characters, self-play, and the scenario author as a character royalty", () => {
    const shares = splitTrpgCreatorRewards({
      paidSpend: 100,
      consumerUserId: 1,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterCreators: [
        { creatorId: 1, characterId: 8, official: 0 },
        { creatorId: 2, characterId: 9, official: 0 },
        { creatorId: 9, characterId: 10, official: 1 },
        { creatorId: 3, characterId: 11, official: 0 },
        { creatorId: 3, characterId: 12, official: 0 },
      ],
    });
    assert.equal(shares.find((s) => s.role === "author")?.creatorId, 2);
    const chars = shares.filter((s) => s.role === "character");
    assert.equal(chars.length, 1);
    assert.equal(chars[0]?.creatorId, 3);
    assert.equal(chars[0]?.reward, 5);
  });

  it("does not pay the author when they are the paying player", () => {
    const shares = splitTrpgCreatorRewards({
      paidSpend: 100,
      consumerUserId: 2,
      authorUserId: 2,
      authorRate: CREATOR_REWARD_RATE_EXCLUSIVE,
      characterCreators: [{ creatorId: 3, characterId: 10, official: 0 }],
    });
    assert.equal(shares.some((s) => s.role === "author"), false);
    assert.equal(shares[0]?.creatorId, 3);
    assert.equal(shares[0]?.reward, 5);
  });
});
