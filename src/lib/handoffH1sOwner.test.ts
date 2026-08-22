import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendAdultHandoffPrompt,
  buildSceneContinuityPacket,
  DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  extractHandoffContinuityFromAssistantText,
  reconcileHandoffContinuityWithCurrentUser,
} from "@/lib/adultSceneRouting";

const OWNER = DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION;

describe("H1S single handoff owner semantics", () => {
  it("CURRENT_USER_NEWEST_STATE_PRESERVED", () => {
    assert.match(OWNER, /현재 사용자 턴 전체가 최신 장면 상태다/);
    assert.match(OWNER, /사용자 턴을 더 극적인 새 \[B\] 행동으로 다시 쓰지 않는다/);
    assert.doesNotMatch(OWNER, /직전 assistant 출력의 바로 다음 순간부터/);
  });

  it("VISIBLE_PRIOR_SCENE_CONTINUITY_PRESERVED", () => {
    assert.match(OWNER, /보이는 이야기 연속이다/);
    assert.match(OWNER, /의상·장비·신체\/감각/);
    assert.doesNotMatch(OWNER, /잘못된 의상/);
    assert.doesNotMatch(OWNER, /우연한 오류보다 우선/);
  });

  it("SOURCE_CHARACTER_VOICE_CONTINUITY_PRESENT", () => {
    assert.match(OWNER, /직전 말투·유머·장난/);
    assert.match(OWNER, /일반 지배적 성인 RP 말투로 바꾸지 않는다/);
  });

  it("NEW_USER_ACTION_CHAIN_PROHIBITED", () => {
    assert.match(OWNER, /새 의도적 \[B\] 행동 사슬을 만들지 않는다/);
    assert.match(OWNER, /이미 시작된 행동의 즉시 물리적 결과만 실현/);
  });

  it("QUESTION_USER_ANSWER_OWNERSHIP_PRESENT", () => {
    assert.match(OWNER, /같은 턴에서 \[B\]의 대답이나 대답 행동을 쓰지 않는다/);
    assert.match(OWNER, /계속\/중단을 다시 묻지 않는다/);
    assert.match(OWNER, /수사·도발은 허용한다/);
  });

  it("UNKNOWN_LOCATION_NEUTRALITY_PRESENT", () => {
    assert.match(OWNER, /기능적 장소를 확정하지 않는다/);
    assert.match(OWNER, /실내·방 안·닫힌 공간/);
  });

  it("stale packet heuristics omitted; current user outranks corridor", () => {
    const extracted = reconcileHandoffContinuityWithCurrentUser({
      text: "로비 중앙의 분수대를 지나 서쪽 통로로 접어들자, 형광 라인이 긴 복도를 비추고 있었다.",
      characterName: "라이크",
      personaName: "렌",
      currentUserText: "문을 닫고 가까이 다가온다. 합의된 성인 장면을 이어간다. 옷을 천천히 벗기며 키스한다.",
    });
    const packet = buildSceneContinuityPacket({
      previousSceneMode: "normal",
      sexualContextActive: true,
      ...extracted,
    });
    assert.equal(packet.location, undefined);
    assert.equal(packet.unfinishedAction, undefined);
    assert.equal(packet.currentSpeechState, undefined);
    const system = appendAdultHandoffPrompt("SYSTEM", packet);
    assert.equal((system.match(/현재 사용자 턴 전체가 최신 장면 상태다/g) ?? []).length, 1);
  });

  it("extract helper returns contact only", () => {
    const extracted = extractHandoffContinuityFromAssistantText({
      text: "호텔 침실에서 라이크가 렌의 허리를 감싸 안았다. 「괜찮아?」",
      characterName: "라이크",
      personaName: "렌",
    });
    assert.equal("location" in extracted, false);
    assert.equal(extracted.previousActionActor, "라이크");
  });
});
