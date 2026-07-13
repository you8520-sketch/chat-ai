import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { paidCreatorRewardSpend } from "./creatorPoints";

describe("paidCreatorRewardSpend", () => {
  it("counts only paid point deductions for creator rewards", () => {
    assert.equal(
      paidCreatorRewardSpend([
        { pointType: "FREE", amount: 80 },
        { pointType: "PAID", amount: 20 },
      ]),
      20
    );
  });

  it("returns zero when a chat turn used only free points", () => {
    assert.equal(
      paidCreatorRewardSpend([
        { pointType: "FREE", amount: 50 },
        { pointType: "FREE", amount: 30 },
      ]),
      0
    );
  });
});
