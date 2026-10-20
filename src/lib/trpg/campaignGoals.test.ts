import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeGoalTitles,
  applyGoalTransition,
  completeVerifiedGoals,
  parseGoalsJson,
  publicGoals,
  reconcileGoals,
  serializeGoals,
  type PlaceMatcher,
  type TrpgGoal,
  type TrpgGoalRoundFacts,
} from "./campaignGoals";
import { parseTrpgGmOutput } from "./gmPrompt";

const exact: PlaceMatcher = (place, location) => place === location;

function facts(overrides: Partial<TrpgGoalRoundFacts> = {}): TrpgGoalRoundFacts {
  return {
    round: 3,
    seats: [{ participantId: 1, human: true, startLocation: "부두", endLocation: "부두" }],
    authoredEncounterIds: [],
    endedEncounterIds: [],
    acceptedEncounterIds: [],
    ...overrides,
  };
}

function goalWith(partial: Partial<TrpgGoal>): TrpgGoal {
  return { id: "goal-1-1", title: "목표", status: "active", source: "gm", createdRound: 1, ...partial };
}

describe("campaignGoals", () => {
  it("reconciles legacy quest strings into criterion-free active goals and survives a JSON round trip", () => {
    const goals = reconcileGoals(null, ["등대를 조사한다", "등대를 조사한다", ""], 2);
    assert.equal(goals.length, 1);
    assert.equal(goals[0].source, "legacy");
    assert.equal(goals[0].criterion, undefined);
    assert.deepEqual(parseGoalsJson(serializeGoals(goals)), goals);
    assert.deepEqual(activeGoalTitles(goals), ["등대를 조사한다"]);
  });

  it("retires a goal an older build removed without credit and adopts a string it added", () => {
    const stored = [goalWith({ title: "옛 목표" })];
    const goals = reconcileGoals(stored, ["새 목표"], 5);
    assert.equal(goals.find((goal) => goal.title === "옛 목표")?.status, "retired");
    assert.equal(goals.find((goal) => goal.title === "옛 목표")?.evidence, undefined);
    assert.equal(goals.find((goal) => goal.title === "새 목표")?.source, "legacy");
  });

  it("drops a criterion that is already true or names an encounter the scenario does not define", () => {
    const base = facts({ seats: [{ participantId: 1, human: true, startLocation: "등대", endLocation: "등대" }] });
    const { goals: next } = applyGoalTransition(
      [],
      {
        questsAdd: ["등대 도착", "허구 위협 격퇴"],
        questCriteria: [
          { title: "등대 도착", criterion: { type: "reach_location", place: "등대" } },
          { title: "허구 위협 격퇴", criterion: { type: "end_encounter", encounterId: "ghost" } },
        ],
      },
      { round: 0, facts: base, placeMatches: exact }
    );
    assert.equal(next.length, 2);
    assert.ok(next.every((goal) => goal.criterion === undefined));
  });

  it("completes reach_location only for a later round and a human seat that actually arrived", () => {
    const goal = goalWith({ criterion: { type: "reach_location", place: "등대" }, createdRound: 1 });
    const stayed = completeVerifiedGoals([goal], facts(), exact);
    assert.equal(stayed[0].status, "active");
    const aiOnly = completeVerifiedGoals(
      [goal],
      facts({ seats: [{ participantId: 9, human: false, startLocation: "부두", endLocation: "등대" }] }),
      exact
    );
    assert.equal(aiOnly[0].status, "active");
    const arrived = completeVerifiedGoals(
      [goal],
      facts({ seats: [{ participantId: 1, human: true, startLocation: "부두", endLocation: "등대" }] }),
      exact
    );
    assert.equal(arrived[0].status, "completed");
    assert.deepEqual(arrived[0].evidence, { kind: "reach_location", round: 3, participantId: 1, location: "등대" });
    const sameRound = completeVerifiedGoals(
      [{ ...goal, createdRound: 3 }],
      facts({ seats: [{ participantId: 1, human: true, startLocation: "부두", endLocation: "등대" }] }),
      exact
    );
    assert.equal(sameRound[0].status, "active");
  });

  it("completes end_encounter only when the server accepted the end", () => {
    const goal = goalWith({ criterion: { type: "end_encounter", encounterId: "t1" } });
    assert.equal(completeVerifiedGoals([goal], facts({ authoredEncounterIds: ["t1"] }), exact)[0].status, "active");
    const done = completeVerifiedGoals(
      [goal],
      facts({ authoredEncounterIds: ["t1"], acceptedEncounterIds: ["t1"] }),
      exact
    );
    assert.equal(done[0].status, "completed");
  });

  it("treats a GM claim as unverified and a removal as retirement, never completion", () => {
    const goal = goalWith({ title: "자유 목표" });
    const claimed = applyGoalTransition([goal], { questsClaimDone: ["자유 목표"] }, { round: 4, placeMatches: exact }).goals;
    assert.equal(claimed[0].status, "active");
    assert.equal(claimed[0].claimedRound, 4);
    const removed = applyGoalTransition([goal], { questsRemove: ["자유 목표"] }, { round: 4, placeMatches: exact }).goals;
    assert.equal(removed[0].status, "retired");
    assert.equal(removed[0].evidence, undefined);
    assert.deepEqual(activeGoalTitles(removed), []);
  });

  it("closes verified goals first, so their slots take the same round's new goals and a removal cannot undo a completion", () => {
    const filler = Array.from({ length: 11 }, (_, index) => goalWith({ id: `goal-0-${index + 1}`, title: `보조 ${index + 1}`, createdRound: 0 }));
    const reach = goalWith({ id: "goal-0-12", title: "도착", createdRound: 0, criterion: { type: "reach_location", place: "등대" } });
    const arrived = facts({ seats: [{ participantId: 1, human: true, startLocation: "부두", endLocation: "등대" }] });
    const ctx = { round: 3, facts: arrived, placeMatches: exact };

    const next = applyGoalTransition([...filler, reach], { questsAdd: ["다음", "또 다음"], questsRemove: ["도착"] }, ctx);
    assert.equal(next.goals.find((goal) => goal.title === "도착")?.status, "completed");
    assert.deepEqual(activeGoalTitles(next.goals), [...filler.map((goal) => goal.title), "다음"]);
    assert.equal(next.addsDroppedAtCap, 1, "only the add with no slot left is dropped");

    const reAdded = applyGoalTransition([...filler, reach], { questsAdd: ["도착"] }, ctx);
    assert.equal(reAdded.goals.filter((goal) => goal.title === "도착").length, 1, "the goal just achieved is not re-added");

    const noFacts = applyGoalTransition([...filler, reach], { questsAdd: ["다음"] }, { round: 3, placeMatches: exact });
    assert.equal(noFacts.addsDroppedAtCap, 1, "no verified completion, no free slot, nothing replaced");
    assert.equal(activeGoalTitles(noFacts.goals).length, 12);
  });

  it("an already active goal keeps a distinct new questsAdd, and a completed goal is not flipped back to active", () => {
    const letter = goalWith({ title: "편지를 찾는다" });
    const withAttic = applyGoalTransition(
      [letter],
      { questsAdd: ["다락을 살핀다", "편지를 찾는다"] },
      { round: 4, placeMatches: exact }
    );
    assert.deepEqual(activeGoalTitles(withAttic.goals), ["편지를 찾는다", "다락을 살핀다"]);

    const completed = goalWith({
      id: "goal-1-1",
      title: "도착",
      status: "completed",
      closedRound: 2,
      evidence: { kind: "host_confirmed", round: 2, participantId: 1 },
    });
    const reAdded = applyGoalTransition([completed], { questsAdd: ["도착"] }, { round: 5, placeMatches: exact });
    const arrivalRows = reAdded.goals.filter((goal) => goal.title === "도착");
    assert.equal(arrivalRows.length, 2);
    assert.equal(arrivalRows.find((goal) => goal.id === "goal-1-1")?.status, "completed");
    assert.equal(arrivalRows.find((goal) => goal.id !== "goal-1-1")?.status, "active");
  });

  it("projects only player-safe fields", () => {
    const goals = [
      goalWith({ title: "A", criterion: { type: "reach_location", place: "비밀 장소" }, claimedRound: 2 }),
      goalWith({ id: "goal-2-1", title: "B", status: "completed", closedRound: 3 }),
    ];
    const json = JSON.stringify(publicGoals(goals));
    assert.ok(!json.includes("비밀 장소"));
    assert.ok(!json.includes("criterion"));
    assert.ok(!json.includes("evidence"));
    assert.ok(publicGoals(goals).some((goal) => goal.title === "A" && goal.claimed));
  });
});

describe("GM output goal fields", () => {
  it("parses a typed criterion and a completion claim, and counts a malformed criterion", () => {
    const raw = JSON.stringify({
      narration: "서술",
      delta: {
        players: [],
        questsAdd: [
          { title: "등대 조사", criterion: { type: "reach_location", place: "곶 끝의 등대" } },
          { title: "잘못된 기준", criterion: { type: "kill_everything" } },
        ],
        questsClaimDone: ["옛 목표"],
      },
    });
    const parsed = parseTrpgGmOutput(raw);
    assert.deepEqual(parsed.delta.questsAdd, ["등대 조사", "잘못된 기준"]);
    assert.deepEqual(parsed.delta.questCriteria, [
      { title: "등대 조사", criterion: { type: "reach_location", place: "곶 끝의 등대" } },
    ]);
    assert.deepEqual(parsed.delta.questsClaimDone, ["옛 목표"]);
    assert.equal(parsed.diagnostics?.questCriteriaRejected, 1);
  });
});
