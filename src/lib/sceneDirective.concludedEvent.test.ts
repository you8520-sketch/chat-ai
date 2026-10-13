/**
 * Quiet-scene ESCALATE regression: finished missions and an explicit OOC scene
 * transition must not be overridden by opening-narration keywords, while a live
 * danger, trigger or auto progression keeps its strong pacing.
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
import {
  applyProductionServerControlsToMessages,
  renderCompactScenePacingCue,
} from "@/lib/scenePacingController";

const QUIET_NIGHT_OOC = `OOC: 임무가 끝난 밤. 둘만 본부 숙소 창가에 있다. 다른 인물은 없다. 여기서부터 장면 계속.

주인공은 창틀에서 한 걸음 떨어져 유리 너머의 불빛만 본다. "오늘은 그냥 이렇게 있자."`;

/** Lobby greeting that carries generic investigation / danger / mission wording. */
const LOBBY_GREETING: ChatMsg[] = [
  { role: "user", content: "(대화 시작)" },
  {
    role: "assistant",
    content:
      "로비는 오늘도 붐볐다. 임무를 마치고 복귀한 요원들이 기록을 넘기고 단서 목록을 확인했다. 그들은 늘 위험과 긴장 속에 놓여 있었다. 데스크 위에는 조사 보고서와 메시지 쪽지가 쌓여 있었다.",
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

function productionPacing(sceneInput: SceneDirectiveInput) {
  const directive = buildSceneDirective(sceneInput);
  const applied = applyProductionServerControlsToMessages({
    messages: [
      { role: "system", content: "BASE SYSTEM" },
      ...(sceneInput.recentMessages ?? []),
      { role: "user", content: sceneInput.currentUserMessage ?? "" },
    ],
    mode: sceneInput.mode,
    contentKind: sceneInput.contentKind,
    party: false,
    primaryCharacterName: sceneInput.primaryCharacterName,
    currentUserMessage: sceneInput.currentUserMessage,
    recentMessages: sceneInput.recentMessages,
    triggeredEventText: sceneInput.triggeredEventText,
    chatId: sceneInput.chatId,
    currentTurn: sceneInput.currentTurn,
    progressionHistory: [],
    canonicalSceneDirective: directive,
  });
  return { directive, decision: applied.decision, system: applied.messages[0]?.content ?? "" };
}

describe("A: explicit OOC scene transition outranks opening narration", () => {
  it("lobby greeting full of generic keywords does not override the declared quiet night", () => {
    const { directive, decision, system } = productionPacing(
      input({ recentMessages: LOBBY_GREETING, currentUserMessage: QUIET_NIGHT_OOC })
    );
    assert.equal(directive.motionDecision, "MICRO_MOTION");
    assert.equal(decision.pacingMode, "DYAD");
    assert.equal(decision.sceneKind, "neutral");
    assert.ok(!directive.progressionTypes.includes("tactical_planning"));
    assert.ok(!directive.progressionTypes.includes("lore_clue"));
    assert.ok(!renderCompactScenePacingCue(directive).includes("ESCALATE"));
    assert.ok(!system.includes("ESCALATE"));
  });

  it("the greeting alone, without a transition, still feeds the signal", () => {
    const signal = buildSceneSignalText({
      recentMessages: LOBBY_GREETING,
      currentUserMessage: "조용히 차를 마신다.",
    });
    assert.notEqual(resolveSceneKind(signal), "neutral");
  });

  it("a transition that restates a live operation still escalates", () => {
    const directive = buildSceneDirective(
      input({
        recentMessages: LOBBY_GREETING,
        currentUserMessage: "OOC: 지금부터 제한시간 십 분짜리 침투 장면.\n\n\"신호 줘.\"",
      })
    );
    assert.equal(directive.motionDecision, "ESCALATE");
  });

  it("an OOC without a transition leaves the live danger in the signal", () => {
    const signal = buildSceneSignalText({
      recentMessages: [{ role: "assistant", content: "경보가 울린다. 지금 위험해!" }],
      currentUserMessage: "OOC: 조금 천천히 진행해줘.\n\n알겠어.",
    });
    assert.equal(resolveSceneKind(signal), "operation");
  });
});

describe("finished events are not present scene signals (per message)", () => {
  it("strips concluded spans in either word order", () => {
    for (const text of [
      "임무가 끝난 밤이다.",
      "작전이 끝나고 숙소로 돌아왔다.",
      "끝난 임무의 보고는 내일이다.",
      "전투 이후 둘은 말이 없었다.",
      "임무를 마치고 복귀했다.",
      "추적이 종료된 새벽이다.",
    ]) {
      assert.equal(resolveSceneKind(buildSceneSignalText({ currentUserMessage: text })), "neutral", text);
    }
    const viaHistory = buildSceneSignalText({
      recentMessages: [{ role: "assistant", content: "임무가 끝난 밤이다." }],
    });
    assert.equal(resolveSceneKind(viaHistory), "neutral");
  });

  it("unfinished or ongoing wording still classifies as operation", () => {
    for (const text of [
      "임무가 끝나기 전에 문을 잠가야 한다.",
      "작전 중이다. 제한시간이 얼마 안 남았다.",
      "침투 시작한다.",
      "임무가 끝나지 않았다.",
    ]) {
      assert.equal(resolveSceneKind(buildSceneSignalText({ currentUserMessage: text })), "operation", text);
    }
  });

  it("a concluded mention does not hide a separate live danger in the same message", () => {
    const signal = buildSceneSignalText({
      currentUserMessage: "임무가 끝난 밤이었는데 갑자기 경보가 울린다.",
    });
    assert.equal(resolveSceneKind(signal), "operation");
  });

  it("words from neighbouring messages never combine into a fake conclusion", () => {
    const signal = buildSceneSignalText({
      recentMessages: [
        { role: "assistant", content: "경보" },
        { role: "user", content: "이후 상황을 보자." },
      ],
      currentUserMessage: "",
    });
    assert.equal(resolveSceneKind(signal), "operation");
    const reversed = buildSceneSignalText({
      recentMessages: [{ role: "assistant", content: "끝난" }],
      currentUserMessage: "임무를 확인한다.",
    });
    assert.equal(resolveSceneKind(reversed), "operation");
  });
});

describe("real operation, danger, trigger, auto progression stay strong", () => {
  const liveOperation: ChatMsg[] = [
    { role: "assistant", content: "무전기가 울렸다. \"침투 시작. 제한시간 십 분.\"" },
  ];

  it("B: live danger announced by the previous assistant survives a dialogue-only reply", () => {
    const directive = buildSceneDirective(
      input({
        recentMessages: [{ role: "assistant", content: "\"지금 위험해. 벽 쪽으로 붙어.\"" }],
        currentUserMessage: "알겠어.",
      })
    );
    assert.equal(directive.motionDecision, "ESCALATE");
    assert.ok(directive.motionReasons.includes("scene_kind_escalation"));
  });

  it("B: live operation with a dialogue-only user turn escalates", () => {
    const directive = buildSceneDirective(
      input({ recentMessages: liveOperation, currentUserMessage: "알겠어. 신호를 기다릴게." })
    );
    assert.equal(directive.motionDecision, "ESCALATE");
  });

  it("B: user-led action in a live operation still holds for the user's move", () => {
    const directive = buildSceneDirective(
      input({ recentMessages: liveOperation, currentUserMessage: "문을 열고 달린다." })
    );
    assert.equal(directive.motionDecision, "HOLD");
    assert.ok(directive.motionReasons.includes("user_led_progress"));
  });

  it("C: ordinary daily conversation keeps a small motion", () => {
    const directive = buildSceneDirective(
      input({
        recentMessages: [{ role: "assistant", content: "식탁에 국이 놓였다." }],
        currentUserMessage: "같이 먹자.",
      })
    );
    assert.equal(directive.motionDecision, "MICRO_MOTION");
  });

  it("D: an explicit trigger still escalates a strong event over a declared quiet scene", () => {
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

  it("E: auto progression after a finished mission stays a small motion", () => {
    const directive = buildSceneDirective(
      input({
        mode: "auto_progression",
        recentMessages: LOBBY_GREETING,
        currentUserMessage: "임무가 끝난 밤.",
      })
    );
    assert.notEqual(directive.motionDecision, "HOLD");
  });

  it("E: simulation content is never held for a quiet night", () => {
    const directive = buildSceneDirective(
      input({
        contentKind: "simulation",
        recentMessages: [{ role: "assistant", content: "숙소 복도에 불이 꺼졌다." }],
        currentUserMessage: "임무가 끝난 밤.",
      })
    );
    assert.notEqual(directive.motionDecision, "HOLD");
    assert.notEqual(directive.motionDecision, "ESCALATE");
  });
});
