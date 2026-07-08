import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRuntimePromptContaminationGuardBlock,
  findPossibleFalseSharedMemoryPhrases,
  logPossibleFalseSharedMemory,
  sanitizeRuntimePromptSource,
  stripRuntimePromptContaminationFromVisibleOutput,
} from "./runtimePromptContaminationGuard";

describe("runtimePromptContaminationGuard", () => {
  it("strips speech rule leakage from visible output", () => {
    const raw = [
      "레온은 잠시 손을 고르고 렌을 바라보았다.",
      "SPEECH LOCK: private_with_user register_by_context 적용.",
      "\"늦었어. 그래도 기다렸어.\"",
    ].join("\n");

    assert.equal(
      stripRuntimePromptContaminationFromVisibleOutput(raw),
      "레온은 잠시 손을 고르고 렌을 바라보았다.\n\"늦었어. 그래도 기다렸어.\""
    );
  });

  it("strips snake_case and _TOUCH_ leakage from visible output", () => {
    const raw = [
      "문가의 불빛이 희미하게 흔들렸다.",
      "private_with_user _TOUCH_SHOULDER_ event_effect: intimacy_up",
      "레온은 코트를 조용히 걸쳐 주었다.",
    ].join("\n");

    assert.equal(
      stripRuntimePromptContaminationFromVisibleOutput(raw),
      "문가의 불빛이 희미하게 흔들렸다.\n레온은 코트를 조용히 걸쳐 주었다."
    );
  });

  it("strips hidden D-DAY and spoiler leakage from visible output", () => {
    const raw = [
      "비가 유리창을 두드렸다.",
      "Hidden D-DAY spoiler: D-3 confession trigger opens.",
      "그는 아무 말 없이 젖은 머리칼을 넘겼다.",
    ].join("\n");

    assert.equal(
      stripRuntimePromptContaminationFromVisibleOutput(raw),
      "비가 유리창을 두드렸다.\n그는 아무 말 없이 젖은 머리칼을 넘겼다."
    );
  });

  it("strips leaked private scene directive labels from visible output", () => {
    const raw = [
      "레온은 잠시 창밖을 보다가 낮게 숨을 골랐다.",
      "[이번 턴 장면 지시 - 비공개]\n권장 강도: 2\n전개 방향: 관계 변화",
      "recentStagnation: true progressionTypes: relationship",
      "\"조금만 앉아 있어. 금방 돌아올게.\"",
    ].join("\n");

    assert.equal(
      stripRuntimePromptContaminationFromVisibleOutput(raw),
      "레온은 잠시 창밖을 보다가 낮게 숨을 골랐다.\n\"조금만 앉아 있어. 금방 돌아올게.\""
    );
  });

  it("passes normal Korean prose", () => {
    const raw = [
      "레온은 렌의 어깨에 코트를 걸쳐 주고 한 걸음 물러섰다.",
      "\"감기 걸리면 곤란하잖아.\"",
      "말끝은 무심했지만 손끝은 아직 망설임을 안고 있었다.",
    ].join("\n");

    assert.equal(stripRuntimePromptContaminationFromVisibleOutput(raw), raw);
  });

  it("filters contaminated long-term memory and lorebook source lines", () => {
    const raw = [
      "렌은 북부 기사단 출신이다.",
      "subject: private_with_user attribute: speech_style value: informal",
      "D-DAY spoiler trigger condition hidden.",
      "레온은 렌에게 오래된 코트를 맡겼다.",
    ].join("\n");

    assert.equal(
      sanitizeRuntimePromptSource(raw),
      "렌은 북부 기사단 출신이다.\n레온은 렌에게 오래된 코트를 맡겼다."
    );
  });

  it("detects possible unsupported shared memory phrases without hard-blocking them", () => {
    const raw = "네가 전에 말했잖아. 에카르트의 문장은 달리는 늑대라고.";

    assert.deepEqual(findPossibleFalseSharedMemoryPhrases(raw), ["전에 말했잖아"]);
    assert.equal(stripRuntimePromptContaminationFromVisibleOutput(raw), raw);
  });

  it("logs possible false shared memory phrase in development", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalWarn = console.warn;
    const calls: unknown[][] = [];
    process.env.NODE_ENV = "development";
    console.warn = (...args: unknown[]) => {
      calls.push(args);
    };

    try {
      const phrases = logPossibleFalseSharedMemory("전에 네가 알려줬잖아. 그때 네가 약속했잖아.");

      assert.deepEqual(phrases, ["그때 네가", "네가 약속했잖아", "전에 네가 알려줬잖아"]);
      assert.equal(calls.length, 1);
      assert.match(String(calls[0][0]), /\[FalseMemoryGuard\]/);
    } finally {
      console.warn = originalWarn;
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("adds Qwen and DeepSeek anti-leak reinforcement without trigger schema", () => {
    const block = buildRuntimePromptContaminationGuardBlock("qwen/qwen3.7-max");

    assert.match(block, /Qwen\/DeepSeek 보강/);
    assert.match(block, /상태창 키, 숨은 트리거, D-DAY 결과/);
    assert.doesNotMatch(block, /trigger schema/i);
    assert.doesNotMatch(block, /trigger evaluator/i);
    assert.doesNotMatch(block, /fire_once logic/i);
  });
});
