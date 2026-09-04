import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CREATOR_PRO_MIN_CHARACTERS,
  CREATOR_PRO_MIN_MONTHLY_SPENT,
  CREATOR_REWARD_RATE,
  CREATOR_REWARD_RATE_PRO,
  CREATOR_REWARD_RATE_SPROUT,
  resolveCreatorTier,
} from "./creatorShared";

const stats = (overrides: Partial<Parameters<typeof resolveCreatorTier>[0]> = {}) => ({
  characterCount: 0,
  publicCharacterCount: 0,
  totalChats: 0,
  monthlySpentOnChars: 0,
  ...overrides,
});

describe("creator tier policy", () => {
  it("uses the three canonical CP rates", () => {
    assert.equal(resolveCreatorTier(stats({ characterCount: 2 })).rewardRate, CREATOR_REWARD_RATE_SPROUT);
    assert.equal(
      resolveCreatorTier(stats({ characterCount: 2, publicCharacterCount: 2, totalChats: 5_000 }))
        .rewardRate,
      CREATOR_REWARD_RATE
    );
    assert.equal(
      resolveCreatorTier(
        stats({
          characterCount: 5,
          publicCharacterCount: CREATOR_PRO_MIN_CHARACTERS,
          monthlySpentOnChars: CREATOR_PRO_MIN_MONTHLY_SPENT,
        })
      ).rewardRate,
      CREATOR_REWARD_RATE_PRO
    );
  });

  it("requires two created characters for sprout and public characters for standard", () => {
    assert.deepEqual(resolveCreatorTier(stats({ characterCount: 1 })), {
      tierLevel: "sprout",
      rewardRate: 0,
    });
    assert.equal(
      resolveCreatorTier(stats({ characterCount: 2, publicCharacterCount: 1, totalChats: 5_000 }))
        .tierLevel,
      "sprout"
    );
  });

  it("keeps the existing pro spend condition while lowering only the public count to five", () => {
    const oneShort = stats({
      characterCount: 5,
      publicCharacterCount: CREATOR_PRO_MIN_CHARACTERS - 1,
      totalChats: 100_000,
      monthlySpentOnChars: CREATOR_PRO_MIN_MONTHLY_SPENT,
    });
    assert.equal(resolveCreatorTier(oneShort).tierLevel, "standard");
    assert.equal(
      resolveCreatorTier({ ...oneShort, publicCharacterCount: CREATOR_PRO_MIN_CHARACTERS }).tierLevel,
      "pro"
    );
    assert.equal(
      resolveCreatorTier({
        ...oneShort,
        publicCharacterCount: CREATOR_PRO_MIN_CHARACTERS,
        monthlySpentOnChars: CREATOR_PRO_MIN_MONTHLY_SPENT - 0.1,
      }).tierLevel,
      "standard"
    );
  });
});
