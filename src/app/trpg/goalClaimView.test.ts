import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TrpgPublicGoal } from "@/lib/trpg/campaignGoals";
import { goalClaimItems } from "./goalClaimView";

const goals: TrpgPublicGoal[] = [
  { id: "g1", title: "행방 추적", status: "active", claimed: true, claimedRound: 2, confirmable: true },
  { id: "g2", title: "단서 조사", status: "active", claimed: false },
  { id: "g3", title: "낡은 제안", status: "active", claimed: true, claimedRound: 1 },
  { id: "g4", title: "끝난 목표", status: "completed", claimed: false, basis: "host" },
];

describe("goal claim view", () => {
  it("lists only pending proposals; the host can answer the ones the server still confirms", () => {
    assert.deepEqual(goalClaimItems(goals, true), [
      { goalId: "g1", title: "행방 추적", claimedRound: 2, answerable: true },
      { goalId: "g3", title: "낡은 제안", claimedRound: 1, answerable: false },
    ]);
  });

  it("another human sees the proposals but cannot answer", () => {
    assert.ok(goalClaimItems(goals, false).every((item) => !item.answerable));
    assert.equal(goalClaimItems(goals, false).length, 2);
  });

  it("nothing pending means nothing shown", () => {
    assert.deepEqual(goalClaimItems(undefined, true), []);
    assert.deepEqual(goalClaimItems([goals[1], goals[3]], true), []);
  });
});
