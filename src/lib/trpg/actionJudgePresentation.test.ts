import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildRoundPresentationActors,
  historicalPresentation,
  resultLaneActorIds,
  shouldShowActionJudgeBlock,
  shouldShowActorResultLane,
  shouldShowCompactRoll,
  startCinematicPresentation,
} from "./roundPresentation";

function aiAction(participantId: number, name: string, body: string) {
  return {
    participantId,
    name,
    body,
    revealed: true,
    kind: "ai_character" as const,
    actionType: "talk" as const,
  };
}

function humanAction(participantId: number, name: string, body: string) {
  return {
    participantId,
    name,
    body,
    revealed: true,
    kind: "human" as const,
    actionType: "free" as const,
  };
}

function humanRoll(participantId: number, d20: number) {
  return {
    participantId,
    name: "유저",
    d20,
    dc: 12,
    tier: "SUCCESS" as const,
    statKey: "dex",
    finalScore: d20 + 2,
    success: true,
    actionBody: "",
    actionType: "free" as const,
    kind: "human" as const,
  };
}

function judgeVisible(opts: {
  kind: string;
  hasIntent: boolean;
  hasRoll: boolean;
  laneIds: number[] | null | undefined;
  participantId: number;
}): boolean {
  const resultRevealed = opts.laneIds == null || opts.laneIds.includes(opts.participantId);
  return shouldShowActionJudgeBlock({
    kind: opts.kind,
    hasIntent: opts.hasIntent,
    hasRoll: opts.hasRoll,
    resultRevealed,
  });
}

