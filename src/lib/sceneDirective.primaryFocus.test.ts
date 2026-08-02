import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSceneDirective,
  renderPrimaryFocusLine,
  renderSceneDirectiveForPrompt,
  resolveSceneCastFocus,
} from "@/lib/sceneDirective";

describe("world-motion-v1.1.1 primary focus (server cast focus)", () => {
  it("single-character settings resolve to single_primary with budget 1", () => {
    const focus = resolveSceneCastFocus({
      contentKind: "character",
      primaryCharacterName: "태형",
    });
    assert.equal(focus.sceneCastMode, "single_primary");
    assert.equal(focus.primaryCharacterName, "태형");
    assert.equal(focus.supportingCastBudget, 1);
  });

  it("does not flip to ensemble/simulation from multi-NPC recent messages", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 11,
      currentTurn: 3,
      recentMessages: [
        {
          role: "assistant",
          content:
            "윤태건이 말했다. 직원이 말했다. 가이드가 말했다. 센티넬이 말했다.",
        },
      ],
      currentUserMessage: "응. 여기서 조금 쉬자.",
    });
    assert.equal(d.castFocus.sceneCastMode, "single_primary");
    assert.equal(d.castFocus.supportingCastBudget, 1);
  });

  it("operation/meeting keywords alone do not switch cast mode", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 12,
      currentTurn: 4,
      currentUserMessage: "작전 회의에서 임무 브리핑을 듣자.",
    });
    assert.equal(d.castFocus.sceneCastMode, "single_primary");
  });

  it("renders one positive primary-focus line for single_primary and never exposes budget", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 13,
      currentTurn: 5,
      currentUserMessage: "응. 여기서 조금 쉬자.",
      recentMessages: [
        { role: "assistant", content: "태형이 포크를 내려놓고 렌을 바라보았다." },
      ],
    });
    const block = renderSceneDirectiveForPrompt(d);
    const line = renderPrimaryFocusLine(d.castFocus);
    assert.ok(line);
    assert.equal((block.match(/직접 발화 중심:/g) ?? []).length, 1);
    assert.match(block, /직접 발화 중심: 태형\./);
    assert.doesNotMatch(block, /supportingCastBudget|발화자\s*1명|직원.*말시키지|퇴장시키지/);
    assert.ok(block.length < 650, `directive length ${block.length}`);
    assert.equal((block.match(/\[PRIVATE SCENE ENGINE RULE\]/g) ?? []).length, 1);
  });

  it("keeps npc_action available while framing through primary interaction", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 14,
      currentTurn: 6,
      currentUserMessage: "동료가 부르나?",
      recentMessages: [
        { role: "assistant", content: "식당 안. 태형이 렌과 식사 중이다. 동료 윤태건이 입구에 있다." },
      ],
    });
    // Must not strip npc_action from the type union / selection space — only soft-frame hint.
    assert.ok(Array.isArray(d.progressionTypes));
    if (d.progressionTypes.includes("npc_action")) {
      assert.match(
        d.nextBeatHint ?? "",
        /중심 인물|장면 밖 결과|메시지·환경|현재 상호작용/
      );
    }
    assert.equal(d.castFocus.supportingCastBudget, 1);
  });

  it("simulation settings skip single-primary focus line and allow multi cast budget", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "simulation",
      primaryCharacterName: "서윤",
      establishedActiveCastNames: ["서윤", "도진", "관리 AI 라움"],
      chatId: 15,
      currentTurn: 2,
      currentUserMessage: "경보가 울렸다.",
    });
    assert.equal(d.castFocus.sceneCastMode, "simulation");
    assert.ok(d.castFocus.supportingCastBudget >= 2);
    const block = renderSceneDirectiveForPrompt(d);
    assert.doesNotMatch(block, /직접 발화 중심:/);
  });

  it("explicit party flag resolves to ensemble without single-primary line", () => {
    const focus = resolveSceneCastFocus({
      contentKind: "character",
      primaryCharacterName: "리더",
      party: true,
      establishedActiveCastNames: ["리더", "부관", "정찰"],
    });
    assert.equal(focus.sceneCastMode, "ensemble");
    assert.equal(renderPrimaryFocusLine(focus), null);
    assert.ok(focus.supportingCastBudget >= 2);
  });

  it("wire constraints: no ban-list style additions in avoid for primary focus", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 16,
      currentTurn: 1,
      currentUserMessage: "밥 먹자.",
    });
    const joined = d.avoid.join(" ");
    assert.doesNotMatch(joined, /NPC|직원|가이드|센티넬|퇴장|발화자/);
  });

  it("single_primary activeSpeakingCast defaults to [primary] only when no known supporting cast", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 17,
      currentTurn: 1,
      currentUserMessage: "밥 먹자.",
    });
    assert.deepEqual(d.castFocus.activeSpeakingCast, ["태형"]);
  });

  it("single_primary selects optional supporting when user cue mentions a known NPC name", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      knownSupportingCastNames: ["윤태건", "서진화"],
      chatId: 18,
      currentTurn: 1,
      currentUserMessage: "태건이 어디 있지?",
    });
    assert.deepEqual(d.castFocus.activeSpeakingCast, ["태형", "윤태건"]);
  });

  it("single_primary does not add optional supporting when no positive signal", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      knownSupportingCastNames: ["윤태건", "서진화"],
      chatId: 19,
      currentTurn: 1,
      currentUserMessage: "응. 여기서 조금 쉬자.",
    });
    assert.deepEqual(d.castFocus.activeSpeakingCast, ["태형"]);
  });

  it("simulation/ensemble activeSpeakingCast includes all established cast", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "simulation",
      primaryCharacterName: "서윤",
      establishedActiveCastNames: ["도진", "관리 AI 라움"],
      chatId: 20,
      currentTurn: 1,
      currentUserMessage: "경보.",
    });
    assert.ok(d.castFocus.activeSpeakingCast.includes("서윤"));
    assert.ok(d.castFocus.activeSpeakingCast.includes("도진"));
    assert.ok(d.castFocus.activeSpeakingCast.includes("관리 AI 라움"));
  });

  it("new focus line concentrates dialogue on primary interaction", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 21,
      currentTurn: 1,
      currentUserMessage: "응.",
    });
    const line = renderPrimaryFocusLine(d.castFocus);
    assert.ok(line);
    assert.match(line!, /직접 발화 중심: 태형\./);
    assert.match(line!, /메인 캐릭터와 유저의 현재 상호작용을 이어가며/);
    assert.match(line!, /서술·메시지·환경 변화로 통합한다/);
  });
});
