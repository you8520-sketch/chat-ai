import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_GPT_56_TERRA_MODEL } from "@/lib/chatModels";
import {
  resolveRpSceneCastMode,
  shouldUseTerraTerminalLengthOwner,
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
} from "@/lib/terraTerminalLengthOwner";
import {
  appendCompactTerminalLengthToUserTurn,
  appendTerraTerminalLengthOwnerToUserTurn,
  buildCompactTerminalLengthAbsoluteTail,
  buildLengthInstruction,
  USER_TAIL_LENGTH_OWNER_SENTENCE,
} from "@/lib/responseLength";
import { isTerraTerminalLengthOwnerActive } from "@/lib/sharedNovelProseModelAdapters";

describe("terraTerminalLengthOwner", () => {
  it("classifies character as single_primary and simulation as simulation", () => {
    assert.equal(resolveRpSceneCastMode("character"), "single_primary");
    assert.equal(resolveRpSceneCastMode(undefined), "single_primary");
    assert.equal(resolveRpSceneCastMode("simulation"), "simulation");
  });

  it("never applies Terra contract gate (retired → USER_TAIL)", () => {
    assert.equal(
      shouldUseTerraTerminalLengthOwner({
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "character",
      }),
      false
    );
    assert.equal(
      isTerraTerminalLengthOwnerActive({
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "character",
      }),
      false
    );
  });

  it("production Terra path uses generic USER_TAIL (not contract)", () => {
    const out = appendCompactTerminalLengthToUserTurn("왼쪽 갈림길.", 3200, {
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
      runtimeMode: "interactive",
    });
    assert.ok(out.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(!out.includes(TERRA_TERMINAL_LENGTH_OWNER_CONTRACT));
    assert.doesNotMatch(out, /관찰·행동·대사·감각·심리의 인과적 연쇄/);
  });

  it("explicit terraTerminalLengthOwner seam still appends contract (test/canary)", () => {
    const block = buildLengthInstruction(3200, { terraTerminalLengthOwner: true });
    assert.doesNotMatch(block, /TARGET_LENGTH/);
    assert.doesNotMatch(block, /MINIMUM_FLOOR/);
    assert.equal(buildCompactTerminalLengthAbsoluteTail(3200, { terraTerminalLengthOwner: true }), "");

    const out = appendTerraTerminalLengthOwnerToUserTurn("왼쪽 갈림길.");
    assert.ok(out.startsWith("왼쪽 갈림길."));
    assert.match(out, /지문과 "…" 대사 사이 빈 줄/);
    assert.ok(out.trimEnd().endsWith(TERRA_TERMINAL_LENGTH_OWNER_CONTRACT));
  });
});