describe("TRPG action judge metadata presentation order", () => {
  const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");

  it("SceneTurn uses resultLaneActorIds owner for judge metadata", () => {
    assert.match(room, /resultRevealed = laneIds == null \|\| laneIds\.includes\(action\.participantId\)/);
    assert.match(room, /shouldShowActionJudgeBlock/);
  });

  it("T_JUDGE_AI_PROGRESSIVE_NO_ROLL: no metadata during actor-action for no-roll AI", () => {
    const actors: PresentationActor[] = buildRoundPresentationActors({
      resolutionOrder: [20],
      actions: [
        aiAction(20, "동료1", '{"intent":"조용히 속삭인다","prose":"..."}'),
      ],
      rolls: [],
    });
    const duringAction = {
      mode: "cinematic" as const,
      phase: "actor-action" as const,
      presentationIndex: 0,
    };
    const laneIds = resultLaneActorIds({ actors, state: duringAction });

    assert.equal(shouldShowActorResultLane({ actorId: 20, actors, state: duringAction }), false);
    assert.deepEqual(laneIds, []);
    assert.equal(
      judgeVisible({
        kind: "ai_character",
        hasIntent: true,
        hasRoll: false,
        laneIds,
        participantId: 20,
      }),
      false,
      "GM_JUDGE_VISIBLE=false"
    );
    assert.equal(
      shouldShowActionJudgeBlock({
        kind: "ai_character",
        hasIntent: true,
        hasRoll: false,
        resultRevealed: false,
      }),
      false,
      "INTENT_VISIBLE=false"
    );
    assert.equal(
      shouldShowActionJudgeBlock({
        kind: "ai_character",
        hasIntent: false,
        hasRoll: false,
        resultRevealed: false,
      }),
      false,
      "NO_ROLL_LABEL_VISIBLE=false"
    );

    const afterAction = {
      mode: "cinematic" as const,
      phase: "gm-narration" as const,
      presentationIndex: 0,
    };
    const afterLaneIds = resultLaneActorIds({ actors, state: afterAction });
    assert.equal(shouldShowActorResultLane({ actorId: 20, actors, state: afterAction }), true);
    assert.deepEqual(afterLaneIds, [20]);
    assert.equal(
      judgeVisible({
        kind: "ai_character",
        hasIntent: true,
        hasRoll: false,
        laneIds: afterLaneIds,
        participantId: 20,
      }),
      true,
      "GM_JUDGE_VISIBLE=true after beat"
    );
    assert.equal(
      shouldShowActionJudgeBlock({
        kind: "ai_character",
        hasIntent: false,
        hasRoll: false,
        resultRevealed: true,
      }),
      true,
      "NO_ROLL_LABEL_VISIBLE=true after beat"
    );
  });

  it("T_JUDGE_AI_PROGRESSIVE_WITH_ROLL: metadata only after actor-result", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [20],
      actions: [aiAction(20, "동료1", '{"intent":"문을 연다","prose":"..."}')],
      rolls: [
        {
          participantId: 20,
          name: "동료1",
          d20: 14,
          dc: 12,
          tier: "SUCCESS",
          statKey: "dex",
          finalScore: 16,
          success: true,
          actionBody: "",
          actionType: "talk",
          kind: "ai_character",
        },
      ],
    });
    const duringAction = { mode: "cinematic" as const, phase: "actor-action" as const, presentationIndex: 0 };
    const duringDice = { mode: "cinematic" as const, phase: "actor-dice" as const, presentationIndex: 0 };
    const duringResult = { mode: "cinematic" as const, phase: "actor-result" as const, presentationIndex: 0 };

    for (const state of [duringAction, duringDice]) {
      const laneIds = resultLaneActorIds({ actors, state });
      assert.deepEqual(laneIds, [], `lane hidden during ${state.phase}`);
      assert.equal(
        judgeVisible({
          kind: "ai_character",
          hasIntent: true,
          hasRoll: true,
          laneIds,
          participantId: 20,
        }),
        false,
        `GM_JUDGE_VISIBLE=false during ${state.phase}`
      );
      assert.equal(
        shouldShowCompactRoll({ actorId: 20, actors, state }),
        false,
        `COMPACT_ROLL_VISIBLE=false during ${state.phase}`
      );
    }

    const resultLane = resultLaneActorIds({ actors, state: duringResult });
    assert.deepEqual(resultLane, [20]);
    assert.equal(
      judgeVisible({
        kind: "ai_character",
        hasIntent: true,
        hasRoll: true,
        laneIds: resultLane,
        participantId: 20,
      }),
      true,
      "GM_JUDGE_VISIBLE=true after dice dismiss"
    );
    assert.equal(
      shouldShowCompactRoll({ actorId: 20, actors, state: duringResult }),
      true,
      "COMPACT_ROLL_VISIBLE=true after actor-result"
    );
  });

  it("T_JUDGE_QUEUED_AI_NO_SPOILER: held AI keeps judge metadata hidden", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [20, 30],
      actions: [
        aiAction(20, "동료1", '{"intent":"먼저","prose":"..."}'),
        aiAction(30, "동료2", '{"intent":"나중","prose":"..."}'),
      ],
      rolls: [],
    });
    const ai1Active = { mode: "cinematic" as const, phase: "actor-action" as const, presentationIndex: 0 };
    const laneIds = resultLaneActorIds({ actors, state: ai1Active });

    assert.equal(shouldShowActorResultLane({ actorId: 30, actors, state: ai1Active }), false);
    assert.equal(
      judgeVisible({
        kind: "ai_character",
        hasIntent: true,
        hasRoll: false,
        laneIds,
        participantId: 30,
      }),
      false,
      "AI2 GM judge=false"
    );
    assert.equal(
      judgeVisible({
        kind: "ai_character",
        hasIntent: true,
        hasRoll: false,
        laneIds: [],
        participantId: 30,
      }),
      false,
      "AI2 intent=false while queued"
    );
  });

  it("T_JUDGE_HUMAN_RESULT_NO_SPOILER: human body visible but judgment gated", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [10],
      actions: [humanAction(10, "유저", "문을 연다.")],
      rolls: [humanRoll(10, 14)],
    });
    const duringAction = { mode: "cinematic" as const, phase: "actor-action" as const, presentationIndex: 0 };
    const duringDice = { mode: "cinematic" as const, phase: "actor-dice" as const, presentationIndex: 0 };
    const duringResult = { mode: "cinematic" as const, phase: "actor-result" as const, presentationIndex: 0 };

    for (const state of [duringAction, duringDice]) {
      const laneIds = resultLaneActorIds({ actors, state });
      assert.equal(
        judgeVisible({
          kind: "human",
          hasIntent: false,
          hasRoll: true,
          laneIds,
          participantId: 10,
        }),
        false,
        `human judgment/result=false before actor-result (${state.phase})`
      );
    }

    const resultLane = resultLaneActorIds({ actors, state: duringResult });
    assert.equal(
      judgeVisible({
        kind: "human",
        hasIntent: false,
        hasRoll: true,
        laneIds: resultLane,
        participantId: 10,
      }),
      true,
      "human judgment/result=true after actor-result"
    );
  });

  it("T_JUDGE_HISTORICAL_UNCHANGED: historical mode reveals all judge metadata", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [20],
      actions: [aiAction(20, "동료1", '{"intent":"spoiler ok","prose":"..."}')],
      rolls: [],
    });
    const hist = historicalPresentation();
    const laneIds = resultLaneActorIds({ actors, state: hist });
    assert.deepEqual(laneIds, [20]);
    assert.equal(
      judgeVisible({
        kind: "ai_character",
        hasIntent: true,
        hasRoll: false,
        laneIds: undefined,
        participantId: 20,
      }),
      true,
      "historical laneIds undefined → resultRevealed true"
    );
    assert.equal(shouldShowActorResultLane({ actorId: 20, actors, state: hist }), true);
  });

  it("incremental live row keeps judge hidden until cinematic result lane opens", () => {
    const liveLaneIds: number[] = [];
    assert.equal(
      judgeVisible({
        kind: "ai_character",
        hasIntent: true,
        hasRoll: false,
        laneIds: liveLaneIds,
        participantId: 20,
      }),
      false
    );
    assert.equal(
      shouldShowActionJudgeBlock({
        kind: "ai_character",
        hasIntent: true,
        hasRoll: true,
        resultRevealed: false,
      }),
      false,
      "intent cannot bypass resultRevealed"
    );
  });

  it("middle no-roll actor shows metadata after its beat advances", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [10, 20, 30],
      actions: [
        humanAction(10, "유저", "a"),
        aiAction(20, "동료", '{"intent":"talk","prose":"..."}'),
        aiAction(30, "동료2", "b"),
      ],
      rolls: [humanRoll(10, 12)],
    });
    const talkBeat = { mode: "cinematic" as const, phase: "actor-action" as const, presentationIndex: 1 };
    assert.equal(shouldShowActorResultLane({ actorId: 20, actors, state: talkBeat }), false);

    const nextBeat = { mode: "cinematic" as const, phase: "actor-action" as const, presentationIndex: 2 };
    assert.equal(shouldShowActorResultLane({ actorId: 20, actors, state: nextBeat }), true);
    assert.deepEqual(resultLaneActorIds({ actors, state: nextBeat }), [10, 20]);
  });
});
