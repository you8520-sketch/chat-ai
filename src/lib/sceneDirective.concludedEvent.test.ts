/**
 * Quiet-scene ESCALATE regression: a concluded mission / habitual "위험" in the
 * opening narration must not read as a present operation.
 * Deterministic — synthetic names and text only, no provider calls.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMsg } from "@/lib/ai";
import {
  buildSceneDirective,
  buildSceneSignalText,
  resolveSceneKind,
  type SceneDirectiveInput,
} from "@/lib/sceneDirective";
import { renderCompactScenePacingCue } from "@/lib/scenePacingController";

const QUIET_NIGHT_OOC = `OOC: 임무가 끝난 밤. 둘만 본부 숙소 창가에 있다. 다른 인물은 없다. 여기서부터 장면 계속.

주인공은 창틀에서 한 걸음 떨어져 유리 너머의 불빛만 본다. "오늘은 그냥 이렇게 있자."`;

const GREETING_WITH_PAST_MISSION: ChatMsg[] = [
  { role: "user", content: "(대화 시작)" },
  {
    role: "assistant",
    content:
      "복도는 오늘도 붐볐다. 임무를 마치고 복귀한 요원들이 지나갔다. 그들은 늘 위험과 긴장 속에 놓여 있었다.",
  },
];

function input(overrides: Partial<SceneDirectiveInput>): SceneDirectiveInput {
  return {
    mode: "interactive",
    recentMessages: [],
    currentUserMessage: "",
    chatId: "concluded-event-fixture",
    currentTurn: 1,
    progressionHistory: [],
    contentKind: "character",
    primaryCharacterName: "테스트요원",
    ...overrides,
  };
}

describe("concluded events are not present scene signals", () => {
  it("A: quiet night after a finished mission is not ESCALATE", () => {
    const directive = buildSceneDirective(
      input({ recentMessages: GREETING_WITH_PAST_MISSION, currentUserMessage: QUIET_NIGHT_OOC })
    );
    assert.notEqual(directive.motionDecision, "ESCALATE");
    assert.equal(directive.motionDecision, "MICRO_MOTION");
    assert.ok(!directive.progressionTypes.includes("tactical_planning"));
    assert.ok(!renderCompactScenePacingCue(directive).includes("ESCALATE"));
  });

  it("strips concluded spans in either word order, from every signal source", () => {
    for (const text of [
      "임무가 끝난 밤이다.",
      "작전이 끝나고 숙소로 돌아왔다.",
      "끝난 임무의 보고는 내일이다.",
      "전투 이후 둘은 말이 없었다.",
      "임무를 마치고 복귀했다.",
      "추적이 종료된 새벽이다.",
    ]) {
      const signal = buildSceneSignalText({ currentUserMessage: text });
      assert.equal(resolveSceneKind(signal), "neutral", text);
    }
    const viaHistory = buildSceneSignalText({
      recentMessages: [{ role: "assistant", content: "임무가 끝난 밤이다." }],
    });
    assert.equal(resolveSceneKind(viaHistory), "neutral");
  });

  it("an unfinished or ongoing operation still classifies as operation", () => {
    for (const text of [
      "임무가 끝나기 전에 문을 잠가야 한다.",
      "작전 중이다. 제한시간이 얼마 안 남았다.",
      "침투 시작한다.",
      "임무가 끝나지 않았다.",
    ]) {
      assert.equal(resolveSceneKind(buildSceneSignalText({ currentUserMessage: text })), "operation", text);
    }
  });

  it("a concluded mention does not hide a separate live danger in the same text", () => {
    const signal = buildSceneSignalText({
      currentUserMessage: "임무가 끝난 밤이었는데 갑자기 경보가 울린다.",
    });
    assert.equal(resolveSceneKind(signal), "operation");
  });
});

describe("habitual 위험 in older narration vs present-turn danger", () => {
  it("history-only 위험 does not make the scene an operation", () => {
    const signal = buildSceneSignalText({
      recentMessages: [{ role: "assistant", content: "그들은 늘 위험과 긴장 속에 놓여 있었다." }],
      currentUserMessage: "조용히 차를 마신다.",
    });
    assert.equal(resolveSceneKind(signal), "neutral");
  });

  it("present-turn 위험 still counts", () => {
    const directive = buildSceneDirective(input({ currentUserMessage: "위험해, 물러서." }));
    assert.equal(directive.motionDecision, "ESCALATE");
  });

  it("history 위험 still counts toward the recent-high-intensity cooldown", () => {
    const directive = buildSceneDirective(
      input({
        recentMessages: [{ role: "assistant", content: "경보가 울렸다. 복도는 위험하다." }],
        currentUserMessage: "숨을 고른다.",
      })
    );
    assert.equal(directive.recommendedIntensity, 0);
    assert.equal(directive.motionDecision, "HOLD");
  });
});

describe("real operation, danger, trigger, auto progression stay strong", () => {
  const liveOperation: ChatMsg[] = [
    { role: "assistant", content: "무전기가 울렸다. \"침투 시작. 제한시간 십 분.\"" },
  ];

  it("B: live operation with a dialogue-only user turn escalates", () => {
    const directive = buildSceneDirective(
      input({ recentMessages: liveOperation, currentUserMessage: "알겠어. 신호를 기다릴게." })
    );
    assert.equal(directive.motionDecision, "ESCALATE");
    assert.ok(directive.motionReasons.includes("scene_kind_escalation"));
  });

  it("B: user-led action in a live operation still holds for the user's move", () => {
    const directive = buildSceneDirective(
      input({ recentMessages: liveOperation, currentUserMessage: "문을 열고 달린다." })
    );
    assert.equal(directive.motionDecision, "HOLD");
    assert.ok(directive.motionReasons.includes("user_led_progress"));
  });

  it("C: ordinary daily conversation keeps a small motion, not a hold or escalation", () => {
    const directive = buildSceneDirective(
      input({
        recentMessages: [{ role: "assistant", content: "식탁에 국이 놓였다." }],
        currentUserMessage: "같이 먹자.",
      })
    );
    assert.equal(directive.motionDecision, "MICRO_MOTION");
  });

  it("D: an explicit trigger still escalates a strong event", () => {
    const directive = buildSceneDirective(
      input({
        recentMessages: [{ role: "assistant", content: "숙소 창가에 불빛이 번졌다." }],
        currentUserMessage: QUIET_NIGHT_OOC,
        triggeredEventText: "[TRIGGER] 숙소 경보가 울린다.",
      })
    );
    assert.equal(directive.motionDecision, "ESCALATE");
    assert.ok(directive.motionReasons.includes("trigger"));
  });

  it("E: auto progression of a live operation escalates and is never held", () => {
    const directive = buildSceneDirective(
      input({ mode: "auto_progression", recentMessages: liveOperation, currentUserMessage: "" })
    );
    assert.equal(directive.motionDecision, "ESCALATE");
  });

  it("E: auto progression of a quiet night after a mission stays a small motion", () => {
    const directive = buildSceneDirective(
      input({
        mode: "auto_progression",
        recentMessages: GREETING_WITH_PAST_MISSION,
        currentUserMessage: "임무가 끝난 밤.",
      })
    );
    assert.equal(directive.motionDecision, "MICRO_MOTION");
  });

  it("E: simulation content is never held for a quiet night", () => {
    const directive = buildSceneDirective(
      input({
        contentKind: "simulation",
        recentMessages: GREETING_WITH_PAST_MISSION,
        currentUserMessage: "임무가 끝난 밤.",
      })
    );
    assert.notEqual(directive.motionDecision, "HOLD");
    assert.notEqual(directive.motionDecision, "ESCALATE");
  });
});
