import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateTrpgEndingDecision } from "./endingDecision";
import type { TrpgActionPlan } from "./actionContract";
import type { TrpgGoal } from "./campaignGoals";

function plan(opts: {
  actorParticipantId: number;
  endingIntent: TrpgActionPlan["endingIntent"];
  status?: "planned" | "unexecuted";
}): TrpgActionPlan {
  return {
    version: 1,
    proposal: {
      version: 1,
      actorParticipantId: opts.actorParticipantId,
      sourceText: "",
      acts: [],
      endingIntent: opts.endingIntent,
      clarification: null,
      owner: "server-rule-v1",
    },
    acts: [
      {
        index: 0,
        kind: "other",
        actorParticipantId: opts.actorParticipantId,
        evidence: "이 모험을 끝낸다.",
        commitment: "committed",
        status: opts.status ?? "planned",
        apCost: 0,
        needsCheck: false,
        source: "human_text",
      },
    ],
    executedText: "이 모험을 끝낸다.",
    unexecuted: [],
    endingIntent: opts.endingIntent,
    createdAt: "2026-10-31T00:00:00.000Z",
  };
}

function goal(overrides: Partial<TrpgGoal> = {}): TrpgGoal {
  return {
    id: "goal-1",
    title: "등대 불을 밝힌다",
    status: "active",
    source: "gm",
    createdRound: 0,
    ...overrides,
  };
}

describe("server ending decision", () => {
  it("ends only when a human explicitly closes the campaign and no required goal is active", () => {
    const decision = evaluateTrpgEndingDecision({
      plans: [plan({ actorParticipantId: 1, endingIntent: "campaign_close" })],
      goals: [],
      humanParticipantIds: new Set([1]),
    });
    assert.equal(decision.kind, "end");
  });

  it("does not let a bot or a normal NPC farewell close the campaign", () => {
    assert.equal(
      evaluateTrpgEndingDecision({
        plans: [plan({ actorParticipantId: 2, endingIntent: "campaign_close" })],
        goals: [],
        humanParticipantIds: new Set([1]),
      }).kind,
      "none"
    );
    assert.equal(
      evaluateTrpgEndingDecision({
        plans: [plan({ actorParticipantId: 1, endingIntent: "farewell_npc" })],
        goals: [],
        humanParticipantIds: new Set([1]),
      }).kind,
      "none"
    );
  });

  it("does not auto-confirm a pending goal claim", () => {
    const decision = evaluateTrpgEndingDecision({
      plans: [plan({ actorParticipantId: 1, endingIntent: "campaign_close" })],
      goals: [goal({ claimedRound: 4 })],
      humanParticipantIds: new Set([1]),
    });
    assert.deepEqual(decision, {
      kind: "needs_host_confirmation",
      goalId: "goal-1",
      claimedRound: 4,
      reason: "goal_claim_pending",
    });
  });

  it("does not end while an unclaimed required goal is active", () => {
    assert.equal(
      evaluateTrpgEndingDecision({
        plans: [plan({ actorParticipantId: 1, endingIntent: "campaign_close" })],
        goals: [goal()],
        humanParticipantIds: new Set([1]),
      }).kind,
      "none"
    );
  });
});
