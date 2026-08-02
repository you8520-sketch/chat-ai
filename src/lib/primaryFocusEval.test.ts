import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { detectExternalNpcEntered, evaluatePrimaryFocus } from "@/lib/primaryFocusEval";

describe("primaryFocusEval — production smoke re-score", () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "data/world-motion-v1_1-main-home-smoke-turns.json"),
      "utf8"
    )
  ) as {
    primaryCharacter: string;
    knownSupportingNames: string[];
    turns: string[];
  };

  it("turn1: primary focus diluted when primary exits for supporting NPC call", () => {
    const r = evaluatePrimaryFocus({
      prose: fixture.turns[0],
      primaryCharacter: fixture.primaryCharacter,
      knownSupportingNames: fixture.knownSupportingNames,
    });
    assert.equal(r.primaryFocusDiluted, true);
    assert.ok(r.reasonCodes.includes("PRIMARY_EXIT_FOR_SUPPORTING_NPC"));
  });

  it("turn2: records supporting NPC dialogue pressure", () => {
    const r = evaluatePrimaryFocus({
      prose: fixture.turns[1],
      primaryCharacter: fixture.primaryCharacter,
      knownSupportingNames: fixture.knownSupportingNames,
    });
    assert.ok(r.supportingNpcDialogueBlocks >= 1);
  });

  it("turn3: detects grounded NPC fanout and focus dilution", () => {
    const r = evaluatePrimaryFocus({
      prose: fixture.turns[2],
      primaryCharacter: fixture.primaryCharacter,
      knownSupportingNames: fixture.knownSupportingNames,
    });
    assert.ok(r.supportingSpeakingNpcCount > 1);
    assert.equal(r.npcFanoutDetected, true);
    assert.equal(r.primaryFocusDiluted, true);
  });

  it("evaluator must not mark all three production smoke turns as PASS", () => {
    const results = fixture.turns.map((prose) =>
      evaluatePrimaryFocus({
        prose,
        primaryCharacter: fixture.primaryCharacter,
        knownSupportingNames: fixture.knownSupportingNames,
      })
    );
    const allPass = results.every((r) => !r.primaryFocusDiluted && !r.npcFanoutDetected);
    assert.equal(allPass, false);
  });

  it("dialogue ping-pong: flags excessive dialogue block count for single_primary", () => {
    const q = (s: string) => `\u201C${s}\u201D`;
    const pingpong = [
      `태형이 말했다.\n${q("안녕.")}\n서진화가 대답했다.\n${q("안녕하세요.")}`,
      `태형이 말했다.\n${q("뭐해?")}\n서진화가 대답했다.\n${q("일해요.")}`,
      `태형이 말했다.\n${q("그래.")}\n서진화가 대답했다.\n${q("네.")}`,
      `태형이 말했다.\n${q("잘가.")}\n서진화가 대답했다.\n${q("안녕히.")}`,
      `태형이 말했다.\n${q("다음에.")}\n서진화가 대답했다.\n${q("알았어요.")}`,
      `태형이 말했다.\n${q("잘자.")}\n서진화가 대답했다.\n${q("네.")}`,
      `태형이 말했다.\n${q("내일.")}\n서진화가 대답했다.\n${q("알았어요.")}`,
    ].join("\n");
    const r = evaluatePrimaryFocus({
      prose: pingpong,
      primaryCharacter: "태형",
      knownSupportingNames: ["서진화"],
      sceneCastMode: "single_primary",
    });
    assert.ok(r.totalDialogueBlockCount > 10, `total=${r.totalDialogueBlockCount}`);
    assert.ok(r.reasonCodes.includes("DIALOGUE_BLOCK_OVERFLOW"));
    assert.ok(r.longestAlternatingSpeakerChain > 4, `longest=${r.longestAlternatingSpeakerChain}`);
    assert.ok(r.reasonCodes.includes("DIALOGUE_PINGPONG"));
  });

  it("dialogue ping-pong: concentrated dialogue with few blocks passes", () => {
    const concentrated = [
      "태형이 포크를 내려놓고 렌을 바라보았다. 식사가 끝나가고 있었다.",
      "“오늘 본부에서 첫날이었지? 어땠어?”",
      "태형은 잠깐 생각하다가 어깨를 으쓱했다. 특별할 것은 없었다.",
      "“그냥 평범했어. 안내 받고, 식사하고, 이제 쉬면 되는 거지.”",
      "그 말에 렌이 고개를 끄덕였다. 태형은 물잔을 들어 한 모금 마셨다.",
    ].join("\n");
    const r = evaluatePrimaryFocus({
      prose: concentrated,
      primaryCharacter: "태형",
      knownSupportingNames: [],
      sceneCastMode: "single_primary",
    });
    assert.ok(r.totalDialogueBlockCount <= 6);
    assert.ok(!r.reasonCodes.includes("DIALOGUE_BLOCK_OVERFLOW"));
    assert.ok(!r.reasonCodes.includes("DIALOGUE_PINGPONG"));
    assert.equal(r.currentInteractionInterrupted, false);
  });

  it("single_primary budget exceeded: supportingSpeakingNpcCount > 1 is flagged", () => {
    const multi = [
      "태형이 말했다.\n“안녕.”\n서진화가 대답했다.\n“안녕하세요.”\n윤태건이 말했다.\n“반갑다.”",
    ].join("\n");
    const r = evaluatePrimaryFocus({
      prose: multi,
      primaryCharacter: "태형",
      knownSupportingNames: ["서진화", "윤태건"],
      sceneCastMode: "single_primary",
    });
    assert.ok(r.supportingSpeakingNpcCount > 1);
    assert.ok(r.reasonCodes.includes("SUPPORTING_CAST_BUDGET_EXCEEDED"));
  });
});

