import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TrpgPublicGoal } from "@/lib/trpg/campaignGoals";
import { goalClaimItems } from "./goalClaimView";

const valid: TrpgPublicGoal = { id: "g1", title: "행방 추적", status: "active", claimed: true, claimedRound: 2, confirmable: true };
const plain: TrpgPublicGoal = { id: "g2", title: "단서 조사", status: "active", claimed: false };
const lostSource: TrpgPublicGoal = { id: "g3", title: "낡은 제안", status: "active", claimed: true, claimedRound: 1 };
const serverDone: TrpgPublicGoal = { id: "g4", title: "끝난 목표", status: "completed", claimed: false, basis: "server" };
const hostDone: TrpgPublicGoal = { id: "g5", title: "확인한 목표", status: "completed", claimed: false, basis: "host" };
const labels = (goal: TrpgPublicGoal, viewerIsHost: boolean) =>
  goalClaimItems([goal], viewerIsHost)[0]?.actions.map((action) => `${action.decision}:${action.label}`);

describe("goal claim view", () => {
  it("host + valid proposal: confirm and 'still in progress'", () => {
    const [item] = goalClaimItems([valid], true);
    assert.equal(item.mode, "confirmable");
    assert.deepEqual(labels(valid, true), ["confirm:해결 확인", "decline:아직 진행 중"]);
  });

  it("host + a proposal whose source is gone (reroll, older build): no confirm, only clearing, never 'the host decides'", () => {
    const [item] = goalClaimItems([lostSource], true);
    assert.equal(item.mode, "stale");
    assert.deepEqual(labels(lostSource, true), ["decline:제안 정리"]);
    assert.match(item.notice, /더 이상 확인할 수 없습니다/);
    assert.ok(!item.notice.includes("방장이 확인합니다"));
    assert.ok(item.actions.every((action) => action.decision !== "confirm"));
  });

  it("another human: read-only for both kinds of proposal", () => {
    for (const goal of [valid, lostSource]) {
      const [item] = goalClaimItems([goal], false);
      assert.equal(item.mode, "readonly");
      assert.deepEqual(item.actions, []);
      assert.match(item.notice, /방장이 확인합니다/);
    }
  });

  it("goals without a pending proposal and server/host-completed goals show no card", () => {
    assert.deepEqual(goalClaimItems(undefined, true), []);
    for (const host of [true, false]) assert.deepEqual(goalClaimItems([plain, serverDone, hostDone], host), []);
  });

  it("each proposal keeps its own goal id and round so the answer targets exactly that proposal", () => {
    assert.deepEqual(
      goalClaimItems([valid, plain, lostSource], true).map((item) => [item.goalId, item.claimedRound]),
      [["g1", 2], ["g3", 1]]
    );
  });
});
