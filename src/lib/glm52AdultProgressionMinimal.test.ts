import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION } from "@/lib/adultSceneRouting";
import {
  GLM52_ADULT_PROGRESSION_MINIMAL,
  GLM52_ADULT_PROGRESSION_MINIMAL_TITLE,
  injectGlmAdultProgressionMinimal,
  progressionFlags,
} from "@/lib/glm52AdultProgressionMinimal";

describe("GLM52 adult progression minimal — audit only", () => {
  it("places the block immediately after the common handoff instruction", () => {
    const system = `rules\n\n${DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION}`;
    const out = injectGlmAdultProgressionMinimal(system);
    const handoffIdx = out.indexOf(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION);
    const blockIdx = out.indexOf(GLM52_ADULT_PROGRESSION_MINIMAL);
    assert.ok(handoffIdx >= 0);
    assert.ok(blockIdx > handoffIdx);
    assert.equal(
      out.indexOf(GLM52_ADULT_PROGRESSION_MINIMAL_TITLE, blockIdx + 1),
      -1
    );
    assert.match(out, /ALREADY_AUTHORIZED|다음 단계 진행이 이미 명시적으로 허용/);
    assert.doesNotMatch(out, /더 노골적으로|더 야하게|장문으로|서술 비율/);
  });

  it("treats user-intent restatement as no actual explicit progress", () => {
    const flags = progressionFlags(
      "렌의 다리가 벌어졌다. 삽입해도 된다는 뜻이었다. 라이크는 그 의미를 읽었다."
    );
    assert.equal(flags.explicitKeywordMentioned, true);
    assert.equal(flags.actualExplicitActionProgressed, false);
  });

  it("marks an actual next-step action as progressed", () => {
    const flags = progressionFlags(
      "라이크는 허리를 낮추고 천천히 삽입했다. 삽입한 채 숨을 골랐다."
    );
    assert.equal(flags.actualExplicitActionProgressed, true);
    assert.equal(flags.stoppedAtConsentCheckpoint, false);
  });

  it("does not treat a kiss tongue push as explicit progress", () => {
    const flags = progressionFlags(
      "렌이 다시 입술을 가져왔다. 혀를 밀어 넣고 입안을 훑는 키스였다. 삽입해도 된다는 뜻이었다."
    );
    assert.equal(flags.actualExplicitActionProgressed, false);
    assert.equal(flags.explicitKeywordMentioned, true);
  });

  it("detects a safeword / permission stall at the end", () => {
    const flags = progressionFlags(
      `키스가 깊어졌다.\n\n"세이프워드."\n\n"지금 정해. 정했어?"\n\n대답을 기다렸다.`
    );
    assert.equal(flags.stoppedAtConsentCheckpoint, true);
    assert.equal(flags.endedOnPermissionQuestion, true);
    assert.equal(flags.actualExplicitActionProgressed, false);
  });
});
