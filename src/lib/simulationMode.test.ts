import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSimulationModeBlock,
  buildSimulationSystemPrompt,
  parseContentKind,
} from "./simulationMode";

describe("simulation mode", () => {
  it("keeps legacy content as a regular character", () => {
    assert.equal(parseContentKind(undefined), "character");
    assert.equal(parseContentKind("unknown"), "character");
  });

  it("keeps free-form creator cast text intact", () => {
    const prompt = buildSimulationSystemPrompt({
      cast: "[A]\n- 냉정한 기사\n\n[B]\n- 왕실 마법사",
      rules: "둘은 서로의 비밀을 모른다.",
    });
    assert.match(prompt, /\[A\][\s\S]*\[B\]/);
    assert.match(prompt, /둘은 서로의 비밀을 모른다/);
  });

  it("defines an ensemble without changing user agency systems", () => {
    const block = buildSimulationModeBlock("왕궁의 밤");
    assert.match(block, /\[AI_CAST\]/);
    assert.match(block, /시뮬레이션 제목/);
    assert.match(block, /No Godmodding/);
    assert.match(block, /유저 페르소나는 \[AI_CAST\]가 아니다/);
  });
});
