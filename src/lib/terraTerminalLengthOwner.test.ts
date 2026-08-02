import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_GPT_56_TERRA_MODEL } from "@/lib/chatModels";
import {
  resolveRpSceneCastMode,
  shouldUseTerraTerminalLengthOwner,
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
} from "@/lib/terraTerminalLengthOwner";
import {
  appendTerraTerminalLengthOwnerToUserTurn,
  buildCompactTerminalLengthAbsoluteTail,
  buildLengthInstruction,
} from "@/lib/responseLength";

describe("terraTerminalLengthOwner", () => {
  it("classifies character as single_primary and simulation as simulation", () => {
    assert.equal(resolveRpSceneCastMode("character"), "single_primary");
    assert.equal(resolveRpSceneCastMode(undefined), "single_primary");
    assert.equal(resolveRpSceneCastMode("simulation"), "simulation");
  });

  it("applies only for gpt-5.6-terra + single_primary", () => {
    assert.equal(
      shouldUseTerraTerminalLengthOwner({
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "character",
      }),
      true
    );
    assert.equal(
      shouldUseTerraTerminalLengthOwner({
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "simulation",
      }),
      false
    );
    assert.equal(
      shouldUseTerraTerminalLengthOwner({
        modelId: "gpt-5.6-luna",
        contentKind: "character",
      }),
      false
    );
  });

  it("strips TARGET_LENGTH / MINIMUM_FLOOR from length instruction when enabled", () => {
    const block = buildLengthInstruction(3200, { terraTerminalLengthOwner: true });
    assert.doesNotMatch(block, /TARGET_LENGTH/);
    assert.doesNotMatch(block, /MINIMUM_FLOOR/);
    assert.doesNotMatch(block, /\[LENGTH CONTROL/);
    assert.doesNotMatch(block, /한국어 장편 소설형 RP로/);
    assert.match(block, /\[SCENE EXPANSION\]/);
    assert.match(block, /\[SCENE CONTINUATION PRIORITY\]/);
    assert.match(block, /\[NARRATIVE DENSITY\]/);
    assert.equal(buildCompactTerminalLengthAbsoluteTail(3200, { terraTerminalLengthOwner: true }), "");
  });

  it("appends the exact terminal contract once at user-turn end", () => {
    const out = appendTerraTerminalLengthOwnerToUserTurn("왼쪽 갈림길.");
    assert.ok(out.startsWith("왼쪽 갈림길."));
    assert.match(out, /지문과 "…" 대사 사이 빈 줄/);
    assert.ok(out.trimEnd().endsWith(TERRA_TERMINAL_LENGTH_OWNER_CONTRACT));
    assert.equal(
      out.split(TERRA_TERMINAL_LENGTH_OWNER_CONTRACT).length - 1,
      1
    );
    assert.doesNotMatch(out, /TARGET_LENGTH/);
    assert.doesNotMatch(out, /MINIMUM_FLOOR/);
  });
});