describe("detectExternalNpcEntered — entrance vs non-entrance", () => {
  const npcs = ["윤태건", "태건"];

  it("negated entrance is false", () => {
    assert.equal(
      detectExternalNpcEntered("태건은 아직 나타나지 않았다. 식당은 조용했다.", npcs),
      false
    );
    assert.equal(
      detectExternalNpcEntered("오늘은 복도 쪽에서도 익숙한 목소리가 들리지 않았다.", npcs),
      false
    );
    assert.equal(
      detectExternalNpcEntered("태건이 나타날 기색이 없었다.", npcs),
      false
    );
  });

  it("hypothetical entrance is false", () => {
    assert.equal(
      detectExternalNpcEntered(
        "평소라면 태건이 어디선가 나타나 쓸데없는 말을 보탰을 시간이었다.",
        npcs
      ),
      false
    );
    assert.equal(
      detectExternalNpcEntered("태건이 있었다면 벌써 끼어들었을 것이다.", npcs),
      false
    );
  });

  it("remembered entrance is false", () => {
    assert.equal(
      detectExternalNpcEntered(
        "태형은 지난번 태건이 식당에 들어왔던 기억을 떠올렸다.",
        npcs
      ),
      false
    );
  });

  it("offscreen mention is false", () => {
    assert.equal(
      detectExternalNpcEntered("윤태건은 복도 쪽에 있을 수도 있었다.", npcs),
      false
    );
  });

  it("actual entrance is true", () => {
    assert.equal(
      detectExternalNpcEntered("윤태건이 문을 열고 들어왔다. 식탁 쪽으로 걸어왔다.", npcs),
      true
    );
    assert.equal(
      detectExternalNpcEntered("태건이 식당에 모습을 드러냈다.", npcs),
      true
    );
    assert.equal(
      detectExternalNpcEntered("윤태건이 식탁 옆에 앉았다.", npcs),
      true
    );
  });

  it("actual direct dialogue is true", () => {
    assert.equal(
      detectExternalNpcEntered('윤태건이 웃으며 말했다. "늦어서 미안."', npcs),
      true
    );
  });

  it("C1 consolidation prose (negated/hypothetical only) is false", () => {
    const c1Prose =
      '평소라면 태건이 어디선가 나타나 쓸데없는 말을 보탰을 시간이었지만, 오늘은 복도 쪽에서도 익숙한 목소리가 들리지 않았다.';
    assert.equal(detectExternalNpcEntered(c1Prose, npcs), false);
  });
});
