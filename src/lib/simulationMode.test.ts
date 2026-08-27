import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSimulationModeBlock,
  buildSimulationSystemPrompt,
  extractSimulationCastEntries,
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

  it("parses character settings blocks through one canonical owner", () => {
    const entries = extractSimulationCastEntries(
      "[김태환]\n외형: 검은 머리\n성격: 무뚝뚝함\n\n[김성찬]\n외관: 회색 눈"
    );
    assert.deepEqual(entries, [
      { name: "김태환", settings: "외형: 검은 머리\n성격: 무뚝뚝함" },
      { name: "김성찬", settings: "외관: 회색 눈" },
    ]);
  });

  it("preserves simulation rules in the existing prompt section", () => {
    const rules = "인물은 자신이 직접 알게 된 정보만 사용한다.";
    const prompt = buildSimulationSystemPrompt({
      cast: "[A]\n외형: 검은 머리",
      rules,
    });
    assert.match(prompt, new RegExp(`\\[SIMULATION-SPECIFIC RULES\\]\\n${rules}`));
  });

  it("defines an ensemble without changing user agency systems", () => {
    const block = buildSimulationModeBlock("왕궁의 밤");
    assert.match(block, /\[AI_CAST\]/);
    assert.match(block, /시뮬레이션 제목/);
    assert.match(block, /No Godmodding/);
    assert.match(block, /유저 페르소나는 \[AI_CAST\]가 아니다/);
  });
});
